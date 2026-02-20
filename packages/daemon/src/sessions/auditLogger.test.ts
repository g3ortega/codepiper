import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Database } from "../db/db";
import { AuditLogger } from "./auditLogger";
import type { PolicyDecision } from "./policyTypes";

describe("AuditLogger", () => {
  let db: Database;
  let logger: AuditLogger;
  const sessionId = "test-session-1";

  beforeEach(async () => {
    db = new Database(":memory:");
    await db.init();

    // Create session
    db.createSession({
      id: sessionId,
      provider: "claude-code",
      cwd: "/test",
      status: "RUNNING",
    });

    // Create test policies
    db.createPolicy({
      id: "policy-1",
      name: "Policy 1",
      rules: [{ id: "rule-1", action: "allow" }],
    });

    db.createPolicy({
      id: "policy-2",
      name: "Policy 2",
      rules: [{ id: "rule-2", action: "deny" }],
    });

    logger = new AuditLogger(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("logDecision", () => {
    it("should log allow decision", () => {
      const decision: PolicyDecision = {
        action: "allow",
        reason: "Read operations are safe",
        policyId: "policy-1",
        ruleId: "rule-1",
      };

      const decisionId = logger.logDecision({
        sessionId,
        toolName: "Read",
        args: { file_path: "/test.txt" },
        decision,
      });

      expect(decisionId).toBeGreaterThan(0);

      const decisions = db.getPolicyDecisionsBySessionId(sessionId);
      expect(decisions).toHaveLength(1);
      expect(decisions[0].id).toBe(decisionId);
      expect(decisions[0].decision).toBe("allow");
      expect(decisions[0].toolName).toBe("Read");
      expect(decisions[0].reason).toBe("Read operations are safe");
      expect(decisions[0].policyId).toBe("policy-1");
    });

    it("should log deny decision", () => {
      const decision: PolicyDecision = {
        action: "deny",
        reason: "Write operations denied",
        policyId: "policy-1",
        ruleId: "rule-1",
      };

      const _decisionId = logger.logDecision({
        sessionId,
        toolName: "Write",
        args: { file_path: "/test.txt" },
        decision,
      });

      const decisions = db.getPolicyDecisionsBySessionId(sessionId);
      expect(decisions[0].decision).toBe("deny");
      expect(decisions[0].reason).toBe("Write operations denied");
    });

    it("should log ask decision", () => {
      const decision: PolicyDecision = {
        action: "ask",
        reason: "Manual approval required",
        policyId: "policy-1",
        ruleId: "rule-1",
      };

      logger.logDecision({
        sessionId,
        toolName: "Bash",
        args: { command: "rm -rf /" },
        decision,
      });

      const decisions = db.getPolicyDecisionsBySessionId(sessionId);
      expect(decisions[0].decision).toBe("ask");
    });

    it("should log decision with eventId", () => {
      const eventId = db.insertEvent({
        sessionId,
        source: "hook",
        type: "PermissionRequest",
        payload: {},
      });

      const decision: PolicyDecision = {
        action: "allow",
        reason: "Allowed",
      };

      logger.logDecision({
        sessionId,
        eventId,
        toolName: "Read",
        args: {},
        decision,
      });

      const decisions = db.getPolicyDecisionsBySessionId(sessionId);
      expect(decisions[0].eventId).toBe(eventId);
    });

    it("should log decision with args as JSON", () => {
      const decision: PolicyDecision = {
        action: "deny",
        reason: "Denied",
      };

      const args = {
        file_path: "/project/.env",
        content: "secret data",
      };

      logger.logDecision({
        sessionId,
        toolName: "Read",
        args,
        decision,
      });

      const decisions = db.getPolicyDecisionsBySessionId(sessionId);
      expect(decisions[0].args).toEqual(args);
    });

    it("should handle decision without policyId", () => {
      const decision: PolicyDecision = {
        action: "deny",
        reason: "Default deny",
      };

      logger.logDecision({
        sessionId,
        toolName: "Unknown",
        args: {},
        decision,
      });

      const decisions = db.getPolicyDecisionsBySessionId(sessionId);
      expect(decisions[0].policyId).toBeUndefined();
    });

    it("should use custom timestamp if provided", () => {
      const customTime = new Date("2024-01-01T12:00:00Z");
      const decision: PolicyDecision = {
        action: "allow",
        reason: "Allowed",
      };

      logger.logDecision({
        sessionId,
        toolName: "Read",
        args: {},
        decision,
        timestamp: customTime,
      });

      const decisions = db.getPolicyDecisionsBySessionId(sessionId);
      expect(decisions[0].timestamp.toISOString()).toBe(customTime.toISOString());
    });
  });

  describe("getDecisions", () => {
    beforeEach(() => {
      // Insert some test decisions
      logger.logDecision({
        sessionId,
        toolName: "Read",
        args: {},
        decision: { action: "allow", reason: "Decision 1" },
      });
      logger.logDecision({
        sessionId,
        toolName: "Write",
        args: {},
        decision: { action: "deny", reason: "Decision 2" },
      });
      logger.logDecision({
        sessionId,
        toolName: "Bash",
        args: {},
        decision: { action: "ask", reason: "Decision 3" },
      });
    });

    it("should get all decisions for session", () => {
      const decisions = logger.getDecisions(sessionId);
      expect(decisions).toHaveLength(3);
    });

    it("should filter by decision type", () => {
      const denyDecisions = logger.getDecisions(sessionId, { decision: "deny" });
      expect(denyDecisions).toHaveLength(1);
      expect(denyDecisions[0].decision).toBe("deny");
    });

    it("should limit results", () => {
      const decisions = logger.getDecisions(sessionId, { limit: 2 });
      expect(decisions).toHaveLength(2);
    });

    it("should get decisions since id", () => {
      const allDecisions = logger.getDecisions(sessionId);
      const firstId = allDecisions[0].id;

      const laterDecisions = logger.getDecisions(sessionId, { since: firstId });
      expect(laterDecisions).toHaveLength(2);
      expect(laterDecisions.every((d) => d.id > firstId)).toBe(true);
    });
  });

  describe("exportDecisions", () => {
    beforeEach(() => {
      logger.logDecision({
        sessionId,
        toolName: "Read",
        args: { file_path: "/test.txt" },
        decision: { action: "allow", reason: "Safe read", policyId: "policy-1", ruleId: "rule-1" },
      });
      logger.logDecision({
        sessionId,
        toolName: "Write",
        args: { file_path: "/test.txt" },
        decision: {
          action: "deny",
          reason: "Write denied",
          policyId: "policy-2",
          ruleId: "rule-2",
        },
      });
    });

    it("should export as JSON array", () => {
      const json = logger.exportDecisions(sessionId, "json");
      const parsed = JSON.parse(json);

      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toHaveProperty("toolName");
      expect(parsed[0]).toHaveProperty("decision");
      expect(parsed[0]).toHaveProperty("reason");
    });

    it("should export as CSV", () => {
      const csv = logger.exportDecisions(sessionId, "csv");
      const lines = csv.split("\n");

      // Should have header + 2 data rows + empty line
      expect(lines.length).toBeGreaterThanOrEqual(3);
      expect(lines[0]).toContain("timestamp");
      expect(lines[0]).toContain("toolName");
      expect(lines[0]).toContain("decision");
    });

    it("should include all relevant fields in export", () => {
      const json = logger.exportDecisions(sessionId, "json");
      const parsed = JSON.parse(json);

      const record = parsed[0];
      expect(record).toHaveProperty("timestamp");
      expect(record).toHaveProperty("toolName");
      expect(record).toHaveProperty("decision");
      expect(record).toHaveProperty("reason");
      expect(record).toHaveProperty("policyId");
      expect(record).toHaveProperty("args");
    });
  });

  describe("getStatistics", () => {
    beforeEach(() => {
      // Log various decisions
      logger.logDecision({
        sessionId,
        toolName: "Read",
        args: {},
        decision: { action: "allow", reason: "Allowed" },
      });
      logger.logDecision({
        sessionId,
        toolName: "Write",
        args: {},
        decision: { action: "deny", reason: "Denied" },
      });
      logger.logDecision({
        sessionId,
        toolName: "Edit",
        args: {},
        decision: { action: "deny", reason: "Denied" },
      });
      logger.logDecision({
        sessionId,
        toolName: "Bash",
        args: {},
        decision: { action: "ask", reason: "Ask" },
      });
    });

    it("should return decision counts", () => {
      const stats = logger.getStatistics(sessionId);

      expect(stats.total).toBe(4);
      expect(stats.allow).toBe(1);
      expect(stats.deny).toBe(2);
      expect(stats.ask).toBe(1);
    });

    it("should handle empty decisions", () => {
      const newSessionId = "empty-session";
      db.createSession({
        id: newSessionId,
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });

      const stats = logger.getStatistics(newSessionId);

      expect(stats.total).toBe(0);
      expect(stats.allow).toBe(0);
      expect(stats.deny).toBe(0);
      expect(stats.ask).toBe(0);
    });
  });
});
