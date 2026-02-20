import { afterEach, describe, expect, test } from "bun:test";
import { ApiRateLimiter } from "./apiRateLimiter";

describe("ApiRateLimiter", () => {
  const limiters: ApiRateLimiter[] = [];

  afterEach(() => {
    while (limiters.length > 0) {
      limiters.pop()?.destroy();
    }
  });

  test("allows requests up to the configured limit", () => {
    const limiter = new ApiRateLimiter({ maxRequests: 3, windowMs: 1000 });
    limiters.push(limiter);

    expect(limiter.consume("127.0.0.1").allowed).toBe(true);
    expect(limiter.consume("127.0.0.1").allowed).toBe(true);
    expect(limiter.consume("127.0.0.1").allowed).toBe(true);
  });

  test("rejects requests over limit with retryAfter", () => {
    const limiter = new ApiRateLimiter({ maxRequests: 2, windowMs: 2000 });
    limiters.push(limiter);

    expect(limiter.consume("127.0.0.1").allowed).toBe(true);
    expect(limiter.consume("127.0.0.1").allowed).toBe(true);

    const blocked = limiter.consume("127.0.0.1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeDefined();
    expect((blocked.retryAfterMs || 0) > 0).toBe(true);
  });

  test("resets quota after window elapses", async () => {
    const limiter = new ApiRateLimiter({ maxRequests: 1, windowMs: 20 });
    limiters.push(limiter);

    expect(limiter.consume("127.0.0.1").allowed).toBe(true);
    expect(limiter.consume("127.0.0.1").allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(limiter.consume("127.0.0.1").allowed).toBe(true);
  });

  test("tracks each key independently", () => {
    const limiter = new ApiRateLimiter({ maxRequests: 1, windowMs: 1000 });
    limiters.push(limiter);

    expect(limiter.consume("127.0.0.1").allowed).toBe(true);
    expect(limiter.consume("10.0.0.1").allowed).toBe(true);
    expect(limiter.consume("127.0.0.1").allowed).toBe(false);
    expect(limiter.consume("10.0.0.1").allowed).toBe(false);
  });
});
