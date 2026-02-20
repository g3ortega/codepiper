import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as crypto from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { Database } from "../db/db";
import { AuthError, AuthService, hashToken } from "./authService";

describe("AuthService", () => {
  let db: Database;
  let authService: AuthService;
  const testDbPath = "/tmp/codepiper-auth-test.db";
  const encryptionKey = crypto.randomBytes(32);

  beforeEach(async () => {
    if (existsSync(testDbPath)) {
      await rm(testDbPath);
    }
    db = new Database(testDbPath);
    await db.init();
    authService = new AuthService(db, encryptionKey);
  });

  afterEach(async () => {
    db.close();
    if (existsSync(testDbPath)) {
      await rm(testDbPath);
    }
  });

  describe("Setup", () => {
    it("should report setup required when no password is set", () => {
      expect(authService.isSetupRequired()).toBe(true);
    });

    it("should set up password and return onboarding token", async () => {
      const result = await authService.setupPassword("test-password-123", "127.0.0.1", "TestAgent");
      expect(result.mfaSetupRequired).toBe(true);
      expect(result.onboardingToken).toBeDefined();
      expect(result.onboardingToken.length).toBe(64); // 32 bytes hex
      expect(authService.isSetupRequired()).toBe(false);
      expect(authService.isMfaSetupPending()).toBe(true);
    });

    it("requires MFA onboarding before regular login sessions are issued", async () => {
      await authService.setupPassword("test-password-123", "127.0.0.1", "TestAgent");
      const loginResult = await authService.login(
        "test-password-123",
        undefined,
        "127.0.0.1",
        "TestAgent"
      );
      expect("mfaSetupRequired" in loginResult).toBe(true);
    });

    it("completes onboarding MFA and issues a session token", async () => {
      const setupResult = await authService.setupPassword(
        "test-password-123",
        "127.0.0.1",
        "TestAgent"
      );
      expect(authService.validateOnboardingToken(hashToken(setupResult.onboardingToken))).toBe(
        true
      );

      const setup = await authService.generateTotpSetup();
      const OTPAuth = await import("otpauth");
      const totp = new OTPAuth.TOTP({
        issuer: "CodePiper",
        label: "admin",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(setup.secret),
      });
      const validCode = totp.generate();

      const verifyResult = await authService.completeOnboardingMfa(
        validCode,
        "127.0.0.1",
        "TestAgent"
      );
      expect(verifyResult.token.length).toBe(64);
      expect(verifyResult.recoveryCodes.length).toBe(8);
      expect(authService.isMfaSetupPending()).toBe(false);
      expect(authService.validateSession(hashToken(verifyResult.token))).toBe(true);
      expect(authService.validateOnboardingToken(hashToken(setupResult.onboardingToken))).toBe(
        false
      );
    });

    it("should reject setup if already configured", async () => {
      await authService.setupPassword("test-password-123", "127.0.0.1", "TestAgent");
      await expect(
        authService.setupPassword("another-password", "127.0.0.1", "TestAgent")
      ).rejects.toThrow("Password is already configured");
    });

    it("should reject password shorter than 8 characters", async () => {
      await expect(authService.setupPassword("short", "127.0.0.1", "TestAgent")).rejects.toThrow(
        "at least 8 characters"
      );
    });
  });

  describe("Login", () => {
    beforeEach(async () => {
      await authService.resetPassword("correct-password");
    });

    it("should login with correct password", async () => {
      const result = await authService.login(
        "correct-password",
        undefined,
        "127.0.0.1",
        "TestAgent"
      );
      expect("token" in result).toBe(true);
      if ("token" in result) {
        expect(result.token.length).toBe(64);
      }
    });

    it("should reject wrong password", async () => {
      await expect(
        authService.login("wrong-password", undefined, "127.0.0.1", "TestAgent")
      ).rejects.toThrow("Invalid password");
    });

    it("should throw AuthError with code on wrong password", async () => {
      try {
        await authService.login("wrong-password", undefined, "127.0.0.1", "TestAgent");
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(AuthError);
        expect((error as AuthError).code).toBe("INVALID_CREDENTIALS");
      }
    });
  });

  describe("Session Management", () => {
    let sessionToken: string;

    beforeEach(async () => {
      await authService.resetPassword("test-password");
      const loginResult = await authService.login(
        "test-password",
        undefined,
        "127.0.0.1",
        "TestAgent"
      );
      if (!("token" in loginResult)) {
        throw new Error("Expected token");
      }
      sessionToken = loginResult.token;
    });

    it("should validate a valid session", () => {
      const tokenHash = hashToken(sessionToken);
      expect(authService.validateSession(tokenHash)).toBe(true);
    });

    it("should reject an invalid token hash", () => {
      const fakeHash = hashToken("nonexistent-token");
      expect(authService.validateSession(fakeHash)).toBe(false);
    });

    it("should revoke a session", () => {
      const tokenHash = hashToken(sessionToken);
      authService.revokeSession(tokenHash);
      expect(authService.validateSession(tokenHash)).toBe(false);
    });

    it("should revoke all sessions", async () => {
      const result2 = await authService.login("test-password", undefined, "127.0.0.1", "Agent2");
      if (!("token" in result2)) throw new Error("Expected token");
      const hash1 = hashToken(sessionToken);
      const hash2 = hashToken(result2.token);

      authService.revokeAllSessions();

      expect(authService.validateSession(hash1)).toBe(false);
      expect(authService.validateSession(hash2)).toBe(false);
    });

    it("should revoke all sessions except current", async () => {
      const result2 = await authService.login("test-password", undefined, "127.0.0.1", "Agent2");
      if (!("token" in result2)) throw new Error("Expected token");
      const hash1 = hashToken(sessionToken);
      const hash2 = hashToken(result2.token);

      authService.revokeAllSessions(hash2);

      expect(authService.validateSession(hash1)).toBe(false);
      expect(authService.validateSession(hash2)).toBe(true);
    });

    it("should list sessions", async () => {
      await authService.login("test-password", undefined, "10.0.0.1", "Firefox");
      const sessions = authService.listSessions();
      expect(sessions.length).toBe(2);
    });

    it("should touch session to extend expiry", () => {
      const tokenHash = hashToken(sessionToken);
      const sessionBefore = db.getAuthSession(tokenHash);
      expect(sessionBefore).toBeDefined();
      const expiryBefore = sessionBefore?.expiresAt ?? 0;

      authService.touchSession(tokenHash);

      const sessionAfter = db.getAuthSession(tokenHash);
      expect(sessionAfter?.expiresAt ?? 0).toBeGreaterThanOrEqual(expiryBefore);
    });
  });

  describe("Password Change", () => {
    beforeEach(async () => {
      await authService.resetPassword("original-password");
    });

    it("should change password with correct current password", async () => {
      await authService.changePassword("original-password", "new-password-123");
      // Old password should no longer work
      await expect(
        authService.login("original-password", undefined, "127.0.0.1", "TestAgent")
      ).rejects.toThrow("Invalid password");
      // New password should work
      const result = await authService.login(
        "new-password-123",
        undefined,
        "127.0.0.1",
        "TestAgent"
      );
      expect("token" in result).toBe(true);
    });

    it("should reject change with wrong current password", async () => {
      await expect(
        authService.changePassword("wrong-password", "new-password-123")
      ).rejects.toThrow("Current password is incorrect");
    });

    it("should reject weak new password", async () => {
      await expect(authService.changePassword("original-password", "short")).rejects.toThrow(
        "at least 8 characters"
      );
    });

    it("should revoke all sessions after password change", async () => {
      const loginResult = await authService.login(
        "original-password",
        undefined,
        "127.0.0.1",
        "TestAgent"
      );
      if (!("token" in loginResult)) throw new Error("Expected token");
      const tokenHash = hashToken(loginResult.token);

      await authService.changePassword("original-password", "new-password-123");
      expect(authService.validateSession(tokenHash)).toBe(false);
    });
  });

  describe("Password Reset (CLI)", () => {
    it("should reset password when none exists", async () => {
      await authService.resetPassword("new-password-123");
      expect(authService.isSetupRequired()).toBe(false);
      const result = await authService.login(
        "new-password-123",
        undefined,
        "127.0.0.1",
        "TestAgent"
      );
      expect("token" in result).toBe(true);
    });

    it("should reset password when one exists", async () => {
      await authService.resetPassword("old-password");
      await authService.resetPassword("reset-password-123");
      const result = await authService.login(
        "reset-password-123",
        undefined,
        "127.0.0.1",
        "TestAgent"
      );
      expect("token" in result).toBe(true);
    });
  });

  describe("MFA (TOTP)", () => {
    beforeEach(async () => {
      await authService.resetPassword("test-password");
    });

    it("should generate TOTP setup with QR code", async () => {
      const setup = await authService.generateTotpSetup();
      expect(setup.secret).toBeDefined();
      expect(setup.secret.length).toBeGreaterThan(0);
      expect(setup.otpauthUri).toContain("otpauth://totp/");
      expect(setup.qrDataUrl).toContain("data:image/png;base64,");
    });

    it("should reject verify without prior setup call", async () => {
      await expect(authService.verifyAndEnableTotp("123456")).rejects.toThrow(
        "No pending TOTP setup"
      );
    });

    it("should verify and enable TOTP with correct code", async () => {
      const setup = await authService.generateTotpSetup();

      // Generate a valid TOTP code from the secret
      const OTPAuth = await import("otpauth");
      const totp = new OTPAuth.TOTP({
        issuer: "CodePiper",
        label: "admin",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(setup.secret),
      });
      const validCode = totp.generate();

      const result = await authService.verifyAndEnableTotp(validCode);
      expect(result.recoveryCodes).toBeDefined();
      expect(result.recoveryCodes.length).toBe(8);
      // Each code should be in xxxx-xxxx format
      for (const code of result.recoveryCodes) {
        expect(code).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}$/);
      }
    });

    it("should reject invalid TOTP code during verification", async () => {
      await authService.generateTotpSetup();
      await expect(authService.verifyAndEnableTotp("000000")).rejects.toThrow("Invalid TOTP code");
    });

    it("should require TOTP code during login when MFA is enabled", async () => {
      // Enable MFA
      const setup = await authService.generateTotpSetup();
      const OTPAuth = await import("otpauth");
      const totp = new OTPAuth.TOTP({
        issuer: "CodePiper",
        label: "admin",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(setup.secret),
      });
      await authService.verifyAndEnableTotp(totp.generate());

      // Login without TOTP should return mfaRequired
      const result = await authService.login("test-password", undefined, "127.0.0.1", "TestAgent");
      expect("mfaRequired" in result).toBe(true);
    });

    it("should login successfully with correct TOTP code", async () => {
      const setup = await authService.generateTotpSetup();
      const OTPAuth = await import("otpauth");
      const totp = new OTPAuth.TOTP({
        issuer: "CodePiper",
        label: "admin",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(setup.secret),
      });
      await authService.verifyAndEnableTotp(totp.generate());

      const loginResult = await authService.login(
        "test-password",
        totp.generate(),
        "127.0.0.1",
        "TestAgent"
      );
      expect("token" in loginResult).toBe(true);
    });

    it("should reject login with wrong TOTP code", async () => {
      const setup = await authService.generateTotpSetup();
      const OTPAuth = await import("otpauth");
      const totp = new OTPAuth.TOTP({
        issuer: "CodePiper",
        label: "admin",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(setup.secret),
      });
      await authService.verifyAndEnableTotp(totp.generate());

      await expect(
        authService.login("test-password", "000000", "127.0.0.1", "TestAgent")
      ).rejects.toThrow("Invalid TOTP code");
    });

    it("should login with recovery code", async () => {
      const setup = await authService.generateTotpSetup();
      const OTPAuth = await import("otpauth");
      const totp = new OTPAuth.TOTP({
        issuer: "CodePiper",
        label: "admin",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(setup.secret),
      });
      const verifyResult = await authService.verifyAndEnableTotp(totp.generate());
      const recoveryCode = verifyResult.recoveryCodes[0];

      const loginResult = await authService.login(
        "test-password",
        recoveryCode,
        "127.0.0.1",
        "TestAgent"
      );
      expect("token" in loginResult).toBe(true);
    });

    it("should not reuse a recovery code", async () => {
      const setup = await authService.generateTotpSetup();
      const OTPAuth = await import("otpauth");
      const totp = new OTPAuth.TOTP({
        issuer: "CodePiper",
        label: "admin",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(setup.secret),
      });
      const verifyResult = await authService.verifyAndEnableTotp(totp.generate());
      const recoveryCode = verifyResult.recoveryCodes[0];

      // First use should succeed
      const loginResult = await authService.login(
        "test-password",
        recoveryCode,
        "127.0.0.1",
        "TestAgent"
      );
      expect("token" in loginResult).toBe(true);

      // Second use should fail
      await expect(
        authService.login("test-password", recoveryCode, "127.0.0.1", "TestAgent")
      ).rejects.toThrow("Invalid TOTP code");
    });

    it("should reset MFA", async () => {
      const setup = await authService.generateTotpSetup();
      const OTPAuth = await import("otpauth");
      const totp = new OTPAuth.TOTP({
        issuer: "CodePiper",
        label: "admin",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(setup.secret),
      });
      await authService.verifyAndEnableTotp(totp.generate());

      authService.resetMfa();

      // Should be able to login without TOTP
      const result = await authService.login("test-password", undefined, "127.0.0.1", "TestAgent");
      expect("token" in result).toBe(true);
    });
  });

  describe("hashToken", () => {
    it("should produce consistent hashes", () => {
      const token = "abc123";
      expect(hashToken(token)).toBe(hashToken(token));
    });

    it("should produce different hashes for different tokens", () => {
      expect(hashToken("token1")).not.toBe(hashToken("token2"));
    });

    it("should produce 64-character hex string", () => {
      const hash = hashToken("test");
      expect(hash.length).toBe(64);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });
  });
});
