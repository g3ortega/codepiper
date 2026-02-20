import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EventBus } from "@codepiper/core";
import { Database } from "../db/db";
import { AuditLogger } from "../sessions/auditLogger";
import { PolicyEngine } from "../sessions/policyEngine";
import type { RouteContext } from "./routes";
import { handleCreateSession, handleRecoverSession, handleResumeSession } from "./routes";

describe("session create/resume/recover routes", () => {
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

  function createContext(
    sessionManagerOverrides: Partial<RouteContext["sessionManager"]>
  ): RouteContext {
    const sessionManager = {
      createSession: mock(async () => ({
        id: "session-1",
        provider: "codex",
        cwd: process.cwd(),
        status: "STARTING",
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      getSession: mock(() => undefined),
      recoverSession: mock(async (_sessionId: string) => ({
        id: "session-1",
        provider: "codex",
        cwd: process.cwd(),
        status: "RUNNING",
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      resumeSession: mock(async (_sessionId: string) => ({
        id: "session-1",
        provider: "codex",
        cwd: process.cwd(),
        status: "RUNNING",
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      ...sessionManagerOverrides,
    } as any;

    return {
      sessionManager,
      db,
      eventBus,
      policyEngine,
      auditLogger,
    };
  }

  test("accepts providerResume payload on session create", async () => {
    const createSession = mock(async (_opts: any) => ({
      id: "session-1",
      provider: "codex",
      cwd: process.cwd(),
      status: "STARTING",
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    const ctx = createContext({ createSession });

    const req = new Request("http://localhost/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "codex",
        cwd: process.cwd(),
        providerResume: {
          providerSessionId: " 019c7285-ba64-7462-bbfc-4227f3e24e88 ",
          mode: "resume",
        },
      }),
    });

    const res = await handleCreateSession(req, ctx);
    expect(res.status).toBe(201);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "codex",
        providerResume: {
          providerSessionId: "019c7285-ba64-7462-bbfc-4227f3e24e88",
          mode: "resume",
        },
      })
    );
  });

  test("rejects invalid providerResume.mode", async () => {
    const ctx = createContext({});

    const req = new Request("http://localhost/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "codex",
        cwd: process.cwd(),
        providerResume: {
          providerSessionId: "abc",
          mode: "invalid-mode",
        },
      }),
    });

    const res = await handleCreateSession(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("providerResume.mode");
  });

  test("recover route uses recoverSession", async () => {
    const recoverSession = mock(async (_sessionId: string) => ({
      id: "session-1",
      provider: "claude-code",
      cwd: process.cwd(),
      status: "RUNNING",
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    const ctx = createContext({ recoverSession });

    const res = await handleRecoverSession(new Request("http://localhost"), ctx, "session-1");

    expect(res.status).toBe(200);
    expect(recoverSession).toHaveBeenCalledWith("session-1");
  });

  test("resume route uses resumeSession", async () => {
    const resumeSession = mock(async (_sessionId: string) => ({
      id: "session-1",
      provider: "claude-code",
      cwd: process.cwd(),
      status: "RUNNING",
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    const ctx = createContext({ resumeSession });

    const res = await handleResumeSession(new Request("http://localhost"), ctx, "session-1");

    expect(res.status).toBe(200);
    expect(resumeSession).toHaveBeenCalledWith("session-1");
  });
});
