/**
 * Lightweight per-IP API rate limiter for HTTP/TCP requests.
 *
 * Uses a fixed time window with in-memory counters. Intended to mitigate
 * accidental or malicious request floods against the browser-facing API.
 */

export interface ApiRateLimiterOptions {
  maxRequests: number;
  windowMs: number;
  cleanupIntervalMs?: number;
}

export interface ApiRateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}

interface ApiWindow {
  count: number;
  windowStart: number;
}

export class ApiRateLimiter {
  private windows = new Map<string, ApiWindow>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private readonly cleanupIntervalMs: number;

  constructor(private readonly options: ApiRateLimiterOptions) {
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? Math.max(5000, options.windowMs);
    this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupIntervalMs);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  consume(key: string): ApiRateLimitResult {
    const now = Date.now();
    const existing = this.windows.get(key);

    if (!existing || now - existing.windowStart >= this.options.windowMs) {
      this.windows.set(key, { count: 1, windowStart: now });
      return { allowed: true };
    }

    if (existing.count >= this.options.maxRequests) {
      return {
        allowed: false,
        retryAfterMs: existing.windowStart + this.options.windowMs - now,
      };
    }

    existing.count += 1;
    return { allowed: true };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, windowState] of this.windows) {
      if (now - windowState.windowStart >= this.options.windowMs) {
        this.windows.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.windows.clear();
  }
}
