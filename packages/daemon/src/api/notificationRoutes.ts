/**
 * Notification API route handlers
 */

import type { ListSessionNotificationsOptions, UpsertPushSubscriptionParams } from "../db/db";
import type { PushRuntimeStatus } from "../notifications/pushNotifier";
import type { RouteContext } from "./routes";
import { jsonError, parseJsonBody } from "./routeUtils";

const MAX_NOTIFICATION_LIMIT = 200;
const MAX_PUSH_ENDPOINT_LENGTH = 2048;
const MAX_PUSH_KEY_LENGTH = 512;
const MAX_PUSH_TEST_TITLE_LENGTH = 120;
const MAX_PUSH_TEST_BODY_LENGTH = 500;
const MAX_PUSH_TEST_SESSION_ID_LENGTH = 120;
const MAX_NOTIFICATION_READ_SOURCE_LENGTH = 64;

const LOOPBACK_PUSH_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function parseBooleanQuery(
  raw: string | null,
  fieldName: string
): { ok: true; value: boolean | undefined } | { ok: false; response: Response } {
  if (raw === null) {
    return { ok: true, value: undefined };
  }
  if (raw === "true") {
    return { ok: true, value: true };
  }
  if (raw === "false") {
    return { ok: true, value: false };
  }
  return { ok: false, response: jsonError(400, `${fieldName} must be "true" or "false"`) };
}

function parsePositiveIntegerQuery(
  raw: string | null,
  fieldName: string,
  max?: number
): { ok: true; value: number | undefined } | { ok: false; response: Response } {
  if (raw === null) {
    return { ok: true, value: undefined };
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { ok: false, response: jsonError(400, `${fieldName} must be a positive integer`) };
  }
  if (max !== undefined && parsed > max) {
    return { ok: false, response: jsonError(400, `${fieldName} must be <= ${max}`) };
  }

  return { ok: true, value: parsed };
}

function validateSessionExists(ctx: RouteContext, sessionId: string): Response | null {
  const session = ctx.db.getSession(sessionId);
  if (!session) {
    return jsonError(404, `Session not found: ${sessionId}`);
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizePushEndpoint(
  endpoint: string
): { ok: true; value: string } | { ok: false; response: Response } {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return { ok: false, response: jsonError(400, "endpoint must be a valid URL") };
  }

  if (parsed.username || parsed.password) {
    return {
      ok: false,
      response: jsonError(400, "endpoint must not include username or password"),
    };
  }

  const protocol = parsed.protocol.toLowerCase();
  const hostname = parsed.hostname.toLowerCase();
  const isLoopbackHttp = protocol === "http:" && LOOPBACK_PUSH_HOSTS.has(hostname);
  if (!(protocol === "https:" || isLoopbackHttp)) {
    return {
      ok: false,
      response: jsonError(400, "endpoint must use https (http is allowed only for localhost)"),
    };
  }

  return { ok: true, value: parsed.toString() };
}

function getFallbackPushStatus(): PushRuntimeStatus {
  return {
    enabled: false,
    configured: false,
    reasons: ["not_available"],
    publicKey: null,
  };
}

function parsePushSubscriptionInput(
  value: unknown
): { ok: true; value: UpsertPushSubscriptionParams } | { ok: false; response: Response } {
  if (!isRecord(value)) {
    return { ok: false, response: jsonError(400, "Push subscription payload must be an object") };
  }

  const endpointRaw = value.endpoint;
  if (typeof endpointRaw !== "string" || endpointRaw.trim() === "") {
    return { ok: false, response: jsonError(400, "endpoint must be a non-empty string") };
  }
  const endpoint = endpointRaw.trim();
  if (endpoint.length > MAX_PUSH_ENDPOINT_LENGTH) {
    return {
      ok: false,
      response: jsonError(400, `endpoint must be at most ${MAX_PUSH_ENDPOINT_LENGTH} characters`),
    };
  }
  const normalizedEndpoint = normalizePushEndpoint(endpoint);
  if (!normalizedEndpoint.ok) {
    return normalizedEndpoint;
  }

  const keysRaw = value.keys;
  if (!isRecord(keysRaw)) {
    return { ok: false, response: jsonError(400, "keys must be an object") };
  }

  const p256dhRaw = keysRaw.p256dh;
  const authRaw = keysRaw.auth;
  if (typeof p256dhRaw !== "string" || p256dhRaw.trim() === "") {
    return { ok: false, response: jsonError(400, "keys.p256dh must be a non-empty string") };
  }
  if (typeof authRaw !== "string" || authRaw.trim() === "") {
    return { ok: false, response: jsonError(400, "keys.auth must be a non-empty string") };
  }
  const p256dh = p256dhRaw.trim();
  const auth = authRaw.trim();
  if (p256dh.length > MAX_PUSH_KEY_LENGTH || auth.length > MAX_PUSH_KEY_LENGTH) {
    return {
      ok: false,
      response: jsonError(400, `push keys must be at most ${MAX_PUSH_KEY_LENGTH} characters`),
    };
  }

  let expirationTime: number | null = null;
  if (value.expirationTime !== undefined && value.expirationTime !== null) {
    if (!(typeof value.expirationTime === "number" && Number.isFinite(value.expirationTime))) {
      return { ok: false, response: jsonError(400, "expirationTime must be a number or null") };
    }
    if (value.expirationTime < 0) {
      return {
        ok: false,
        response: jsonError(400, "expirationTime must be greater than or equal to 0"),
      };
    }
    expirationTime = Math.floor(value.expirationTime);
  }

  return {
    ok: true,
    value: {
      endpoint: normalizedEndpoint.value,
      keys: { p256dh, auth },
      expirationTime,
    },
  };
}

/**
 * GET /notifications - List notifications
 */
export async function handleListNotifications(req: Request, ctx: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  const eventType = url.searchParams.get("eventType");

  const unreadOnlyResult = parseBooleanQuery(url.searchParams.get("unreadOnly"), "unreadOnly");
  if (!unreadOnlyResult.ok) {
    return unreadOnlyResult.response;
  }

  const beforeResult = parsePositiveIntegerQuery(url.searchParams.get("before"), "before");
  if (!beforeResult.ok) {
    return beforeResult.response;
  }

  const limitResult = parsePositiveIntegerQuery(
    url.searchParams.get("limit"),
    "limit",
    MAX_NOTIFICATION_LIMIT
  );
  if (!limitResult.ok) {
    return limitResult.response;
  }

  if (sessionId) {
    const sessionValidation = validateSessionExists(ctx, sessionId);
    if (sessionValidation) {
      return sessionValidation;
    }
  }

  const options: ListSessionNotificationsOptions = {
    sessionId: sessionId ?? undefined,
    eventType: eventType ?? undefined,
    unreadOnly: unreadOnlyResult.value,
    before: beforeResult.value,
    limit: limitResult.value,
  };

  const notifications = ctx.db.listSessionNotifications(options);
  return Response.json({ notifications });
}

/**
 * GET /notifications/counts - Global + per-session unread counts
 */
export async function handleGetNotificationCounts(
  _req: Request,
  ctx: RouteContext
): Promise<Response> {
  const counts = ctx.db.getSessionNotificationCounts();
  return Response.json({ counts });
}

/**
 * GET /notifications/push/status - Daemon push runtime status
 */
export async function handleGetPushStatus(_req: Request, ctx: RouteContext): Promise<Response> {
  const status = ctx.pushNotifier?.getStatus() ?? getFallbackPushStatus();
  return Response.json({ status });
}

/**
 * POST /notifications/push/test - trigger a test push notification
 */
export async function handleSendTestPushNotification(
  req: Request,
  ctx: RouteContext
): Promise<Response> {
  if (!ctx.pushNotifier) {
    return jsonError(503, "Push notifier is unavailable");
  }

  let body: { title?: unknown; body?: unknown; sessionId?: unknown } = {};
  if (req.headers.get("content-length") || req.headers.get("content-type")) {
    const parsed = await parseJsonBody<{ title?: unknown; body?: unknown; sessionId?: unknown }>(
      req
    );
    if (!parsed.ok) {
      return parsed.response;
    }
    body = parsed.body;
  }

  let title: string | undefined;
  if (body.title !== undefined) {
    if (typeof body.title !== "string") {
      return jsonError(400, "title must be a string");
    }
    const normalized = body.title.trim();
    if (normalized.length > MAX_PUSH_TEST_TITLE_LENGTH) {
      return jsonError(400, `title must be <= ${MAX_PUSH_TEST_TITLE_LENGTH} characters`);
    }
    if (normalized.length > 0) {
      title = normalized;
    }
  }

  let pushBody: string | undefined;
  if (body.body !== undefined) {
    if (typeof body.body !== "string") {
      return jsonError(400, "body must be a string");
    }
    const normalized = body.body.trim();
    if (normalized.length > MAX_PUSH_TEST_BODY_LENGTH) {
      return jsonError(400, `body must be <= ${MAX_PUSH_TEST_BODY_LENGTH} characters`);
    }
    if (normalized.length > 0) {
      pushBody = normalized;
    }
  }

  let sessionId: string | undefined;
  if (body.sessionId !== undefined) {
    if (typeof body.sessionId !== "string") {
      return jsonError(400, "sessionId must be a string");
    }
    const normalized = body.sessionId.trim();
    if (normalized.length > MAX_PUSH_TEST_SESSION_ID_LENGTH) {
      return jsonError(400, `sessionId must be <= ${MAX_PUSH_TEST_SESSION_ID_LENGTH} characters`);
    }
    if (normalized.length > 0) {
      sessionId = normalized;
    }
  }

  const result = await ctx.pushNotifier.sendTestNotification({ title, body: pushBody, sessionId });
  return Response.json({ result });
}

/**
 * POST /notifications/:id/read - Mark one notification as read
 */
export async function handleMarkNotificationRead(
  req: Request,
  ctx: RouteContext,
  notificationIdRaw: string
): Promise<Response> {
  const notificationId = Number(notificationIdRaw);
  if (!Number.isInteger(notificationId) || notificationId <= 0) {
    return jsonError(400, "notificationId must be a positive integer");
  }

  let readSource: string | undefined;
  if (req.headers.get("content-length") || req.headers.get("content-type")) {
    const parsed = await parseJsonBody<{ readSource?: unknown }>(req);
    if (!parsed.ok) {
      return parsed.response;
    }

    if (parsed.body.readSource !== undefined) {
      if (typeof parsed.body.readSource !== "string" || parsed.body.readSource.trim() === "") {
        return jsonError(400, "readSource must be a non-empty string");
      }
      const normalized = parsed.body.readSource.trim();
      if (normalized.length > MAX_NOTIFICATION_READ_SOURCE_LENGTH) {
        return jsonError(
          400,
          `readSource must be <= ${MAX_NOTIFICATION_READ_SOURCE_LENGTH} characters`
        );
      }
      readSource = normalized;
    }
  }

  const readAt = new Date();
  const normalizedReadSource = readSource ?? "click";
  const changed = ctx.db.markSessionNotificationRead(notificationId, normalizedReadSource, readAt);
  if (changed) {
    ctx.eventBus.emit("notification:read", {
      id: notificationId,
      readAt,
      readSource: normalizedReadSource,
    });
    ctx.eventBus.emit("notification:counts_updated", ctx.db.getSessionNotificationCounts());
  }

  return Response.json({ success: true, changed });
}

/**
 * POST /notifications/read - Mark notifications as read in bulk
 */
export async function handleMarkNotificationsRead(
  req: Request,
  ctx: RouteContext
): Promise<Response> {
  let body: { sessionId?: unknown; readSource?: unknown } = {};
  if (req.headers.get("content-length") || req.headers.get("content-type")) {
    const parsed = await parseJsonBody<{ sessionId?: unknown; readSource?: unknown }>(req);
    if (!parsed.ok) {
      return parsed.response;
    }
    body = parsed.body;
  }

  let sessionId: string | undefined;
  if (body.sessionId !== undefined) {
    if (typeof body.sessionId !== "string" || body.sessionId.trim() === "") {
      return jsonError(400, "sessionId must be a non-empty string");
    }
    sessionId = body.sessionId.trim();
    const sessionValidation = validateSessionExists(ctx, sessionId);
    if (sessionValidation) {
      return sessionValidation;
    }
  }

  let readSource: string | undefined;
  if (body.readSource !== undefined) {
    if (typeof body.readSource !== "string" || body.readSource.trim() === "") {
      return jsonError(400, "readSource must be a non-empty string");
    }
    const normalized = body.readSource.trim();
    if (normalized.length > MAX_NOTIFICATION_READ_SOURCE_LENGTH) {
      return jsonError(
        400,
        `readSource must be <= ${MAX_NOTIFICATION_READ_SOURCE_LENGTH} characters`
      );
    }
    readSource = normalized;
  }

  const readAt = new Date();
  const normalizedReadSource = readSource ?? "bulk";
  const updated = ctx.db.markSessionNotificationsRead({
    sessionId,
    readSource: normalizedReadSource,
    readAt,
  });
  if (updated > 0) {
    ctx.eventBus.emit("notification:read", {
      id: null,
      readAt,
      readSource: normalizedReadSource,
      sessionId: sessionId ?? null,
      bulk: true,
      updated,
    });
    ctx.eventBus.emit("notification:counts_updated", ctx.db.getSessionNotificationCounts());
  }

  return Response.json({ success: true, updated });
}

/**
 * GET /sessions/:id/notifications/prefs - Get session notification preference
 */
export async function handleGetSessionNotificationPrefs(
  _req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  const sessionValidation = validateSessionExists(ctx, sessionId);
  if (sessionValidation) {
    return sessionValidation;
  }

  const prefs = ctx.db.getSessionNotificationPrefs(sessionId);
  return Response.json({ prefs });
}

/**
 * PUT /sessions/:id/notifications/prefs - Upsert session notification preference
 */
export async function handleUpdateSessionNotificationPrefs(
  req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  const sessionValidation = validateSessionExists(ctx, sessionId);
  if (sessionValidation) {
    return sessionValidation;
  }

  const parsed = await parseJsonBody<{ enabled?: unknown }>(req);
  if (!parsed.ok) {
    return parsed.response;
  }

  if (parsed.body.enabled === undefined) {
    return jsonError(400, "Missing required field: enabled");
  }
  if (!(parsed.body.enabled === null || typeof parsed.body.enabled === "boolean")) {
    return jsonError(400, "enabled must be a boolean or null");
  }

  const prefs = ctx.db.setSessionNotificationPrefs(sessionId, parsed.body.enabled);
  return Response.json({ prefs });
}

/**
 * GET /notifications/push/subscriptions - list stored push subscriptions
 */
export async function handleListPushSubscriptions(
  _req: Request,
  ctx: RouteContext
): Promise<Response> {
  const subscriptions = ctx.db.listPushSubscriptions().map((subscription) => ({
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
  }));
  return Response.json({ subscriptions });
}

/**
 * PUT /notifications/push/subscriptions - upsert push subscription
 */
export async function handleUpsertPushSubscription(
  req: Request,
  ctx: RouteContext
): Promise<Response> {
  const parsed = await parseJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) {
    return parsed.response;
  }

  const subscription = parsePushSubscriptionInput(parsed.body);
  if (!subscription.ok) {
    return subscription.response;
  }

  const stored = ctx.db.upsertPushSubscription(subscription.value);
  return Response.json({
    subscription: {
      endpoint: stored.endpoint,
      expirationTime: stored.expirationTime,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    },
  });
}

/**
 * DELETE /notifications/push/subscriptions - delete push subscription by endpoint
 */
export async function handleDeletePushSubscription(
  req: Request,
  ctx: RouteContext
): Promise<Response> {
  const parsed = await parseJsonBody<{ endpoint?: unknown }>(req);
  if (!parsed.ok) {
    return parsed.response;
  }

  if (typeof parsed.body.endpoint !== "string" || parsed.body.endpoint.trim() === "") {
    return jsonError(400, "endpoint must be a non-empty string");
  }

  const deleted = ctx.db.deletePushSubscription(parsed.body.endpoint.trim());
  return Response.json({ success: true, deleted });
}
