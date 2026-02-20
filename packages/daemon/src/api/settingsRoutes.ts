/**
 * Daemon settings API route handlers
 */

import type { RouteContext } from "./routes";

const MAX_NOTIFICATION_EVENT_DEFAULT_ENTRIES = 128;
const MAX_NOTIFICATION_EVENT_KEY_LENGTH = 128;
const MAX_NOTIFICATION_SOUND_MAP_ENTRIES = 128;
const MAX_NOTIFICATION_SOUND_KEY_LENGTH = 128;
const MAX_NOTIFICATION_SOUND_VALUE_BYTES = 700_000;
const MAX_NOTIFICATION_SOUND_MAP_TOTAL_BYTES = 900_000;
const utf8Encoder = new TextEncoder();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function utf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).byteLength;
}

function validateRecordKey(key: string, field: string, maxLength: number): string | null {
  if (key.length === 0) {
    return `${field} keys must not be empty`;
  }
  if (key.length > maxLength) {
    return `${field} keys must be at most ${maxLength} characters`;
  }
  if (key.trim() !== key) {
    return `${field} keys must not have leading or trailing whitespace`;
  }
  for (let i = 0; i < key.length; i += 1) {
    const codePoint = key.charCodeAt(i);
    if (codePoint <= 0x1f || codePoint === 0x7f) {
      return `${field} keys must not contain control characters`;
    }
  }
  return null;
}

function validateNotificationEventDefaults(
  value: unknown
): { ok: true; value: Record<string, boolean> } | { ok: false; error: string } {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      error: "notificationEventDefaults must be an object with boolean values",
    };
  }

  const entries = Object.entries(value);
  if (entries.length > MAX_NOTIFICATION_EVENT_DEFAULT_ENTRIES) {
    return {
      ok: false,
      error: `notificationEventDefaults must contain at most ${MAX_NOTIFICATION_EVENT_DEFAULT_ENTRIES} entries`,
    };
  }

  const normalized: Record<string, boolean> = {};
  for (const [key, entry] of entries) {
    const keyError = validateRecordKey(
      key,
      "notificationEventDefaults",
      MAX_NOTIFICATION_EVENT_KEY_LENGTH
    );
    if (keyError) {
      return { ok: false, error: keyError };
    }
    if (typeof entry !== "boolean") {
      return {
        ok: false,
        error: "notificationEventDefaults must be an object with boolean values",
      };
    }
    normalized[key] = entry;
  }

  return { ok: true, value: normalized };
}

function validateNotificationSoundMap(
  value: unknown
): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      error: "notificationSoundMap must be an object with string values",
    };
  }

  const entries = Object.entries(value);
  if (entries.length > MAX_NOTIFICATION_SOUND_MAP_ENTRIES) {
    return {
      ok: false,
      error: `notificationSoundMap must contain at most ${MAX_NOTIFICATION_SOUND_MAP_ENTRIES} entries`,
    };
  }

  const normalized: Record<string, string> = {};
  let totalBytes = 0;
  for (const [key, entry] of entries) {
    const keyError = validateRecordKey(
      key,
      "notificationSoundMap",
      MAX_NOTIFICATION_SOUND_KEY_LENGTH
    );
    if (keyError) {
      return { ok: false, error: keyError };
    }

    if (typeof entry !== "string") {
      return {
        ok: false,
        error: "notificationSoundMap must be an object with string values",
      };
    }

    const valueBytes = utf8ByteLength(entry);
    if (valueBytes === 0) {
      return {
        ok: false,
        error: "notificationSoundMap values must not be empty",
      };
    }
    if (valueBytes > MAX_NOTIFICATION_SOUND_VALUE_BYTES) {
      return {
        ok: false,
        error: `notificationSoundMap values must be at most ${MAX_NOTIFICATION_SOUND_VALUE_BYTES} bytes`,
      };
    }
    totalBytes += valueBytes;
    if (totalBytes > MAX_NOTIFICATION_SOUND_MAP_TOTAL_BYTES) {
      return {
        ok: false,
        error: `notificationSoundMap total payload must be at most ${MAX_NOTIFICATION_SOUND_MAP_TOTAL_BYTES} bytes`,
      };
    }
    normalized[key] = entry;
  }

  return { ok: true, value: normalized };
}

function parseCanaryPercent(
  value: unknown,
  key: string
): { ok: true; value: number } | { ok: false; error: string } {
  if (!(typeof value === "number" && Number.isFinite(value))) {
    return { ok: false, error: `${key} must be a number` };
  }

  const rounded = Math.round(value);
  if (rounded < 0 || rounded > 100) {
    return { ok: false, error: `${key} must be between 0 and 100` };
  }
  return { ok: true, value: rounded };
}

/**
 * GET /settings/daemon - Get daemon settings
 */
export async function handleGetDaemonSettings(_req: Request, ctx: RouteContext): Promise<Response> {
  const settings = ctx.db.getDaemonSettings();
  return Response.json({ settings });
}

/**
 * PUT /settings/daemon - Update daemon settings
 */
export async function handleUpdateDaemonSettings(
  req: Request,
  ctx: RouteContext
): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  if (body.preserveSessions !== undefined && typeof body.preserveSessions !== "boolean") {
    return Response.json({ error: "preserveSessions must be a boolean" }, { status: 400 });
  }

  if (
    body.defaultPolicyAction !== undefined &&
    body.defaultPolicyAction !== "ask" &&
    body.defaultPolicyAction !== "deny"
  ) {
    return Response.json({ error: 'defaultPolicyAction must be "ask" or "deny"' }, { status: 400 });
  }

  if (body.forwardSshAuthSock !== undefined && typeof body.forwardSshAuthSock !== "boolean") {
    return Response.json({ error: "forwardSshAuthSock must be a boolean" }, { status: 400 });
  }

  if (
    body.codexHostAccessProfileEnabled !== undefined &&
    typeof body.codexHostAccessProfileEnabled !== "boolean"
  ) {
    return Response.json(
      { error: "codexHostAccessProfileEnabled must be a boolean" },
      { status: 400 }
    );
  }

  if (body.notificationsEnabled !== undefined && typeof body.notificationsEnabled !== "boolean") {
    return Response.json({ error: "notificationsEnabled must be a boolean" }, { status: 400 });
  }

  if (
    body.systemNotificationsEnabled !== undefined &&
    typeof body.systemNotificationsEnabled !== "boolean"
  ) {
    return Response.json(
      { error: "systemNotificationsEnabled must be a boolean" },
      { status: 400 }
    );
  }

  if (
    body.notificationSoundsEnabled !== undefined &&
    typeof body.notificationSoundsEnabled !== "boolean"
  ) {
    return Response.json({ error: "notificationSoundsEnabled must be a boolean" }, { status: 400 });
  }

  if (
    body.notificationEventDefaults !== undefined &&
    !isPlainObject(body.notificationEventDefaults)
  ) {
    return Response.json(
      { error: "notificationEventDefaults must be an object with boolean values" },
      { status: 400 }
    );
  }

  if (body.notificationSoundMap !== undefined && !isPlainObject(body.notificationSoundMap)) {
    return Response.json(
      { error: "notificationSoundMap must be an object with string values" },
      { status: 400 }
    );
  }

  let notificationEventDefaults: Record<string, boolean> | undefined;
  if (body.notificationEventDefaults !== undefined) {
    const validated = validateNotificationEventDefaults(body.notificationEventDefaults);
    if (!validated.ok) {
      return Response.json({ error: validated.error }, { status: 400 });
    }
    notificationEventDefaults = validated.value;
  }

  let notificationSoundMap: Record<string, string> | undefined;
  if (body.notificationSoundMap !== undefined) {
    const validated = validateNotificationSoundMap(body.notificationSoundMap);
    if (!validated.ok) {
      return Response.json({ error: validated.error }, { status: 400 });
    }
    notificationSoundMap = validated.value;
  }

  const terminalFeaturesPatch: Record<string, unknown> = {};
  if (body.terminalFeatures !== undefined) {
    if (!isPlainObject(body.terminalFeatures)) {
      return Response.json({ error: "terminalFeatures must be an object" }, { status: 400 });
    }

    const terminalFeatures = body.terminalFeatures as Record<string, unknown>;
    const booleanFeatureKeys = [
      "wsPtyPasteEnabled",
      "latencyProbesEnabled",
      "diagnosticsPanelEnabled",
      "codexAppServerSpikeEnabled",
    ] as const;
    for (const key of booleanFeatureKeys) {
      if (terminalFeatures[key] !== undefined && typeof terminalFeatures[key] !== "boolean") {
        return Response.json({ error: `${key} must be a boolean` }, { status: 400 });
      }
      if (terminalFeatures[key] !== undefined) {
        terminalFeaturesPatch[key] = terminalFeatures[key];
      }
    }

    const canaryKeys = [
      "wsPtyPasteCanaryPercent",
      "latencyProbesCanaryPercent",
      "diagnosticsPanelCanaryPercent",
    ] as const;
    for (const key of canaryKeys) {
      if (terminalFeatures[key] === undefined) {
        continue;
      }
      const parsed = parseCanaryPercent(terminalFeatures[key], key);
      if (!parsed.ok) {
        return Response.json({ error: parsed.error }, { status: 400 });
      }
      terminalFeaturesPatch[key] = parsed.value;
    }
  }

  ctx.db.updateDaemonSettings({
    preserveSessions: body.preserveSessions,
    defaultPolicyAction: body.defaultPolicyAction,
    forwardSshAuthSock: body.forwardSshAuthSock,
    codexHostAccessProfileEnabled: body.codexHostAccessProfileEnabled,
    notificationsEnabled: body.notificationsEnabled,
    systemNotificationsEnabled: body.systemNotificationsEnabled,
    notificationSoundsEnabled: body.notificationSoundsEnabled,
    notificationEventDefaults,
    notificationSoundMap,
    terminalFeatures:
      Object.keys(terminalFeaturesPatch).length > 0
        ? (terminalFeaturesPatch as {
            wsPtyPasteEnabled?: boolean;
            latencyProbesEnabled?: boolean;
            diagnosticsPanelEnabled?: boolean;
            codexAppServerSpikeEnabled?: boolean;
            wsPtyPasteCanaryPercent?: number;
            latencyProbesCanaryPercent?: number;
            diagnosticsPanelCanaryPercent?: number;
          })
        : undefined,
  });

  // Update live policy engine if default action changed
  if (body.defaultPolicyAction !== undefined) {
    ctx.policyEngine.setDefaultAction(body.defaultPolicyAction);
  }

  const settings = ctx.db.getDaemonSettings();
  return Response.json({ settings });
}

/**
 * POST /settings/daemon/restart - Restart daemon process
 */
export async function handleRestartDaemon(_req: Request, ctx: RouteContext): Promise<Response> {
  if (!ctx.restartDaemon) {
    return Response.json(
      { error: "Daemon restart is not available in this runtime" },
      { status: 501 }
    );
  }

  const preserveSessions = ctx.db.getDaemonSettings().preserveSessions;
  try {
    // Intentionally fire-and-forget so we can acknowledge before process teardown.
    void Promise.resolve(ctx.restartDaemon()).catch((error) => {
      console.error("Failed to restart daemon:", error);
    });
    return Response.json(
      {
        restarting: true,
        preserveSessions,
        message: preserveSessions
          ? "Daemon restart scheduled. Active sessions will be preserved."
          : "Daemon restart scheduled. Active sessions will be stopped.",
      },
      { status: 202 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to schedule daemon restart";
    return Response.json({ error: message }, { status: 500 });
  }
}
