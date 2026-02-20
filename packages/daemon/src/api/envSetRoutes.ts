/**
 * Environment Variable Set API route handlers
 */

import type { RouteContext } from "./routes";
import { hasAnyDefinedField, jsonError, parseJsonBody } from "./routeUtils";
import { getErrorMessage, isSqliteUniqueConstraintError } from "./sqliteErrors";

/**
 * GET /env-sets - List all env sets (with masked values)
 */
export async function handleListEnvSets(_req: Request, ctx: RouteContext): Promise<Response> {
  const envSets = ctx.db.listEnvSets();
  return Response.json({ envSets });
}

/**
 * POST /env-sets - Create a new env set
 */
export async function handleCreateEnvSet(req: Request, ctx: RouteContext): Promise<Response> {
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) {
    return parsed.response;
  }
  const body = parsed.body as any;

  if (!body.name || typeof body.name !== "string") {
    return jsonError(400, "Missing required field: name");
  }
  if (body.name.trim().length === 0) {
    return jsonError(400, "Field 'name' must not be empty");
  }
  if (body.name.length > 100) {
    return jsonError(400, "Name too long (max 100 chars)");
  }
  if (
    body.description !== undefined &&
    body.description !== null &&
    typeof body.description !== "string"
  ) {
    return jsonError(400, "Field 'description' must be a string or null");
  }
  if (!body.vars || typeof body.vars !== "object" || Array.isArray(body.vars)) {
    return jsonError(400, "Missing required field: vars (must be an object)");
  }

  // Validate all keys and values are strings
  for (const [key, value] of Object.entries(body.vars)) {
    if (typeof key !== "string" || typeof value !== "string") {
      return jsonError(400, `All env var keys and values must be strings. Invalid: ${key}`);
    }
  }

  const id = crypto.randomUUID();

  try {
    ctx.db.createEnvSet({
      id,
      name: body.name,
      description: body.description,
      vars: body.vars,
    });
    const envSet = ctx.db.getEnvSet(id);
    return Response.json({ envSet }, { status: 201 });
  } catch (error) {
    const msg = getErrorMessage(error);
    if (isSqliteUniqueConstraintError(error)) {
      return jsonError(409, `Env set name already exists: ${body.name}`);
    }
    return jsonError(500, msg);
  }
}

/**
 * GET /env-sets/:id - Get a specific env set (with masked values)
 */
export async function handleGetEnvSet(
  _req: Request,
  ctx: RouteContext,
  envSetId: string
): Promise<Response> {
  const envSet = ctx.db.getEnvSet(envSetId);
  if (!envSet) {
    return jsonError(404, `Env set not found: ${envSetId}`);
  }
  return Response.json({ envSet });
}

/**
 * PUT /env-sets/:id - Update an env set
 */
export async function handleUpdateEnvSet(
  req: Request,
  ctx: RouteContext,
  envSetId: string
): Promise<Response> {
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) {
    return parsed.response;
  }
  const body = parsed.body as any;

  const existing = ctx.db.getEnvSet(envSetId);
  if (!existing) {
    return jsonError(404, `Env set not found: ${envSetId}`);
  }

  if (body.name !== undefined && typeof body.name !== "string") {
    return jsonError(400, "name must be a string");
  }
  if (body.name !== undefined && body.name.trim().length === 0) {
    return jsonError(400, "name must not be empty");
  }
  if (body.name !== undefined && body.name.length > 100) {
    return jsonError(400, "Name too long (max 100 chars)");
  }
  if (
    body.description !== undefined &&
    body.description !== null &&
    typeof body.description !== "string"
  ) {
    return jsonError(400, "description must be a string or null");
  }
  if (body.vars !== undefined) {
    if (typeof body.vars !== "object" || Array.isArray(body.vars)) {
      return jsonError(400, "vars must be an object");
    }
    for (const [key, value] of Object.entries(body.vars)) {
      if (typeof key !== "string" || typeof value !== "string") {
        return jsonError(400, `All env var keys and values must be strings. Invalid: ${key}`);
      }
    }
  }
  if (!hasAnyDefinedField(body, ["name", "description", "vars"])) {
    return jsonError(422, "At least one field must be provided: name, description, or vars");
  }

  try {
    ctx.db.updateEnvSet(envSetId, {
      name: body.name,
      description: body.description,
      vars: body.vars,
    });
    const envSet = ctx.db.getEnvSet(envSetId);
    return Response.json({ envSet });
  } catch (error) {
    const msg = getErrorMessage(error);
    if (isSqliteUniqueConstraintError(error)) {
      return jsonError(409, `Env set name already exists: ${body.name}`);
    }
    return jsonError(500, msg);
  }
}

/**
 * DELETE /env-sets/:id - Delete an env set
 */
export async function handleDeleteEnvSet(
  _req: Request,
  ctx: RouteContext,
  envSetId: string
): Promise<Response> {
  const existing = ctx.db.getEnvSet(envSetId);
  if (!existing) {
    return jsonError(404, `Env set not found: ${envSetId}`);
  }

  ctx.db.deleteEnvSet(envSetId);
  return Response.json({ success: true });
}
