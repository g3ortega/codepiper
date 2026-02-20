/**
 * Tests for policy set API routes
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "../db/db";
import {
  handleAddPolicyToSet,
  handleApplyPolicySetToSession,
  handleCreatePolicySet,
  handleGetSessionPolicySets,
  handleListPolicyDecisions,
  handleRemovePolicyFromSet,
  handleRemovePolicySetFromSession,
} from "./policySetRoutes";
import type { RouteContext } from "./routes";

describe("Policy Set API Routes", () => {
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

    db.createPolicy({
      id: "policy-1",
      name: "Policy 1",
      enabled: true,
      priority: 10,
      sessionId: null,
      rules: [{ id: "rule-1", action: "allow", tool: "Read" }],
    });
    db.createPolicy({
      id: "policy-2",
      name: "Policy 2",
      enabled: true,
      priority: 5,
      sessionId: null,
      rules: [{ id: "rule-2", action: "deny", tool: "Write" }],
    });
    db.createSession({
      id: "session-1",
      provider: "claude-code",
      cwd: "/tmp",
      status: "RUNNING",
    });
  });

  afterEach(() => {
    db.close();
  });

  test("POST /policy-sets returns 409 for duplicate id", async () => {
    const firstReq = new Request("http://localhost/policy-sets", {
      method: "POST",
      body: JSON.stringify({
        id: "set-1",
        name: "My Policy Set",
      }),
    });
    const firstRes = await handleCreatePolicySet(firstReq, ctx);
    expect(firstRes.status).toBe(201);

    const duplicateReq = new Request("http://localhost/policy-sets", {
      method: "POST",
      body: JSON.stringify({
        id: "set-1",
        name: "Another Name",
      }),
    });
    const duplicateRes = await handleCreatePolicySet(duplicateReq, ctx);
    expect(duplicateRes.status).toBe(409);

    const body = await duplicateRes.json();
    expect(body.error).toContain("already exists");
  });

  test("POST /policy-sets returns 422 for missing policy references", async () => {
    const req = new Request("http://localhost/policy-sets", {
      method: "POST",
      body: JSON.stringify({
        id: "set-missing-policy",
        name: "Set with missing policy",
        policyIds: ["policy-1", "missing-policy"],
      }),
    });

    const res = await handleCreatePolicySet(req, ctx);
    expect(res.status).toBe(422);

    const body = await res.json();
    expect(body.error).toContain("referenced policies");
    expect(body.missingPolicyIds).toContain("missing-policy");
  });

  test("POST /policy-sets/:id/policies returns 409 when member already exists", async () => {
    db.createPolicySet({
      id: "set-members",
      name: "Set Members",
      policyIds: ["policy-1"],
    });

    const req = new Request("http://localhost/policy-sets/set-members/policies", {
      method: "POST",
      body: JSON.stringify({ policyId: "policy-1" }),
    });

    const res = await handleAddPolicyToSet(req, ctx, "set-members");
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error).toContain("already a member");
  });

  test("POST /sessions/:id/policy-sets returns 404 for missing session", async () => {
    db.createPolicySet({
      id: "set-apply",
      name: "Apply Set",
      policyIds: ["policy-1"],
    });

    const req = new Request("http://localhost/sessions/missing/policy-sets", {
      method: "POST",
      body: JSON.stringify({ policySetId: "set-apply" }),
    });

    const res = await handleApplyPolicySetToSession(req, ctx, "missing-session");
    expect(res.status).toBe(404);
  });

  test("POST /sessions/:id/policy-sets returns 409 when policy set already applied", async () => {
    db.createPolicySet({
      id: "set-applied",
      name: "Applied Set",
      policyIds: ["policy-1"],
    });

    const firstReq = new Request("http://localhost/sessions/session-1/policy-sets", {
      method: "POST",
      body: JSON.stringify({ policySetId: "set-applied" }),
    });
    const firstRes = await handleApplyPolicySetToSession(firstReq, ctx, "session-1");
    expect(firstRes.status).toBe(200);

    const duplicateReq = new Request("http://localhost/sessions/session-1/policy-sets", {
      method: "POST",
      body: JSON.stringify({ policySetId: "set-applied" }),
    });
    const duplicateRes = await handleApplyPolicySetToSession(duplicateReq, ctx, "session-1");
    expect(duplicateRes.status).toBe(409);

    const body = await duplicateRes.json();
    expect(body.error).toContain("already applied");
  });

  test("DELETE /policy-sets/:id/policies/:policyId returns 404 when membership is missing", async () => {
    db.createPolicySet({
      id: "set-remove",
      name: "Remove Set",
      policyIds: ["policy-1"],
    });

    const req = new Request("http://localhost/policy-sets/set-remove/policies/policy-2", {
      method: "DELETE",
    });

    const res = await handleRemovePolicyFromSet(req, ctx, "set-remove", "policy-2");
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toContain("not a member");
  });

  test("DELETE /sessions/:id/policy-sets/:setId returns 404 when binding is missing", async () => {
    db.createPolicySet({
      id: "set-not-bound",
      name: "Not Bound",
      policyIds: ["policy-1"],
    });

    const req = new Request("http://localhost/sessions/session-1/policy-sets/set-not-bound", {
      method: "DELETE",
    });

    const res = await handleRemovePolicySetFromSession(req, ctx, "session-1", "set-not-bound");
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toContain("not applied");
  });

  test("GET /sessions/:id/policy-sets returns 404 for missing session", async () => {
    const req = new Request("http://localhost/sessions/missing/policy-sets");
    const res = await handleGetSessionPolicySets(req, ctx, "missing-session");
    expect(res.status).toBe(404);
  });

  test("GET /policy-decisions returns 422 for invalid decision query", async () => {
    const req = new Request("http://localhost/policy-decisions?decision=maybe");
    const res = await handleListPolicyDecisions(req, ctx);
    expect(res.status).toBe(422);

    const body = await res.json();
    expect(body.error).toContain("decision");
  });

  test("GET /policy-decisions returns 422 for invalid limit query", async () => {
    const req = new Request("http://localhost/policy-decisions?limit=0");
    const res = await handleListPolicyDecisions(req, ctx);
    expect(res.status).toBe(422);

    const body = await res.json();
    expect(body.error).toContain("limit");
  });
});
