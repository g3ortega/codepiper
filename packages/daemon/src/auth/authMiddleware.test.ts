import { afterEach, describe, expect, it } from "bun:test";
import {
  addSecurityHeaders,
  buildClearOnboardingCookie,
  buildClearSessionCookie,
  buildOnboardingCookie,
  buildSessionCookie,
  extractOnboardingToken,
  extractToken,
  getClientIp,
  isBodyTooLarge,
  isPublicRoute,
  shouldUseSecureCookies,
} from "./authMiddleware";

describe("authMiddleware", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalForceSecureCookies = process.env.CODEPIPER_FORCE_SECURE_COOKIES;
  const originalTrustProxyHeaders = process.env.CODEPIPER_TRUST_PROXY_HEADERS;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }

    if (originalForceSecureCookies === undefined) {
      delete process.env.CODEPIPER_FORCE_SECURE_COOKIES;
    } else {
      process.env.CODEPIPER_FORCE_SECURE_COOKIES = originalForceSecureCookies;
    }

    if (originalTrustProxyHeaders === undefined) {
      delete process.env.CODEPIPER_TRUST_PROXY_HEADERS;
    } else {
      process.env.CODEPIPER_TRUST_PROXY_HEADERS = originalTrustProxyHeaders;
    }
  });

  describe("isPublicRoute", () => {
    it("should allow health check", () => {
      expect(isPublicRoute("GET", "/health")).toBe(true);
    });

    it("should allow version check", () => {
      expect(isPublicRoute("GET", "/version")).toBe(true);
    });

    it("should allow auth status", () => {
      expect(isPublicRoute("GET", "/auth/status")).toBe(true);
    });

    it("should allow auth setup", () => {
      expect(isPublicRoute("POST", "/auth/setup")).toBe(true);
    });

    it("should allow auth login", () => {
      expect(isPublicRoute("POST", "/auth/login")).toBe(true);
    });

    it("should allow hooks endpoint", () => {
      expect(isPublicRoute("POST", "/hooks/claude")).toBe(true);
    });

    it("should reject non-public routes", () => {
      expect(isPublicRoute("GET", "/sessions")).toBe(false);
      expect(isPublicRoute("POST", "/auth/logout")).toBe(false);
      expect(isPublicRoute("GET", "/auth/sessions")).toBe(false);
    });

    it("should reject wrong method on public routes", () => {
      expect(isPublicRoute("POST", "/health")).toBe(false);
      expect(isPublicRoute("GET", "/auth/login")).toBe(false);
    });
  });

  describe("extractToken", () => {
    it("should extract from Authorization Bearer header", () => {
      const token = "a".repeat(64);
      const req = new Request("http://localhost/api/test", {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(extractToken(req)).toBe(token);
    });

    it("should extract from cookie", () => {
      const token = "b".repeat(64);
      const req = new Request("http://localhost/api/test", {
        headers: { Cookie: `codepiper_session=${token}` },
      });
      expect(extractToken(req)).toBe(token);
    });

    it("should prefer Bearer header over cookie", () => {
      const bearerToken = "a".repeat(64);
      const cookieToken = "b".repeat(64);
      const req = new Request("http://localhost/api/test", {
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          Cookie: `codepiper_session=${cookieToken}`,
        },
      });
      expect(extractToken(req)).toBe(bearerToken);
    });

    it("should return null when no token present", () => {
      const req = new Request("http://localhost/api/test");
      expect(extractToken(req)).toBeNull();
    });

    it("should reject non-hex tokens", () => {
      const req = new Request("http://localhost/api/test", {
        headers: { Authorization: "Bearer not-hex-token!" },
      });
      expect(extractToken(req)).toBeNull();
    });
  });

  describe("extractOnboardingToken", () => {
    it("should extract onboarding token from cookie", () => {
      const token = "c".repeat(64);
      const req = new Request("http://localhost/api/test", {
        headers: { Cookie: `codepiper_onboarding=${token}` },
      });
      expect(extractOnboardingToken(req)).toBe(token);
    });

    it("should return null when onboarding token is missing", () => {
      const req = new Request("http://localhost/api/test");
      expect(extractOnboardingToken(req)).toBeNull();
    });
  });

  describe("buildSessionCookie", () => {
    it("should build httpOnly SameSite=Strict cookie", () => {
      const cookie = buildSessionCookie("abc123", 3600);
      expect(cookie).toContain("codepiper_session=abc123");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Strict");
      expect(cookie).toContain("Path=/");
      expect(cookie).toContain("Max-Age=3600");
    });

    it("supports secure session cookies", () => {
      const cookie = buildSessionCookie("abc123", 3600, true);
      expect(cookie).toContain("Secure");
    });
  });

  describe("buildOnboardingCookie", () => {
    it("should build onboarding cookie with strict flags", () => {
      const cookie = buildOnboardingCookie("abc123", 3600);
      expect(cookie).toContain("codepiper_onboarding=abc123");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Strict");
      expect(cookie).toContain("Path=/");
      expect(cookie).toContain("Max-Age=3600");
    });

    it("supports secure onboarding cookies", () => {
      const cookie = buildOnboardingCookie("abc123", 3600, true);
      expect(cookie).toContain("Secure");
    });
  });

  describe("clear cookie builders", () => {
    it("includes secure when clearing secure cookies", () => {
      expect(buildClearSessionCookie(true)).toContain("Secure");
      expect(buildClearOnboardingCookie(true)).toContain("Secure");
    });
  });

  describe("shouldUseSecureCookies", () => {
    it("returns true for https requests", () => {
      const req = new Request("https://example.com/api/auth/login");
      expect(shouldUseSecureCookies(req)).toBe(true);
    });

    it("returns false for http requests by default", () => {
      const req = new Request("http://localhost:3000/api/auth/login");
      expect(shouldUseSecureCookies(req)).toBe(false);
    });

    it("allows forcing secure cookies via env override", () => {
      process.env.CODEPIPER_FORCE_SECURE_COOKIES = "1";
      const req = new Request("http://localhost:3000/api/auth/login");
      expect(shouldUseSecureCookies(req)).toBe(true);
    });

    it("trusts forwarded proto=https when proxy header trust is enabled", () => {
      process.env.CODEPIPER_TRUST_PROXY_HEADERS = "1";
      const req = new Request("http://localhost:3000/api/auth/login", {
        headers: {
          "X-Forwarded-Proto": "https",
        },
      });
      expect(shouldUseSecureCookies(req)).toBe(true);
    });

    it("does not trust forwarded proto when proxy header trust is disabled", () => {
      process.env.CODEPIPER_TRUST_PROXY_HEADERS = "0";
      const req = new Request("http://localhost:3000/api/auth/login", {
        headers: {
          "X-Forwarded-Proto": "https",
        },
      });
      expect(shouldUseSecureCookies(req)).toBe(false);
    });
  });

  describe("addSecurityHeaders", () => {
    it("should add all security headers", () => {
      const response = addSecurityHeaders(new Response("ok"));
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
      expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(response.headers.get("Content-Security-Policy")).toBeDefined();
    });

    it("uses strict script-src in production", () => {
      process.env.NODE_ENV = "production";
      const response = addSecurityHeaders(new Response("ok"));
      const csp = response.headers.get("Content-Security-Policy") || "";
      expect(csp).toContain("script-src 'self'");
      expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
      expect(csp).not.toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    });

    it("keeps relaxed script-src in development", () => {
      process.env.NODE_ENV = "development";
      const response = addSecurityHeaders(new Response("ok"));
      const csp = response.headers.get("Content-Security-Policy") || "";
      expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    });
  });

  describe("isBodyTooLarge", () => {
    it("should reject bodies over 1MB", () => {
      const req = new Request("http://localhost/api/test", {
        method: "POST",
        headers: { "Content-Length": String(2 * 1024 * 1024) },
      });
      expect(isBodyTooLarge(req)).toBe(true);
    });

    it("should allow bodies under 1MB", () => {
      const req = new Request("http://localhost/api/test", {
        method: "POST",
        headers: { "Content-Length": "1024" },
      });
      expect(isBodyTooLarge(req)).toBe(false);
    });

    it("should allow requests without content-length", () => {
      const req = new Request("http://localhost/api/test");
      expect(isBodyTooLarge(req)).toBe(false);
    });
  });

  describe("getClientIp", () => {
    it("should NOT trust X-Forwarded-For by default (security fix)", () => {
      const req = new Request("http://localhost/api/test", {
        headers: { "X-Forwarded-For": "10.0.0.1, 10.0.0.2" },
      });
      // Without a server providing requestIP, should fall back to 127.0.0.1
      expect(getClientIp(req)).toBe("127.0.0.1");
    });

    it("can trust X-Forwarded-For when explicitly enabled", () => {
      process.env.CODEPIPER_TRUST_PROXY_HEADERS = "1";
      const req = new Request("http://localhost/api/test", {
        headers: { "X-Forwarded-For": "10.0.0.1, 10.0.0.2" },
      });
      expect(getClientIp(req)).toBe("10.0.0.1");
    });

    it("can trust X-Real-IP when explicitly enabled", () => {
      process.env.CODEPIPER_TRUST_PROXY_HEADERS = "1";
      const req = new Request("http://localhost/api/test", {
        headers: { "X-Real-IP": "192.168.1.44" },
      });
      expect(getClientIp(req)).toBe("192.168.1.44");
    });

    it("should use server requestIP when available", () => {
      const req = new Request("http://localhost/api/test");
      const mockServer = {
        requestIP: () => ({ address: "192.168.1.50" }),
      };
      expect(getClientIp(req, mockServer as any)).toBe("192.168.1.50");
    });

    it("falls back to requestIP when trusted proxy headers are enabled but invalid", () => {
      process.env.CODEPIPER_TRUST_PROXY_HEADERS = "1";
      const req = new Request("http://localhost/api/test", {
        headers: { "X-Forwarded-For": "not-an-ip" },
      });
      const mockServer = {
        requestIP: () => ({ address: "192.168.1.50" }),
      };
      expect(getClientIp(req, mockServer as any)).toBe("192.168.1.50");
    });

    it("should fallback to 127.0.0.1", () => {
      const req = new Request("http://localhost/api/test");
      expect(getClientIp(req)).toBe("127.0.0.1");
    });
  });
});
