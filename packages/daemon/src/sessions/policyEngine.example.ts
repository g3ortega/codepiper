/**
 * PolicyEngine Usage Examples
 *
 * This file demonstrates how to use the PolicyEngine in real scenarios.
 * These examples will be integrated into the hooks system and API layer.
 */

import { PolicyEngine } from "./policyEngine";
import type { PermissionRequest, Policy } from "./policyTypes";

// ============================================================================
// Example 1: Basic Usage - Default Safe Policy
// ============================================================================

async function example1_basicUsage() {
  const engine = new PolicyEngine();

  const policy: Policy = {
    id: "default-safe",
    name: "Default Safe Policy",
    enabled: true,
    priority: 0,
    rules: [
      {
        id: "allow-reads",
        action: "allow",
        tool: ["Read", "Glob", "Grep"],
        reason: "Read operations are safe",
      },
      {
        id: "deny-writes",
        action: "deny",
        tool: ["Write", "Edit"],
        reason: "Write operations require approval",
      },
    ],
  };

  // Test read request (should allow)
  const readRequest: PermissionRequest = {
    sessionId: "session-1",
    tool: "Read",
    args: { file_path: "/workspace/test.txt" },
    cwd: "/workspace",
  };

  const readDecision = await engine.evaluate(readRequest, [policy]);
  console.log("Read decision:", readDecision);
  // Output: { action: "allow", reason: "Read operations are safe", policyId: "default-safe", ruleId: "allow-reads" }

  // Test write request (should deny)
  const writeRequest: PermissionRequest = {
    sessionId: "session-1",
    tool: "Write",
    args: { file_path: "/workspace/test.txt", content: "..." },
    cwd: "/workspace",
  };

  const writeDecision = await engine.evaluate(writeRequest, [policy]);
  console.log("Write decision:", writeDecision);
  // Output: { action: "deny", reason: "Write operations require approval", policyId: "default-safe", ruleId: "deny-writes" }
}

// ============================================================================
// Example 2: Protect Sensitive Files
// ============================================================================

async function example2_protectSecrets() {
  const engine = new PolicyEngine();

  const secretsPolicy: Policy = {
    id: "protect-secrets",
    name: "Protect Secrets",
    enabled: true,
    priority: 100, // High priority - evaluated first
    rules: [
      {
        id: "deny-env-files",
        action: "deny",
        tool: ["Read", "Write", "Edit"],
        args: {
          file_path: ["**/.env", "**/.env.*", "**/secrets.*"],
        },
        reason: "Access to .env files denied",
      },
    ],
  };

  const normalPolicy: Policy = {
    id: "default",
    name: "Default Policy",
    enabled: true,
    priority: 0,
    rules: [
      {
        id: "allow-all",
        action: "allow",
        tool: "*",
      },
    ],
  };

  // Try to read .env file (should deny due to high priority)
  const envRequest: PermissionRequest = {
    sessionId: "session-1",
    tool: "Read",
    args: { file_path: "/workspace/.env.local" },
    cwd: "/workspace",
  };

  const decision = await engine.evaluate(envRequest, [secretsPolicy, normalPolicy]);
  console.log(".env decision:", decision);
  // Output: { action: "deny", reason: "Access to .env files denied", policyId: "protect-secrets", ruleId: "deny-env-files" }
}

// ============================================================================
// Example 3: Ask for Destructive Operations
// ============================================================================

async function example3_askDestructive() {
  const engine = new PolicyEngine();

  const policy: Policy = {
    id: "ask-destructive",
    name: "Ask for Destructive Operations",
    enabled: true,
    priority: 75,
    rules: [
      {
        id: "ask-rm",
        action: "ask",
        tool: "Bash",
        args: {
          command: ["rm *", "*rm -rf*", "*git reset --hard*"],
        },
        reason: "Destructive command detected - user approval required",
      },
      {
        id: "allow-safe-bash",
        action: "allow",
        tool: "Bash",
        reason: "Safe bash command",
      },
    ],
  };

  // Destructive command (should ask)
  const rmRequest: PermissionRequest = {
    sessionId: "session-1",
    tool: "Bash",
    args: { command: "rm -rf /tmp/cache" },
    cwd: "/workspace",
  };

  const rmDecision = await engine.evaluate(rmRequest, [policy]);
  console.log("rm decision:", rmDecision);
  // Output: { action: "ask", reason: "Destructive command detected - user approval required", policyId: "ask-destructive", ruleId: "ask-rm" }

  // Safe command (should allow)
  const lsRequest: PermissionRequest = {
    sessionId: "session-1",
    tool: "Bash",
    args: { command: "ls -la" },
    cwd: "/workspace",
  };

  const lsDecision = await engine.evaluate(lsRequest, [policy]);
  console.log("ls decision:", lsDecision);
  // Output: { action: "allow", reason: "Safe bash command", policyId: "ask-destructive", ruleId: "allow-safe-bash" }
}

// ============================================================================
// Example 4: Session-Specific Policies
// ============================================================================

async function example4_sessionSpecific() {
  const engine = new PolicyEngine();

  // Global policy (applies to all sessions)
  const globalPolicy: Policy = {
    id: "global-default",
    name: "Global Default",
    enabled: true,
    priority: 0,
    rules: [
      {
        id: "allow-reads",
        action: "allow",
        tool: ["Read", "Glob", "Grep"],
      },
    ],
  };

  // Session-specific policy (only session-1)
  const session1Policy: Policy = {
    id: "session-1-strict",
    name: "Session 1 Strict Policy",
    enabled: true,
    priority: 100,
    sessionId: "session-1", // Only applies to session-1
    rules: [
      {
        id: "deny-all",
        action: "deny",
        tool: "*",
        reason: "Session-1 is locked down",
      },
    ],
  };

  // Session 1 request (should deny - session-specific policy)
  const session1Request: PermissionRequest = {
    sessionId: "session-1",
    tool: "Read",
    args: { file_path: "/test.txt" },
    cwd: "/workspace",
  };

  const decision1 = await engine.evaluate(session1Request, [globalPolicy, session1Policy]);
  console.log("Session 1 decision:", decision1);
  // Output: { action: "deny", reason: "Session-1 is locked down", policyId: "session-1-strict", ruleId: "deny-all" }

  // Session 2 request (should allow - only global policy applies)
  const session2Request: PermissionRequest = {
    sessionId: "session-2",
    tool: "Read",
    args: { file_path: "/test.txt" },
    cwd: "/workspace",
  };

  const decision2 = await engine.evaluate(session2Request, [globalPolicy, session1Policy]);
  console.log("Session 2 decision:", decision2);
  // Output: { action: "allow", policyId: "global-default", ruleId: "allow-reads" }
}

// ============================================================================
// Example 5: Integration with Hooks System
// ============================================================================

async function example5_hooksIntegration(hookData: any, sessionId: string, sessionCwd: string) {
  const engine = new PolicyEngine();

  // Convert hook data to PermissionRequest
  const request: PermissionRequest = {
    sessionId,
    tool: hookData.tool_name,
    args: hookData.input || {},
    cwd: sessionCwd,
  };

  // Load policies from database (example - would be real DB call)
  const policies: Policy[] = [
    {
      id: "default-safe",
      name: "Default Safe Policy",
      enabled: true,
      priority: 0,
      rules: [
        {
          id: "allow-reads",
          action: "allow",
          tool: ["Read", "Glob", "Grep"],
        },
        {
          id: "deny-writes",
          action: "deny",
          tool: ["Write", "Edit"],
        },
      ],
    },
  ];

  // Evaluate
  const decision = await engine.evaluate(request, policies);

  // Convert to Claude Code hook response format
  const hookResponse = {
    allow: decision.action === "allow",
    message: decision.reason || "No matching policy rule found",
    // Optional: Include policy metadata for logging
    metadata: {
      policyId: decision.policyId,
      ruleId: decision.ruleId,
      action: decision.action,
    },
  };

  return hookResponse;
}

// ============================================================================
// Example 6: Custom Default Policy
// ============================================================================

async function example6_customDefault() {
  // Allow by default (less secure, but useful for development)
  const engine = new PolicyEngine({
    defaultAction: "allow",
    defaultReason: "No restrictions configured",
  });

  const request: PermissionRequest = {
    sessionId: "session-1",
    tool: "UnknownTool",
    args: {},
    cwd: "/workspace",
  };

  // No policies provided - uses default
  const decision = await engine.evaluate(request, []);
  console.log("Default decision:", decision);
  // Output: { action: "allow", reason: "No restrictions configured" }
}

// ============================================================================
// Example 7: Complex Multi-Layer Policies
// ============================================================================

async function example7_multiLayer() {
  const engine = new PolicyEngine();

  const policies: Policy[] = [
    // Layer 1: Protect secrets (highest priority)
    {
      id: "protect-secrets",
      name: "Protect Secrets",
      enabled: true,
      priority: 100,
      rules: [
        {
          id: "deny-env",
          action: "deny",
          args: { file_path: "**/.env*" },
          reason: "Secrets protected",
        },
      ],
    },

    // Layer 2: Ask for destructive (medium priority)
    {
      id: "ask-destructive",
      name: "Ask Destructive",
      enabled: true,
      priority: 50,
      rules: [
        {
          id: "ask-rm",
          action: "ask",
          tool: "Bash",
          args: { command: "*rm*" },
          reason: "Destructive operation",
        },
      ],
    },

    // Layer 3: Default safe (lowest priority)
    {
      id: "default-safe",
      name: "Default Safe",
      enabled: true,
      priority: 0,
      rules: [
        {
          id: "allow-reads",
          action: "allow",
          tool: ["Read", "Glob", "Grep"],
        },
        {
          id: "deny-writes",
          action: "deny",
          tool: ["Write", "Edit"],
        },
      ],
    },
  ];

  // Test .env read (Layer 1 catches it)
  const envRequest: PermissionRequest = {
    sessionId: "session-1",
    tool: "Read",
    args: { file_path: "/workspace/.env" },
    cwd: "/workspace",
  };

  const envDecision = await engine.evaluate(envRequest, policies);
  console.log(".env:", envDecision.action, envDecision.policyId); // "deny", "protect-secrets"

  // Test rm command (Layer 2 catches it)
  const rmRequest: PermissionRequest = {
    sessionId: "session-1",
    tool: "Bash",
    args: { command: "rm file.txt" },
    cwd: "/workspace",
  };

  const rmDecision = await engine.evaluate(rmRequest, policies);
  console.log("rm:", rmDecision.action, rmDecision.policyId); // "ask", "ask-destructive"

  // Test normal read (Layer 3 catches it)
  const readRequest: PermissionRequest = {
    sessionId: "session-1",
    tool: "Read",
    args: { file_path: "/workspace/file.txt" },
    cwd: "/workspace",
  };

  const readDecision = await engine.evaluate(readRequest, policies);
  console.log("read:", readDecision.action, readDecision.policyId); // "allow", "default-safe"
}

// ============================================================================
// Run Examples
// ============================================================================

async function _runExamples() {
  console.log("=== Example 1: Basic Usage ===");
  await example1_basicUsage();

  console.log("\n=== Example 2: Protect Secrets ===");
  await example2_protectSecrets();

  console.log("\n=== Example 3: Ask Destructive ===");
  await example3_askDestructive();

  console.log("\n=== Example 4: Session-Specific ===");
  await example4_sessionSpecific();

  console.log("\n=== Example 6: Custom Default ===");
  await example6_customDefault();

  console.log("\n=== Example 7: Multi-Layer ===");
  await example7_multiLayer();
}

// Uncomment to run examples:
// runExamples().catch(console.error);

export {
  example1_basicUsage,
  example2_protectSecrets,
  example3_askDestructive,
  example4_sessionSpecific,
  example5_hooksIntegration,
  example6_customDefault,
  example7_multiLayer,
};
