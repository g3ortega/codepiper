/**
 * Anthropic API pricing configuration.
 *
 * Prices are in USD per million tokens.
 * Source: https://platform.claude.com/docs/en/about-claude/pricing
 *
 * Update this file when Anthropic changes pricing.
 * Last updated: 2026-02-15
 */

export interface ModelPricing {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

/**
 * Pricing table keyed by short model family name.
 * Model IDs like "claude-opus-4-6" are matched via getPricingForModel().
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "opus-4.6": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "opus-4.5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "opus-4.1": { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  "opus-4": { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  "sonnet-4.5": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "sonnet-4": { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  "haiku-4.5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  "haiku-3.5": { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 },
  "haiku-3": { input: 0.25, output: 1.25, cacheWrite: 0.3, cacheRead: 0.03 },
};

function lookupPricing(key: string): ModelPricing {
  const pricing = MODEL_PRICING[key];
  if (!pricing) {
    throw new Error(`Missing pricing entry for model key: ${key}`);
  }
  return pricing;
}

/** Default pricing for unknown models (uses Sonnet 4.5 rates). */
const DEFAULT_PRICING = lookupPricing("sonnet-4.5");

/**
 * Match a full model ID (e.g. "claude-opus-4-6", "claude-sonnet-4-5-20250929")
 * to its pricing entry.
 */
export function getPricingForModel(model: string): ModelPricing {
  if (model.includes("opus-4-6") || model.includes("opus-4.6")) return lookupPricing("opus-4.6");
  if (model.includes("opus-4-5") || model.includes("opus-4.5")) return lookupPricing("opus-4.5");
  if (model.includes("opus-4-1") || model.includes("opus-4.1")) return lookupPricing("opus-4.1");
  if (model.includes("opus")) return lookupPricing("opus-4");
  if (model.includes("sonnet-4-5") || model.includes("sonnet-4.5"))
    return lookupPricing("sonnet-4.5");
  if (model.includes("sonnet")) return lookupPricing("sonnet-4");
  if (model.includes("haiku-4-5") || model.includes("haiku-4.5")) return lookupPricing("haiku-4.5");
  if (model.includes("haiku-3-5") || model.includes("haiku-3.5")) return lookupPricing("haiku-3.5");
  if (model.includes("haiku")) return lookupPricing("haiku-3");
  return DEFAULT_PRICING;
}

/**
 * Calculate estimated equivalent API cost from token counts.
 */
export function calculateCost(
  promptTokens: number,
  completionTokens: number,
  cacheCreation: number,
  cacheRead: number,
  pricing: ModelPricing
): number {
  return (
    (promptTokens / 1_000_000) * pricing.input +
    (completionTokens / 1_000_000) * pricing.output +
    (cacheCreation / 1_000_000) * pricing.cacheWrite +
    (cacheRead / 1_000_000) * pricing.cacheRead
  );
}
