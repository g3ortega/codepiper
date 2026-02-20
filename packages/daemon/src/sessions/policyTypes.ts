/**
 * PolicyTypes - Core types for the policy engine
 */

/**
 * Policy rule action types
 */
export type PolicyAction = "allow" | "deny" | "ask";

/**
 * A single policy rule that matches against PermissionRequest criteria
 */
export interface PolicyRule {
  /** Unique identifier for this rule */
  id: string;

  /** Action to take if this rule matches */
  action: PolicyAction;

  /** Tool name pattern(s) to match against (glob supported) */
  tool?: string | string[];

  /** Argument patterns to match (key -> pattern) */
  args?: Record<string, string | string[]>;

  /** CWD pattern(s) to match against */
  cwd?: string | string[];

  /** Session ID pattern(s) to match against */
  session?: string | string[];

  /** Human-readable explanation for the decision */
  reason?: string;
}

/**
 * A policy contains multiple rules and metadata
 */
export interface Policy {
  /** Unique identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Optional description */
  description?: string;

  /** Whether this policy is active */
  enabled: boolean;

  /** Higher priority = evaluated first (more specific) */
  priority: number;

  /** Session ID this policy applies to (null = global) */
  sessionId?: string;

  /** Rules to evaluate in order */
  rules: PolicyRule[];
}

/**
 * The result of evaluating a permission request against policies
 */
export interface PolicyDecision {
  /** The action to take */
  action: PolicyAction;

  /** Explanation for the decision */
  reason?: string;

  /** ID of the policy that matched */
  policyId?: string;

  /** ID of the specific rule that matched */
  ruleId?: string;
}

/**
 * A permission request from Claude Code hooks
 */
export interface PermissionRequest {
  /** Session ID making the request */
  sessionId: string;

  /** Tool name being invoked */
  tool: string;

  /** Tool arguments */
  args: Record<string, unknown>;

  /** Current working directory */
  cwd: string;
}
