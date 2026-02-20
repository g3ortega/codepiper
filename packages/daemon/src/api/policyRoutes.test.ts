import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { EventBus } from "@codepiper/core";
import { Database } from "../db/db";
import { createPolicyDb } from "../db/policyDb";
import { SessionManager } from "../sessions/sessionManager";
import {
  handleCreatePolicy,
  handleDeletePolicy,
  handleGetPolicy,
  handleListPolicies,
  handleUpdatePolicy,
} from "./policyRoutes";
import type { RouteContext } from "./routes";

describe("Policy API Routes", () => {
  let db: Database;
  let ctx: RouteContext;
  const testDbPath = "/tmp/codepiper-policy-routes-test.db";

  beforeEach(async () => {
    // Clean up any existing test database
    if (existsSync(testDbPath)) {
      await rm(testDbPath);
    }

    db = new Database(testDbPath);
    await db.init();

    const eventBus = new EventBus();
    const sessionManager = new SessionManager(db, eventBus);

    ctx = {
      db,
      eventBus,
      sessionManager,
    };
  });

  afterEach(async () => {
    db.close();
    if (existsSync(testDbPath)) {
      await rm(testDbPath);
    }
  });

  describe("GET /policies", () => {
    it("should list all policies", async () => {
      const policyDb = createPolicyDb(db);

      // Create test policies
      policyDb.createPolicy({
        id: "policy-1",
        name: "Policy 1",
        enabled: true,
        priority: 10,
        sessionId: null,
        rules: [{ id: "rule-1", action: "allow", tool: "Read" }],
      });
      policyDb.createPolicy({
        id: "policy-2",
        name: "Policy 2",
        enabled: true,
        priority: 20,
        sessionId: null,
        rules: [{ id: "rule-1", action: "deny", tool: "Write" }],
      });

      const req = new Request("http://localhost/policies");
      const res = await handleListPolicies(req, ctx);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.policies).toHaveLength(2);
      expect(body.policies[0].id).toBe("policy-2"); // Higher priority first
      expect(body.policies[1].id).toBe("policy-1");
    });

    it("should filter policies by enabled status", async () => {
      const policyDb = createPolicyDb(db);

      policyDb.createPolicy({
        id: "enabled-policy",
        name: "Enabled",
        enabled: true,
        priority: 0,
        sessionId: null,
        rules: [{ id: "rule-1", action: "allow" }],
      });
      policyDb.createPolicy({
        id: "disabled-policy",
        name: "Disabled",
        enabled: false,
        priority: 0,
        sessionId: null,
        rules: [{ id: "rule-1", action: "deny" }],
      });

      const req = new Request("http://localhost/policies?enabled=true");
      const res = await handleListPolicies(req, ctx);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.policies).toHaveLength(1);
      expect(body.policies[0].id).toBe("enabled-policy");
    });

    it("should filter policies by session id", async () => {
      const policyDb = createPolicyDb(db);

      // Create session
      db.createSession({
        id: "test-session",
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });

      policyDb.createPolicy({
        id: "global-policy",
        name: "Global",
        enabled: true,
        priority: 0,
        sessionId: null,
        rules: [{ id: "rule-1", action: "allow" }],
      });
      policyDb.createPolicy({
        id: "session-policy",
        name: "Session",
        enabled: true,
        priority: 50,
        sessionId: "test-session",
        rules: [{ id: "rule-1", action: "deny" }],
      });

      const req = new Request("http://localhost/policies?sessionId=test-session");
      const res = await handleListPolicies(req, ctx);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.policies).toHaveLength(1);
      expect(body.policies[0].id).toBe("session-policy");
    });

    it("should handle global policies with sessionId=null", async () => {
      const policyDb = createPolicyDb(db);

      policyDb.createPolicy({
        id: "global-policy",
        name: "Global",
        enabled: true,
        priority: 0,
        sessionId: null,
        rules: [{ id: "rule-1", action: "allow" }],
      });

      const req = new Request("http://localhost/policies?sessionId=null");
      const res = await handleListPolicies(req, ctx);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.policies).toHaveLength(1);
      expect(body.policies[0].id).toBe("global-policy");
    });

    it("should return empty array when no policies exist", async () => {
      const req = new Request("http://localhost/policies");
      const res = await handleListPolicies(req, ctx);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.policies).toEqual([]);
    });
  });

  describe("POST /policies", () => {
    it("should create a new policy", async () => {
      const policyData = {
        id: "new-policy",
        name: "New Policy",
        description: "A test policy",
        enabled: true,
        priority: 50,
        sessionId: null,
        rules: [
          {
            id: "rule-1",
            action: "allow",
            tool: ["Read", "Glob"],
            reason: "Safe operations",
          },
        ],
      };

      const req = new Request("http://localhost/policies", {
        method: "POST",
        body: JSON.stringify(policyData),
      });

      const res = await handleCreatePolicy(req, ctx);

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.policy.id).toBe("new-policy");
      expect(body.policy.name).toBe("New Policy");
      expect(body.policy.rules).toEqual(policyData.rules);

      // Verify it was created in database
      const policyDb = createPolicyDb(db);
      const policy = policyDb.getPolicy("new-policy");
      expect(policy).toBeDefined();
    });

    it("should validate required fields", async () => {
      const invalidData = {
        name: "Missing Fields",
        // Missing: id, enabled, priority, sessionId, rules
      };

      const req = new Request("http://localhost/policies", {
        method: "POST",
        body: JSON.stringify(invalidData),
      });

      const res = await handleCreatePolicy(req, ctx);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Missing required field");
    });

    it("should validate rules is an array", async () => {
      const invalidData = {
        id: "bad-policy",
        name: "Bad Policy",
        enabled: true,
        priority: 0,
        sessionId: null,
        rules: "not-an-array",
      };

      const req = new Request("http://localhost/policies", {
        method: "POST",
        body: JSON.stringify(invalidData),
      });

      const res = await handleCreatePolicy(req, ctx);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Field 'rules' must be an array");
    });

    it("should handle invalid JSON", async () => {
      const req = new Request("http://localhost/policies", {
        method: "POST",
        body: "invalid-json",
      });

      const res = await handleCreatePolicy(req, ctx);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid JSON");
    });

    it("should reject duplicate policy id", async () => {
      const policyDb = createPolicyDb(db);

      // Create first policy
      policyDb.createPolicy({
        id: "duplicate-id",
        name: "First",
        enabled: true,
        priority: 0,
        sessionId: null,
        rules: [{ id: "rule-1", action: "allow" }],
      });

      // Try to create second with same id
      const req = new Request("http://localhost/policies", {
        method: "POST",
        body: JSON.stringify({
          id: "duplicate-id",
          name: "Second",
          enabled: true,
          priority: 0,
          sessionId: null,
          rules: [{ id: "rule-1", action: "deny" }],
        }),
      });

      const res = await handleCreatePolicy(req, ctx);

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toContain("already exists");
    });
  });

  describe("GET /policies/:id", () => {
    it("should get policy by id", async () => {
      const policyDb = createPolicyDb(db);

      policyDb.createPolicy({
        id: "get-policy",
        name: "Get Policy",
        description: "Test description",
        enabled: true,
        priority: 25,
        sessionId: null,
        rules: [{ id: "rule-1", action: "allow", tool: "Read" }],
      });

      const req = new Request("http://localhost/policies/get-policy");
      const res = await handleGetPolicy(req, ctx, "get-policy");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.policy.id).toBe("get-policy");
      expect(body.policy.name).toBe("Get Policy");
      expect(body.policy.description).toBe("Test description");
      expect(body.policy.priority).toBe(25);
    });

    it("should return 404 for non-existent policy", async () => {
      const req = new Request("http://localhost/policies/non-existent");
      const res = await handleGetPolicy(req, ctx, "non-existent");

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("not found");
    });
  });

  describe("PUT /policies/:id", () => {
    it("should update policy fields", async () => {
      const policyDb = createPolicyDb(db);

      policyDb.createPolicy({
        id: "update-policy",
        name: "Original Name",
        description: "Original Description",
        enabled: true,
        priority: 10,
        sessionId: null,
        rules: [{ id: "rule-1", action: "allow" }],
      });

      const updates = {
        name: "Updated Name",
        description: "Updated Description",
        enabled: false,
        priority: 50,
      };

      const req = new Request("http://localhost/policies/update-policy", {
        method: "PUT",
        body: JSON.stringify(updates),
      });

      const res = await handleUpdatePolicy(req, ctx, "update-policy");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.policy.name).toBe("Updated Name");
      expect(body.policy.description).toBe("Updated Description");
      expect(body.policy.enabled).toBe(false);
      expect(body.policy.priority).toBe(50);
    });

    it("should update policy rules", async () => {
      const policyDb = createPolicyDb(db);

      policyDb.createPolicy({
        id: "update-rules",
        name: "Update Rules",
        enabled: true,
        priority: 0,
        sessionId: null,
        rules: [{ id: "rule-1", action: "allow" }],
      });

      const newRules = [
        { id: "rule-1", action: "deny" as const, tool: "Write" },
        { id: "rule-2", action: "allow" as const, tool: "Read" },
      ];

      const req = new Request("http://localhost/policies/update-rules", {
        method: "PUT",
        body: JSON.stringify({ rules: newRules }),
      });

      const res = await handleUpdatePolicy(req, ctx, "update-rules");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.policy.rules).toEqual(newRules);
    });

    it("should return 404 for non-existent policy", async () => {
      const req = new Request("http://localhost/policies/non-existent", {
        method: "PUT",
        body: JSON.stringify({ name: "Updated" }),
      });

      const res = await handleUpdatePolicy(req, ctx, "non-existent");

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("not found");
    });

    it("should handle invalid JSON", async () => {
      const policyDb = createPolicyDb(db);

      policyDb.createPolicy({
        id: "test-policy",
        name: "Test",
        enabled: true,
        priority: 0,
        sessionId: null,
        rules: [{ id: "rule-1", action: "allow" }],
      });

      const req = new Request("http://localhost/policies/test-policy", {
        method: "PUT",
        body: "invalid-json",
      });

      const res = await handleUpdatePolicy(req, ctx, "test-policy");

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid JSON");
    });

    it("should validate rules array when updating", async () => {
      const policyDb = createPolicyDb(db);

      policyDb.createPolicy({
        id: "test-policy",
        name: "Test",
        enabled: true,
        priority: 0,
        sessionId: null,
        rules: [{ id: "rule-1", action: "allow" }],
      });

      const req = new Request("http://localhost/policies/test-policy", {
        method: "PUT",
        body: JSON.stringify({ rules: "not-an-array" }),
      });

      const res = await handleUpdatePolicy(req, ctx, "test-policy");

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Field 'rules' must be an array");
    });
  });

  describe("DELETE /policies/:id", () => {
    it("should delete policy", async () => {
      const policyDb = createPolicyDb(db);

      policyDb.createPolicy({
        id: "delete-policy",
        name: "Delete Me",
        enabled: true,
        priority: 0,
        sessionId: null,
        rules: [{ id: "rule-1", action: "allow" }],
      });

      expect(policyDb.getPolicy("delete-policy")).toBeDefined();

      const req = new Request("http://localhost/policies/delete-policy", {
        method: "DELETE",
      });

      const res = await handleDeletePolicy(req, ctx, "delete-policy");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify deletion
      expect(policyDb.getPolicy("delete-policy")).toBeUndefined();
    });

    it("should return 404 for non-existent policy", async () => {
      const req = new Request("http://localhost/policies/non-existent", {
        method: "DELETE",
      });

      const res = await handleDeletePolicy(req, ctx, "non-existent");

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("not found");
    });
  });
});
