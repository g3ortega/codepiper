import { useCallback, useEffect, useState } from "react";
import type { Session } from "../../types/api";
import { api } from "../api";
import { websocketManager } from "../websocket";

type SessionTopicMessage =
  | { type: "session_created"; session: Session }
  | { type: "session_updated"; session: Session }
  | { type: "session_deleted"; sessionId: string };

function isSessionRecord(value: unknown): value is Session {
  if (!(value && typeof value === "object")) return false;
  const candidate = value as Partial<Session>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.provider === "string" &&
    typeof candidate.cwd === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

function isSessionTopicMessage(value: unknown): value is SessionTopicMessage {
  if (!(value && typeof value === "object")) return false;
  const message = value as Record<string, unknown>;
  const type = message.type;
  if (type === "session_deleted") {
    return typeof message.sessionId === "string";
  }
  if (type === "session_created" || type === "session_updated") {
    return isSessionRecord(message.session);
  }
  return false;
}

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await api.getSessions();
      setSessions(response.sessions);
    } catch {
      // ignore refresh errors
    }
  }, []);

  // Optimistic local update — instantly reflect status change without waiting for fetch
  const updateSessionStatus = useCallback((sessionId: string, status: Session["status"]) => {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, status } : s)));
  }, []);

  useEffect(() => {
    let isSubscribed = true;

    const fetchSessions = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await api.getSessions();
        if (isSubscribed) {
          setSessions(response.sessions);
        }
      } catch (err) {
        if (isSubscribed) {
          setError(err instanceof Error ? err.message : "Failed to fetch sessions");
        }
      } finally {
        if (isSubscribed) {
          setLoading(false);
        }
      }
    };

    fetchSessions();

    const unsubscribe = websocketManager.subscribe("sessions", (message) => {
      if (!isSessionTopicMessage(message)) {
        return;
      }

      if (message.type === "session_created") {
        setSessions((prev) => [...prev, message.session]);
      } else if (message.type === "session_updated") {
        setSessions((prev) => prev.map((s) => (s.id === message.session.id ? message.session : s)));
      } else if (message.type === "session_deleted") {
        setSessions((prev) => prev.filter((s) => s.id !== message.sessionId));
      }
    });

    return () => {
      isSubscribed = false;
      unsubscribe();
    };
  }, []);

  return { sessions, loading, error, refresh, updateSessionStatus };
}
