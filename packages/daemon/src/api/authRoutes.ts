/**
 * Authentication API route handlers.
 */

import {
  buildClearOnboardingCookie,
  buildClearSessionCookie,
  buildOnboardingCookie,
  buildSessionCookie,
  extractAndHashOnboardingToken,
  extractAndHashToken,
  getClientIp,
  shouldUseSecureCookies,
} from "../auth/authMiddleware";
import { AuthError } from "../auth/authService";
import type { RouteContext } from "./routes";

const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days
const ONBOARDING_MAX_AGE_SECONDS = 24 * 60 * 60; // 24 hours

function getStringField(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  return typeof value === "string" ? value : undefined;
}

function jsonWithCookies(
  payload: Record<string, unknown>,
  status: number,
  cookies: string[]
): Response {
  const headers = new Headers({
    "Content-Type": "application/json",
  });
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(JSON.stringify(payload), { status, headers });
}

// ─── Public Routes ──────────────────────────────────────────────────

export async function handleAuthStatus(req: Request, ctx: RouteContext): Promise<Response> {
  const authService = ctx.authService;
  if (!authService) {
    // Auth not configured — report disabled, NOT authenticated
    return Response.json({
      setupRequired: false,
      mfaEnabled: false,
      onboardingPending: false,
      authenticated: false,
      authEnabled: false,
    });
  }

  const setupRequired = authService.isSetupRequired();
  const onboardingPending = !setupRequired && authService.isMfaSetupPending();
  let mfaSetupRequired = false;
  if (onboardingPending) {
    const onboardingTokenHash = extractAndHashOnboardingToken(req);
    mfaSetupRequired =
      onboardingTokenHash !== null && authService.validateOnboardingToken(onboardingTokenHash);
  }
  const tokenHash = extractAndHashToken(req);
  const authenticated = tokenHash ? authService.validateSession(tokenHash) : false;

  let mfaEnabled = false;
  if (!setupRequired) {
    const config = ctx.db.getAuthConfig();
    mfaEnabled = config?.totpEnabled ?? false;
  }

  return Response.json({
    setupRequired,
    mfaEnabled,
    mfaSetupRequired,
    onboardingPending,
    authenticated,
  });
}

export async function handleAuthSetup(req: Request, ctx: RouteContext): Promise<Response> {
  const authService = ctx.authService;
  if (!authService) {
    return Response.json({ error: "Auth not configured" }, { status: 500 });
  }

  if (!authService.isSetupRequired()) {
    return Response.json({ error: "Password is already configured" }, { status: 400 });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const password = getStringField(body, "password");
    if (!password) {
      return Response.json({ error: "Password is required" }, { status: 400 });
    }

    const ip = getClientIp(req);
    const ua = req.headers.get("User-Agent");
    const result = await authService.setupPassword(password, ip, ua);
    const secureCookie = shouldUseSecureCookies(req);

    return jsonWithCookies({ ok: true, mfaSetupRequired: true }, 200, [
      buildOnboardingCookie(result.onboardingToken, ONBOARDING_MAX_AGE_SECONDS, secureCookie),
      buildClearSessionCookie(secureCookie),
    ]);
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message, code: error.code }, { status: 400 });
    }
    throw error;
  }
}

export async function handleAuthLogin(req: Request, ctx: RouteContext): Promise<Response> {
  const authService = ctx.authService;
  const rateLimiter = ctx.rateLimiter;
  if (!authService) {
    return Response.json({ error: "Auth not configured" }, { status: 500 });
  }

  const ip = getClientIp(req);
  const secureCookie = shouldUseSecureCookies(req);

  // Rate limit check
  if (rateLimiter) {
    const check = rateLimiter.check(ip);
    if (!check.allowed) {
      const retryAfter = Math.ceil((check.retryAfterMs || 0) / 1000);
      return new Response(JSON.stringify({ error: "Too many login attempts", retryAfter }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retryAfter),
        },
      });
    }
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const password = getStringField(body, "password");
    const totpCode = getStringField(body, "totpCode");
    if (!password) {
      return Response.json({ error: "Password is required" }, { status: 400 });
    }

    const ua = req.headers.get("User-Agent");
    const result = await authService.login(password, totpCode, ip, ua);

    if ("mfaSetupRequired" in result) {
      rateLimiter?.recordSuccess(ip);
      return jsonWithCookies({ mfaSetupRequired: true }, 401, [
        buildOnboardingCookie(result.onboardingToken, ONBOARDING_MAX_AGE_SECONDS, secureCookie),
        buildClearSessionCookie(secureCookie),
      ]);
    }

    if ("mfaRequired" in result) {
      return Response.json({ mfaRequired: true }, { status: 401 });
    }

    // Success — reset rate limiter
    rateLimiter?.recordSuccess(ip);

    return new Response(JSON.stringify({ ok: true, token: result.token }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": buildSessionCookie(result.token, SESSION_MAX_AGE_SECONDS, secureCookie),
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      rateLimiter?.recordFailure(ip);
      // Return generic message — don't reveal whether password or TOTP failed
      if (error.code === "INVALID_CREDENTIALS" || error.code === "INVALID_TOTP") {
        return Response.json(
          { error: "Invalid credentials", code: "INVALID_CREDENTIALS" },
          { status: 401 }
        );
      }
      return Response.json({ error: error.message, code: error.code }, { status: 400 });
    }
    throw error;
  }
}

// ─── Authenticated Routes ───────────────────────────────────────────

export async function handleAuthLogout(req: Request, ctx: RouteContext): Promise<Response> {
  const authService = ctx.authService;
  if (!authService) {
    return Response.json({ error: "Auth not configured" }, { status: 500 });
  }

  const tokenHash = extractAndHashToken(req);
  if (tokenHash) {
    authService.revokeSession(tokenHash);
  }
  const secureCookie = shouldUseSecureCookies(req);

  return jsonWithCookies({ ok: true }, 200, [
    buildClearSessionCookie(secureCookie),
    buildClearOnboardingCookie(secureCookie),
  ]);
}

export async function handleAuthChangePassword(req: Request, ctx: RouteContext): Promise<Response> {
  const authService = ctx.authService;
  if (!authService) {
    return Response.json({ error: "Auth not configured" }, { status: 500 });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const currentPassword = getStringField(body, "currentPassword");
    const newPassword = getStringField(body, "newPassword");
    if (!(currentPassword && newPassword)) {
      return Response.json(
        { error: "Both currentPassword and newPassword are required" },
        { status: 400 }
      );
    }

    await authService.changePassword(currentPassword, newPassword);
    const secureCookie = shouldUseSecureCookies(req);

    return jsonWithCookies({ ok: true }, 200, [
      buildClearSessionCookie(secureCookie),
      buildClearOnboardingCookie(secureCookie),
    ]);
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message, code: error.code }, { status: 400 });
    }
    throw error;
  }
}

// ─── MFA Routes ─────────────────────────────────────────────────────

export async function handleMfaSetup(_req: Request, ctx: RouteContext): Promise<Response> {
  const authService = ctx.authService;
  if (!authService) {
    return Response.json({ error: "Auth not configured" }, { status: 500 });
  }

  try {
    const result = await authService.generateTotpSetup();
    return Response.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message, code: error.code }, { status: 400 });
    }
    return Response.json({ error: "Failed to generate MFA setup data" }, { status: 500 });
  }
}

export async function handleMfaVerify(req: Request, ctx: RouteContext): Promise<Response> {
  const authService = ctx.authService;
  if (!authService) {
    return Response.json({ error: "Auth not configured" }, { status: 500 });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const totpCode = getStringField(body, "totpCode");
    if (!totpCode) {
      return Response.json({ error: "TOTP code is required" }, { status: 400 });
    }

    const onboardingTokenHash = extractAndHashOnboardingToken(req);
    const isOnboardingRequest =
      onboardingTokenHash !== null && authService.validateOnboardingToken(onboardingTokenHash);

    if (isOnboardingRequest) {
      const ip = getClientIp(req);
      const ua = req.headers.get("User-Agent");
      const result = await authService.completeOnboardingMfa(totpCode, ip, ua);
      const secureCookie = shouldUseSecureCookies(req);
      return jsonWithCookies({ recoveryCodes: result.recoveryCodes, token: result.token }, 200, [
        buildSessionCookie(result.token, SESSION_MAX_AGE_SECONDS, secureCookie),
        buildClearOnboardingCookie(secureCookie),
      ]);
    }

    const result = await authService.verifyAndEnableTotp(totpCode);
    return Response.json(result);
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message, code: error.code }, { status: 400 });
    }
    throw error;
  }
}

// ─── Session Management Routes ──────────────────────────────────────

export async function handleAuthSessions(_req: Request, ctx: RouteContext): Promise<Response> {
  const authService = ctx.authService;
  if (!authService) {
    return Response.json({ error: "Auth not configured" }, { status: 500 });
  }

  const sessions = authService.listSessions();
  // Redact token hashes — only show metadata
  const redacted = sessions.map((s) => ({
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    lastUsedAt: s.lastUsedAt,
    ipAddress: s.ipAddress,
    userAgent: s.userAgent,
  }));

  return Response.json({ sessions: redacted });
}

export async function handleAuthRevokeAll(req: Request, ctx: RouteContext): Promise<Response> {
  const authService = ctx.authService;
  if (!authService) {
    return Response.json({ error: "Auth not configured" }, { status: 500 });
  }

  const currentTokenHash = extractAndHashToken(req);
  authService.revokeAllSessions(currentTokenHash ?? undefined);

  return Response.json({ ok: true });
}

// ─── CLI-Only Routes (Unix socket access only) ──────────────────────

export async function handleCliResetPassword(req: Request, ctx: RouteContext): Promise<Response> {
  const authService = ctx.authService;
  if (!authService) {
    return Response.json({ error: "Auth not configured" }, { status: 500 });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const shouldGenerate = body.generate === true;

    let password: string;
    if (shouldGenerate) {
      password = authService.generateSecurePassword();
    } else {
      const provided = getStringField(body, "password");
      if (!provided) {
        return Response.json({ error: "Password is required" }, { status: 400 });
      }
      password = provided;
    }

    await authService.resetPassword(password);

    // Re-enter MFA onboarding when MFA is not currently enabled
    const config = ctx.db.getAuthConfig();
    if (config && !config.totpEnabled) {
      ctx.db.updateAuthOnboardingState(true, null, null);
    }

    if (shouldGenerate) {
      return Response.json({ ok: true, generated: true, password });
    }
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message, code: error.code }, { status: 400 });
    }
    throw error;
  }
}

export async function handleCliResetMfa(_req: Request, ctx: RouteContext): Promise<Response> {
  const authService = ctx.authService;
  if (!authService) {
    return Response.json({ error: "Auth not configured" }, { status: 500 });
  }

  authService.resetMfa();
  return Response.json({ ok: true });
}
