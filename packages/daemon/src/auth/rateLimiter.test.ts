import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { RateLimiter } from "./rateLimiter";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  afterEach(() => {
    limiter.destroy();
  });

  it("should allow first request", () => {
    const result = limiter.check("192.168.1.1");
    expect(result.allowed).toBe(true);
  });

  it("should allow requests below threshold", () => {
    const key = "192.168.1.1";
    for (let i = 0; i < 4; i++) {
      limiter.recordFailure(key);
    }
    const result = limiter.check(key);
    expect(result.allowed).toBe(true);
  });

  it("should lock after 5 failures within 15 minutes", () => {
    const key = "192.168.1.1";
    for (let i = 0; i < 5; i++) {
      limiter.recordFailure(key);
    }
    const result = limiter.check(key);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.retryAfterMs).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it("should reset on successful login", () => {
    const key = "192.168.1.1";
    for (let i = 0; i < 4; i++) {
      limiter.recordFailure(key);
    }
    limiter.recordSuccess(key);
    const result = limiter.check(key);
    expect(result.allowed).toBe(true);
  });

  it("should track different keys independently", () => {
    for (let i = 0; i < 5; i++) {
      limiter.recordFailure("ip-1");
    }
    const result1 = limiter.check("ip-1");
    const result2 = limiter.check("ip-2");
    expect(result1.allowed).toBe(false);
    expect(result2.allowed).toBe(true);
  });

  it("should return allowed after lock expires", () => {
    const key = "192.168.1.1";
    for (let i = 0; i < 5; i++) {
      limiter.recordFailure(key);
    }

    // Force the lock
    const check1 = limiter.check(key);
    expect(check1.allowed).toBe(false);

    // Manually expire the lock by manipulating internal state
    const record = (limiter as any).attempts.get(key);
    record.lockedUntil = Date.now() - 1;

    const check2 = limiter.check(key);
    expect(check2.allowed).toBe(true);
  });

  it("should clean up on destroy", () => {
    limiter.recordFailure("key1");
    limiter.recordFailure("key2");
    limiter.destroy();
    // After destroy, internal map should be empty
    expect((limiter as any).attempts.size).toBe(0);
  });
});
