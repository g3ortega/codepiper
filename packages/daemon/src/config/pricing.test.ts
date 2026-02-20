import { describe, expect, test } from "bun:test";
import { calculateCost, getPricingForModel, MODEL_PRICING } from "./pricing";

describe("MODEL_PRICING", () => {
  test("has entries for all expected model families", () => {
    const expected = [
      "opus-4.6",
      "opus-4.5",
      "opus-4.1",
      "opus-4",
      "sonnet-4.5",
      "sonnet-4",
      "haiku-4.5",
      "haiku-3.5",
      "haiku-3",
    ];
    for (const key of expected) {
      expect(MODEL_PRICING[key]).toBeDefined();
      expect(MODEL_PRICING[key].input).toBeGreaterThan(0);
      expect(MODEL_PRICING[key].output).toBeGreaterThan(0);
      expect(MODEL_PRICING[key].cacheWrite).toBeGreaterThan(0);
      expect(MODEL_PRICING[key].cacheRead).toBeGreaterThan(0);
    }
  });

  test("output price is always higher than input price", () => {
    for (const [, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.output).toBeGreaterThan(pricing.input);
    }
  });

  test("cache write price is higher than input price", () => {
    for (const [, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.cacheWrite).toBeGreaterThan(pricing.input);
    }
  });

  test("cache read price is lower than input price", () => {
    for (const [, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.cacheRead).toBeLessThan(pricing.input);
    }
  });
});

describe("getPricingForModel", () => {
  test("matches claude-opus-4-6 model ID", () => {
    const pricing = getPricingForModel("claude-opus-4-6");
    expect(pricing).toBe(MODEL_PRICING["opus-4.6"]);
  });

  test("matches opus-4.6 dot notation", () => {
    expect(getPricingForModel("opus-4.6")).toBe(MODEL_PRICING["opus-4.6"]);
  });

  test("matches claude-opus-4-5-20250929 with date suffix", () => {
    const pricing = getPricingForModel("claude-opus-4-5-20250929");
    expect(pricing).toBe(MODEL_PRICING["opus-4.5"]);
  });

  test("matches claude-opus-4-1 model ID", () => {
    expect(getPricingForModel("claude-opus-4-1")).toBe(MODEL_PRICING["opus-4.1"]);
  });

  test("matches generic opus to opus-4", () => {
    expect(getPricingForModel("claude-opus-4")).toBe(MODEL_PRICING["opus-4"]);
    expect(getPricingForModel("opus")).toBe(MODEL_PRICING["opus-4"]);
  });

  test("matches claude-sonnet-4-5-20250929 with date suffix", () => {
    const pricing = getPricingForModel("claude-sonnet-4-5-20250929");
    expect(pricing).toBe(MODEL_PRICING["sonnet-4.5"]);
  });

  test("matches sonnet-4.5 dot notation", () => {
    expect(getPricingForModel("sonnet-4.5")).toBe(MODEL_PRICING["sonnet-4.5"]);
  });

  test("matches generic sonnet to sonnet-4", () => {
    expect(getPricingForModel("claude-sonnet-4")).toBe(MODEL_PRICING["sonnet-4"]);
    expect(getPricingForModel("sonnet")).toBe(MODEL_PRICING["sonnet-4"]);
  });

  test("matches claude-haiku-4-5-20251001 with date suffix", () => {
    const pricing = getPricingForModel("claude-haiku-4-5-20251001");
    expect(pricing).toBe(MODEL_PRICING["haiku-4.5"]);
  });

  test("matches haiku-3.5 model", () => {
    expect(getPricingForModel("claude-haiku-3-5")).toBe(MODEL_PRICING["haiku-3.5"]);
    expect(getPricingForModel("haiku-3.5")).toBe(MODEL_PRICING["haiku-3.5"]);
  });

  test("matches generic haiku to haiku-3", () => {
    expect(getPricingForModel("claude-haiku-3")).toBe(MODEL_PRICING["haiku-3"]);
    expect(getPricingForModel("haiku")).toBe(MODEL_PRICING["haiku-3"]);
  });

  test("returns default pricing (sonnet-4.5) for unknown models", () => {
    const pricing = getPricingForModel("unknown-model-xyz");
    expect(pricing).toBe(MODEL_PRICING["sonnet-4.5"]);
  });

  test("returns default pricing for empty string", () => {
    expect(getPricingForModel("")).toBe(MODEL_PRICING["sonnet-4.5"]);
  });

  test("matching is case-sensitive (model IDs are lowercase)", () => {
    // Model IDs from Claude Code are always lowercase
    const pricing = getPricingForModel("CLAUDE-OPUS-4-6");
    // Won't match any specific pattern, falls through to default
    expect(pricing).toBe(MODEL_PRICING["sonnet-4.5"]);
  });

  test("opus-4-6 takes priority over generic opus", () => {
    // Ensures ordering is correct - specific matches before generic
    expect(getPricingForModel("opus-4-6")).toBe(MODEL_PRICING["opus-4.6"]);
    expect(getPricingForModel("opus-4-6")).not.toBe(MODEL_PRICING["opus-4"]);
  });

  test("sonnet-4-5 takes priority over generic sonnet", () => {
    expect(getPricingForModel("sonnet-4-5")).toBe(MODEL_PRICING["sonnet-4.5"]);
    expect(getPricingForModel("sonnet-4-5")).not.toBe(MODEL_PRICING["sonnet-4"]);
  });
});

describe("calculateCost", () => {
  const sonnetPricing = MODEL_PRICING["sonnet-4.5"];

  test("calculates cost for input tokens only", () => {
    const cost = calculateCost(1_000_000, 0, 0, 0, sonnetPricing);
    expect(cost).toBe(3); // $3/MTok input
  });

  test("calculates cost for output tokens only", () => {
    const cost = calculateCost(0, 1_000_000, 0, 0, sonnetPricing);
    expect(cost).toBe(15); // $15/MTok output
  });

  test("calculates cost for cache write only", () => {
    const cost = calculateCost(0, 0, 1_000_000, 0, sonnetPricing);
    expect(cost).toBe(3.75); // $3.75/MTok cache write
  });

  test("calculates cost for cache read only", () => {
    const cost = calculateCost(0, 0, 0, 1_000_000, sonnetPricing);
    expect(cost).toBe(0.3); // $0.30/MTok cache read
  });

  test("calculates combined cost correctly", () => {
    const cost = calculateCost(500_000, 100_000, 200_000, 300_000, sonnetPricing);
    const expected =
      (500_000 / 1_000_000) * 3 +
      (100_000 / 1_000_000) * 15 +
      (200_000 / 1_000_000) * 3.75 +
      (300_000 / 1_000_000) * 0.3;
    expect(cost).toBeCloseTo(expected, 10);
  });

  test("returns 0 for zero tokens", () => {
    expect(calculateCost(0, 0, 0, 0, sonnetPricing)).toBe(0);
  });

  test("handles typical Claude Code session token counts", () => {
    // Typical session: ~50K input, ~5K output, ~40K cache write, ~30K cache read
    const cost = calculateCost(50_000, 5_000, 40_000, 30_000, sonnetPricing);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(1); // Should be well under $1 for this small usage
  });

  test("uses opus pricing correctly", () => {
    const opusPricing = MODEL_PRICING["opus-4.6"];
    const cost = calculateCost(1_000_000, 1_000_000, 0, 0, opusPricing);
    expect(cost).toBe(30); // $5 input + $25 output
  });

  test("uses haiku pricing correctly", () => {
    const haikuPricing = MODEL_PRICING["haiku-4.5"];
    const cost = calculateCost(1_000_000, 1_000_000, 0, 0, haikuPricing);
    expect(cost).toBe(6); // $1 input + $5 output
  });
});
