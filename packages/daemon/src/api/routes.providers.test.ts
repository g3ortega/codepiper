import { describe, expect, test } from "bun:test";
import { EventBus } from "@codepiper/core";
import { Database } from "../db/db";
import { AuditLogger } from "../sessions/auditLogger";
import { PolicyEngine } from "../sessions/policyEngine";
import { SessionManager } from "../sessions/sessionManager";
import { handleListProviders, type RouteContext } from "./routes";

describe("provider capability routes", () => {
  test("GET /providers lists supported providers with capabilities", async () => {
    const db = new Database(":memory:");
    await db.init();
    const eventBus = new EventBus();
    const policyEngine = new PolicyEngine({ defaultAction: "ask" });
    const auditLogger = new AuditLogger(db);
    const sessionManager = new SessionManager(db, eventBus);

    const ctx: RouteContext = {
      sessionManager,
      db,
      eventBus,
      policyEngine,
      auditLogger,
    };

    const response = await handleListProviders(new Request("http://localhost/providers"), ctx);
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(Array.isArray(body.providers)).toBe(true);
    expect(body.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "claude-code",
          runtime: "tmux",
          capabilities: expect.objectContaining({
            nativeHooks: true,
            supportsDangerousMode: true,
          }),
          launchHints: expect.objectContaining({
            dangerousModeFlags: expect.arrayContaining(["--dangerously-skip-permissions"]),
            resumeCommands: expect.objectContaining({
              resume: "claude --resume {id}",
            }),
          }),
        }),
        expect.objectContaining({
          id: "codex",
          runtime: "tmux",
          capabilities: expect.objectContaining({
            nativeHooks: false,
            supportsDangerousMode: true,
          }),
          launchHints: expect.objectContaining({
            dangerousModeFlags: expect.arrayContaining([
              "--dangerously-bypass-approvals-and-sandbox",
            ]),
            resumeCommands: expect.objectContaining({
              resume: "codex resume {id}",
            }),
          }),
        }),
      ])
    );

    await sessionManager.stopAll();
    db.close();
  });
});
