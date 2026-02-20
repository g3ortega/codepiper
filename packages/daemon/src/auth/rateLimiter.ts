/**
 * In-memory sliding window rate limiter with escalating lockout.
 *
 * Lockout tiers:
 *   - 5 failures in 15 min  → locked 15 min
 *   - 10 failures in 1 hour → locked 1 hour
 *   - 20+ failures in 24 h  → locked 24 hours
 */

interface AttemptRecord {
  count: number;
  firstAt: number;
  lockedUntil: number | null;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}

const TIERS = [
  { maxAttempts: 5, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000 },
  { maxAttempts: 10, windowMs: 60 * 60 * 1000, lockMs: 60 * 60 * 1000 },
  { maxAttempts: 20, windowMs: 24 * 60 * 60 * 1000, lockMs: 24 * 60 * 60 * 1000 },
];

const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const SMALLEST_TIER = TIERS[0];
const LARGEST_TIER = TIERS[TIERS.length - 1];

export class RateLimiter {
  private attempts = new Map<string, AttemptRecord>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    // Don't keep the process alive just for cleanup
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  check(key: string): RateLimitResult {
    const now = Date.now();
    const record = this.attempts.get(key);

    if (!record) {
      return { allowed: true };
    }

    // If currently locked, check if lock has expired
    if (record.lockedUntil !== null) {
      if (now < record.lockedUntil) {
        return { allowed: false, retryAfterMs: record.lockedUntil - now };
      }
      // Lock expired — reset record
      this.attempts.delete(key);
      return { allowed: true };
    }

    // Check each tier (highest first — most restrictive)
    for (let i = TIERS.length - 1; i >= 0; i--) {
      const tier = TIERS[i];
      if (!tier) {
        continue;
      }
      if (now - record.firstAt <= tier.windowMs && record.count >= tier.maxAttempts) {
        // Lock the account
        record.lockedUntil = now + tier.lockMs;
        return { allowed: false, retryAfterMs: tier.lockMs };
      }
    }

    // If the smallest window has expired, reset the counter
    if (!SMALLEST_TIER || now - record.firstAt > SMALLEST_TIER.windowMs) {
      this.attempts.delete(key);
      return { allowed: true };
    }

    return { allowed: true };
  }

  recordFailure(key: string): void {
    const now = Date.now();
    const record = this.attempts.get(key);

    if (!record) {
      this.attempts.set(key, { count: 1, firstAt: now, lockedUntil: null });
      return;
    }

    // If outside the largest window, start fresh
    if (!LARGEST_TIER) {
      this.attempts.set(key, { count: 1, firstAt: now, lockedUntil: null });
      return;
    }
    const largestWindow = LARGEST_TIER.windowMs;
    if (now - record.firstAt > largestWindow) {
      this.attempts.set(key, { count: 1, firstAt: now, lockedUntil: null });
      return;
    }

    record.count++;
  }

  recordSuccess(key: string): void {
    this.attempts.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    const largestWindow = LARGEST_TIER?.windowMs;
    if (largestWindow === undefined) {
      this.attempts.clear();
      return;
    }

    for (const [key, record] of this.attempts) {
      // Remove entries whose largest window has expired and are not locked
      if (now - record.firstAt > largestWindow && record.lockedUntil === null) {
        this.attempts.delete(key);
      }
      // Remove entries whose lock has expired
      if (record.lockedUntil !== null && now > record.lockedUntil) {
        this.attempts.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.attempts.clear();
  }
}
