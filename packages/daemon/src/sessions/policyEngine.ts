/**
 * PolicyEngine - Evaluates PermissionRequest events against policy rules
 *
 * Features:
 * - Pattern matching (glob, negation, arrays)
 * - Rule precedence (priority + order)
 * - Context matching (tool, args, cwd, session)
 * - Default policy fallback
 */

import { matchPattern, valueToString } from "./policyMatcher";
import type { PermissionRequest, Policy, PolicyDecision, PolicyRule } from "./policyTypes";

export type DefaultPolicyAction = "ask" | "deny";

export interface PolicyEngineOptions {
  /** Default action when no rules match (only "ask" or "deny" — "allow" requires explicit rules) */
  defaultAction?: DefaultPolicyAction;

  /** Default reason when no rules match */
  defaultReason?: string;
}

export class PolicyEngine {
  private defaultAction: DefaultPolicyAction;
  private defaultReason: string;

  constructor(options: PolicyEngineOptions = {}) {
    this.defaultAction = options.defaultAction ?? "ask";
    this.defaultReason = options.defaultReason ?? "No matching policy rule found (default ask)";
  }

  /**
   * Update the default action at runtime (e.g., when daemon settings change)
   */
  setDefaultAction(action: DefaultPolicyAction): void {
    this.defaultAction = action;
    this.defaultReason =
      action === "ask"
        ? "No matching policy rule found (default ask)"
        : `No matching policy rule found (default ${action})`;
  }

  /**
   * Get the current default action
   */
  getDefaultAction(): DefaultPolicyAction {
    return this.defaultAction;
  }

  /**
   * Evaluate a permission request against a list of policies
   *
   * Algorithm:
   * 1. Filter policies by session ID and enabled status
   * 2. Sort by priority (higher = more specific, evaluated first)
   * 3. Evaluate each rule in priority order
   * 4. First match wins
   * 5. If no match, return default policy
   *
   * @param request The permission request to evaluate
   * @param policies All available policies
   * @returns The policy decision
   */
  async evaluate(request: PermissionRequest, policies: Policy[]): Promise<PolicyDecision> {
    // Filter and sort policies
    const applicablePolicies = policies
      .filter((p) => this.isPolicyApplicable(p, request))
      .sort((a, b) => b.priority - a.priority); // Higher priority first

    // Evaluate each policy's rules in order
    for (const policy of applicablePolicies) {
      for (const rule of policy.rules) {
        if (this.ruleMatches(rule, request)) {
          // First match wins
          return {
            action: rule.action,
            reason: rule.reason,
            policyId: policy.id,
            ruleId: rule.id,
          };
        }
      }
    }

    // No match - return default policy
    return this.getDefaultPolicy();
  }

  /**
   * Check if a policy is applicable to a request
   */
  private isPolicyApplicable(policy: Policy, request: PermissionRequest): boolean {
    // Only enabled policies
    if (!policy.enabled) {
      return false;
    }

    // Check session ID match
    if (policy.sessionId !== undefined) {
      if (policy.sessionId !== request.sessionId) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if a rule matches a permission request
   *
   * All criteria must match for the rule to match:
   * - Tool name (if specified)
   * - Arguments (if specified, all must match)
   * - CWD (if specified)
   * - Session (if specified)
   */
  private ruleMatches(rule: PolicyRule, request: PermissionRequest): boolean {
    // Match tool name
    if (rule.tool !== undefined) {
      if (!matchPattern(request.tool, rule.tool)) {
        return false;
      }
    }

    // Match arguments
    if (rule.args !== undefined) {
      for (const [key, pattern] of Object.entries(rule.args)) {
        const value = request.args[key];
        const valueStr = valueToString(value);

        if (!(valueStr && matchPattern(valueStr, pattern))) {
          return false;
        }
      }
    }

    // Match CWD
    if (rule.cwd !== undefined) {
      if (!matchPattern(request.cwd, rule.cwd)) {
        return false;
      }
    }

    // Match session
    if (rule.session !== undefined) {
      if (!matchPattern(request.sessionId, rule.session)) {
        return false;
      }
    }

    // All criteria matched
    return true;
  }

  /**
   * Get the default policy when no rules match
   */
  private getDefaultPolicy(): PolicyDecision {
    return {
      action: this.defaultAction,
      reason: this.defaultReason,
    };
  }
}
