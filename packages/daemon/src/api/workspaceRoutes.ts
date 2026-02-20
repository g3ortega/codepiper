/**
 * Workspace API route handlers
 */

import * as fs from "node:fs";
import type { RouteContext } from "./routes";
import { hasAnyDefinedField, jsonError, parseJsonBody } from "./routeUtils";
import { getErrorMessage, isSqliteUniqueConstraintError } from "./sqliteErrors";

/**
 * GET /workspaces - List all workspaces
 */
export async function handleListWorkspaces(_req: Request, ctx: RouteContext): Promise<Response> {
  const workspaces = ctx.db.listWorkspaces();
  return Response.json({ workspaces });
}

/**
 * POST /workspaces - Create a new workspace
 */
export async function handleCreateWorkspace(req: Request, ctx: RouteContext): Promise<Response> {
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
  if (!body.path || typeof body.path !== "string") {
    return jsonError(400, "Missing required field: path");
  }
  if (!body.path.startsWith("/")) {
    return jsonError(400, "Path must be an absolute path");
  }
  if (!fs.existsSync(body.path)) {
    return jsonError(400, `Directory does not exist: ${body.path}`);
  }

  const id = crypto.randomUUID();

  try {
    ctx.db.createWorkspace({ id, name: body.name, path: body.path });
    const workspace = ctx.db.getWorkspace(id);
    return Response.json({ workspace }, { status: 201 });
  } catch (error) {
    const msg = getErrorMessage(error);
    if (isSqliteUniqueConstraintError(error)) {
      return jsonError(409, `Workspace name already exists: ${body.name}`);
    }
    return jsonError(500, msg);
  }
}

/**
 * GET /workspaces/:id - Get a specific workspace
 */
export async function handleGetWorkspace(
  _req: Request,
  ctx: RouteContext,
  workspaceId: string
): Promise<Response> {
  const workspace = ctx.db.getWorkspace(workspaceId);
  if (!workspace) {
    return jsonError(404, `Workspace not found: ${workspaceId}`);
  }
  return Response.json({ workspace });
}

/**
 * PUT /workspaces/:id - Update a workspace
 */
export async function handleUpdateWorkspace(
  req: Request,
  ctx: RouteContext,
  workspaceId: string
): Promise<Response> {
  const parsed = await parseJsonBody(req);
  if (!parsed.ok) {
    return parsed.response;
  }
  const body = parsed.body as any;

  const existing = ctx.db.getWorkspace(workspaceId);
  if (!existing) {
    return jsonError(404, `Workspace not found: ${workspaceId}`);
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
  if (body.path !== undefined) {
    if (typeof body.path !== "string") {
      return jsonError(400, "path must be a string");
    }
    if (!body.path.startsWith("/")) {
      return jsonError(400, "Path must be an absolute path");
    }
    if (!fs.existsSync(body.path)) {
      return jsonError(400, `Directory does not exist: ${body.path}`);
    }
  }
  if (!hasAnyDefinedField(body, ["name", "path"])) {
    return jsonError(422, "At least one field must be provided: name or path");
  }

  try {
    ctx.db.updateWorkspace(workspaceId, {
      name: body.name,
      path: body.path,
    });
    const workspace = ctx.db.getWorkspace(workspaceId);
    return Response.json({ workspace });
  } catch (error) {
    const msg = getErrorMessage(error);
    if (isSqliteUniqueConstraintError(error)) {
      return jsonError(409, `Workspace name already exists: ${body.name}`);
    }
    return jsonError(500, msg);
  }
}

/**
 * DELETE /workspaces/:id - Delete a workspace
 */
export async function handleDeleteWorkspace(
  _req: Request,
  ctx: RouteContext,
  workspaceId: string
): Promise<Response> {
  const existing = ctx.db.getWorkspace(workspaceId);
  if (!existing) {
    return jsonError(404, `Workspace not found: ${workspaceId}`);
  }

  ctx.db.deleteWorkspace(workspaceId);
  return Response.json({ success: true });
}
