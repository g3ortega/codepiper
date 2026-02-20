import type { SessionNotificationRecord } from "@/types/api";

const EVENT_LABELS: Record<string, string> = {
  "session.turn_completed": "Turn completed",
  "session.permission_required": "Permission required",
  "session.input_required": "Input required",
};

const PROVIDER_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sentenceCase(text: string): string {
  if (!text) {
    return text;
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function includesLabel(text: string, label: string): boolean {
  return text.toLocaleLowerCase().includes(label.toLocaleLowerCase());
}

function withSessionLabelPrefix(text: string, label: string): string {
  if (includesLabel(text, label)) {
    return text;
  }
  return `${label}: ${text}`;
}

export function getNotificationEventLabel(eventType: string): string {
  if (eventType in EVENT_LABELS) {
    return EVENT_LABELS[eventType];
  }
  return sentenceCase(eventType.replace(/[._]+/g, " "));
}

export function getNotificationProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? sentenceCase(provider.replace(/-/g, " "));
}

export function getNotificationSessionLabel(notification: SessionNotificationRecord): string {
  return getNotificationSessionLabelWithFallback(notification);
}

export function getNotificationSessionLabelWithFallback(
  notification: SessionNotificationRecord,
  resolvedSessionLabel?: string | null
): string {
  if (typeof resolvedSessionLabel === "string" && resolvedSessionLabel.trim()) {
    return resolvedSessionLabel.trim();
  }

  const payload = notification.payload;
  if (
    isRecord(payload) &&
    typeof payload.sessionLabel === "string" &&
    payload.sessionLabel.trim()
  ) {
    return payload.sessionLabel.trim();
  }
  return `#${notification.sessionId.slice(0, 8)}`;
}

export function getNotificationDescription(
  notification: SessionNotificationRecord,
  resolvedSessionLabel?: string | null
): string {
  const sessionLabel = getNotificationSessionLabelWithFallback(notification, resolvedSessionLabel);

  if (notification.eventType === "session.turn_completed") {
    return `${sessionLabel} wrapped up a turn and is ready for your next move.`;
  }
  if (notification.eventType === "session.permission_required") {
    return `${sessionLabel} needs a quick permission decision to continue.`;
  }
  if (notification.eventType === "session.input_required") {
    return `${sessionLabel} is waiting for your input.`;
  }

  if (notification.body?.trim()) {
    return withSessionLabelPrefix(notification.body.trim(), sessionLabel);
  }
  return `${sessionLabel}: ${getNotificationEventLabel(notification.eventType)}.`;
}

export function getNotificationTitle(
  notification: SessionNotificationRecord,
  resolvedSessionLabel?: string | null
): string {
  const sessionLabel = getNotificationSessionLabelWithFallback(notification, resolvedSessionLabel);
  const normalizedTitle = notification.title.trim();
  if (normalizedTitle.length === 0) {
    return sessionLabel;
  }
  if (includesLabel(normalizedTitle, sessionLabel)) {
    return normalizedTitle;
  }
  return `${sessionLabel} · ${normalizedTitle}`;
}
