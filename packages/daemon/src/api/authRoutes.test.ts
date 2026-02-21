import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as crypto from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import * as OTPAuth from "otpauth";
import { AuthService, hashToken } from "../auth/authService";
import { Database } from "../db/db";
import {
  handleAuthSetup,
  handleAuthStatus,
  handleCliResetPassword,
  handleMfaVerify,
} from "./authRoutes";
import type { RouteContext } from "./routes";

describe("authRoutes onboarding MFA hardening", () => {
  let db: Database;
  let authService: AuthService;
  let ctx: RouteContext;
  const testDbPath = "/tmp/codepiper-auth-routes-test.db";
  const encryptionKey = crypto.randomBytes(32);

  beforeEach(async () => {
    if (existsSync(testDbPath)) {
      await rm(testDbPath);
    }
    db = new Database(testDbPath);
    await db.init();
    authService = new AuthService(db, encryptionKey);
    ctx = { db, authService } as RouteContext;
  });

  afterEach(async () => {
    db.close();
    if (existsSync(testDbPath)) {
      await rm(testDbPath);
    }
  });

  it("auth setup returns onboarding requirement and onboarding cookie", async () => {
    const req = new Request("http://localhost/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "test-password-123" }),
    });

    const response = await handleAuthSetup(req, ctx);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.mfaSetupRequired).toBe(true);

    const setCookie = response.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("codepiper_onboarding=");
    expect(setCookie).toContain("codepiper_session=");
    expect(authService.isMfaSetupPending()).toBe(true);
  });

  it("adds Secure cookie attribute on HTTPS auth setup responses", async () => {
    const req = new Request("https://example.com/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "test-password-123" }),
    });

    const response = await handleAuthSetup(req, ctx);
    expect(response.status).toBe(200);

    const setCookie = response.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("Secure");
  });

  it("auth status reports onboardingPending without mfaSetupRequired when onboarding cookie is absent", async () => {
    await authService.setupPassword("test-password-123", "127.0.0.1", "TestAgent");
    const req = new Request("http://localhost/auth/status");

    const response = await handleAuthStatus(req, ctx);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.setupRequired).toBe(false);
    expect(body.authenticated).toBe(false);
    expect(body.onboardingPending).toBe(true);
    expect(body.mfaSetupRequired).toBe(false);
  });

  it("auth status reports mfaSetupRequired when onboarding cookie is valid", async () => {
    const setupReq = new Request("http://localhost/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "test-password-123" }),
    });
    const setupResponse = await handleAuthSetup(setupReq, ctx);
    const setupCookieHeader = setupResponse.headers.get("Set-Cookie") ?? "";
    const onboardingToken = setupCookieHeader.match(/codepiper_onboarding=([a-f0-9]{64})/)?.[1];
    if (!onboardingToken) {
      throw new Error("Expected onboarding token cookie");
    }

    const req = new Request("http://localhost/auth/status", {
      headers: {
        Cookie: `codepiper_onboarding=${onboardingToken}`,
      },
    });

    const response = await handleAuthStatus(req, ctx);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.setupRequired).toBe(false);
    expect(body.onboardingPending).toBe(true);
    expect(body.mfaSetupRequired).toBe(true);
  });

  it("mfa verify with onboarding cookie issues session and clears onboarding state", async () => {
    const setupReq = new Request("http://localhost/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "test-password-123" }),
    });
    const setupResponse = await handleAuthSetup(setupReq, ctx);
    const setupCookieHeader = setupResponse.headers.get("Set-Cookie") ?? "";
    const onboardingToken = setupCookieHeader.match(/codepiper_onboarding=([a-f0-9]{64})/)?.[1];
    if (!onboardingToken) {
      throw new Error("Expected onboarding token cookie");
    }

    const setup = await authService.generateTotpSetup();
    const totp = new OTPAuth.TOTP({
      issuer: "CodePiper",
      label: "admin",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(setup.secret),
    });
    const validCode = totp.generate();

    const verifyReq = new Request("http://localhost/auth/mfa/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `codepiper_onboarding=${onboardingToken}`,
      },
      body: JSON.stringify({ totpCode: validCode }),
    });

    const verifyResponse = await handleMfaVerify(verifyReq, ctx);
    expect(verifyResponse.status).toBe(200);
    const verifyBody = await verifyResponse.json();
    expect(Array.isArray(verifyBody.recoveryCodes)).toBe(true);
    expect(typeof verifyBody.token).toBe("string");

    expect(authService.isMfaSetupPending()).toBe(false);
    expect(authService.validateSession(hashToken(verifyBody.token))).toBe(true);

    const verifySetCookie = verifyResponse.headers.get("Set-Cookie") ?? "";
    expect(verifySetCookie).toContain("codepiper_session=");
    expect(verifySetCookie).toContain("codepiper_onboarding=;");
  });

  it("cli reset-password can generate and return a secure password", async () => {
    await authService.resetPassword("initial-password-123");
    const req = new Request("http://localhost/auth/cli/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generate: true }),
    });

    const response = await handleCliResetPassword(req, ctx);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.generated).toBe(true);
    expect(typeof body.password).toBe("string");
    expect(body.password.length).toBeGreaterThanOrEqual(8);
    expect(authService.isMfaSetupPending()).toBe(true);
  });
});
