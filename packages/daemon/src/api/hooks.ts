/**
 * Hooks ingestion endpoint
 *
 * Receives hook events from `codepiper hook-forward` and processes them.
 * Events are stored in database, emitted on event bus, and may trigger session state updates.
 */

import * as crypto from "node:crypto";
import * as path from "node:path";
import type { EventBus } from "@codepiper/core";
import type { Database, UpdateSessionParams } from "../db/db";
import type { AuditLogger } from "../sessions/auditLogger";
import type { PolicyEngine } from "../sessions/policyEngine";
import type { PermissionRequest as PolicyPermissionRequest } from "../sessions/policyTypes";
import type { SessionManager } from "../sessions/sessionManager";
import { isDangerousModeMetadata } from "../sessions/sessionManager";

export interface HookContext {
  db: Database;
  eventBus: EventBus;
  sessionManager?: SessionManager;
  policyEngine?: PolicyEngine;
  auditLogger?: AuditLogger;
  /** Shared daemon secret for authenticating hook requests */
  hookSecret?: string;
}

interface HookEventPayload {
  sessionId: string;
  event: string;
  data: Record<string, any>;
}

interface PermissionRequest {
  input: string;
  requestedPermissions: Array<{
    operation: string;
    path: string;
  }>;
}

interface PermissionDecision {
  decision: "allow" | "deny" | "ask";
  allow: boolean;
  updatedInput?: string;
  updatedPermissions?: Array<{
    operation: string;
    path: string;
  }>;
  message?: string;
  denialMessage?: string;
}

const VALID_EVENT_TYPES = ["SessionStart", "Notification", "Stop", "PermissionRequest"];
const STOP_NOTIFICATION_EVENT_TYPE = "session.turn_completed";
const STOP_NOTIFICATION_TITLE = "Turn completed";
const PERMISSION_NOTIFICATION_EVENT_TYPE = "session.permission_required";
const PERMISSION_NOTIFICATION_TITLE = "Permission required";
const INPUT_REQUIRED_NOTIFICATION_EVENT_TYPE = "session.input_required";
const INPUT_REQUIRED_NOTIFICATION_TITLE = "Input required";

interface HookSessionNotificationParams {
  eventType: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
}

const textEncoder = new TextEncoder();

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Returns false for mismatched lengths without leaking which bytes differ.
 */
function timingSafeEquals(a: string, b: string): boolean {
  const bufA = textEncoder.encode(a);
  const bufB = textEncoder.encode(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function handleHookEvent(req: Request, ctx: HookContext): Promise<Response> {
  // Validate hook secret (authenticates that request comes from a codepiper-spawned process)
  if (ctx.hookSecret) {
    const providedSecret = req.headers.get("X-CodePiper-Secret");
    if (!(providedSecret && timingSafeEquals(ctx.hookSecret, providedSecret))) {
      return Response.json({ error: "Invalid or missing hook secret" }, { status: 403 });
    }
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  if (!(rawBody && typeof rawBody === "object" && !Array.isArray(rawBody))) {
    return Response.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }

  const parsedBody = rawBody as Record<string, unknown>;
  const sessionId = typeof parsedBody.sessionId === "string" ? parsedBody.sessionId : "";
  const event = typeof parsedBody.event === "string" ? parsedBody.event : "";
  const rawData = parsedBody.data;
  const data =
    rawData && typeof rawData === "object" && !Array.isArray(rawData)
      ? (rawData as Record<string, any>)
      : {};

  const body: HookEventPayload = { sessionId, event, data };

  if (!body.sessionId) {
    return Response.json({ error: "Missing required field: sessionId" }, { status: 400 });
  }

  if (!body.event) {
    return Response.json({ error: "Missing required field: event" }, { status: 400 });
  }

  if (!VALID_EVENT_TYPES.includes(body.event)) {
    return Response.json(
      { error: `Unknown event type: ${body.event}. Valid types: ${VALID_EVENT_TYPES.join(", ")}` },
      { status: 400 }
    );
  }

  if (!ctx.db.getSession(body.sessionId)) {
    return Response.json({ error: `Session not found: ${body.sessionId}` }, { status: 404 });
  }

  switch (body.event) {
    case "SessionStart":
      return await handleSessionStart(body, ctx);
    case "Notification":
      return handleNotification(body, ctx);
    case "PermissionRequest":
      return await handlePermissionRequest(body, ctx);
    case "Stop":
      return handleStop(body, ctx);
    default:
      return Response.json({ error: `Unhandled event type: ${body.event}` }, { status: 400 });
  }
}

/**
 * Insert an event into the database and emit it on the event bus.
 */
function recordAndEmit(
  ctx: HookContext,
  sessionId: string,
  type: string,
  payload: unknown
): number {
  const eventId = ctx.db.insertEvent({
    sessionId,
    source: "hook",
    type,
    payload,
  });

  ctx.eventBus.emit("session:event", {
    id: eventId,
    sessionId,
    type,
    source: "hook",
    timestamp: new Date(),
    payload,
  });

  return eventId;
}

async function handleSessionStart(payload: HookEventPayload, ctx: HookContext): Promise<Response> {
  const { sessionId, data } = payload;

  const update: UpdateSessionParams = {
    status: "RUNNING",
  };

  if (data.transcript_path) {
    update.transcriptPath = data.transcript_path;
  }

  ctx.db.updateSession(sessionId, update);
  recordAndEmit(ctx, sessionId, "SessionStart", data);

  if (data.transcript_path && ctx.sessionManager?.getSession(sessionId)) {
    try {
      await ctx.sessionManager.setTranscriptPath(
        sessionId,
        data.transcript_path,
        ctx.db,
        ctx.eventBus
      );
    } catch (error) {
      console.error(`Failed to start transcript tailer for session ${sessionId}:`, error);
    }
  }

  return Response.json({ success: true });
}

function handleNotification(payload: HookEventPayload, ctx: HookContext): Response {
  const { sessionId, data } = payload;

  if (data.type === "permission_prompt") {
    ctx.db.updateSession(sessionId, { status: "NEEDS_PERMISSION" });
  } else if (data.type === "idle_prompt") {
    ctx.db.updateSession(sessionId, { status: "NEEDS_INPUT" });
  }

  const sourceEventId = recordAndEmit(ctx, sessionId, "Notification", data);
  maybeCreatePromptNotification(ctx, sessionId, sourceEventId, data);
  return Response.json({ success: true });
}

async function handlePermissionRequest(
  payload: HookEventPayload,
  ctx: HookContext
): Promise<Response> {
  const { sessionId, data } = payload;
  const session = ctx.db.getSession(sessionId);
  const dangerousMode = isDangerousModeMetadata(session?.metadata);

  let decision: PermissionDecision;
  let policyAction: "allow" | "deny" | "ask" = "ask";

  if (dangerousMode) {
    policyAction = "allow";
    decision = toPermissionDecision("allow", "Dangerous mode bypassed CodePiper policy checks");
    const payloadWithDecision = { ...data, decision, policyAction, dangerousMode: true };
    const eventId = ctx.db.insertEvent({
      sessionId,
      source: "hook",
      type: "PermissionRequest",
      payload: payloadWithDecision,
    });

    if (ctx.auditLogger) {
      ctx.auditLogger.logDecision({
        sessionId,
        eventId,
        toolName: "dangerous_mode_bypass",
        args: { provider: session?.provider ?? "unknown" },
        decision: {
          action: "allow",
          reason: "Dangerous mode bypassed CodePiper policy checks",
        },
      });
    }

    ctx.eventBus.emit("session:event", {
      id: eventId,
      sessionId,
      type: "PermissionRequest",
      source: "hook",
      timestamp: new Date(),
      payload: payloadWithDecision,
    });
  } else if (ctx.policyEngine && ctx.auditLogger) {
    // Use PolicyEngine if available, otherwise fall back to simple evaluation
    const permData = data as unknown as PermissionRequest;

    // Get session for CWD
    const cwd = session?.cwd ?? "/";

    // Build policy permission request
    const policyRequest: PolicyPermissionRequest = {
      sessionId,
      tool: permData.requestedPermissions?.[0]?.operation ?? "unknown",
      args: { input: permData.input },
      cwd,
    };

    // Load applicable policies (direct + policy sets + global, deduplicated)
    const allPolicies = ctx.db.getEffectivePolicies(sessionId);

    // Evaluate with policy engine
    const policyDecision = await ctx.policyEngine.evaluate(policyRequest, allPolicies);
    policyAction = policyDecision.action;

    // Convert policy decision to permission decision
    decision = toPermissionDecision(policyDecision.action, policyDecision.reason);

    // Store event with decision (use the permission decision format)
    const payloadWithDecision = { ...data, decision, policyAction };
    const eventId = ctx.db.insertEvent({
      sessionId,
      source: "hook",
      type: "PermissionRequest",
      payload: payloadWithDecision,
    });

    // Log decision to audit log
    ctx.auditLogger.logDecision({
      sessionId,
      eventId,
      toolName: policyRequest.tool,
      args: policyRequest.args,
      decision: policyDecision,
    });

    // Emit event on bus
    ctx.eventBus.emit("session:event", {
      id: eventId,
      sessionId,
      type: "PermissionRequest",
      source: "hook",
      timestamp: new Date(),
      payload: payloadWithDecision,
    });
  } else {
    // Fallback to simple MVP policy
    decision = evaluatePermission(data as unknown as PermissionRequest);
    policyAction = decision.decision;

    // Store event with decision
    const payloadWithDecision = { ...data, decision, policyAction };
    const eventId = ctx.db.insertEvent({
      sessionId,
      source: "hook",
      type: "PermissionRequest",
      payload: payloadWithDecision,
    });

    // Emit event on bus
    ctx.eventBus.emit("session:event", {
      id: eventId,
      sessionId,
      type: "PermissionRequest",
      source: "hook",
      timestamp: new Date(),
      payload: payloadWithDecision,
    });
  }

  // Automatically send approval/denial to session if policy is clear
  if (ctx.sessionManager?.getSession(sessionId) && policyAction !== "ask") {
    try {
      if (policyAction === "allow") {
        await sendApproval(sessionId, ctx.sessionManager);
      } else if (policyAction === "deny") {
        await sendDenial(sessionId, ctx.sessionManager);
      }
    } catch (error) {
      console.error(`Failed to send permission response to session ${sessionId}:`, error);
      // Don't fail the request - decision is still recorded
    }
  }

  return Response.json(decision);
}

function handleStop(payload: HookEventPayload, ctx: HookContext): Response {
  const { sessionId, data } = payload;
  const sourceEventId = recordAndEmit(ctx, sessionId, "Stop", data);
  maybeCreateStopNotification(ctx, sessionId, sourceEventId, data);
  return Response.json({ success: true });
}

function maybeCreateStopNotification(
  ctx: HookContext,
  sessionId: string,
  sourceEventId: number,
  data: Record<string, any>
): void {
  const session = ctx.db.getSession(sessionId);
  if (!session) {
    return;
  }

  const sessionLabel = getSessionLabel(session);
  const body = `${sessionLabel} is ready for your next prompt.`;

  const notificationPayload = {
    sessionId,
    sessionLabel,
    provider: session.provider,
    hookEvent: "Stop",
    reason: typeof data.reason === "string" ? data.reason : null,
  };

  maybeCreateSessionNotification(ctx, session, sourceEventId, {
    eventType: STOP_NOTIFICATION_EVENT_TYPE,
    title: STOP_NOTIFICATION_TITLE,
    body,
    payload: notificationPayload,
  });
}

function maybeCreatePromptNotification(
  ctx: HookContext,
  sessionId: string,
  sourceEventId: number,
  data: Record<string, any>
): void {
  if (!(data.type === "permission_prompt" || data.type === "idle_prompt")) {
    return;
  }

  const session = ctx.db.getSession(sessionId);
  if (!session) {
    return;
  }

  const sessionLabel = getSessionLabel(session);
  const providerLabel = getProviderLabel(session.provider);
  const notificationPayload = {
    sessionId,
    sessionLabel,
    provider: session.provider,
    hookEvent: "Notification",
    notificationType: data.type,
    message: typeof data.message === "string" ? data.message : null,
  };

  if (data.type === "permission_prompt") {
    maybeCreateSessionNotification(ctx, session, sourceEventId, {
      eventType: PERMISSION_NOTIFICATION_EVENT_TYPE,
      title: PERMISSION_NOTIFICATION_TITLE,
      body: `${sessionLabel} is waiting for permission approval in ${providerLabel}.`,
      payload: notificationPayload,
    });
    return;
  }

  maybeCreateSessionNotification(ctx, session, sourceEventId, {
    eventType: INPUT_REQUIRED_NOTIFICATION_EVENT_TYPE,
    title: INPUT_REQUIRED_NOTIFICATION_TITLE,
    body: `${sessionLabel} is waiting for your input in ${providerLabel}.`,
    payload: notificationPayload,
  });
}

function maybeCreateSessionNotification(
  ctx: HookContext,
  session: { id: string; provider: string },
  sourceEventId: number,
  params: HookSessionNotificationParams
): void {
  const settings = ctx.db.getDaemonSettings();
  if (!settings.notificationsEnabled) {
    return;
  }

  const sessionPrefs = ctx.db.getSessionNotificationPrefs(session.id);
  if (sessionPrefs.enabled === false) {
    return;
  }

  const explicitEnabled = settings.notificationEventDefaults[params.eventType];
  const eventEnabled = explicitEnabled !== undefined ? explicitEnabled : true;
  if (!eventEnabled) {
    return;
  }

  const notification = ctx.db.insertSessionNotificationWithStatus({
    sessionId: session.id,
    provider: session.provider,
    eventType: params.eventType,
    sourceEventId,
    title: params.title,
    body: params.body,
    payload: params.payload,
  });

  if (!notification.inserted) {
    return;
  }

  const createdAt = new Date();
  ctx.eventBus.emit("notification:created", {
    id: notification.id,
    sessionId: session.id,
    provider: session.provider,
    eventType: params.eventType,
    sourceEventId,
    title: params.title,
    body: params.body,
    payload: params.payload,
    createdAt,
    readAt: null,
    readSource: null,
  });

  ctx.eventBus.emit("notification:counts_updated", ctx.db.getSessionNotificationCounts());
}

function getSessionCustomName(metadata: unknown): string | null {
  if (!isObjectRecord(metadata)) {
    return null;
  }

  const ui = metadata.ui;
  if (!(isObjectRecord(ui) && typeof ui.customName === "string")) {
    return null;
  }

  const trimmed = ui.customName.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getSessionLabel(session: {
  id: string;
  cwd: string;
  metadata?: Record<string, unknown>;
}): string {
  const customName = getSessionCustomName(session.metadata);
  if (customName) {
    return customName;
  }

  const directoryName = path.basename(session.cwd).trim();
  if (directoryName && directoryName !== "." && directoryName !== "/") {
    return directoryName;
  }
  return `session ${session.id.slice(0, 8)}`;
}

function getProviderLabel(provider: string): string {
  if (provider === "claude-code") {
    return "Claude Code";
  }
  if (provider === "codex") {
    return "Codex";
  }
  return "this session";
}

/**
 * Evaluate permission request using simple MVP policy:
 * allow all read operations, deny write and execute operations.
 */
function evaluatePermission(request: PermissionRequest): PermissionDecision {
  const hasWriteOp = request.requestedPermissions.some(
    (perm) => perm.operation === "write" || perm.operation === "execute"
  );

  if (hasWriteOp) {
    return toPermissionDecision("deny", "Write operations are denied by default policy");
  }

  return toPermissionDecision("allow");
}

function toPermissionDecision(
  action: "allow" | "deny" | "ask",
  message?: string
): PermissionDecision {
  const decision: PermissionDecision = {
    decision: action,
    allow: action === "allow", // Backward compatibility for older consumers
  };

  if (message) {
    decision.message = message;
    if (action === "deny") {
      decision.denialMessage = message;
    }
  }

  return decision;
}

/**
 * Send approval to Claude Code session
 * Claude Code permission prompts typically use:
 * 1 = Yes/Approve
 */
async function sendApproval(sessionId: string, sessionManager: SessionManager): Promise<void> {
  console.log(`[Permission] Auto-approving permission request for session ${sessionId}`);
  await sessionManager.sendKeys(sessionId, ["1", "enter"]);
}

/**
 * Send denial to Claude Code session
 * Claude Code permission prompts typically use:
 * 2 = No/Deny or 3 = Cancel
 */
async function sendDenial(sessionId: string, sessionManager: SessionManager): Promise<void> {
  console.log(`[Permission] Auto-denying permission request for session ${sessionId}`);
  await sessionManager.sendKeys(sessionId, ["2", "enter"]);
}
