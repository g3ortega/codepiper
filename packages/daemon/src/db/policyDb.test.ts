import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { Database } from "./db";
import type { PolicyDb } from "./policyDb";
import { createPolicyDb } from "./policyDb";

describe("PolicyDb", () => {
  let db: Database;
  let policyDb: PolicyDb;
  const testDbPath = "/tmp/codepiper-policy-test.db";

  beforeEach(async () => {
    // Clean up any existing test database
    if (existsSync(testDbPath)) {
      await rm(testDbPath);
    }
    db = new Database(testDbPath);
    await db.init();
    policyDb = createPolicyDb(db);
  });

  afterEach(async () => {
    db.close();
    if (existsSync(testDbPath)) {
      await rm(testDbPath);
    }
  });

  describe("Policy CRUD Operations", () => {
    it("should create a policy", () => {
      const policyId = "test-policy-1";
      const rules = [
        {
          id: "rule-1",
          action: "allow" as const,
          tool: ["Read", "Glob"],
          reason: "Safe operations",
        },
      ];

      policyDb.createPolicy({
        id: policyId,
        name: "Test Policy",
        description: "A test policy",
        enabled: true,
        priority: 10,
        sessionId: null,
        rules,
      });

      const policy = policyDb.getPolicy(policyId);
      expect(policy).toBeDefined();
      expect(policy?.id).toBe(policyId);
      expect(policy?.name).toBe("Test Policy");
      expect(policy?.description).toBe("A test policy");
      expect(policy?.enabled).toBe(true);
      expect(policy?.priority).toBe(10);
      expect(policy?.sessionId).toBeNull();
      expect(policy?.rules).toEqual(rules);
      expect(policy?.createdAt).toBeInstanceOf(Date);
      expect(policy?.updatedAt).toBeInstanceOf(Date);
    });

    it("should create policy with minimal fields", () => {
      const policyId = "minimal-policy";
      const rules = [
        {
          id: "rule-1",
          action: "deny" as const,
          tool: "Bash",
        },
      ];

      policyDb.createPolicy({
        id: policyId,
        name: "Minimal Policy",
        enabled: true,
        priority: 0,
        sessionId: null,
        rules,
      });

      const policy = policyDb.getPolicy(policyId);
      expect(policy).toBeDefined();
      expect(policy?.description).toBeUndefined();
      expect(policy?.rules).toEqual(rules);
    });

    it("should create session-specific policy", () => {
      // Create session first
      db.createSession({
        id: "session-1",
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });

      const policyId = "session-policy";
      const rules = [{ id: "rule-1", action: "allow" as const }];

      policyDb.createPolicy({
        id: policyId,
        name: "Session Policy",
        enabled: true,
        priority: 100,
        sessionId: "session-1",
        rules,
      });

      const policy = policyDb.getPolicy(policyId);
      expect(policy?.sessionId).toBe("session-1");
    });

    it("should get policy by id", () => {
      const policyId = "get-test";
      policyDb.createPolicy({
        id: policyId,
        name: "Get Test",
        enabled: true,
        priority: 0,
        sessionId: null,
        rules: [{ id: "rule-1", action: "allow" as const }],
      });

      const policy = policyDb.getPolicy(policyId);
      expect(policy).toBeDefined();
      expect(policy?.id).toBe(policyId);
    });

    it("should return undefined for non-existent policy", () => {
      const policy = policyDb.getPolicy("non-existent");
      expect(policy).toBeUndefined();
    });

    it("should update policy fields", async () => {
      const policyId = "update-test";
      policyDb.createPolicy({
        id: policyId,
        name: "Original Name",
        description: "Original Description",
        enabled: true,
        priority: 0,
        sessionId: null,
        rules: [{ id: "rule-1", action: "allow" as const }],
      });

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));

      policyDb.updatePolicy(policyId, {
        name: "Updated Name",
        description: "Updated Description",
        enabled: false,
        priority: 50,
      });

      const policy = policyDb.getPolicy(policyId);
      expect(policy?.name).toBe("Updated Name");
      expect(policy?.description).toBe("Updated Description");
      expect(policy?.enabled).toBe(false);
      expect(policy?.priority).toBe(50);
      expect(policy?.updatedAt.getTime()).toBeGreaterThan(policy?.createdAt.getTime() || 0);
    });

    it("should update policy rules", () => {
      const policyId = "update-rules";
      const originalRules = [{ id: "rule-1", action: "allow" as const }];
      const newRules = [
        { id: "rule-1", action: "deny" as const },
        { id: "rule-2", action: "allow" as const, tool: "Read" },
      ];

      policyDb.createPolicy({
        id: policyId,
        name: "Rules Test",
        enabled: true,
        priority: 0,
        sessionId: null,
        rules: originalRules,
      });

      policyDb.updatePolicy(policyId, { rules: newRules });

      const policy = policyDb.getPolicy(policyId);
      expect(policy?.rules).toEqual(newRules);
    });

    it("should delete policy", () => {
      const policyId = "delete-test";
      policyDb.createPolicy({
        id: policyId,
        name: "Delete Test",
        enabled: true,
        priority: 0,
        sessionId: null,
        rules: [{ id: "rule-1", action: "allow" as const }],
      });

      expect(policyDb.getPolicy(policyId)).toBeDefined();

      policyDb.deletePolicy(policyId);

      expect(policyDb.getPolicy(policyId)).toBeUndefined();
    });

    it("should list all policies", () => {
      policyDb.createPolicy({
        id: "policy-1",
        name: "Policy 1",
        enabled: true,
        priority: 0,
        sessionId: null,
        rules: [{ id: "rule-1", action: "allow" as const }],
      });
      policyDb.createPolicy({
        id: "policy-2",
        name: "Policy 2",
        enabled: true,
        priority: 10,
        sessionId: null,
        rules: [{ id: "rule-1", action: "deny" as const }],
      });

      const policies = policyDb.getPolicies();
      expect(policies).toHaveLength(2);
      expect(policies.map((p) => p.id).sort()).toEqual(["policy-1", "policy-2"]);
    });

    it("should filter policies by enabled status", () => {
      policyDb.createPolicy({
        id: "enabled-1",
        name: "Enabled 1",
        enabled: true,
        priority: 0,
        sessionId: null,
        rules: [{ id: "rule-1", action: "allow" as const }],
      });
      policyDb.createPolicy({
        id: "disabled-1",
        name: "Disabled 1",
        enabled: false,
        priority: 0,
        sessionId: null,
        rules: [{ id: "rule-1", action: "deny" as const }],
      });
      policyDb.createPolicy({
        id: "enabled-2",
        name: "Enabled 2",
        enabled: true,
        priority: 0,
        sessionId: null,
        rules: [{ id: "rule-1", action: "allow" as const }],
      });

      const enabled = policyDb.getPolicies({ enabled: true });
      expect(enabled).toHaveLength(2);
      expect(enabled.every((p) => p.enabled === true)).toBe(true);

      const disabled = policyDb.getPolicies({ enabled: false });
      expect(disabled).toHaveLength(1);
      expect(disabled[0].enabled).toBe(false);
    });

    it("should filter policies by session id", () => {
      // Create sessions
      db.createSession({
        id: "session-1",
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });
      db.createSession({
        id: "session-2",
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });

      policyDb.createPolicy({
        id: "global-1",
        name: "Global Policy",
        enabled: true,
        priority: 0,
        sessionId: null,
        rules: [{ id: "rule-1", action: "allow" as const }],
      });
      policyDb.createPolicy({
        id: "session-1-policy",
        name: "Session 1 Policy",
        enabled: true,
        priority: 50,
        sessionId: "session-1",
        rules: [{ id: "rule-1", action: "deny" as const }],
      });
      policyDb.createPolicy({
        id: "session-2-policy",
        name: "Session 2 Policy",
        enabled: true,
        priority: 50,
        sessionId: "session-2",
        rules: [{ id: "rule-1", action: "allow" as const }],
      });

      const globalPolicies = policyDb.getPolicies({ sessionId: null });
      expect(globalPolicies).toHaveLength(1);
      expect(globalPolicies[0].sessionId).toBeNull();

      const session1Policies = policyDb.getPolicies({ sessionId: "session-1" });
      expect(session1Policies).toHaveLength(1);
      expect(session1Policies[0].sessionId).toBe("session-1");

      const session2Policies = policyDb.getPolicies({ sessionId: "session-2" });
      expect(session2Policies).toHaveLength(1);
      expect(session2Policies[0].sessionId).toBe("session-2");
    });

    it("should order policies by priority descending", () => {
      policyDb.createPolicy({
        id: "low-priority",
        name: "Low Priority",
        enabled: true,
        priority: 10,
        sessionId: null,
        rules: [{ id: "rule-1", action: "allow" as const }],
      });
      policyDb.createPolicy({
        id: "high-priority",
        name: "High Priority",
        enabled: true,
        priority: 100,
        sessionId: null,
        rules: [{ id: "rule-1", action: "deny" as const }],
      });
      policyDb.createPolicy({
        id: "medium-priority",
        name: "Medium Priority",
        enabled: true,
        priority: 50,
        sessionId: null,
        rules: [{ id: "rule-1", action: "allow" as const }],
      });

      const policies = policyDb.getPolicies();
      expect(policies.map((p) => p.id)).toEqual([
        "high-priority",
        "medium-priority",
        "low-priority",
      ]);
      expect(policies.map((p) => p.priority)).toEqual([100, 50, 10]);
    });

    it("should combine enabled and sessionId filters", () => {
      db.createSession({
        id: "session-1",
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });

      policyDb.createPolicy({
        id: "global-enabled",
        name: "Global Enabled",
        enabled: true,
        priority: 0,
        sessionId: null,
        rules: [{ id: "rule-1", action: "allow" as const }],
      });
      policyDb.createPolicy({
        id: "session-enabled",
        name: "Session Enabled",
        enabled: true,
        priority: 50,
        sessionId: "session-1",
        rules: [{ id: "rule-1", action: "deny" as const }],
      });
      policyDb.createPolicy({
        id: "session-disabled",
        name: "Session Disabled",
        enabled: false,
        priority: 50,
        sessionId: "session-1",
        rules: [{ id: "rule-1", action: "allow" as const }],
      });

      const policies = policyDb.getPolicies({ enabled: true, sessionId: "session-1" });
      expect(policies).toHaveLength(1);
      expect(policies[0].id).toBe("session-enabled");
    });
  });

  describe("Policy Decision Operations", () => {
    const sessionId = "decision-session";

    beforeEach(() => {
      db.createSession({
        id: sessionId,
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });
    });

    it("should insert policy decision", () => {
      const decisionId = policyDb.insertPolicyDecision({
        sessionId,
        toolName: "Read",
        args: { file_path: "/test/file.txt" },
        decision: "allow",
        reason: "Safe read operation",
      });

      expect(decisionId).toBeGreaterThan(0);
    });

    it("should insert decision with policy reference", () => {
      const policyId = "test-policy";
      policyDb.createPolicy({
        id: policyId,
        name: "Test Policy",
        enabled: true,
        priority: 0,
        sessionId: null,
        rules: [{ id: "rule-1", action: "allow" as const, tool: "Read" }],
      });

      const decisionId = policyDb.insertPolicyDecision({
        sessionId,
        policyId,
        toolName: "Read",
        args: { file_path: "/test/file.txt" },
        decision: "allow",
        reason: "Matched allow rule",
      });

      expect(decisionId).toBeGreaterThan(0);
    });

    it("should insert decision with event reference", () => {
      const eventId = db.insertEvent({
        sessionId,
        source: "hook",
        type: "PermissionRequest",
        payload: { tool: "Write" },
      });

      const decisionId = policyDb.insertPolicyDecision({
        sessionId,
        eventId,
        toolName: "Write",
        args: { file_path: "/test/output.txt" },
        decision: "deny",
        reason: "Write operations denied",
      });

      expect(decisionId).toBeGreaterThan(0);
    });

    it("should insert decision with custom timestamp", () => {
      const customTs = new Date("2024-01-01T00:00:00Z");

      const decisionId = policyDb.insertPolicyDecision({
        sessionId,
        toolName: "Bash",
        decision: "deny",
        timestamp: customTs,
      });

      const decisions = policyDb.getPolicyDecisions(sessionId);
      const decision = decisions.find((d) => d.id === decisionId);
      expect(decision?.timestamp.toISOString()).toBe(customTs.toISOString());
    });

    it("should get policy decisions by session", () => {
      policyDb.insertPolicyDecision({
        sessionId,
        toolName: "Read",
        decision: "allow",
      });
      policyDb.insertPolicyDecision({
        sessionId,
        toolName: "Write",
        decision: "deny",
      });

      const decisions = policyDb.getPolicyDecisions(sessionId);
      expect(decisions).toHaveLength(2);
      expect(decisions[0].sessionId).toBe(sessionId);
      expect(decisions[1].sessionId).toBe(sessionId);
    });

    it("should get decisions with limit", () => {
      for (let i = 0; i < 10; i++) {
        policyDb.insertPolicyDecision({
          sessionId,
          toolName: "Read",
          decision: "allow",
        });
      }

      const decisions = policyDb.getPolicyDecisions(sessionId, { limit: 5 });
      expect(decisions).toHaveLength(5);
    });

    it("should get decisions since timestamp", async () => {
      const ts1 = new Date();
      policyDb.insertPolicyDecision({
        sessionId,
        toolName: "Read",
        decision: "allow",
        timestamp: ts1,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const ts2 = new Date();
      policyDb.insertPolicyDecision({
        sessionId,
        toolName: "Write",
        decision: "deny",
        timestamp: ts2,
      });
      policyDb.insertPolicyDecision({
        sessionId,
        toolName: "Bash",
        decision: "deny",
        timestamp: ts2,
      });

      const decisions = policyDb.getPolicyDecisions(sessionId, {
        since: new Date(ts1.getTime() + 5),
      });
      expect(decisions).toHaveLength(2);
      expect(decisions.every((d) => d.timestamp >= ts2)).toBe(true);
    });

    it("should filter decisions by decision type", () => {
      policyDb.insertPolicyDecision({
        sessionId,
        toolName: "Read",
        decision: "allow",
      });
      policyDb.insertPolicyDecision({
        sessionId,
        toolName: "Write",
        decision: "deny",
      });
      policyDb.insertPolicyDecision({
        sessionId,
        toolName: "Edit",
        decision: "deny",
      });

      const deniedDecisions = policyDb.getPolicyDecisions(sessionId, { decision: "deny" });
      expect(deniedDecisions).toHaveLength(2);
      expect(deniedDecisions.every((d) => d.decision === "deny")).toBe(true);
    });

    it("should filter decisions by tool name", () => {
      policyDb.insertPolicyDecision({
        sessionId,
        toolName: "Read",
        decision: "allow",
      });
      policyDb.insertPolicyDecision({
        sessionId,
        toolName: "Write",
        decision: "deny",
      });
      policyDb.insertPolicyDecision({
        sessionId,
        toolName: "Read",
        decision: "allow",
      });

      const readDecisions = policyDb.getPolicyDecisions(sessionId, { toolName: "Read" });
      expect(readDecisions).toHaveLength(2);
      expect(readDecisions.every((d) => d.toolName === "Read")).toBe(true);
    });

    it("should isolate decisions between sessions", () => {
      const session2Id = "decision-session-2";
      db.createSession({
        id: session2Id,
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });

      policyDb.insertPolicyDecision({
        sessionId,
        toolName: "Read",
        decision: "allow",
      });
      policyDb.insertPolicyDecision({
        sessionId: session2Id,
        toolName: "Write",
        decision: "deny",
      });

      const session1Decisions = policyDb.getPolicyDecisions(sessionId);
      const session2Decisions = policyDb.getPolicyDecisions(session2Id);

      expect(session1Decisions).toHaveLength(1);
      expect(session2Decisions).toHaveLength(1);
      expect(session1Decisions[0].toolName).toBe("Read");
      expect(session2Decisions[0].toolName).toBe("Write");
    });

    it("should handle missing optional fields", () => {
      const decisionId = policyDb.insertPolicyDecision({
        sessionId,
        toolName: "Bash",
        decision: "deny",
      });

      const decisions = policyDb.getPolicyDecisions(sessionId);
      const decision = decisions.find((d) => d.id === decisionId);

      expect(decision?.eventId).toBeUndefined();
      expect(decision?.policyId).toBeUndefined();
      expect(decision?.args).toBeUndefined();
      expect(decision?.reason).toBeUndefined();
    });

    it("should preserve args JSON structure", () => {
      const args = {
        file_path: "/test/file.txt",
        content: "Hello World",
        nested: { key: "value", array: [1, 2, 3] },
      };

      const decisionId = policyDb.insertPolicyDecision({
        sessionId,
        toolName: "Write",
        args,
        decision: "deny",
      });

      const decisions = policyDb.getPolicyDecisions(sessionId);
      const decision = decisions.find((d) => d.id === decisionId);

      expect(decision?.args).toEqual(args);
    });
  });

  describe("Foreign Key Constraints", () => {
    it("should cascade delete policies when session is deleted", () => {
      // Create session and policy
      db.createSession({
        id: "cascade-session",
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });

      policyDb.createPolicy({
        id: "session-policy",
        name: "Session Policy",
        enabled: true,
        priority: 0,
        sessionId: "cascade-session",
        rules: [{ id: "rule-1", action: "allow" as const }],
      });

      expect(policyDb.getPolicy("session-policy")).toBeDefined();

      // Delete session
      db.deleteSession("cascade-session");

      // Policy should be deleted too
      expect(policyDb.getPolicy("session-policy")).toBeUndefined();
    });

    it("should cascade delete decisions when session is deleted", () => {
      // Create session and decision
      db.createSession({
        id: "cascade-session-2",
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });

      policyDb.insertPolicyDecision({
        sessionId: "cascade-session-2",
        toolName: "Read",
        decision: "allow",
      });

      expect(policyDb.getPolicyDecisions("cascade-session-2")).toHaveLength(1);

      // Delete session
      db.deleteSession("cascade-session-2");

      // Decisions should be deleted too
      expect(policyDb.getPolicyDecisions("cascade-session-2")).toHaveLength(0);
    });

    it("should set policy_id to NULL when policy is deleted", () => {
      const sessionId = "null-test";
      db.createSession({
        id: sessionId,
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });

      // Create policy
      policyDb.createPolicy({
        id: "deletable-policy",
        name: "Deletable Policy",
        enabled: true,
        priority: 0,
        sessionId: null,
        rules: [{ id: "rule-1", action: "allow" as const }],
      });

      // Create decision referencing policy
      const decisionId = policyDb.insertPolicyDecision({
        sessionId,
        policyId: "deletable-policy",
        toolName: "Read",
        decision: "allow",
      });

      // Delete policy
      policyDb.deletePolicy("deletable-policy");

      // Decision should still exist but policy_id should be null
      const decisions = policyDb.getPolicyDecisions(sessionId);
      const decision = decisions.find((d) => d.id === decisionId);
      expect(decision).toBeDefined();
      expect(decision?.policyId).toBeUndefined();
    });

    it("should set event_id to NULL when event is deleted", () => {
      const sessionId = "event-null-test";
      db.createSession({
        id: sessionId,
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });

      // Create event
      const eventId = db.insertEvent({
        sessionId,
        source: "hook",
        type: "PermissionRequest",
        payload: {},
      });

      // Create decision referencing event
      const decisionId = policyDb.insertPolicyDecision({
        sessionId,
        eventId,
        toolName: "Read",
        decision: "allow",
      });

      // Note: We can't directly delete an event through the public API,
      // but we can test the constraint using raw SQL
      const rawDb = (db as any).db;
      rawDb.run("DELETE FROM events WHERE id = ?", eventId);

      // Decision should still exist but event_id should be null
      const decisions = policyDb.getPolicyDecisions(sessionId);
      const decision = decisions.find((d) => d.id === decisionId);
      expect(decision).toBeDefined();
      expect(decision?.eventId).toBeUndefined();
    });
  });
});
