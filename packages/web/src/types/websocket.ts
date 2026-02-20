import type { Session, SessionNotificationCounts, SessionNotificationRecord } from "./api";

export type WsSessionEventsTopic = `session:${string}:events`;
export type WsSessionPtyTopic = `session:${string}:pty`;
export type WsSessionsTopic = "sessions";
export type WsNotificationsTopic = "notifications";

export type WsTopic =
  | WsSessionEventsTopic
  | WsSessionPtyTopic
  | WsSessionsTopic
  | WsNotificationsTopic;

export interface WsSessionEventsPayload {
  data?: Record<string, unknown>;
}

export interface WsTerminalCursor {
  x: number;
  y: number;
  visible: boolean;
}

export interface WsPtyOutputPayload {
  type: "pty_output";
  data: string;
  seq?: number;
  cursor?: WsTerminalCursor;
}

export interface WsPtyPatchPayload {
  type: "pty_patch";
  baseSeq: number;
  seq: number;
  start: number;
  deleteCount: number;
  data: string;
  cursor?: WsTerminalCursor;
}

export type WsPtyFramePayload = WsPtyOutputPayload | WsPtyPatchPayload;

export type WsSessionsPayload =
  | { type: "session_created"; session: Session }
  | { type: "session_updated"; session: Session }
  | { type: "session_deleted"; sessionId: string }
  | ({ type?: string; session?: unknown; sessionId?: string } & Record<string, unknown>);

export interface WsNotificationReadData {
  id: number | null;
  readAt: string;
  readSource: string;
  sessionId?: string | null;
  bulk?: true;
  updated?: number;
}

export type WsNotificationsPayload =
  | { type: "notification_created"; data: SessionNotificationRecord }
  | { type: "notification_read"; data: WsNotificationReadData }
  | { type: "notification_counts_updated"; data: SessionNotificationCounts }
  | ({ type?: string; data?: unknown } & Record<string, unknown>);

export type WsPayloadForTopic<TTopic extends WsTopic> = TTopic extends WsSessionPtyTopic
  ? WsPtyFramePayload
  : TTopic extends WsSessionEventsTopic
    ? WsSessionEventsPayload
    : TTopic extends WsSessionsTopic
      ? WsSessionsPayload
      : WsNotificationsPayload;

export function isWsTopic(topic: string): topic is WsTopic {
  return (
    topic === "sessions" ||
    topic === "notifications" ||
    /^session:[a-zA-Z0-9-]+:(events|pty)$/.test(topic)
  );
}

export function isWsSessionPtyTopic(topic: WsTopic): topic is WsSessionPtyTopic {
  return /^session:[a-zA-Z0-9-]+:pty$/.test(topic);
}
