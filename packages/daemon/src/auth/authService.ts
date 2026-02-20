/**
 * Single-user authentication service.
 *
 * Handles password hashing (Bun.password / Argon2id), session tokens,
 * TOTP MFA with QR code generation, and recovery codes.
 */

import * as crypto from "node:crypto";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { decrypt, type EncryptedBlob, encrypt } from "../crypto/encryption";
import type { AuthSessionRecord, Database } from "../db/db";

const SESSION_TOKEN_BYTES = 32;
const SESSION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ONBOARDING_TOKEN_BYTES = 32;
const ONBOARDING_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const TOTP_WINDOW = 1; // ±1 step (90 seconds total)
const RECOVERY_CODE_COUNT = 8;
const MIN_PASSWORD_LENGTH = 8;

export interface LoginResult {
  token: string;
}

export interface MfaRequiredResult {
  mfaRequired: true;
}

export interface MfaSetupRequiredResult {
  mfaSetupRequired: true;
  onboardingToken: string;
}

export interface TotpSetupResult {
  secret: string;
  otpauthUri: string;
  qrDataUrl: string;
}

export interface TotpVerifyResult {
  recoveryCodes: string[];
}

export interface OnboardingTotpVerifyResult extends TotpVerifyResult {
  token: string;
}

export class AuthService {
  private pendingTotpSecret: string | null = null;

  constructor(
    private db: Database,
    private encryptionKey: Buffer
  ) {}

  // ─── Setup ────────────────────────────────────────────────────────

  isSetupRequired(): boolean {
    return !this.db.hasAuthConfig();
  }

  isMfaSetupPending(): boolean {
    const config = this.db.getAuthConfig();
    if (!config) {
      return false;
    }
    return config.mfaSetupPending;
  }

  async setupPassword(
    password: string,
    _ip: string | null,
    _userAgent: string | null
  ): Promise<MfaSetupRequiredResult> {
    if (!this.isSetupRequired()) {
      throw new Error("Password is already configured");
    }
    this.validatePassword(password);

    const hash = await Bun.password.hash(password, {
      algorithm: "argon2id",
      memoryCost: 65536,
      timeCost: 3,
    });

    const onboarding = this.generateOnboardingToken();
    this.db.createAuthConfig(hash, {
      mfaSetupPending: true,
      onboardingTokenHash: onboarding.tokenHash,
      onboardingTokenExpiresAt: onboarding.expiresAt,
    });

    return {
      mfaSetupRequired: true,
      onboardingToken: onboarding.rawToken,
    };
  }

  // ─── Login ────────────────────────────────────────────────────────

  async login(
    password: string,
    totpCode: string | undefined,
    ip: string | null,
    userAgent: string | null
  ): Promise<LoginResult | MfaRequiredResult | MfaSetupRequiredResult> {
    const config = this.db.getAuthConfig();
    if (!config) {
      throw new Error("Authentication not configured");
    }

    const validPassword = await Bun.password.verify(password, config.passwordHash);
    if (!validPassword) {
      throw new AuthError("Invalid password", "INVALID_CREDENTIALS");
    }

    // Setup hardening: first-run is incomplete until MFA setup is verified.
    if (config.mfaSetupPending) {
      const onboarding = this.generateOnboardingToken();
      this.db.updateAuthOnboardingState(true, onboarding.tokenHash, onboarding.expiresAt);
      return {
        mfaSetupRequired: true,
        onboardingToken: onboarding.rawToken,
      };
    }

    // Check MFA
    if (config.totpEnabled) {
      if (!totpCode) {
        return { mfaRequired: true };
      }

      const totpValid = this.verifyTotpCode(config, totpCode);
      if (!totpValid) {
        // Try recovery code
        const recoveryValid = this.tryRecoveryCode(config, totpCode);
        if (!recoveryValid) {
          throw new AuthError("Invalid TOTP code", "INVALID_TOTP");
        }
      }
    }

    return this.createSession(ip, userAgent);
  }

  validateOnboardingToken(tokenHash: string): boolean {
    const config = this.db.getAuthConfig();
    if (!config) {
      return false;
    }
    if (!config.mfaSetupPending) {
      return false;
    }
    if (!(config.onboardingTokenHash && config.onboardingTokenExpiresAt)) {
      return false;
    }
    if (Date.now() > config.onboardingTokenExpiresAt) {
      this.db.updateAuthOnboardingState(true, null, null);
      return false;
    }

    try {
      if (tokenHash.length !== config.onboardingTokenHash.length) {
        return false;
      }
      return crypto.timingSafeEqual(
        Buffer.from(tokenHash, "hex"),
        Buffer.from(config.onboardingTokenHash, "hex")
      );
    } catch {
      return false;
    }
  }

  // ─── Session Management ───────────────────────────────────────────

  validateSession(tokenHash: string): boolean {
    const session = this.db.getAuthSession(tokenHash);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
      this.db.deleteAuthSession(tokenHash);
      return false;
    }
    return true;
  }

  touchSession(tokenHash: string): void {
    const newExpiry = Date.now() + SESSION_EXPIRY_MS;
    this.db.touchAuthSession(tokenHash, newExpiry);
  }

  revokeSession(tokenHash: string): void {
    this.db.deleteAuthSession(tokenHash);
  }

  revokeAllSessions(exceptTokenHash?: string): void {
    if (exceptTokenHash) {
      const sessions = this.db.listAuthSessions();
      for (const session of sessions) {
        if (session.tokenHash !== exceptTokenHash) {
          this.db.deleteAuthSession(session.tokenHash);
        }
      }
    } else {
      this.db.deleteAllAuthSessions();
    }
  }

  listSessions(): AuthSessionRecord[] {
    return this.db.listAuthSessions();
  }

  cleanupExpiredSessions(): number {
    return this.db.cleanupExpiredAuthSessions();
  }

  // ─── Password ─────────────────────────────────────────────────────

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const config = this.db.getAuthConfig();
    if (!config) throw new Error("Authentication not configured");

    const valid = await Bun.password.verify(currentPassword, config.passwordHash);
    if (!valid) {
      throw new AuthError("Current password is incorrect", "INVALID_CREDENTIALS");
    }

    this.validatePassword(newPassword);
    const hash = await Bun.password.hash(newPassword, {
      algorithm: "argon2id",
      memoryCost: 65536,
      timeCost: 3,
    });

    this.db.updateAuthPassword(hash);
    // Revoke all sessions to force re-login
    this.db.deleteAllAuthSessions();
  }

  async resetPassword(newPassword: string): Promise<void> {
    this.validatePassword(newPassword);
    const hash = await Bun.password.hash(newPassword, {
      algorithm: "argon2id",
      memoryCost: 65536,
      timeCost: 3,
    });

    if (this.isSetupRequired()) {
      this.db.createAuthConfig(hash);
    } else {
      this.db.updateAuthPassword(hash);
    }
    this.db.updateAuthOnboardingState(false, null, null);
    this.db.deleteAllAuthSessions();
  }

  // ─── MFA ──────────────────────────────────────────────────────────

  async generateTotpSetup(): Promise<TotpSetupResult> {
    const secret = new OTPAuth.Secret();
    const totp = new OTPAuth.TOTP({
      issuer: "CodePiper",
      label: "admin",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret,
    });

    const otpauthUri = totp.toString();
    const qrDataUrl = await QRCode.toDataURL(otpauthUri);

    // Store pending secret (not persisted until verified)
    this.pendingTotpSecret = secret.base32;

    return {
      secret: secret.base32,
      otpauthUri,
      qrDataUrl,
    };
  }

  async verifyAndEnableTotp(totpCode: string): Promise<TotpVerifyResult> {
    if (!this.pendingTotpSecret) {
      throw new AuthError(
        "No pending TOTP setup. Please start MFA setup again.",
        "NO_PENDING_TOTP"
      );
    }

    const totp = new OTPAuth.TOTP({
      issuer: "CodePiper",
      label: "admin",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(this.pendingTotpSecret),
    });

    const delta = totp.validate({ token: totpCode, window: TOTP_WINDOW });
    if (delta === null) {
      throw new AuthError("Invalid TOTP code", "INVALID_TOTP");
    }

    // Encrypt and persist
    const blob = encrypt(this.pendingTotpSecret, this.encryptionKey);
    const encryptedSecret = JSON.stringify(blob);

    // Generate recovery codes
    const recoveryCodes = this.generateRecoveryCodes();
    const hashedCodes = recoveryCodes.map((code) =>
      this.hashRecoveryCode(code.replace(/-/g, "").toLowerCase())
    );
    const recoveryBlob = encrypt(JSON.stringify(hashedCodes), this.encryptionKey);
    const encryptedRecovery = JSON.stringify(recoveryBlob);

    this.db.updateAuthTotp(encryptedSecret, true, encryptedRecovery);
    this.db.updateAuthOnboardingState(false, null, null);
    this.pendingTotpSecret = null;

    return { recoveryCodes };
  }

  async completeOnboardingMfa(
    totpCode: string,
    ip: string | null,
    userAgent: string | null
  ): Promise<OnboardingTotpVerifyResult> {
    const config = this.db.getAuthConfig();
    if (!config?.mfaSetupPending) {
      throw new AuthError("MFA onboarding is not pending", "MFA_SETUP_NOT_PENDING");
    }

    const result = await this.verifyAndEnableTotp(totpCode);
    const session = this.createSession(ip, userAgent);
    return {
      recoveryCodes: result.recoveryCodes,
      token: session.token,
    };
  }

  resetMfa(): void {
    this.db.updateAuthTotp(null, false, null);
    this.db.updateAuthOnboardingState(false, null, null);
    this.db.deleteAllAuthSessions();
  }

  // ─── Private Helpers ──────────────────────────────────────────────

  private createSession(ip: string | null, userAgent: string | null): LoginResult {
    const rawToken = crypto.randomBytes(SESSION_TOKEN_BYTES).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = Date.now() + SESSION_EXPIRY_MS;

    this.db.createAuthSession(tokenHash, ip, userAgent, expiresAt);

    return { token: rawToken };
  }

  private validatePassword(password: string): void {
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      throw new AuthError(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        "WEAK_PASSWORD"
      );
    }
  }

  private verifyTotpCode(
    config: { totpSecretEncrypted: string | null; totpEnabled: boolean },
    code: string
  ): boolean {
    if (!config.totpSecretEncrypted) return false;

    let secret: string;
    try {
      const blob: EncryptedBlob = JSON.parse(config.totpSecretEncrypted);
      secret = decrypt(blob, this.encryptionKey);
    } catch (err) {
      console.error("[auth] Failed to decrypt TOTP secret — encryption key may have changed:", err);
      throw new AuthError(
        "Unable to verify TOTP: encrypted data is corrupt or the encryption key has changed. Use CLI 'codepiper auth reset-mfa' to reset MFA.",
        "TOTP_DECRYPT_FAILED"
      );
    }

    const totp = new OTPAuth.TOTP({
      issuer: "CodePiper",
      label: "admin",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });

    const delta = totp.validate({ token: code, window: TOTP_WINDOW });
    return delta !== null;
  }

  private tryRecoveryCode(
    config: { recoveryCodesEncrypted: string | null },
    code: string
  ): boolean {
    if (!config.recoveryCodesEncrypted) return false;

    let hashedCodes: string[];
    try {
      const blob: EncryptedBlob = JSON.parse(config.recoveryCodesEncrypted);
      const hashedCodesJson = decrypt(blob, this.encryptionKey);
      hashedCodes = JSON.parse(hashedCodesJson);
    } catch (err) {
      console.error("[auth] Failed to decrypt recovery codes:", err);
      throw new AuthError(
        "Unable to verify recovery code: encrypted data is corrupt. Use CLI 'codepiper auth reset-mfa' to reset MFA.",
        "RECOVERY_DECRYPT_FAILED"
      );
    }

    const inputHash = this.hashRecoveryCode(code.replace(/-/g, "").toLowerCase());

    // Constant-time comparison over fixed iteration count to prevent timing leaks
    let matchIndex = -1;
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
      const storedHash = hashedCodes[i];
      if (storedHash !== undefined) {
        if (crypto.timingSafeEqual(Buffer.from(storedHash, "hex"), Buffer.from(inputHash, "hex"))) {
          matchIndex = i;
        }
      }
    }

    if (matchIndex === -1) return false;

    // Remove used recovery code and log usage
    console.warn(`[auth] Recovery code used (${hashedCodes.length - 1} remaining)`);
    hashedCodes.splice(matchIndex, 1);
    const newBlob = encrypt(JSON.stringify(hashedCodes), this.encryptionKey);
    const config2 = this.db.getAuthConfig();
    if (config2) {
      this.db.updateAuthTotp(
        config2.totpSecretEncrypted,
        config2.totpEnabled,
        JSON.stringify(newBlob)
      );
    }

    return true;
  }

  private generateRecoveryCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
      const raw = crypto.randomBytes(4).toString("hex"); // 8 hex chars
      codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
    }
    return codes;
  }

  private hashRecoveryCode(code: string): string {
    return crypto.createHash("sha256").update(code).digest("hex");
  }

  private generateOnboardingToken(): {
    rawToken: string;
    tokenHash: string;
    expiresAt: number;
  } {
    const rawToken = crypto.randomBytes(ONBOARDING_TOKEN_BYTES).toString("hex");
    return {
      rawToken,
      tokenHash: hashToken(rawToken),
      expiresAt: Date.now() + ONBOARDING_TOKEN_EXPIRY_MS,
    };
  }
}

/**
 * Hash a raw session token for storage.
 */
export function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Auth-specific error with error code.
 */
export class AuthError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = "AuthError";
  }
}
