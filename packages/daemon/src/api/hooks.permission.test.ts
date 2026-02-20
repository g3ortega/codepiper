/**
 * Test automatic permission request handling via PolicyEngine
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EventBus } from "@codepiper/core";
import { Database } from "../db/db";
import { AuditLogger } from "../sessions/auditLogger";
import { PolicyEngine } from "../sessions/policyEngine";
import { SessionManager } from "../sessions/sessionManager";
import type { HookContext } from "./hooks";
import { handleHookEvent } from "./hooks";

describe("Permission Request Auto-Handling", () => {
  let db: Database;
  let eventBus: EventBus;
  let policyEngine: PolicyEngine;
  let auditLogger: AuditLogger;
  let sessionManager: SessionManager;
  let sessionId: string;

  function mockManagedSession(): void {
    sessionManager.getSession = mock((_sessionId: string) => ({
      id: sessionId,
      provider: "claude-code",
      cwd: "/tmp/test",
      status: "RUNNING",
      createdAt: new Date(),
      updatedAt: new Date(),
    })) as any;
  }

  beforeEach(async () => {
    // Setup in-memory database
    db = new Database(":memory:");
    await db.init();

    eventBus = new EventBus();
    policyEngine = new PolicyEngine({ defaultAction: "ask" });
    auditLogger = new AuditLogger(db);
    sessionManager = new SessionManager(db, eventBus);

    // Create test session
    sessionId = crypto.randomUUID();
    db.createSession({
      id: sessionId,
      provider: "claude-code",
      cwd: "/tmp/test",
      status: "RUNNING",
    });
  });

  afterEach(async () => {
    await db.close();
  });

  test("auto-approves permission when policy allows", async () => {
    // Create policy that allows write operations to /tmp/**
    db.createPolicy({
      name: "Allow /tmp writes",
      enabled: true,
      priority: 100,
      sessionId,
      rules: [
        {
          id: "rule-1",
          action: "allow",
          tool: "write",
          args: { input: "/tmp/**" },
          reason: "Safe temporary directory",
        },
      ],
    });

    // Mock SessionManager.sendKeys to verify it's called
    const sendKeysMock = mock(async (_sessionId: string, _keys: string[]) => {});
    sessionManager.sendKeys = sendKeysMock;
    mockManagedSession();

    // Create hook context
    const ctx: HookContext = {
      db,
      eventBus,
      sessionManager,
      policyEngine,
      auditLogger,
    };

    // Simulate permission request hook
    const hookPayload = {
      sessionId,
      event: "PermissionRequest",
      data: {
        input: "/tmp/test-file.txt",
        requestedPermissions: [{ operation: "write", path: "/tmp/test-file.txt" }],
      },
    };

    const req = new Request("http://localhost/hooks/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(hookPayload),
    });

    const response = await handleHookEvent(req, ctx);
    expect(response.status).toBe(200);

    const result = await response.json();
    expect(result.allow).toBe(true);
    expect(result.decision).toBe("allow");
    expect(result.message).toContain("Safe temporary directory");

    // Verify sendKeys was called with approval
    expect(sendKeysMock).toHaveBeenCalledTimes(1);
    expect(sendKeysMock).toHaveBeenCalledWith(sessionId, ["1", "enter"]);

    // Verify event was stored
    const events = db.getEventsBySessionId(sessionId);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("PermissionRequest");
    expect(events[0].payload).toHaveProperty("policyAction", "allow");

    // Verify audit log
    const decisions = db.getPolicyDecisionsBySessionId(sessionId);
    expect(decisions.length).toBe(1);
    expect(decisions[0].decision).toBe("allow");
  });

  test("bypasses policy engine when session is in dangerous mode", async () => {
    db.updateSession(sessionId, {
      metadata: {
        security: {
          dangerousMode: true,
        },
      },
    });

    db.createPolicy({
      id: "deny-everything",
      name: "Deny all writes",
      enabled: true,
      priority: 100,
      sessionId,
      rules: [
        {
          id: "rule-deny-all",
          action: "deny",
          tool: "write",
          reason: "Would normally deny",
        },
      ],
    });

    const sendKeysMock = mock(async (_sessionId: string, _keys: string[]) => {});
    sessionManager.sendKeys = sendKeysMock;
    mockManagedSession();

    const ctx: HookContext = {
      db,
      eventBus,
      sessionManager,
      policyEngine,
      auditLogger,
    };

    const req = new Request("http://localhost/hooks/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        event: "PermissionRequest",
        data: {
          input: "/etc/passwd",
          requestedPermissions: [{ operation: "write", path: "/etc/passwd" }],
        },
      }),
    });

    const response = await handleHookEvent(req, ctx);
    expect(response.status).toBe(200);

    const result = await response.json();
    expect(result.decision).toBe("allow");
    expect(result.message).toContain("Dangerous mode");

    expect(sendKeysMock).toHaveBeenCalledTimes(1);
    expect(sendKeysMock).toHaveBeenCalledWith(sessionId, ["1", "enter"]);

    const decisions = db.getPolicyDecisionsBySessionId(sessionId);
    expect(decisions.length).toBe(1);
    expect(decisions[0].decision).toBe("allow");
    expect(decisions[0].toolName).toBe("dangerous_mode_bypass");
  });

  test("auto-denies permission when policy denies", async () => {
    // Create policy that denies write operations to sensitive paths
    db.createPolicy({
      name: "Deny sensitive writes",
      enabled: true,
      priority: 100,
      sessionId,
      rules: [
        {
          id: "rule-1",
          action: "deny",
          tool: "write",
          args: { input: "~/.ssh/**" },
          reason: "Sensitive SSH directory",
        },
      ],
    });

    // Mock SessionManager.sendKeys
    const sendKeysMock = mock(async (_sessionId: string, _keys: string[]) => {});
    sessionManager.sendKeys = sendKeysMock;
    mockManagedSession();

    const ctx: HookContext = {
      db,
      eventBus,
      sessionManager,
      policyEngine,
      auditLogger,
    };

    const hookPayload = {
      sessionId,
      event: "PermissionRequest",
      data: {
        input: "~/.ssh/config",
        requestedPermissions: [{ operation: "write", path: "~/.ssh/config" }],
      },
    };

    const req = new Request("http://localhost/hooks/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(hookPayload),
    });

    const response = await handleHookEvent(req, ctx);
    expect(response.status).toBe(200);

    const result = await response.json();
    expect(result.allow).toBe(false);
    expect(result.decision).toBe("deny");
    expect(result.message).toContain("Sensitive SSH directory");

    // Verify sendKeys was called with denial
    expect(sendKeysMock).toHaveBeenCalledTimes(1);
    expect(sendKeysMock).toHaveBeenCalledWith(sessionId, ["2", "enter"]);

    // Verify audit log
    const decisions = db.getPolicyDecisionsBySessionId(sessionId);
    expect(decisions.length).toBe(1);
    expect(decisions[0].decision).toBe("deny");
  });

  test("skips auto-send when session is not actively managed", async () => {
    db.createPolicy({
      name: "Allow write for test",
      enabled: true,
      priority: 100,
      sessionId,
      rules: [
        {
          id: "rule-1",
          action: "allow",
          tool: "write",
          reason: "Managed session required for key injection",
        },
      ],
    });

    const sendKeysMock = mock(async (_sessionId: string, _keys: string[]) => {});
    sessionManager.sendKeys = sendKeysMock;
    // Intentionally do not mock getSession() to simulate DB-only session.

    const ctx: HookContext = {
      db,
      eventBus,
      sessionManager,
      policyEngine,
      auditLogger,
    };

    const req = new Request("http://localhost/hooks/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        event: "PermissionRequest",
        data: {
          input: "/tmp/test-file.txt",
          requestedPermissions: [{ operation: "write", path: "/tmp/test-file.txt" }],
        },
      }),
    });

    const response = await handleHookEvent(req, ctx);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.allow).toBe(true);
    expect(result.decision).toBe("allow");
    expect(sendKeysMock).not.toHaveBeenCalled();
  });

  test("does not send keys when policy action is 'ask'", async () => {
    // Create policy that asks user for confirmation
    db.createPolicy({
      name: "Ask for important operations",
      enabled: true,
      priority: 100,
      sessionId,
      rules: [
        {
          id: "rule-1",
          action: "ask",
          tool: "write",
          args: { input: "/etc/**" },
          reason: "System configuration - needs user confirmation",
        },
      ],
    });

    // Mock SessionManager.sendKeys
    const sendKeysMock = mock(async (_sessionId: string, _keys: string[]) => {});
    sessionManager.sendKeys = sendKeysMock;

    const ctx: HookContext = {
      db,
      eventBus,
      sessionManager,
      policyEngine,
      auditLogger,
    };

    const hookPayload = {
      sessionId,
      event: "PermissionRequest",
      data: {
        input: "/etc/hosts",
        requestedPermissions: [{ operation: "write", path: "/etc/hosts" }],
      },
    };

    const req = new Request("http://localhost/hooks/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(hookPayload),
    });

    const response = await handleHookEvent(req, ctx);
    expect(response.status).toBe(200);

    const result = await response.json();
    expect(result.decision).toBe("ask");
    expect(result.message).toContain("user confirmation");

    // Verify sendKeys was NOT called (user must respond manually)
    expect(sendKeysMock).not.toHaveBeenCalled();

    // Verify event was still stored
    const events = db.getEventsBySessionId(sessionId);
    expect(events.length).toBe(1);
    expect(events[0].payload).toHaveProperty("policyAction", "ask");
  });

  test("handles sendKeys errors gracefully", async () => {
    // Create allow policy
    db.createPolicy({
      name: "Allow writes",
      enabled: true,
      priority: 100,
      sessionId,
      rules: [
        {
          id: "rule-1",
          action: "allow",
          tool: "write",
          reason: "Test policy",
        },
      ],
    });

    // Mock sendKeys to throw error
    const sendKeysMock = mock(async (_sessionId: string, _keys: string[]) => {
      throw new Error("Session not found");
    });
    sessionManager.sendKeys = sendKeysMock;
    mockManagedSession();

    const ctx: HookContext = {
      db,
      eventBus,
      sessionManager,
      policyEngine,
      auditLogger,
    };

    const hookPayload = {
      sessionId,
      event: "PermissionRequest",
      data: {
        input: "/tmp/test.txt",
        requestedPermissions: [{ operation: "write", path: "/tmp/test.txt" }],
      },
    };

    const req = new Request("http://localhost/hooks/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(hookPayload),
    });

    // Should not throw even if sendKeys fails
    const response = await handleHookEvent(req, ctx);
    expect(response.status).toBe(200);

    const result = await response.json();
    expect(result.allow).toBe(true);
    expect(result.decision).toBe("allow");

    // Decision should still be recorded even if sendKeys failed
    const decisions = db.getPolicyDecisionsBySessionId(sessionId);
    expect(decisions.length).toBe(1);
    expect(decisions[0].decision).toBe("allow");
  });
});
