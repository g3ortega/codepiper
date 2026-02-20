/**
 * PolicyMatcher - Pattern matching utilities for policy rules
 * Supports glob patterns, negation, and arrays
 */

import micromatch from "micromatch";

/**
 * Match a value against a pattern or array of patterns
 *
 * Supports:
 * - Exact matching: "Read" matches "Read"
 * - Glob patterns: "Read*" matches "ReadFile"
 * - Wildcards: "*Read*" matches "FileRead"
 * - Negation: "!*.env" matches anything except *.env
 * - Arrays: ["Read", "Write"] matches either
 *
 * @param value The value to match
 * @param pattern The pattern(s) to match against
 * @returns true if the value matches the pattern
 */
export function matchPattern(value: string, pattern: string | string[]): boolean {
  const patterns = Array.isArray(pattern) ? pattern : [pattern];

  // Track if we have any negative patterns
  const negativePatterns: string[] = [];
  const positivePatterns: string[] = [];

  for (const p of patterns) {
    // Skip empty patterns
    if (p === "") {
      // Empty pattern matches empty value
      if (value === "") {
        return true;
      }
      continue;
    }

    if (p.startsWith("!")) {
      const negPattern = p.slice(1);
      if (negPattern !== "") {
        negativePatterns.push(negPattern);
      }
    } else {
      positivePatterns.push(p);
    }
  }

  // Micromatch options for better pattern matching
  // bash: true treats patterns as bash globs (not file paths)
  const options = { bash: true };

  // If value matches any negative pattern, fail immediately
  if (negativePatterns.length > 0) {
    if (micromatch.isMatch(value, negativePatterns, options)) {
      return false;
    }
  }

  // If we have positive patterns, check if any match
  if (positivePatterns.length > 0) {
    return micromatch.isMatch(value, positivePatterns, options);
  }

  // If we only had negative patterns and they didn't match, still fail
  // because we have no positive pattern to indicate what SHOULD match
  // Negative patterns alone mean "deny these" but don't specify what to allow
  if (negativePatterns.length > 0) {
    return false;
  }

  // No patterns at all
  return false;
}

/**
 * Normalize a path for consistent matching
 * Removes trailing slashes and resolves relative paths
 */
export function normalizePath(path: string): string {
  // Remove trailing slash
  let normalized = path.replace(/\/+$/, "");

  // If empty after removing slashes, it was root
  if (normalized === "") {
    normalized = "/";
  }

  return normalized;
}

/**
 * Convert a value to string for pattern matching
 * Handles non-string values gracefully
 */
export function valueToString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}
