/**
 * PolicyEngine Tests - TDD approach
 * Write tests FIRST, then implement
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { PolicyEngine } from "./policyEngine";
import type { PermissionRequest, Policy } from "./policyTypes";

describe("PolicyEngine", () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine();
  });

  describe("Basic Rule Matching", () => {
    test("should allow when rule matches tool name exactly", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        rules: [
          {
            id: "allow-read",
            action: "allow",
            tool: "Read",
            reason: "Read operations are safe",
          },
        ],
      };

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: { file_path: "/test.txt" },
        cwd: "/workspace",
      };

      const decision = await engine.evaluate(request, [policy]);

      expect(decision.action).toBe("allow");
      expect(decision.reason).toBe("Read operations are safe");
      expect(decision.policyId).toBe("test-policy");
      expect(decision.ruleId).toBe("allow-read");
    });

    test("should deny when rule matches tool name exactly", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        rules: [
          {
            id: "deny-bash",
            action: "deny",
            tool: "Bash",
            reason: "Bash execution denied",
          },
        ],
      };

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Bash",
        args: { command: "ls" },
        cwd: "/workspace",
      };

      const decision = await engine.evaluate(request, [policy]);

      expect(decision.action).toBe("deny");
      expect(decision.reason).toBe("Bash execution denied");
    });

    test("should ask when rule matches", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        rules: [
          {
            id: "ask-write",
            action: "ask",
            tool: "Write",
            reason: "Write needs approval",
          },
        ],
      };

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Write",
        args: { file_path: "/test.txt" },
        cwd: "/workspace",
      };

      const decision = await engine.evaluate(request, [policy]);

      expect(decision.action).toBe("ask");
    });

    test("should not match when tool name differs", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        rules: [
          {
            id: "allow-read",
            action: "allow",
            tool: "Read",
          },
        ],
      };

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Write",
        args: {},
        cwd: "/workspace",
      };

      const decision = await engine.evaluate(request, [policy]);

      // Should use default policy
      expect(decision.action).toBe("ask");
      expect(decision.policyId).toBeUndefined();
    });
  });

  describe("Pattern Matching - Tool Names", () => {
    test("should match tool name with glob pattern", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        rules: [
          {
            id: "deny-all-bash",
            action: "deny",
            tool: "Bash*",
          },
        ],
      };

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "BashExecute",
        args: {},
        cwd: "/workspace",
      };

      const decision = await engine.evaluate(request, [policy]);
      expect(decision.action).toBe("deny");
    });

    test("should match tool name with wildcard pattern", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        rules: [
          {
            id: "allow-reads",
            action: "allow",
            tool: "*Read*",
          },
        ],
      };

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "FileRead",
        args: {},
        cwd: "/workspace",
      };

      const decision = await engine.evaluate(request, [policy]);
      expect(decision.action).toBe("allow");
    });

    test("should match tool name with array of patterns", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
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

      const readRequest: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: {},
        cwd: "/workspace",
      };

      const globRequest: PermissionRequest = {
        sessionId: "session-1",
        tool: "Glob",
        args: {},
        cwd: "/workspace",
      };

      expect((await engine.evaluate(readRequest, [policy])).action).toBe("allow");
      expect((await engine.evaluate(globRequest, [policy])).action).toBe("allow");
    });

    test("should not match when no pattern in array matches", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
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

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Write",
        args: {},
        cwd: "/workspace",
      };

      const decision = await engine.evaluate(request, [policy]);
      expect(decision.action).toBe("ask"); // Default
    });
  });

  describe("Pattern Matching - Arguments", () => {
    test("should match exact argument value", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        rules: [
          {
            id: "deny-env",
            action: "deny",
            tool: "Read",
            args: {
              file_path: ".env",
            },
          },
        ],
      };

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: { file_path: ".env" },
        cwd: "/workspace",
      };

      const decision = await engine.evaluate(request, [policy]);
      expect(decision.action).toBe("deny");
    });

    test("should match argument with glob pattern", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        rules: [
          {
            id: "deny-env-files",
            action: "deny",
            tool: "Read",
            args: {
              file_path: "**/.env",
            },
          },
        ],
      };

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: { file_path: "/workspace/project/.env" },
        cwd: "/workspace",
      };

      const decision = await engine.evaluate(request, [policy]);
      expect(decision.action).toBe("deny");
    });

    test("should match argument with multiple glob patterns", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        rules: [
          {
            id: "deny-secrets",
            action: "deny",
            args: {
              file_path: ["**/.env", "**/.env.*", "**/secrets.*"],
            },
          },
        ],
      };

      const envRequest: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: { file_path: "/project/.env" },
        cwd: "/workspace",
      };

      const secretsRequest: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: { file_path: "/project/secrets.json" },
        cwd: "/workspace",
      };

      expect((await engine.evaluate(envRequest, [policy])).action).toBe("deny");
      expect((await engine.evaluate(secretsRequest, [policy])).action).toBe("deny");
    });

    test("should not match when argument missing", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        rules: [
          {
            id: "deny-env",
            action: "deny",
            args: {
              file_path: "**/.env",
            },
          },
        ],
      };

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: {}, // No file_path
        cwd: "/workspace",
      };

      const decision = await engine.evaluate(request, [policy]);
      expect(decision.action).toBe("ask"); // Default policy
    });

    test("should require all args patterns to match", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        rules: [
          {
            id: "specific-rule",
            action: "deny",
            tool: "Bash",
            args: {
              command: "*rm*",
              cwd: "/tmp",
            },
          },
        ],
      };

      const matchBothRequest: PermissionRequest = {
        sessionId: "session-1",
        tool: "Bash",
        args: { command: "rm -rf file", cwd: "/tmp" },
        cwd: "/workspace",
      };

      const matchOnlyOneRequest: PermissionRequest = {
        sessionId: "session-1",
        tool: "Bash",
        args: { command: "rm -rf file", cwd: "/home" }, // cwd doesn't match
        cwd: "/workspace",
      };

      expect((await engine.evaluate(matchBothRequest, [policy])).action).toBe("deny");
      expect((await engine.evaluate(matchOnlyOneRequest, [policy])).action).toBe("ask"); // Default
    });
  });

  describe("Pattern Matching - Negation", () => {
    test("should support negation pattern with !", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        rules: [
          {
            id: "deny-outside-cwd",
            action: "deny",
            args: {
              file_path: ["**", "!(/workspace/**)"],
            },
          },
        ],
      };

      const insideRequest: PermissionRequest = {
        sessionId: "session-1",
        tool: "Write",
        args: { file_path: "/workspace/file.txt" },
        cwd: "/workspace",
      };

      const outsideRequest: PermissionRequest = {
        sessionId: "session-1",
        tool: "Write",
        args: { file_path: "/etc/passwd" },
        cwd: "/workspace",
      };

      // Inside workspace should NOT match negation rule (so default ask)
      expect((await engine.evaluate(insideRequest, [policy])).action).toBe("ask");

      // Outside workspace SHOULD match rule and be denied.
      expect((await engine.evaluate(outsideRequest, [policy])).action).toBe("deny");
    });

    test("should combine positive and negation patterns", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        rules: [
          {
            id: "allow-txt-not-secrets",
            action: "allow",
            args: {
              file_path: ["*.txt", "!secrets.txt"],
            },
          },
        ],
      };

      const normalTxtRequest: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: { file_path: "normal.txt" },
        cwd: "/workspace",
      };

      const secretsTxtRequest: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: { file_path: "secrets.txt" },
        cwd: "/workspace",
      };

      // normal.txt should match *.txt and pass
      expect((await engine.evaluate(normalTxtRequest, [policy])).action).toBe("allow");

      // secrets.txt matches *.txt BUT negation !secrets.txt fails it
      expect((await engine.evaluate(secretsTxtRequest, [policy])).action).toBe("ask"); // Default
    });
  });

  describe("Pattern Matching - CWD", () => {
    test("should match CWD pattern", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        rules: [
          {
            id: "allow-in-workspace",
            action: "allow",
            cwd: "/workspace/**",
          },
        ],
      };

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: {},
        cwd: "/workspace/project",
      };

      const decision = await engine.evaluate(request, [policy]);
      expect(decision.action).toBe("allow");
    });

    test("should not match when CWD differs", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        rules: [
          {
            id: "allow-in-workspace",
            action: "allow",
            cwd: "/workspace/**",
          },
        ],
      };

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: {},
        cwd: "/tmp",
      };

      const decision = await engine.evaluate(request, [policy]);
      expect(decision.action).toBe("ask"); // Default
    });
  });

  describe("Pattern Matching - Session", () => {
    test("should match session ID exactly", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        sessionId: "session-1",
        rules: [
          {
            id: "allow-this-session",
            action: "allow",
            session: "session-1",
          },
        ],
      };

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: {},
        cwd: "/workspace",
      };

      const decision = await engine.evaluate(request, [policy]);
      expect(decision.action).toBe("allow");
    });

    test("should match session with pattern", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        rules: [
          {
            id: "allow-test-sessions",
            action: "allow",
            session: "test-*",
          },
        ],
      };

      const request: PermissionRequest = {
        sessionId: "test-123",
        tool: "Read",
        args: {},
        cwd: "/workspace",
      };

      const decision = await engine.evaluate(request, [policy]);
      expect(decision.action).toBe("allow");
    });
  });

  describe("Rule Precedence", () => {
    test("should evaluate rules in order, first match wins", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        rules: [
          {
            id: "deny-all-bash",
            action: "deny",
            tool: "Bash",
          },
          {
            id: "allow-safe-bash", // This comes after, should not override
            action: "allow",
            tool: "Bash",
            args: { command: "ls" },
          },
        ],
      };

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Bash",
        args: { command: "ls" },
        cwd: "/workspace",
      };

      // First rule (deny-all-bash) should match first
      const decision = await engine.evaluate(request, [policy]);
      expect(decision.action).toBe("deny");
      expect(decision.ruleId).toBe("deny-all-bash");
    });

    test("should skip non-matching rules and continue", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        rules: [
          {
            id: "allow-write",
            action: "allow",
            tool: "Write",
          },
          {
            id: "allow-read",
            action: "allow",
            tool: "Read",
          },
        ],
      };

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: {},
        cwd: "/workspace",
      };

      const decision = await engine.evaluate(request, [policy]);
      expect(decision.action).toBe("allow");
      expect(decision.ruleId).toBe("allow-read");
    });
  });

  describe("Policy Precedence", () => {
    test("should evaluate higher priority policies first", async () => {
      const lowPriorityPolicy: Policy = {
        id: "low-priority",
        name: "Low Priority",
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

      const highPriorityPolicy: Policy = {
        id: "high-priority",
        name: "High Priority",
        enabled: true,
        priority: 100,
        rules: [
          {
            id: "deny-bash",
            action: "deny",
            tool: "Bash",
          },
        ],
      };

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Bash",
        args: {},
        cwd: "/workspace",
      };

      // High priority should be evaluated first
      const decision = await engine.evaluate(request, [lowPriorityPolicy, highPriorityPolicy]);

      expect(decision.action).toBe("deny");
      expect(decision.policyId).toBe("high-priority");
    });

    test("should skip disabled policies", async () => {
      const disabledPolicy: Policy = {
        id: "disabled",
        name: "Disabled",
        enabled: false,
        priority: 100,
        rules: [
          {
            id: "deny-all",
            action: "deny",
            tool: "*",
          },
        ],
      };

      const enabledPolicy: Policy = {
        id: "enabled",
        name: "Enabled",
        enabled: true,
        priority: 0,
        rules: [
          {
            id: "allow-read",
            action: "allow",
            tool: "Read",
          },
        ],
      };

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: {},
        cwd: "/workspace",
      };

      const decision = await engine.evaluate(request, [disabledPolicy, enabledPolicy]);

      expect(decision.action).toBe("allow");
      expect(decision.policyId).toBe("enabled");
    });

    test("should filter policies by sessionId", async () => {
      const session1Policy: Policy = {
        id: "session-1-policy",
        name: "Session 1",
        enabled: true,
        priority: 100,
        sessionId: "session-1",
        rules: [
          {
            id: "deny-all",
            action: "deny",
            tool: "*",
          },
        ],
      };

      const globalPolicy: Policy = {
        id: "global-policy",
        name: "Global",
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

      const session1Request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: {},
        cwd: "/workspace",
      };

      const session2Request: PermissionRequest = {
        sessionId: "session-2",
        tool: "Read",
        args: {},
        cwd: "/workspace",
      };

      // Session 1 should match session-specific policy
      const decision1 = await engine.evaluate(session1Request, [session1Policy, globalPolicy]);
      expect(decision1.action).toBe("deny");
      expect(decision1.policyId).toBe("session-1-policy");

      // Session 2 should match only global policy
      const decision2 = await engine.evaluate(session2Request, [session1Policy, globalPolicy]);
      expect(decision2.action).toBe("allow");
      expect(decision2.policyId).toBe("global-policy");
    });
  });

  describe("Default Policy", () => {
    test("should return deny when no rules match", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        rules: [
          {
            id: "allow-write",
            action: "allow",
            tool: "Write",
          },
        ],
      };

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: {},
        cwd: "/workspace",
      };

      const decision = await engine.evaluate(request, [policy]);

      expect(decision.action).toBe("ask");
      expect(decision.reason).toContain("No matching policy rule");
    });

    test("should return ask when no policies provided", async () => {
      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: {},
        cwd: "/workspace",
      };

      const decision = await engine.evaluate(request, []);

      expect(decision.action).toBe("ask");
      expect(decision.reason).toContain("No matching policy rule");
    });

    test("should allow customizing default policy", async () => {
      const customEngine = new PolicyEngine({
        defaultAction: "allow",
        defaultReason: "No restrictions configured",
      });

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: {},
        cwd: "/workspace",
      };

      const decision = await customEngine.evaluate(request, []);

      expect(decision.action).toBe("allow");
      expect(decision.reason).toBe("No restrictions configured");
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty rules array", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        rules: [],
      };

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: {},
        cwd: "/workspace",
      };

      const decision = await engine.evaluate(request, [policy]);
      expect(decision.action).toBe("ask"); // Default
    });

    test("should handle null/undefined args gracefully", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        rules: [
          {
            id: "allow-read",
            action: "allow",
            tool: "Read",
          },
        ],
      };

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: {},
        cwd: "/workspace",
      };

      const decision = await engine.evaluate(request, [policy]);
      expect(decision.action).toBe("allow");
    });

    test("should handle non-string argument values", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        rules: [
          {
            id: "match-limit",
            action: "allow",
            args: {
              limit: "100",
            },
          },
        ],
      };

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: { limit: 100 }, // Number, not string
        cwd: "/workspace",
      };

      const decision = await engine.evaluate(request, [policy]);
      // Should convert to string for matching
      expect(decision.action).toBe("allow");
    });

    test("should handle special characters in patterns", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        rules: [
          {
            id: "match-parens",
            action: "deny",
            args: {
              command: "*rm*",
            },
          },
        ],
      };

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Bash",
        args: { command: "rm -rf /tmp/(cache)" },
        cwd: "/workspace",
      };

      const decision = await engine.evaluate(request, [policy]);
      expect(decision.action).toBe("deny");
    });

    test("should handle empty string patterns", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        rules: [
          {
            id: "empty-tool",
            action: "allow",
            tool: "",
          },
        ],
      };

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "",
        args: {},
        cwd: "/workspace",
      };

      const decision = await engine.evaluate(request, [policy]);
      expect(decision.action).toBe("allow");
    });

    test("should handle case-sensitive matching", async () => {
      const policy: Policy = {
        id: "test-policy",
        name: "Test Policy",
        enabled: true,
        priority: 0,
        rules: [
          {
            id: "allow-read-lower",
            action: "allow",
            tool: "read",
          },
        ],
      };

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read", // Capital R
        args: {},
        cwd: "/workspace",
      };

      const decision = await engine.evaluate(request, [policy]);
      // Should be case-sensitive
      expect(decision.action).toBe("ask"); // Default, no match
    });
  });

  describe("Complex Real-World Scenarios", () => {
    test("should implement allow reads, deny writes policy", async () => {
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
            tool: ["Write", "Edit", "NotebookEdit"],
            reason: "Write operations require approval",
          },
          {
            id: "deny-bash",
            action: "deny",
            tool: "Bash",
            reason: "Bash execution requires approval",
          },
        ],
      };

      const readRequest: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: { file_path: "/test.txt" },
        cwd: "/workspace",
      };

      const writeRequest: PermissionRequest = {
        sessionId: "session-1",
        tool: "Write",
        args: { file_path: "/test.txt" },
        cwd: "/workspace",
      };

      const bashRequest: PermissionRequest = {
        sessionId: "session-1",
        tool: "Bash",
        args: { command: "ls" },
        cwd: "/workspace",
      };

      expect((await engine.evaluate(readRequest, [policy])).action).toBe("allow");
      expect((await engine.evaluate(writeRequest, [policy])).action).toBe("deny");
      expect((await engine.evaluate(bashRequest, [policy])).action).toBe("deny");
    });

    test("should protect sensitive files", async () => {
      const policy: Policy = {
        id: "protect-secrets",
        name: "Protect Secrets",
        enabled: true,
        priority: 100,
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
          {
            id: "deny-credentials",
            action: "deny",
            tool: ["Read", "Write", "Edit"],
            args: {
              file_path: ["**/credentials.json", "**/.aws/credentials"],
            },
            reason: "Access to credential files denied",
          },
        ],
      };

      const envRequest: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: { file_path: "/project/.env.local" },
        cwd: "/workspace",
      };

      const credRequest: PermissionRequest = {
        sessionId: "session-1",
        tool: "Write",
        args: { file_path: "/home/user/.aws/credentials" },
        cwd: "/workspace",
      };

      const normalRequest: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: { file_path: "/project/config.json" },
        cwd: "/workspace",
      };

      expect((await engine.evaluate(envRequest, [policy])).action).toBe("deny");
      expect((await engine.evaluate(credRequest, [policy])).action).toBe("deny");
      expect((await engine.evaluate(normalRequest, [policy])).action).toBe("ask"); // No rule matches, default ask
    });

    test("should use deny default when configured", async () => {
      const denyEngine = new PolicyEngine({ defaultAction: "deny" });

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: {},
        cwd: "/workspace",
      };

      const decision = await denyEngine.evaluate(request, []);
      expect(decision.action).toBe("deny");
      expect(decision.reason).toContain("No matching policy rule");
    });

    test("should ask for destructive operations", async () => {
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
            reason: "Destructive command detected",
          },
        ],
      };

      const rmRequest: PermissionRequest = {
        sessionId: "session-1",
        tool: "Bash",
        args: { command: "rm -rf /tmp/cache" },
        cwd: "/workspace",
      };

      const gitResetRequest: PermissionRequest = {
        sessionId: "session-1",
        tool: "Bash",
        args: { command: "git reset --hard HEAD" },
        cwd: "/workspace",
      };

      const safeRequest: PermissionRequest = {
        sessionId: "session-1",
        tool: "Bash",
        args: { command: "ls -la" },
        cwd: "/workspace",
      };

      expect((await engine.evaluate(rmRequest, [policy])).action).toBe("ask");
      expect((await engine.evaluate(gitResetRequest, [policy])).action).toBe("ask");
      expect((await engine.evaluate(safeRequest, [policy])).action).toBe("ask"); // No match, default
    });
  });

  describe("Runtime Default Action Changes", () => {
    test("setDefaultAction changes the fallback to deny", async () => {
      engine.setDefaultAction("deny");

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: {},
        cwd: "/workspace",
      };

      const decision = await engine.evaluate(request, []);
      expect(decision.action).toBe("deny");
      expect(decision.reason).toContain("default deny");
    });

    test("setDefaultAction changes back to ask", async () => {
      engine.setDefaultAction("deny");
      engine.setDefaultAction("ask");

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: {},
        cwd: "/workspace",
      };

      const decision = await engine.evaluate(request, []);
      expect(decision.action).toBe("ask");
      expect(decision.reason).toContain("default ask");
    });

    test("getDefaultAction returns current default", () => {
      expect(engine.getDefaultAction()).toBe("ask");
      engine.setDefaultAction("deny");
      expect(engine.getDefaultAction()).toBe("deny");
    });

    test("setDefaultAction does not affect matched rules", async () => {
      engine.setDefaultAction("deny");

      const policy: Policy = {
        id: "test-policy",
        name: "Test",
        enabled: true,
        priority: 0,
        rules: [{ id: "allow-read", action: "allow", tool: "Read" }],
      };

      const request: PermissionRequest = {
        sessionId: "session-1",
        tool: "Read",
        args: {},
        cwd: "/workspace",
      };

      const decision = await engine.evaluate(request, [policy]);
      expect(decision.action).toBe("allow");
    });
  });
});
