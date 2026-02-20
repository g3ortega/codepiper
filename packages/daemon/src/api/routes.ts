/**
 * API route handlers
 */

import type { EventBus } from "@codepiper/core";
import { SessionNotFoundError } from "@codepiper/core";
import type { Database, EventSource } from "../db/db";
import type { PushNotifier } from "../notifications/pushNotifier";
import {
  getProviderDefinition,
  isProviderId,
  listProviderDefinitions,
  listSupportedProviders,
} from "../providers/registry";
import type { AuditLogger } from "../sessions/auditLogger";
import type { PolicyEngine } from "../sessions/policyEngine";
import type { SessionManager } from "../sessions/sessionManager";
import { handleHookEvent } from "./hooks";
import { enforceInputPolicyPreflight } from "./inputPolicy";
import {
  validateArgs,
  validateCwd,
  validateEnv,
  validateImageUpload,
  validateKeys,
  validateModel,
  validateText,
} from "./validation";

export interface RouteContext {
  sessionManager: SessionManager;
  db: Database;
  eventBus: EventBus;
  policyEngine: PolicyEngine;
  auditLogger: AuditLogger;
  authService?: import("../auth/authService").AuthService;
  rateLimiter?: import("../auth/rateLimiter").RateLimiter;
  /** Shared daemon secret for authenticating hook requests */
  hookSecret?: string;
  /** Optional callback to request daemon restart (used by settings endpoint) */
  restartDaemon?: () => Promise<void> | void;
  /** Optional push notifier status provider */
  pushNotifier?: PushNotifier;
}

const SESSION_CUSTOM_NAME_MAX_LENGTH = 80;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codePoint = value.charCodeAt(index);
    if ((codePoint >= 0 && codePoint <= 31) || codePoint === 127) {
      return true;
    }
  }
  return false;
}

function upsertSessionCustomName(
  metadata: Record<string, unknown> | undefined,
  customName: string | null
): Record<string, unknown> {
  const current = isObjectRecord(metadata) ? metadata : {};
  const next = { ...current };
  const currentUi = isObjectRecord(current.ui) ? current.ui : {};
  const nextUi = { ...currentUi };

  if (customName) {
    nextUi.customName = customName;
  } else {
    delete nextUi.customName;
  }

  if (Object.keys(nextUi).length > 0) {
    next.ui = nextUi;
  } else {
    delete next.ui;
  }

  return Object.keys(next).length > 0 ? next : {};
}

function errorResponse(error: unknown, fallbackStatus = 500): Response {
  if (error instanceof SessionNotFoundError) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  return Response.json(
    { error: error instanceof Error ? error.message : "Unknown error" },
    { status: fallbackStatus }
  );
}

function listActiveDbSessions(ctx: RouteContext) {
  return [
    ...ctx.db.listSessions({ status: "RUNNING" }),
    ...ctx.db.listSessions({ status: "STARTING" }),
  ];
}

function listCodepiperTmuxSessionNames(): Set<string> | null {
  try {
    const tmuxResult = Bun.spawnSync(["tmux", "list-sessions", "-F", "#{session_name}"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    if (tmuxResult.exitCode !== 0) {
      return null;
    }

    const names = (tmuxResult.stdout?.toString() ?? "")
      .split("\n")
      .map((name) => name.trim())
      .filter((name) => name.startsWith("codepiper-"));
    return new Set(names);
  } catch {
    return null;
  }
}

export async function handleHealth(_req: Request, ctx: RouteContext): Promise<Response> {
  const activeDbSessions = listActiveDbSessions(ctx);
  const activeInMemorySessionIds = new Set(
    ctx.sessionManager.listSessions().map((session) => session.id)
  );
  const tmuxSessionNames = listCodepiperTmuxSessionNames();

  let zombieSessionCount = 0;
  for (const session of activeDbSessions) {
    if (activeInMemorySessionIds.has(session.id)) {
      continue;
    }
    if (tmuxSessionNames?.has(`codepiper-${session.id}`)) {
      continue;
    }
    zombieSessionCount++;
  }

  return Response.json({
    status: "ok",
    zombieSessionCount,
  });
}

export async function handleVersion(_req: Request, _ctx: RouteContext): Promise<Response> {
  return Response.json({
    version: "0.1.0",
    bun: Bun.version,
  });
}

export async function handleListProviders(_req: Request, _ctx: RouteContext): Promise<Response> {
  return Response.json({
    providers: listProviderDefinitions().map((provider) => ({
      id: provider.id,
      label: provider.label,
      runtime: provider.runtime,
      capabilities: provider.capabilities,
      launchHints: provider.launchHints,
    })),
  });
}

export async function handleListSessions(_req: Request, ctx: RouteContext): Promise<Response> {
  // Merge in-memory (active) sessions with DB (stopped/crashed) sessions
  const activeSessions = ctx.sessionManager.listSessions();
  const activeIds = new Set(activeSessions.map((s) => s.id));
  const dbSessions = ctx.db.listSessions().filter((s) => !activeIds.has(s.id));

  // Health check DB-only sessions that claim to be active
  const adoptedSessions: any[] = [];
  const remainingDbSessions: typeof dbSessions = [];

  for (const session of dbSessions) {
    if (session.status === "RUNNING" || session.status === "STARTING") {
      const tmuxCheck = Bun.spawnSync(["tmux", "has-session", "-t", `codepiper-${session.id}`], {
        stdout: "ignore",
        stderr: "ignore",
      });
      if (tmuxCheck.exitCode !== 0) {
        ctx.db.updateSession(session.id, { status: "STOPPED" });
        session.status = "STOPPED";
        remainingDbSessions.push(session);
      } else {
        // Tmux alive but not in memory — auto-adopt
        try {
          const adopted = await ctx.sessionManager.adoptSession(session.id);
          adoptedSessions.push(adopted);
        } catch {
          remainingDbSessions.push(session);
        }
      }
    } else {
      remainingDbSessions.push(session);
    }
  }

  return Response.json({
    sessions: [...activeSessions, ...adoptedSessions, ...remainingDbSessions],
  });
}

export async function handleCreateSession(req: Request, ctx: RouteContext): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  // Validate required fields
  if (!body.provider) {
    return Response.json({ error: "Missing required field: provider" }, { status: 400 });
  }

  if (!body.cwd) {
    return Response.json({ error: "Missing required field: cwd" }, { status: 400 });
  }

  // Validate provider
  const validProviders = listSupportedProviders();
  if (!(typeof body.provider === "string" && isProviderId(body.provider))) {
    return Response.json(
      {
        error: `Invalid provider: ${body.provider}. Must be one of: ${validProviders.join(", ")}`,
      },
      { status: 400 }
    );
  }
  const providerDefinition = getProviderDefinition(body.provider);

  // Validate cwd (path length, format)
  const cwdValidation = validateCwd(body.cwd);
  if (!cwdValidation.valid) {
    return Response.json({ error: cwdValidation.error }, { status: 400 });
  }

  // Validate optional env (if provided)
  if (body.env !== undefined) {
    const envValidation = validateEnv(body.env);
    if (!envValidation.valid) {
      return Response.json({ error: envValidation.error }, { status: 400 });
    }
  }

  // Validate optional args (if provided)
  if (body.args !== undefined) {
    const argsValidation = validateArgs(body.args);
    if (!argsValidation.valid) {
      return Response.json({ error: argsValidation.error }, { status: 400 });
    }
  }

  // Validate optional billingMode (if provided)
  if (body.billingMode !== undefined) {
    const validModes = ["subscription", "api"];
    if (!validModes.includes(body.billingMode)) {
      return Response.json(
        {
          error: `Invalid billingMode: ${body.billingMode}. Must be one of: ${validModes.join(", ")}`,
        },
        { status: 400 }
      );
    }
  }

  if (body.dangerousMode !== undefined && typeof body.dangerousMode !== "boolean") {
    return Response.json({ error: "dangerousMode must be a boolean" }, { status: 400 });
  }
  if (
    body.dangerousMode === true &&
    providerDefinition.capabilities.supportsDangerousMode !== true
  ) {
    return Response.json(
      { error: `dangerousMode is not supported for provider ${providerDefinition.id}` },
      { status: 400 }
    );
  }

  // Validate optional envSetIds (if provided)
  if (body.envSetIds !== undefined) {
    if (!Array.isArray(body.envSetIds)) {
      return Response.json({ error: "envSetIds must be an array of strings" }, { status: 400 });
    }
    for (const id of body.envSetIds) {
      if (typeof id !== "string") {
        return Response.json({ error: "envSetIds must be an array of strings" }, { status: 400 });
      }
      const envSet = ctx.db.getEnvSet(id);
      if (!envSet) {
        return Response.json({ error: `Env set not found: ${id}` }, { status: 404 });
      }
    }
  }

  // Validate optional worktree config (if provided)
  if (body.worktree !== undefined) {
    if (typeof body.worktree !== "object" || body.worktree === null) {
      return Response.json({ error: "worktree must be an object" }, { status: 400 });
    }
    if (!body.worktree.branch || typeof body.worktree.branch !== "string") {
      return Response.json({ error: "worktree.branch is required" }, { status: 400 });
    }
    if (typeof body.worktree.createBranch !== "boolean") {
      return Response.json({ error: "worktree.createBranch must be a boolean" }, { status: 400 });
    }
    if (body.worktree.startPoint !== undefined && typeof body.worktree.startPoint !== "string") {
      return Response.json({ error: "worktree.startPoint must be a string" }, { status: 400 });
    }
  }

  if (body.providerResume !== undefined) {
    if (typeof body.providerResume !== "object" || body.providerResume === null) {
      return Response.json({ error: "providerResume must be an object" }, { status: 400 });
    }
    if (typeof body.providerResume.providerSessionId !== "string") {
      return Response.json(
        { error: "providerResume.providerSessionId must be a string" },
        { status: 400 }
      );
    }
    if (body.providerResume.providerSessionId.trim().length === 0) {
      return Response.json(
        { error: "providerResume.providerSessionId must not be empty" },
        { status: 400 }
      );
    }
    if (
      body.providerResume.mode !== undefined &&
      body.providerResume.mode !== "resume" &&
      body.providerResume.mode !== "fork"
    ) {
      return Response.json(
        { error: 'providerResume.mode must be either "resume" or "fork"' },
        { status: 400 }
      );
    }
  }

  try {
    const session = await ctx.sessionManager.createSession({
      provider: body.provider,
      cwd: body.cwd,
      env: body.env,
      args: body.args,
      billingMode: body.billingMode,
      dangerousMode: body.dangerousMode,
      envSetIds: body.envSetIds,
      providerResume:
        body.providerResume !== undefined
          ? {
              providerSessionId: body.providerResume.providerSessionId.trim(),
              mode: body.providerResume.mode,
            }
          : undefined,
      worktree: body.worktree,
    });

    return Response.json({ session }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleGetSession(
  _req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  // Try in-memory first (active sessions), then fall back to DB (stopped/crashed)
  const inMemory = ctx.sessionManager.getSession(sessionId);
  if (inMemory) {
    return Response.json({ session: inMemory });
  }

  const session = ctx.db.getSession(sessionId);
  if (!session) {
    return Response.json({ error: `Session not found: ${sessionId}` }, { status: 404 });
  }

  // Health check: if DB says RUNNING/STARTING but not in memory
  if (session.status === "RUNNING" || session.status === "STARTING") {
    const tmuxCheck = Bun.spawnSync(["tmux", "has-session", "-t", `codepiper-${sessionId}`], {
      stdout: "ignore",
      stderr: "ignore",
    });
    if (tmuxCheck.exitCode !== 0) {
      // Tmux is gone — mark STOPPED
      ctx.db.updateSession(sessionId, { status: "STOPPED" });
      session.status = "STOPPED";
    } else {
      // Tmux is alive but not in memory — auto-adopt
      try {
        const adopted = await ctx.sessionManager.adoptSession(sessionId);
        return Response.json({ session: adopted });
      } catch {
        // Fall through to return DB data
      }
    }
  }

  return Response.json({ session });
}

export async function handleStopSession(
  _req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  try {
    await ctx.sessionManager.stopSession(sessionId);
    return Response.json({ success: true });
  } catch (error) {
    // If session not in memory, try to transition orphaned DB session to STOPPED
    if (error instanceof SessionNotFoundError) {
      return transitionOrphanedSession(ctx, sessionId);
    }
    return errorResponse(error);
  }
}

export async function handleKillSession(
  _req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  try {
    await ctx.sessionManager.killSession(sessionId);
    return Response.json({ success: true });
  } catch (error) {
    // If session not in memory, try to transition orphaned DB session to STOPPED
    if (error instanceof SessionNotFoundError) {
      return transitionOrphanedSession(ctx, sessionId);
    }
    return errorResponse(error);
  }
}

export async function handleResumeSession(
  _req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  try {
    const session = await ctx.sessionManager.resumeSession(sessionId);
    return Response.json({ session });
  } catch (error) {
    return errorResponse(error, 400);
  }
}

export async function handleRecoverSession(
  _req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  // Already in memory — already active
  const inMemory = ctx.sessionManager.getSession(sessionId);
  if (inMemory) {
    return Response.json({ session: inMemory });
  }

  // Try to adopt the orphaned session
  try {
    const session = await ctx.sessionManager.recoverSession(sessionId);
    return Response.json({ session });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to recover session";
    return Response.json({ error: msg }, { status: 400 });
  }
}

export async function handleUpdateSessionName(
  req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  if (!(isObjectRecord(body) && "name" in body)) {
    return Response.json({ error: "Missing required field: name" }, { status: 400 });
  }

  if (!(typeof body.name === "string" || body.name === null)) {
    return Response.json({ error: "name must be a string or null" }, { status: 400 });
  }

  let normalizedName: string | null = null;
  if (typeof body.name === "string") {
    const trimmed = body.name.trim();
    if (trimmed.length > 0) {
      if (trimmed.length > SESSION_CUSTOM_NAME_MAX_LENGTH) {
        return Response.json(
          { error: `name must be ${SESSION_CUSTOM_NAME_MAX_LENGTH} characters or fewer` },
          { status: 400 }
        );
      }
      if (hasControlCharacters(trimmed)) {
        return Response.json(
          { error: "name must not contain control characters" },
          { status: 400 }
        );
      }
      normalizedName = trimmed;
    }
  }

  const activeSession = ctx.sessionManager.getSession(sessionId);
  if (activeSession) {
    const session = ctx.sessionManager.setSessionCustomName(sessionId, normalizedName);
    return Response.json({ session });
  }

  const dbSession = ctx.db.getSession(sessionId);
  if (!dbSession) {
    return Response.json({ error: `Session not found: ${sessionId}` }, { status: 404 });
  }

  const nextMetadata = upsertSessionCustomName(dbSession.metadata, normalizedName);
  ctx.db.updateSession(sessionId, { metadata: nextMetadata });

  const updatedSession = ctx.db.getSession(sessionId);
  return Response.json({ session: updatedSession ?? { ...dbSession, metadata: nextMetadata } });
}

/**
 * Transition an orphaned session (exists in DB but not in memory) to STOPPED.
 * Also attempts to clean up any lingering tmux session.
 */
function transitionOrphanedSession(ctx: RouteContext, sessionId: string): Response {
  const dbSession = ctx.db.getSession(sessionId);
  if (!dbSession) {
    return Response.json({ error: `Session not found: ${sessionId}` }, { status: 404 });
  }

  // Already in terminal state — nothing to do
  if (dbSession.status === "STOPPED" || dbSession.status === "CRASHED") {
    return Response.json({ success: true });
  }

  // Update DB to STOPPED
  ctx.db.updateSession(sessionId, { status: "STOPPED" });

  // Best-effort: kill any orphaned tmux session that might still exist
  try {
    Bun.spawnSync(["tmux", "kill-session", "-t", `codepiper-${sessionId}`], {
      stdout: "ignore",
      stderr: "ignore",
    });
  } catch {
    // tmux session may not exist — that's fine
  }

  return Response.json({ success: true });
}

export async function handleSendText(
  req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  // Validate text field
  if (typeof body.text !== "string") {
    return Response.json({ error: "Missing required field: text" }, { status: 400 });
  }

  const textValidation = validateText(body.text);
  if (!textValidation.valid) {
    return Response.json({ error: textValidation.error }, { status: 400 });
  }

  try {
    const policyCheck = await enforceInputPolicyPreflight(ctx, sessionId, {
      kind: "text",
      input: body.text,
      newline: body.newline === true,
    });
    if (!policyCheck.allowed) {
      return Response.json(
        {
          error: policyCheck.error || "Input blocked by policy",
          policyAction: policyCheck.policyAction,
          provider: policyCheck.provider,
        },
        { status: policyCheck.status ?? 403 }
      );
    }

    // Send the text
    await ctx.sessionManager.sendText(sessionId, body.text);

    // If newline requested, flush writes and send Enter key
    if (body.newline) {
      // Flush any batched writes before sending Enter
      ctx.sessionManager.flushWrites(sessionId);
      // Small delay to ensure flush completed
      await new Promise((resolve) => setTimeout(resolve, 20));
      // Send Enter key
      await ctx.sessionManager.sendKeys(sessionId, ["enter"]);
    }

    return Response.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleSendKeys(
  req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  // Validate keys array
  const keysValidation = validateKeys(body.keys);
  if (!keysValidation.valid) {
    return Response.json({ error: keysValidation.error }, { status: 400 });
  }

  try {
    const policyCheck = await enforceInputPolicyPreflight(ctx, sessionId, {
      kind: "keys",
      keys: body.keys,
    });
    if (!policyCheck.allowed) {
      return Response.json(
        {
          error: policyCheck.error || "Input blocked by policy",
          policyAction: policyCheck.policyAction,
          provider: policyCheck.provider,
        },
        { status: policyCheck.status ?? 403 }
      );
    }

    await ctx.sessionManager.sendKeys(sessionId, body.keys);

    return Response.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleClaudeHook(req: Request, ctx: RouteContext): Promise<Response> {
  return handleHookEvent(req, {
    db: ctx.db,
    eventBus: ctx.eventBus,
    sessionManager: ctx.sessionManager,
    policyEngine: ctx.policyEngine,
    auditLogger: ctx.auditLogger,
    hookSecret: ctx.hookSecret,
  });
}

export async function handleGetTranscriptEvents(
  req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  const url = new URL(req.url);
  const since = url.searchParams.get("since");
  const before = url.searchParams.get("before");
  const limit = url.searchParams.get("limit");
  const source = url.searchParams.get("source");
  const type = url.searchParams.get("type");
  const order = url.searchParams.get("order");

  try {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    const parsedSource: EventSource | undefined =
      source === "pty" || source === "hook" || source === "transcript" || source === "statusline"
        ? source
        : undefined;

    const events = ctx.db.getEventsBySessionId(sessionId, {
      source: parsedSource,
      type: type || undefined,
      since: since ? parseInt(since, 10) : undefined,
      before: before ? parseInt(before, 10) : undefined,
      limit: parsedLimit ? parsedLimit + 1 : undefined,
      order: order === "asc" || order === "desc" ? order : undefined,
    });

    // Determine hasMore by checking if we got more than the requested limit
    let hasMore = false;
    if (parsedLimit && events.length > parsedLimit) {
      hasMore = true;
      events.pop();
    }

    return Response.json({ events, hasMore });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleSwitchModel(
  req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  const session = ctx.sessionManager.getSession(sessionId);
  if (!session) {
    return Response.json({ error: `Session not found: ${sessionId}` }, { status: 404 });
  }

  const capabilities = getProviderDefinition(session.provider).capabilities;
  if (!capabilities.supportsModelSwitch) {
    return Response.json(
      {
        error: `Model switching is not supported for provider ${session.provider}`,
        provider: session.provider,
        supportsModelSwitch: false,
      },
      { status: 409 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  // Validate model field
  if (typeof body.model !== "string") {
    return Response.json({ error: "Missing required field: model" }, { status: 400 });
  }

  const modelValidation = validateModel(body.model);
  if (!modelValidation.valid) {
    return Response.json({ error: modelValidation.error }, { status: 400 });
  }

  try {
    await ctx.sessionManager.switchModel(sessionId, body.model);

    return Response.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleGetModel(
  _req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  try {
    const session = ctx.sessionManager.getSession(sessionId);
    if (!session) {
      return Response.json({ error: `Session not found: ${sessionId}` }, { status: 404 });
    }
    const capabilities = getProviderDefinition(session.provider).capabilities;
    const model = ctx.sessionManager.getCurrentModel(sessionId);

    return Response.json({
      model,
      provider: session.provider,
      supportsModelSwitch: capabilities.supportsModelSwitch,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleGetSessionPolicy(
  _req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  try {
    // Verify session exists
    const session = ctx.sessionManager.getSession(sessionId);
    if (!session) {
      return Response.json({ error: `Session not found: ${sessionId}` }, { status: 404 });
    }

    // Get policies for this session (sessionId filter)
    const policies = ctx.db.listPolicies({ sessionId });

    return Response.json({ policies });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleGetSessionOutput(
  _req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  try {
    const output = await ctx.sessionManager.getSessionOutput(sessionId);
    return Response.json({ output });
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      const dbSession = ctx.db.getSession(sessionId);
      if (!dbSession) {
        return Response.json({ error: `Session not found: ${sessionId}` }, { status: 404 });
      }

      return Response.json(
        {
          error: `Session is not actively managed: ${sessionId}`,
          status: dbSession.status,
        },
        { status: 409 }
      );
    }

    return errorResponse(error);
  }
}

export async function handleResizeSession(
  req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  const cols = body.cols;
  const rows = body.rows;
  if (typeof cols !== "number" || typeof rows !== "number" || cols < 1 || rows < 1) {
    return Response.json({ error: "cols and rows must be positive numbers" }, { status: 400 });
  }

  try {
    await ctx.sessionManager.resizeSession(sessionId, cols, rows);
    return Response.json({ success: true });
  } catch {
    // Session may be stopped — silently ignore resize for dead sessions
    return Response.json({ success: false });
  }
}

export async function handleSetSessionPolicy(
  req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  try {
    // Verify session exists
    const session = ctx.sessionManager.getSession(sessionId);
    if (!session) {
      return Response.json({ error: `Session not found: ${sessionId}` }, { status: 404 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }

    // Validate policy structure
    if (!body.policy || typeof body.policy !== "object") {
      return Response.json({ error: "Missing or invalid 'policy' field" }, { status: 400 });
    }

    // Policy structure should have name and rules
    if (!(body.policy.name && Array.isArray(body.policy.rules))) {
      return Response.json(
        { error: "Policy must have 'name' (string) and 'rules' (array)" },
        { status: 400 }
      );
    }

    // Generate policy ID (session-id-policy format)
    const policyId = `${sessionId}-policy`;

    // Check if policy already exists for this session
    const existingPolicies = ctx.db.listPolicies({ sessionId });

    if (existingPolicies.length > 0) {
      // Update existing policy
      const existingPolicy = existingPolicies[0]; // Use first one
      if (!existingPolicy) {
        return Response.json({ error: "Failed to load existing policy" }, { status: 500 });
      }
      ctx.db.updatePolicy(existingPolicy.id, {
        name: body.policy.name,
        description: body.policy.description,
        enabled: body.policy.enabled !== undefined ? body.policy.enabled : true,
        priority: body.policy.priority !== undefined ? body.policy.priority : 50,
        rules: body.policy.rules,
      });

      return Response.json({
        success: true,
        policyId: existingPolicy.id,
        action: "updated",
      });
    } else {
      // Create new policy
      ctx.db.createPolicy({
        id: policyId,
        name: body.policy.name,
        description: body.policy.description,
        enabled: body.policy.enabled !== undefined ? body.policy.enabled : true,
        priority: body.policy.priority !== undefined ? body.policy.priority : 50,
        sessionId, // Link to this session
        rules: body.policy.rules,
      });

      return Response.json({
        success: true,
        policyId,
        action: "created",
      });
    }
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleUploadImage(
  req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  // Verify session exists (in-memory or DB)
  const session = ctx.sessionManager.getSession(sessionId);
  if (!session) {
    const dbSession = ctx.db.getSession(sessionId);
    if (!dbSession) {
      return Response.json({ error: `Session not found: ${sessionId}` }, { status: 404 });
    }
  }

  let formData: Awaited<ReturnType<Request["formData"]>>;
  try {
    formData = await req.formData();
  } catch {
    return Response.json(
      { error: "Invalid multipart form data. Send image as 'image' field." },
      { status: 400 }
    );
  }

  const validation = validateImageUpload(formData);
  if (!(validation.valid && validation.file)) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  const imageDir = ctx.sessionManager.getImageDir(sessionId);
  const filename = `upload-${Date.now()}-${validation.sanitizedName}`;
  const filePath = `${imageDir}/${filename}`;

  try {
    // Ensure directory exists (may have been cleaned up if session was stopped)
    const fs = await import("node:fs");
    if (!fs.existsSync(imageDir)) {
      fs.mkdirSync(imageDir, { recursive: true, mode: 0o700 });
    }
    try {
      fs.chmodSync(imageDir, 0o700);
    } catch {
      // best-effort on non-POSIX filesystems
    }

    // Write the file using Bun.write for optimal performance
    await Bun.write(filePath, validation.file);
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // best-effort on non-POSIX filesystems
    }

    return Response.json({
      path: filePath,
      filename: validation.file.name || validation.sanitizedName,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
