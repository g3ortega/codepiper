import type { Session } from "@/types/api";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeLabel(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getSessionCustomName(session: Pick<Session, "metadata">): string | null {
  if (!isObjectRecord(session.metadata)) {
    return null;
  }

  const ui = session.metadata.ui;
  if (!isObjectRecord(ui) || typeof ui.customName !== "string") {
    return null;
  }

  return normalizeLabel(ui.customName);
}

export function getSessionDefaultLabel(cwd: string): string {
  const sanitized = cwd.replace(/[\\/]+$/, "");
  if (!sanitized) {
    return cwd || "session";
  }

  const segments = sanitized.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? sanitized;
}

export function buildSessionDisplayNameMap(sessions: Session[]): Map<string, string> {
  const labels = new Map<string, string>();
  const groupedDefaults = new Map<string, string[]>();

  const sorted = [...sessions].sort((a, b) => {
    const createdDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (createdDiff !== 0) return createdDiff;
    return a.id.localeCompare(b.id);
  });

  for (const session of sorted) {
    const customName = getSessionCustomName(session);
    if (customName) {
      labels.set(session.id, customName);
      continue;
    }

    const baseLabel = getSessionDefaultLabel(session.cwd);
    const group = groupedDefaults.get(baseLabel);
    if (group) {
      group.push(session.id);
    } else {
      groupedDefaults.set(baseLabel, [session.id]);
    }
  }

  for (const [baseLabel, ids] of groupedDefaults) {
    if (ids.length === 1) {
      labels.set(ids[0], baseLabel);
      continue;
    }

    ids.forEach((id, index) => {
      labels.set(id, `${baseLabel} [${index + 1}]`);
    });
  }

  return labels;
}

export function getSessionDisplayName(
  session: Session,
  displayNameMap?: Map<string, string>
): string {
  return (
    displayNameMap?.get(session.id) ??
    getSessionCustomName(session) ??
    getSessionDefaultLabel(session.cwd)
  );
}
