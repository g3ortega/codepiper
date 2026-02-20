import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EventBus } from "@codepiper/core";
import { Database } from "../db/db";
import { AuditLogger } from "../sessions/auditLogger";
import { PolicyEngine } from "../sessions/policyEngine";
import type { RouteContext } from "./routes";
import { handleGetModel, handleSwitchModel } from "./routes";

describe("model routes capability checks", () => {
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

  function createContext(params: {
    provider?: "claude-code" | "codex";
    currentModel?: string;
    switchModel?: ReturnType<typeof mock>;
  }): RouteContext {
    const switchModel =
      params.switchModel ??
      mock(async (_sessionId: string, _model: string) => {
        return;
      });

    const session =
      params.provider === undefined
        ? undefined
        : {
            id: "session-1",
            provider: params.provider,
            cwd: "/tmp",
            status: "RUNNING",
          };

    const sessionManager = {
      getSession: mock((_sessionId: string) => session),
      switchModel,
      getCurrentModel: mock((_sessionId: string) => params.currentModel),
    } as any;

    return {
      sessionManager,
      db,
      eventBus,
      policyEngine,
      auditLogger,
    };
  }

  test("returns 409 when switching model for provider without model switch capability", async () => {
    const switchModel = mock(async () => {});
    const ctx = createContext({ provider: "codex", switchModel });

    const req = new Request("http://localhost/sessions/session-1/model", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "sonnet" }),
    });
    const res = await handleSwitchModel(req, ctx, "session-1");

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("not supported");
    expect(body.supportsModelSwitch).toBe(false);
    expect(switchModel).not.toHaveBeenCalled();
  });

  test("returns 404 when switching model for unknown session", async () => {
    const ctx = createContext({});

    const req = new Request("http://localhost/sessions/session-1/model", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "sonnet" }),
    });
    const res = await handleSwitchModel(req, ctx, "session-1");

    expect(res.status).toBe(404);
  });

  test("switches model for provider with model switch capability", async () => {
    const switchModel = mock(async () => {});
    const ctx = createContext({ provider: "claude-code", switchModel });

    const req = new Request("http://localhost/sessions/session-1/model", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "sonnet" }),
    });
    const res = await handleSwitchModel(req, ctx, "session-1");

    expect(res.status).toBe(200);
    expect(switchModel).toHaveBeenCalledTimes(1);
    expect(switchModel).toHaveBeenCalledWith("session-1", "sonnet");
  });

  test("get model returns provider capability metadata", async () => {
    const ctx = createContext({ provider: "codex", currentModel: "unknown" });
    const req = new Request("http://localhost/sessions/session-1/model", {
      method: "GET",
    });

    const res = await handleGetModel(req, ctx, "session-1");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider).toBe("codex");
    expect(body.supportsModelSwitch).toBe(false);
    expect(body.model).toBe("unknown");
  });

  test("get model returns 404 for unknown session", async () => {
    const ctx = createContext({});
    const req = new Request("http://localhost/sessions/session-1/model", {
      method: "GET",
    });

    const res = await handleGetModel(req, ctx, "session-1");

    expect(res.status).toBe(404);
  });
});
