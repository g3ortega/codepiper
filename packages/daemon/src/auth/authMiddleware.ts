/**
 * Authentication middleware for HTTP requests.
 *
 * Unix socket requests bypass auth (trusted local access).
 * HTTP/TCP requests require a valid session token.
 */

import { isIP } from "node:net";
import { hashToken } from "./authService";

/** Routes that do not require authentication */
const PUBLIC_ROUTES: Array<{ method: string; pattern: RegExp }> = [
  { method: "GET", pattern: /^\/health$/ },
  { method: "GET", pattern: /^\/version$/ },
  { method: "GET", pattern: /^\/auth\/status$/ },
  { method: "POST", pattern: /^\/auth\/setup$/ },
  { method: "POST", pattern: /^\/auth\/login$/ },
  { method: "POST", pattern: /^\/hooks\/claude$/ },
];

export function isPublicRoute(method: string, pathname: string): boolean {
  return PUBLIC_ROUTES.some((r) => r.method === method && r.pattern.test(pathname));
}

/**
 * Extract session token from request.
 * Checks Authorization header first, then cookie.
 */
export function extractToken(req: Request): string | null {
  // 1. Bearer token (must be 64-char hex)
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    if (/^[a-f0-9]{64}$/.test(token)) {
      return token;
    }
  }

  // 2. Cookie
  const cookieHeader = req.headers.get("Cookie");
  if (cookieHeader) {
    const match = cookieHeader.match(/codepiper_session=([a-f0-9]{64})/);
    const cookieToken = match?.[1];
    if (cookieToken) return cookieToken;
  }

  return null;
}

/**
 * Extract token and hash it for DB lookup.
 */
export function extractAndHashToken(req: Request): string | null {
  const token = extractToken(req);
  if (!token) return null;
  return hashToken(token);
}

/**
 * Extract onboarding token from request cookies.
 */
export function extractOnboardingToken(req: Request): string | null {
  const cookieHeader = req.headers.get("Cookie");
  if (!cookieHeader) {
    return null;
  }

  const match = cookieHeader.match(/codepiper_onboarding=([a-f0-9]{64})/);
  const token = match?.[1];
  if (!token) {
    return null;
  }
  return token;
}

/**
 * Extract onboarding token and hash it for DB lookup.
 */
export function extractAndHashOnboardingToken(req: Request): string | null {
  const token = extractOnboardingToken(req);
  if (!token) {
    return null;
  }
  return hashToken(token);
}

/**
 * Build Set-Cookie header for session token.
 * Includes Secure flag when served over HTTPS to prevent cookie leakage.
 */
export function buildSessionCookie(token: string, maxAgeSeconds: number, isSecure = false): string {
  const flags = [
    `codepiper_session=${token}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isSecure) {
    flags.push("Secure");
  }
  return flags.join("; ");
}

/**
 * Build Set-Cookie header for temporary onboarding token.
 */
export function buildOnboardingCookie(
  token: string,
  maxAgeSeconds: number,
  isSecure = false
): string {
  const flags = [
    `codepiper_onboarding=${token}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isSecure) {
    flags.push("Secure");
  }
  return flags.join("; ");
}

/**
 * Build Set-Cookie header to clear the session cookie.
 */
export function buildClearSessionCookie(isSecure = false): string {
  const flags = ["codepiper_session=", "HttpOnly", "SameSite=Strict", "Path=/", "Max-Age=0"];
  if (isSecure) {
    flags.push("Secure");
  }
  return flags.join("; ");
}

/**
 * Build Set-Cookie header to clear the onboarding cookie.
 */
export function buildClearOnboardingCookie(isSecure = false): string {
  const flags = ["codepiper_onboarding=", "HttpOnly", "SameSite=Strict", "Path=/", "Max-Age=0"];
  if (isSecure) {
    flags.push("Secure");
  }
  return flags.join("; ");
}

/**
 * Determine whether auth cookies should include the Secure attribute.
 *
 * Secure cookies are required for HTTPS deployments. Local HTTP development remains
 * supported by default, and operators can force secure cookies via env flag.
 */
export function shouldUseSecureCookies(req: Request): boolean {
  if (process.env.CODEPIPER_FORCE_SECURE_COOKIES === "1") {
    return true;
  }

  if (process.env.CODEPIPER_TRUST_PROXY_HEADERS === "1") {
    const forwardedProtoHeader = req.headers.get("X-Forwarded-Proto");
    if (forwardedProtoHeader) {
      const normalized = forwardedProtoHeader.split(",")[0]?.trim().toLowerCase();
      if (normalized === "https") {
        return true;
      }
      if (normalized === "http") {
        return false;
      }
    }

    const forwardedHeader = req.headers.get("Forwarded");
    if (forwardedHeader) {
      const protoMatch = forwardedHeader.match(/(?:^|[;,]\s*)proto=(https|http)(?:$|[;,])/i);
      if (protoMatch?.[1]) {
        return protoMatch[1].toLowerCase() === "https";
      }
    }
  }

  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Add security headers to a response.
 */
export function addSecurityHeaders(response: Response): Response {
  const isDevelopment = process.env.NODE_ENV === "development";
  const scriptSrc = isDevelopment
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self'";

  const headers = new Headers(response.headers);
  // API responses are real-time data — never cache them
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // Permissions-Policy: restrict access to sensitive browser APIs
  headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=(), usb=()");
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      // Development mode needs relaxed script policy for HMR and Monaco tooling.
      // Production uses a strict script policy (no inline/eval).
      scriptSrc,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' ws://localhost:* wss://localhost:* ws://127.0.0.1:* wss://127.0.0.1:*",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const MAX_BODY_SIZE = 1024 * 1024; // 1MB
export const MAX_IMAGE_BODY_SIZE = 10 * 1024 * 1024 + 1024; // 10MB + multipart overhead

function normalizeProxyIpCandidate(raw: string | null): string | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  if (isIP(trimmed) !== 0) {
    return trimmed;
  }

  const bracketIpv6 = trimmed.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketIpv6?.[1] && isIP(bracketIpv6[1]) !== 0) {
    return bracketIpv6[1];
  }

  const ipv4WithPort = trimmed.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4WithPort?.[1] && isIP(ipv4WithPort[1]) !== 0) {
    return ipv4WithPort[1];
  }

  return null;
}

/**
 * Check if request body is too large.
 */
export function isBodyTooLarge(req: Request): boolean {
  const contentLength = Number(req.headers.get("content-length") || 0);
  return contentLength > MAX_BODY_SIZE;
}

/**
 * Check if image upload body is too large (higher limit for multipart image data).
 */
export function isImageBodyTooLarge(req: Request): boolean {
  const contentLength = Number(req.headers.get("content-length") || 0);
  return contentLength > MAX_IMAGE_BODY_SIZE;
}

/**
 * Extract client IP from request.
 * Only trusts X-Forwarded-For when explicitly configured with a trusted proxy.
 * Falls back to connection IP or "127.0.0.1".
 */
export function getClientIp(
  req: Request,
  _server?: { requestIP?: (req: Request) => { address: string } | null }
): string {
  if (process.env.CODEPIPER_TRUST_PROXY_HEADERS === "1") {
    const xForwardedFor = req.headers.get("X-Forwarded-For");
    const forwardedCandidate = xForwardedFor ? (xForwardedFor.split(",")[0] ?? null) : null;
    const forwardedIp = normalizeProxyIpCandidate(forwardedCandidate);
    if (forwardedIp) {
      return forwardedIp;
    }

    const xRealIp = normalizeProxyIpCandidate(req.headers.get("X-Real-IP"));
    if (xRealIp) {
      return xRealIp;
    }
  }

  // Use the actual connection IP when available (Bun.serve provides this)
  if (_server?.requestIP) {
    const info = _server.requestIP(req);
    if (info?.address) return info.address;
  }
  // Fallback — do NOT trust X-Forwarded-For by default (spoofable)
  return "127.0.0.1";
}
