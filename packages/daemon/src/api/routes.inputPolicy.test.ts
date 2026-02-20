import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EventBus } from "@codepiper/core";
import { Database } from "../db/db";
import { AuditLogger } from "../sessions/auditLogger";
import { PolicyEngine } from "../sessions/policyEngine";
import type { RouteContext } from "./routes";
import { handleSendKeys, handleSendText } from "./routes";

describe("input preflight policy for no-hook providers", () => {
  let db: Database;
  let eventBus: EventBus;
  let policyEngine: PolicyEngine;
  let auditLogger: AuditLogger;

  beforeEach(async () => {
    db = new Database(":memory:");
    await db.init();
    eventBus = new EventBus();
    policyEngine = new PolicyEngine({ defaultAction: "ask" });
    auditLogger = new AuditLogger(db);
  });

  afterEach(() => {
    db.close();
    mock.restore();
  });

  function createContext(sendTextMock: ReturnType<typeof mock>): RouteContext {
    const sessionManager = {
      sendText: sendTextMock,
      sendKeys: mock(async () => {}),
      flushWrites: mock(() => {}),
      getSession: mock(() => undefined),
    } as any;

    return {
      sessionManager,
      db,
      eventBus,
      policyEngine,
      auditLogger,
    };
  }

  test("allows codex input when no policy matches and default action is ask", async () => {
    const sessionId = crypto.randomUUID();
    db.createSession({
      id: sessionId,
      provider: "codex",
      cwd: "/tmp",
      status: "RUNNING",
    });

    const sendTextMock = mock(async () => {});
    const ctx = createContext(sendTextMock);

    const req = new Request(`http://localhost/sessions/${sessionId}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "ls -la", newline: false }),
    });

    const res = await handleSendText(req, ctx, sessionId);
    expect(res.status).toBe(200);
    expect(sendTextMock).toHaveBeenCalledTimes(1);

    const decisions = db.getPolicyDecisionsBySessionId(sessionId);
    expect(decisions.length).toBe(1);
    expect(decisions[0].decision).toBe("ask");

    const events = db.getEventsBySessionId(sessionId);
    expect(events.some((evt) => evt.type === "InputPolicyDecision")).toBe(true);
  });

  test("blocks codex input when policy denies", async () => {
    const sessionId = crypto.randomUUID();
    db.createSession({
      id: sessionId,
      provider: "codex",
      cwd: "/tmp",
      status: "RUNNING",
    });

    db.createPolicy({
      id: "deny-destructive",
      name: "Deny destructive terminal input",
      enabled: true,
      priority: 100,
      sessionId,
      rules: [
        {
          id: "rule-deny-rm",
          action: "deny",
          tool: "terminal_input",
          args: { input: "*rm -rf*" },
          reason: "Destructive command blocked",
        },
      ],
    });

    const sendTextMock = mock(async () => {});
    const ctx = createContext(sendTextMock);

    const req = new Request(`http://localhost/sessions/${sessionId}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "rm -rf /", newline: true }),
    });

    const res = await handleSendText(req, ctx, sessionId);
    expect(res.status).toBe(403);
    expect(sendTextMock).not.toHaveBeenCalled();

    const body = await res.json();
    expect(body.error).toContain("Destructive command blocked");

    const decisions = db.getPolicyDecisionsBySessionId(sessionId);
    expect(decisions.length).toBe(1);
    expect(decisions[0].decision).toBe("deny");
  });

  test("skips input preflight policy when dangerous mode is enabled", async () => {
    const sessionId = crypto.randomUUID();
    db.createSession({
      id: sessionId,
      provider: "codex",
      cwd: "/tmp",
      status: "RUNNING",
      metadata: {
        security: {
          dangerousMode: true,
        },
      },
    });

    db.createPolicy({
      id: "deny-all-terminal-input",
      name: "Deny all terminal input",
      enabled: true,
      priority: 100,
      sessionId,
      rules: [
        {
          id: "rule-deny-all",
          action: "deny",
          tool: "terminal_input",
          reason: "Should be bypassed in dangerous mode",
        },
      ],
    });

    const sendTextMock = mock(async () => {});
    const ctx = createContext(sendTextMock);

    const req = new Request(`http://localhost/sessions/${sessionId}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "rm -rf /", newline: true }),
    });

    const res = await handleSendText(req, ctx, sessionId);
    expect(res.status).toBe(200);
    expect(sendTextMock).toHaveBeenCalledTimes(1);

    const decisions = db.getPolicyDecisionsBySessionId(sessionId);
    expect(decisions.length).toBe(0);
  });

  test("blocks codex key input when policy denies terminal_keys", async () => {
    const sessionId = crypto.randomUUID();
    db.createSession({
      id: sessionId,
      provider: "codex",
      cwd: "/tmp",
      status: "RUNNING",
    });

    db.createPolicy({
      id: "deny-enter-key",
      name: "Deny Enter key on codex",
      enabled: true,
      priority: 100,
      sessionId,
      rules: [
        {
          id: "rule-deny-enter",
          action: "deny",
          tool: "terminal_keys",
          args: { keys: '*"enter"*' },
          reason: "Enter key blocked",
        },
      ],
    });

    const sendKeysMock = mock(async () => {});
    const sessionManager = {
      sendText: mock(async () => {}),
      sendKeys: sendKeysMock,
      flushWrites: mock(() => {}),
      getSession: mock(() => undefined),
    } as any;

    const ctx: RouteContext = {
      sessionManager,
      db,
      eventBus,
      policyEngine,
      auditLogger,
    };

    const req = new Request(`http://localhost/sessions/${sessionId}/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: ["enter"] }),
    });

    const res = await handleSendKeys(req, ctx, sessionId);
    expect(res.status).toBe(403);
    expect(sendKeysMock).not.toHaveBeenCalled();

    const body = await res.json();
    expect(body.error).toContain("Enter key blocked");

    const decisions = db.getPolicyDecisionsBySessionId(sessionId);
    expect(decisions.length).toBe(1);
    expect(decisions[0].toolName).toBe("terminal_keys");
  });
});
