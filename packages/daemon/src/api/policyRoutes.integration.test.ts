import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { EventBus } from "@codepiper/core";
import { Database } from "../db/db";
import { createPolicyDb } from "../db/policyDb";
import { SessionManager } from "../sessions/sessionManager";
import { createServer, type DaemonServer } from "./server";

describe("Policy Routes Integration", () => {
  let server: DaemonServer;
  let sessionManager: SessionManager;
  let socketPath: string;
  let dbPath: string;

  beforeEach(async () => {
    // Use unique paths for each test to avoid conflicts
    const testId = Math.random().toString(36).substring(7);
    socketPath = `/tmp/codepiper-policy-${testId}.sock`;
    dbPath = `/tmp/codepiper-policy-${testId}.db`;

    // Clean up any existing files
    if (existsSync(socketPath)) {
      await rm(socketPath);
    }
    if (existsSync(dbPath)) {
      await rm(dbPath);
    }

    const db = new Database(dbPath);
    await db.init();
    const eventBus = new EventBus();
    sessionManager = new SessionManager(db, eventBus);

    server = await createServer(socketPath, sessionManager, db, eventBus);
  });

  afterEach(async () => {
    // Stop all sessions before closing server/DB to avoid "closed database" errors
    if (sessionManager) {
      await sessionManager.stopAll();
    }
    await server.stop();

    // Clean up files
    if (existsSync(socketPath)) {
      await rm(socketPath);
    }
    if (existsSync(dbPath)) {
      await rm(dbPath);
    }
  });

  it("should handle GET /policies", async () => {
    const res = await fetch("http://localhost/policies", {
      unix: socketPath,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.policies).toEqual([]);
  });

  it("should handle POST /policies", async () => {
    const policy = {
      id: "test-policy",
      name: "Test Policy",
      description: "Integration test policy",
      enabled: true,
      priority: 10,
      sessionId: null,
      rules: [
        {
          id: "rule-1",
          action: "allow",
          tool: "Read",
          reason: "Safe operation",
        },
      ],
    };

    const res = await fetch("http://localhost/policies", {
      unix: socketPath,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(policy),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.policy.id).toBe("test-policy");
    expect(body.policy.name).toBe("Test Policy");
  });

  it("should handle GET /policies/:id", async () => {
    // Create a policy first
    const policyDb = createPolicyDb(server.db);
    policyDb.createPolicy({
      id: "get-test",
      name: "Get Test",
      enabled: true,
      priority: 0,
      sessionId: null,
      rules: [{ id: "rule-1", action: "allow" }],
    });

    const res = await fetch("http://localhost/policies/get-test", {
      unix: socketPath,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.policy.id).toBe("get-test");
  });

  it("should handle PUT /policies/:id", async () => {
    // Create a policy first
    const policyDb = createPolicyDb(server.db);
    policyDb.createPolicy({
      id: "update-test",
      name: "Original Name",
      enabled: true,
      priority: 0,
      sessionId: null,
      rules: [{ id: "rule-1", action: "allow" }],
    });

    const res = await fetch("http://localhost/policies/update-test", {
      unix: socketPath,
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated Name", priority: 50 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.policy.name).toBe("Updated Name");
    expect(body.policy.priority).toBe(50);
  });

  it("should handle DELETE /policies/:id", async () => {
    // Create a policy first
    const policyDb = createPolicyDb(server.db);
    policyDb.createPolicy({
      id: "delete-test",
      name: "Delete Test",
      enabled: true,
      priority: 0,
      sessionId: null,
      rules: [{ id: "rule-1", action: "allow" }],
    });

    const res = await fetch("http://localhost/policies/delete-test", {
      unix: socketPath,
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify deletion
    const policy = policyDb.getPolicy("delete-test");
    expect(policy).toBeUndefined();
  });

  it("should return 404 for non-existent policy", async () => {
    const res = await fetch("http://localhost/policies/non-existent", {
      unix: socketPath,
    });

    expect(res.status).toBe(404);
  });
});
