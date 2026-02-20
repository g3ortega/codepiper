/**
 * Policy API route handlers
 */

import type { PolicyRule } from "../db/policyDb";
import { createPolicyDb } from "../db/policyDb";
import type { RouteContext } from "./routes";
import { jsonError, parseJsonBody } from "./routeUtils";
import {
  getErrorMessage,
  isSqliteForeignKeyConstraintError,
  isSqliteUniqueConstraintError,
} from "./sqliteErrors";

/**
 * GET /policies - List all policies
 */
export async function handleListPolicies(req: Request, ctx: RouteContext): Promise<Response> {
  const policyDb = createPolicyDb(ctx.db);

  // Parse query parameters
  const url = new URL(req.url);
  const enabledParam = url.searchParams.get("enabled");
  const sessionIdParam = url.searchParams.get("sessionId");

  const options: any = {};

  if (enabledParam !== null) {
    options.enabled = enabledParam === "true";
  }

  if (sessionIdParam !== null) {
    options.sessionId = sessionIdParam === "null" ? null : sessionIdParam;
  }

  const policies = policyDb.getPolicies(options);

  return Response.json({ policies });
}

/**
 * POST /policies - Create a new policy
 */
export async function handleCreatePolicy(req: Request, ctx: RouteContext): Promise<Response> {
  const parsed = await parseJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) {
    return parsed.response;
  }
  const body = parsed.body as any;

  // Validate required fields
  if (!body.id) {
    return jsonError(400, "Missing required field: id");
  }
  if (!body.name) {
    return jsonError(400, "Missing required field: name");
  }
  if (body.enabled === undefined) {
    return jsonError(400, "Missing required field: enabled");
  }
  if (body.priority === undefined) {
    return jsonError(400, "Missing required field: priority");
  }
  if (body.sessionId === undefined) {
    return jsonError(400, "Missing required field: sessionId");
  }
  if (!body.rules) {
    return jsonError(400, "Missing required field: rules");
  }
  if (!Array.isArray(body.rules)) {
    return jsonError(400, "Field 'rules' must be an array");
  }
  if (typeof body.enabled !== "boolean") {
    return jsonError(400, "Field 'enabled' must be a boolean");
  }
  if (
    typeof body.priority !== "number" ||
    !Number.isInteger(body.priority) ||
    !Number.isFinite(body.priority)
  ) {
    return jsonError(400, "Field 'priority' must be an integer");
  }
  if (body.sessionId !== null && typeof body.sessionId !== "string") {
    return jsonError(400, "Field 'sessionId' must be a string or null");
  }
  if (body.sessionId !== null && !ctx.db.getSession(body.sessionId)) {
    return jsonError(404, `Session not found: ${body.sessionId}`);
  }

  try {
    const policyDb = createPolicyDb(ctx.db);

    policyDb.createPolicy({
      id: body.id,
      name: body.name,
      description: body.description,
      enabled: body.enabled,
      priority: body.priority,
      sessionId: body.sessionId,
      rules: body.rules as PolicyRule[],
    });

    const policy = policyDb.getPolicy(body.id);

    return Response.json({ policy }, { status: 201 });
  } catch (error) {
    if (isSqliteUniqueConstraintError(error)) {
      return jsonError(409, `Policy already exists: ${body.id}`);
    }
    if (isSqliteForeignKeyConstraintError(error)) {
      return jsonError(422, "Policy references a missing related record");
    }
    return jsonError(500, getErrorMessage(error));
  }
}

/**
 * GET /policies/:id - Get a specific policy
 */
export async function handleGetPolicy(
  _req: Request,
  ctx: RouteContext,
  policyId: string
): Promise<Response> {
  const policyDb = createPolicyDb(ctx.db);
  const policy = policyDb.getPolicy(policyId);

  if (!policy) {
    return Response.json({ error: `Policy not found: ${policyId}` }, { status: 404 });
  }

  return Response.json({ policy });
}

/**
 * PUT /policies/:id - Update a policy
 */
export async function handleUpdatePolicy(
  req: Request,
  ctx: RouteContext,
  policyId: string
): Promise<Response> {
  const parsed = await parseJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) {
    return parsed.response;
  }
  const body = parsed.body as any;

  // Validate rules if provided
  if (body.rules !== undefined && !Array.isArray(body.rules)) {
    return jsonError(400, "Field 'rules' must be an array");
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
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    return jsonError(400, "Field 'enabled' must be a boolean");
  }
  if (
    body.priority !== undefined &&
    (typeof body.priority !== "number" ||
      !Number.isInteger(body.priority) ||
      !Number.isFinite(body.priority))
  ) {
    return jsonError(400, "Field 'priority' must be an integer");
  }

  const policyDb = createPolicyDb(ctx.db);

  // Check if policy exists
  const existing = policyDb.getPolicy(policyId);
  if (!existing) {
    return jsonError(404, `Policy not found: ${policyId}`);
  }

  try {
    const updates: any = {};

    if (body.name !== undefined) {
      updates.name = body.name;
    }
    if (body.description !== undefined) {
      updates.description = body.description;
    }
    if (body.enabled !== undefined) {
      updates.enabled = body.enabled;
    }
    if (body.priority !== undefined) {
      updates.priority = body.priority;
    }
    if (body.rules !== undefined) {
      updates.rules = body.rules;
    }

    policyDb.updatePolicy(policyId, updates);

    const policy = policyDb.getPolicy(policyId);

    return Response.json({ policy });
  } catch (error) {
    return jsonError(500, getErrorMessage(error));
  }
}

/**
 * DELETE /policies/:id - Delete a policy
 */
export async function handleDeletePolicy(
  _req: Request,
  ctx: RouteContext,
  policyId: string
): Promise<Response> {
  const policyDb = createPolicyDb(ctx.db);

  // Check if policy exists
  const existing = policyDb.getPolicy(policyId);
  if (!existing) {
    return jsonError(404, `Policy not found: ${policyId}`);
  }

  try {
    policyDb.deletePolicy(policyId);
    return Response.json({ success: true });
  } catch (error) {
    return jsonError(500, getErrorMessage(error));
  }
}
