/**
 * Tests for workspace API routes
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "../db/db";
import type { RouteContext } from "./routes";
import { handleCreateWorkspace, handleUpdateWorkspace } from "./workspaceRoutes";

describe("Workspace API Routes", () => {
  let db: Database;
  let ctx: RouteContext;

  beforeEach(async () => {
    db = new Database(":memory:");
    await db.init();

    ctx = {
      db,
      sessionManager: {} as any,
      eventBus: {} as any,
      policyEngine: {} as any,
      auditLogger: {} as any,
    };
  });

  afterEach(() => {
    db.close();
  });

  test("POST /workspaces returns 409 for duplicate workspace name", async () => {
    const reqA = new Request("http://localhost/workspaces", {
      method: "POST",
      body: JSON.stringify({
        name: "shared-name",
        path: process.cwd(),
      }),
    });
    const resA = await handleCreateWorkspace(reqA, ctx);
    expect(resA.status).toBe(201);

    const reqB = new Request("http://localhost/workspaces", {
      method: "POST",
      body: JSON.stringify({
        name: "shared-name",
        path: "/tmp",
      }),
    });
    const resB = await handleCreateWorkspace(reqB, ctx);
    expect(resB.status).toBe(409);

    const body = await resB.json();
    expect(body.error).toContain("already exists");
  });

  test("PUT /workspaces/:id returns 422 when no updatable fields are provided", async () => {
    db.createWorkspace({
      id: "ws-empty-update",
      name: "Workspace 1",
      path: process.cwd(),
    });

    const req = new Request("http://localhost/workspaces/ws-empty-update", {
      method: "PUT",
      body: JSON.stringify({}),
    });

    const res = await handleUpdateWorkspace(req, ctx, "ws-empty-update");
    expect(res.status).toBe(422);

    const body = await res.json();
    expect(body.error).toContain("At least one field");
  });
});
