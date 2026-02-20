/**
 * Tests for env set API routes
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "../db/db";
import { handleCreateEnvSet, handleUpdateEnvSet } from "./envSetRoutes";
import type { RouteContext } from "./routes";

describe("Env Set API Routes", () => {
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

  test("POST /env-sets returns 409 for duplicate env set name", async () => {
    const reqA = new Request("http://localhost/env-sets", {
      method: "POST",
      body: JSON.stringify({
        name: "shared-env-set",
        vars: { API_KEY: "abc123" },
      }),
    });
    const resA = await handleCreateEnvSet(reqA, ctx);
    expect(resA.status).toBe(201);

    const reqB = new Request("http://localhost/env-sets", {
      method: "POST",
      body: JSON.stringify({
        name: "shared-env-set",
        vars: { TOKEN: "def456" },
      }),
    });
    const resB = await handleCreateEnvSet(reqB, ctx);
    expect(resB.status).toBe(409);

    const body = await resB.json();
    expect(body.error).toContain("already exists");
  });

  test("PUT /env-sets/:id returns 422 when no updatable fields are provided", async () => {
    const createReq = new Request("http://localhost/env-sets", {
      method: "POST",
      body: JSON.stringify({
        name: "update-target",
        vars: { API_KEY: "abc123" },
      }),
    });
    const createRes = await handleCreateEnvSet(createReq, ctx);
    expect(createRes.status).toBe(201);

    const { envSet } = await createRes.json();

    const req = new Request(`http://localhost/env-sets/${envSet.id}`, {
      method: "PUT",
      body: JSON.stringify({}),
    });
    const res = await handleUpdateEnvSet(req, ctx, envSet.id);
    expect(res.status).toBe(422);

    const body = await res.json();
    expect(body.error).toContain("At least one field");
  });
});
