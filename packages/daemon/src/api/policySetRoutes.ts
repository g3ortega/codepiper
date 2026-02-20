/**
 * Policy Set API route handlers
 */

import type { RouteContext } from "./routes";
import { hasAnyDefinedField, jsonError, parseJsonBody } from "./routeUtils";
import {
  getErrorMessage,
  isSqliteForeignKeyConstraintError,
  isSqliteUniqueConstraintError,
} from "./sqliteErrors";

const VALID_POLICY_DECISIONS = new Set(["allow", "deny", "ask"]);

function setContainsPolicy(ctx: RouteContext, setId: string, policyId: string): boolean {
  return ctx.db.getPolicySetMembers(setId).some((policy) => policy.id === policyId);
}

function sessionHasPolicySet(ctx: RouteContext, sessionId: string, setId: string): boolean {
  return ctx.db.getSessionPolicySets(sessionId).some((set) => set.id === setId);
}

/**
 * GET /policy-sets - List all policy sets
 */
export async function handleListPolicySets(_req: Request, ctx: RouteContext): Promise<Response> {
  const policySets = ctx.db.listPolicySets();
  return Response.json({ policySets });
}

/**
 * POST /policy-sets - Create a new policy set
 */
export async function handleCreatePolicySet(req: Request, ctx: RouteContext): Promise<Response> {
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) {
    return parsed.response;
  }
  const body = parsed.body as any;

  if (!body.id) {
    return jsonError(400, "Missing required field: id");
  }
  if (!body.name) {
    return jsonError(400, "Missing required field: name");
  }
  if (typeof body.id !== "string") {
    return jsonError(400, "Field 'id' must be a string");
  }
  if (typeof body.name !== "string") {
    return jsonError(400, "Field 'name' must be a string");
  }
  if (
    body.description !== undefined &&
    body.description !== null &&
    typeof body.description !== "string"
  ) {
    return jsonError(400, "Field 'description' must be a string or null");
  }
  if (body.isDefault !== undefined && typeof body.isDefault !== "boolean") {
    return jsonError(400, "Field 'isDefault' must be a boolean");
  }
  if (body.policyIds !== undefined) {
    if (!Array.isArray(body.policyIds)) {
      return jsonError(400, "Field 'policyIds' must be an array of strings");
    }

    for (const policyId of body.policyIds) {
      if (typeof policyId !== "string") {
        return jsonError(400, "Field 'policyIds' must be an array of strings");
      }
    }

    const missingPolicyIds = [...new Set<string>(body.policyIds)].filter(
      (policyId) => !ctx.db.getPolicy(policyId)
    );
    if (missingPolicyIds.length > 0) {
      return jsonError(422, "One or more referenced policies were not found", {
        missingPolicyIds,
      });
    }
  }

  try {
    ctx.db.createPolicySet({
      id: body.id,
      name: body.name,
      description: body.description,
      isDefault: body.isDefault ?? false,
      policyIds: body.policyIds,
    });

    const policySet = ctx.db.getPolicySet(body.id);
    const members = ctx.db.getPolicySetMembers(body.id);

    return Response.json({ policySet: { ...policySet, policies: members } }, { status: 201 });
  } catch (error) {
    if (isSqliteUniqueConstraintError(error)) {
      return jsonError(409, `Policy set already exists: ${body.id ?? body.name}`);
    }
    if (isSqliteForeignKeyConstraintError(error)) {
      return jsonError(422, "Policy set references a missing related record");
    }
    return jsonError(500, getErrorMessage(error));
  }
}

/**
 * GET /policy-sets/:id - Get a specific policy set with member policies
 */
export async function handleGetPolicySet(
  _req: Request,
  ctx: RouteContext,
  setId: string
): Promise<Response> {
  const policySet = ctx.db.getPolicySet(setId);
  if (!policySet) {
    return Response.json({ error: `Policy set not found: ${setId}` }, { status: 404 });
  }

  const members = ctx.db.getPolicySetMembers(setId);
  return Response.json({ policySet: { ...policySet, policies: members } });
}

/**
 * PUT /policy-sets/:id - Update a policy set
 */
export async function handleUpdatePolicySet(
  req: Request,
  ctx: RouteContext,
  setId: string
): Promise<Response> {
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) {
    return parsed.response;
  }
  const body = parsed.body as any;

  const existing = ctx.db.getPolicySet(setId);
  if (!existing) {
    return jsonError(404, `Policy set not found: ${setId}`);
  }
  if (body.name !== undefined && typeof body.name !== "string") {
    return jsonError(400, "Field 'name' must be a string");
  }
  if (
    body.description !== undefined &&
    body.description !== null &&
    typeof body.description !== "string"
  ) {
    return jsonError(400, "Field 'description' must be a string or null");
  }
  if (body.isDefault !== undefined && typeof body.isDefault !== "boolean") {
    return jsonError(400, "Field 'isDefault' must be a boolean");
  }

  const hasUpdates = hasAnyDefinedField(body, ["name", "description", "isDefault"]);
  if (!hasUpdates) {
    return jsonError(422, "At least one field must be provided: name, description, or isDefault");
  }

  try {
    const updates: any = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.isDefault !== undefined) updates.isDefault = body.isDefault;

    ctx.db.updatePolicySet(setId, updates);

    const policySet = ctx.db.getPolicySet(setId);
    const members = ctx.db.getPolicySetMembers(setId);

    return Response.json({ policySet: { ...policySet, policies: members } });
  } catch (error) {
    if (isSqliteUniqueConstraintError(error)) {
      return jsonError(409, `Policy set name already exists: ${body.name}`);
    }
    return jsonError(500, getErrorMessage(error));
  }
}

/**
 * DELETE /policy-sets/:id - Delete a policy set
 */
export async function handleDeletePolicySet(
  _req: Request,
  ctx: RouteContext,
  setId: string
): Promise<Response> {
  const existing = ctx.db.getPolicySet(setId);
  if (!existing) {
    return jsonError(404, `Policy set not found: ${setId}`);
  }

  try {
    ctx.db.deletePolicySet(setId);
    return Response.json({ success: true });
  } catch (error) {
    return jsonError(500, getErrorMessage(error));
  }
}

/**
 * POST /policy-sets/:id/policies - Add a policy to a set
 */
export async function handleAddPolicyToSet(
  req: Request,
  ctx: RouteContext,
  setId: string
): Promise<Response> {
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) {
    return parsed.response;
  }
  const body = parsed.body as any;

  if (!body.policyId) {
    return jsonError(400, "Missing required field: policyId");
  }
  if (typeof body.policyId !== "string") {
    return jsonError(400, "Field 'policyId' must be a string");
  }

  const set = ctx.db.getPolicySet(setId);
  if (!set) {
    return jsonError(404, `Policy set not found: ${setId}`);
  }

  const policy = ctx.db.getPolicy(body.policyId);
  if (!policy) {
    return jsonError(404, `Policy not found: ${body.policyId}`);
  }
  if (setContainsPolicy(ctx, setId, body.policyId)) {
    return jsonError(409, `Policy ${body.policyId} is already a member of set ${setId}`);
  }

  try {
    ctx.db.addPolicyToSet(setId, body.policyId);
    return Response.json({ success: true });
  } catch (error) {
    if (isSqliteForeignKeyConstraintError(error)) {
      return jsonError(422, "Policy set membership references a missing related record");
    }
    return jsonError(500, getErrorMessage(error));
  }
}

/**
 * DELETE /policy-sets/:id/policies/:policyId - Remove a policy from a set
 */
export async function handleRemovePolicyFromSet(
  _req: Request,
  ctx: RouteContext,
  setId: string,
  policyId: string
): Promise<Response> {
  const set = ctx.db.getPolicySet(setId);
  if (!set) {
    return jsonError(404, `Policy set not found: ${setId}`);
  }

  const policy = ctx.db.getPolicy(policyId);
  if (!policy) {
    return jsonError(404, `Policy not found: ${policyId}`);
  }
  if (!setContainsPolicy(ctx, setId, policyId)) {
    return jsonError(404, `Policy ${policyId} is not a member of set ${setId}`);
  }

  try {
    ctx.db.removePolicyFromSet(setId, policyId);
    return Response.json({ success: true });
  } catch (error) {
    return jsonError(500, getErrorMessage(error));
  }
}

/**
 * GET /sessions/:id/policy-sets - Get policy sets applied to a session
 */
export async function handleGetSessionPolicySets(
  _req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  const session = ctx.db.getSession(sessionId);
  if (!session) {
    return jsonError(404, `Session not found: ${sessionId}`);
  }

  const policySets = ctx.db.getSessionPolicySets(sessionId);
  return Response.json({ policySets });
}

/**
 * POST /sessions/:id/policy-sets - Apply a policy set to a session
 */
export async function handleApplyPolicySetToSession(
  req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) {
    return parsed.response;
  }
  const body = parsed.body as any;

  if (!body.policySetId) {
    return jsonError(400, "Missing required field: policySetId");
  }
  if (typeof body.policySetId !== "string") {
    return jsonError(400, "Field 'policySetId' must be a string");
  }

  const session = ctx.db.getSession(sessionId);
  if (!session) {
    return jsonError(404, `Session not found: ${sessionId}`);
  }
  const set = ctx.db.getPolicySet(body.policySetId);
  if (!set) {
    return jsonError(404, `Policy set not found: ${body.policySetId}`);
  }
  if (sessionHasPolicySet(ctx, sessionId, body.policySetId)) {
    return jsonError(
      409,
      `Policy set ${body.policySetId} is already applied to session ${sessionId}`
    );
  }

  try {
    ctx.db.applyPolicySetToSession(sessionId, body.policySetId);
    return Response.json({ success: true });
  } catch (error) {
    if (isSqliteForeignKeyConstraintError(error)) {
      return jsonError(422, "Session policy set references a missing related record");
    }
    return jsonError(500, getErrorMessage(error));
  }
}

/**
 * DELETE /sessions/:id/policy-sets/:setId - Remove a policy set from a session
 */
export async function handleRemovePolicySetFromSession(
  _req: Request,
  ctx: RouteContext,
  sessionId: string,
  setId: string
): Promise<Response> {
  const session = ctx.db.getSession(sessionId);
  if (!session) {
    return jsonError(404, `Session not found: ${sessionId}`);
  }

  const set = ctx.db.getPolicySet(setId);
  if (!set) {
    return jsonError(404, `Policy set not found: ${setId}`);
  }
  if (!sessionHasPolicySet(ctx, sessionId, setId)) {
    return jsonError(404, `Policy set ${setId} is not applied to session ${sessionId}`);
  }

  try {
    ctx.db.removePolicySetFromSession(sessionId, setId);
    return Response.json({ success: true });
  } catch (error) {
    return jsonError(500, getErrorMessage(error));
  }
}

/**
 * GET /sessions/:id/effective-policies - Get resolved policies for a session
 */
export async function handleGetEffectivePolicies(
  _req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  const session = ctx.db.getSession(sessionId);
  if (!session) {
    return jsonError(404, `Session not found: ${sessionId}`);
  }

  const policies = ctx.db.getEffectivePolicies(sessionId);
  return Response.json({ policies });
}

/**
 * GET /policy-decisions - List all policy decisions (audit log)
 */
export async function handleListPolicyDecisions(
  req: Request,
  ctx: RouteContext
): Promise<Response> {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  const decisionParam = url.searchParams.get("decision");
  if (decisionParam !== null && !VALID_POLICY_DECISIONS.has(decisionParam)) {
    return jsonError(422, "Query param 'decision' must be one of: allow, deny, ask");
  }
  const decision = decisionParam as "allow" | "deny" | "ask" | null;

  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number.parseInt(limitParam, 10) : 100;
  if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) {
    return jsonError(422, "Query param 'limit' must be an integer between 1 and 1000");
  }

  if (sessionId) {
    const decisions = ctx.db.getPolicyDecisionsBySessionId(sessionId, {
      decision: decision || undefined,
      limit,
    });
    return Response.json({ decisions });
  }

  // All decisions across sessions (query raw)
  const bunDb = (ctx.db as any).db;
  let sql = "SELECT * FROM policy_decisions WHERE 1=1";
  const values: unknown[] = [];

  if (decision) {
    sql += " AND decision = ?";
    values.push(decision);
  }

  sql += " ORDER BY id DESC LIMIT ?";
  values.push(limit);

  const rows = bunDb.prepare(sql).all(...values) as any[];
  const decisions = rows.map((row: any) => ({
    id: row.id,
    sessionId: row.session_id,
    eventId: row.event_id ?? undefined,
    policyId: row.policy_id ?? undefined,
    toolName: row.tool_name,
    args: row.args_json ? JSON.parse(row.args_json) : undefined,
    decision: row.decision,
    reason: row.reason ?? undefined,
    timestamp: new Date(row.timestamp),
  }));

  return Response.json({ decisions });
}
