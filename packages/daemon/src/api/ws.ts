/**
 * WebSocket streaming support for real-time event delivery
 */

import type { ProviderEvent } from "@codepiper/core";
import type { ServerWebSocket } from "bun";
import type { TerminalCursor } from "../sessions/tmuxSession";

export interface WSMessage {
  op: string;
  topic?: string;
  [key: string]: unknown;
}

type SessionEventsTopic = `session:${string}:events`;
type SessionPtyTopic = `session:${string}:pty`;
type SessionsTopic = "sessions";
type NotificationsTopic = "notifications";
type WSTopic = SessionEventsTopic | SessionPtyTopic | SessionsTopic | NotificationsTopic;

interface PtyOutputMessage {
  topic: SessionPtyTopic;
  type: "pty_output";
  data: string;
  seq: number;
  cursor?: TerminalCursor;
}

interface PtyPatchMessage {
  topic: SessionPtyTopic;
  type: "pty_patch";
  baseSeq: number;
  seq: number;
  start: number;
  deleteCount: number;
  data: string;
  cursor?: TerminalCursor;
}

interface SessionEventsMessage {
  topic: SessionEventsTopic;
  data: ProviderEvent | Record<string, unknown>;
}

interface HelloAckMessage {
  op: "hello_ack";
  version: number;
  features: {
    ptyReplay: boolean;
    ptyPatch: boolean;
    ptyBinary: boolean;
    ptyPaste: boolean;
  };
  negotiated: {
    ptyPatch: boolean;
    ptyBinary: boolean;
    ptyPaste: boolean;
  };
}

type SessionsMessage = {
  topic: SessionsTopic;
} & Record<string, unknown>;

interface NotificationsMessage {
  topic: NotificationsTopic;
  type: "notification_created" | "notification_read" | "notification_counts_updated";
  data: Record<string, unknown>;
}

type PtyFrameMessage = PtyOutputMessage | PtyPatchMessage;
type OutboundWSMessage =
  | PtyFrameMessage
  | SessionEventsMessage
  | SessionsMessage
  | NotificationsMessage;
type InputOperation = "pty_input" | "pty_key" | "pty_paste";
type InboundRateClass = "control" | "pty_input" | "pty_key" | "pty_paste";
type PolicyAction = "allow" | "deny" | "ask";
type DisconnectReason =
  | "client_disconnect"
  | "rate_limit"
  | "backpressure"
  | "drop"
  | "send_error"
  | "shutdown";

export interface WsTransportTelemetrySnapshot {
  startedAt: number;
  uptimeMs: number;
  activeConnections: number;
  totalConnectionsAccepted: number;
  totalConnectionsDisconnected: number;
  disconnectReasons: Record<DisconnectReason, number>;
  inboundMessages: number;
  rateLimitedMessages: number;
  rateLimitedControlMessages: number;
  rateLimitedPtyInputMessages: number;
  rateLimitedPtyKeyMessages: number;
  rateLimitedPtyPasteMessages: number;
  subscribeOps: number;
  unsubscribeOps: number;
  ptyInputOps: number;
  ptyKeyOps: number;
  ptyPasteOps: number;
  ptyInputDispatchErrors: number;
  helloOps: number;
  helloAckSent: number;
  ptyFramesBroadcast: number;
  ptyPatchFramesBroadcast: number;
  ptyBinaryFramesBroadcast: number;
  ptyBytesBroadcast: number;
  replayRequests: number;
  replayFramesSent: number;
  replayMisses: number;
  sendSuccess: number;
  sendBackpressureSignals: number;
  sendQueued: number;
  sendQueueFlushes: number;
  sendQueueOverflows: number;
  sendDrops: number;
  sendErrors: number;
}

interface WsTransportTelemetryCounters {
  totalConnectionsAccepted: number;
  totalConnectionsDisconnected: number;
  disconnectReasons: Record<DisconnectReason, number>;
  inboundMessages: number;
  rateLimitedMessages: number;
  rateLimitedControlMessages: number;
  rateLimitedPtyInputMessages: number;
  rateLimitedPtyKeyMessages: number;
  rateLimitedPtyPasteMessages: number;
  subscribeOps: number;
  unsubscribeOps: number;
  ptyInputOps: number;
  ptyKeyOps: number;
  ptyPasteOps: number;
  ptyInputDispatchErrors: number;
  helloOps: number;
  helloAckSent: number;
  ptyFramesBroadcast: number;
  ptyPatchFramesBroadcast: number;
  ptyBinaryFramesBroadcast: number;
  ptyBytesBroadcast: number;
  replayRequests: number;
  replayFramesSent: number;
  replayMisses: number;
  sendSuccess: number;
  sendBackpressureSignals: number;
  sendQueued: number;
  sendQueueFlushes: number;
  sendQueueOverflows: number;
  sendDrops: number;
  sendErrors: number;
}

export const MAX_WS_MESSAGE_BYTES = 64 * 1024; // 64KB
export const WS_PROTOCOL_VERSION = 1;
export const WS_RATE_WINDOW_MS = 10_000; // 10 seconds
export const WS_MAX_CONTROL_MESSAGES_PER_WINDOW = 120;
export const WS_MAX_PTY_INPUT_MESSAGES_PER_WINDOW = 600;
export const WS_MAX_PTY_KEY_MESSAGES_PER_WINDOW = 2000;
export const WS_MAX_PTY_PASTE_MESSAGES_PER_WINDOW = 600;
export const WS_MAX_PTY_PASTE_CHUNKS = 512;
export const WS_MAX_PTY_PASTE_BYTES = 2 * 1024 * 1024;
export const WS_MAX_ACTIVE_PASTE_ASSEMBLIES_PER_CLIENT = 8;
export const WS_PTY_PASTE_ASSEMBLY_TTL_MS = 30_000;
// Backward-compatible alias for tests/tools using the previous single-quota name.
export const WS_MAX_MESSAGES_PER_WINDOW = WS_MAX_CONTROL_MESSAGES_PER_WINDOW;
export const WS_MAX_SUBSCRIPTIONS = 200;
export const WS_MAX_CONSECUTIVE_BACKPRESSURE = 8;
export const WS_MAX_PENDING_OUTBOUND_MESSAGES = 256;
export const WS_MAX_PENDING_OUTBOUND_BYTES = 2 * 1024 * 1024;
export const WS_PTY_REPLAY_BUFFER_SIZE = 64;
const WS_PTY_PATCH_ENABLED = process.env.CODEPIPER_WS_PTY_PATCH === "1";
const WS_PTY_BINARY_ENABLED = process.env.CODEPIPER_WS_PTY_BINARY === "1";
const WS_PTY_PASTE_ENABLED = process.env.CODEPIPER_WS_PTY_PASTE !== "0";
const WS_PTY_BINARY_MAGIC = 0x43; // "C"
const WS_PTY_BINARY_VERSION = 1;
const WS_PTY_BINARY_TYPE_OUTPUT = 1;
const WS_PTY_BINARY_TYPE_PATCH = 2;
const WS_PTY_BINARY_HEADER_BYTES = 10;
const WS_PTY_BINARY_PATCH_META_BYTES = 16;
const WS_PTY_BINARY_OUTPUT_META_BYTES = 4;
const WS_PTY_BINARY_MAX_TOPIC_BYTES = 0xffff;
const WS_PTY_BINARY_MAX_UINT32 = 0xffffffff;
const WS_BINARY_TEXT_ENCODER = new TextEncoder();

/**
 * Parse and validate incoming WS message with size guard.
 */
export function parseWsMessage(raw: string | Buffer): WSMessage {
  const size = typeof raw === "string" ? Buffer.byteLength(raw, "utf-8") : raw.byteLength;
  if (size > MAX_WS_MESSAGE_BYTES) {
    throw new Error(`WebSocket message too large (max ${MAX_WS_MESSAGE_BYTES} bytes)`);
  }

  const text = typeof raw === "string" ? raw : raw.toString("utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON message");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Invalid message: expected JSON object");
  }

  return parsed as WSMessage;
}

interface ClientState {
  ws: ServerWebSocket<unknown> | any;
  subscriptions: Set<WSTopic>;
  rateWindowStartedAt: number;
  controlMessagesInWindow: number;
  ptyInputMessagesInWindow: number;
  ptyKeyMessagesInWindow: number;
  ptyPasteMessagesInWindow: number;
  consecutiveBackpressure: number;
  supportsPtyPatch: boolean;
  supportsPtyBinary: boolean;
  supportsPtyPaste: boolean;
  backpressureActive: boolean;
  pendingOutbound: Array<{ payload: string | Uint8Array; bytes: number }>;
  pendingOutboundBytes: number;
  pasteAssemblies: Map<string, PendingPasteAssembly>;
  pendingDisconnectReason?: DisconnectReason;
}

interface PendingPasteAssembly {
  sessionId: string;
  chunkCount: number;
  nextChunkIndex: number;
  chunks: string[];
  totalBytes: number;
  startedAt: number;
}

interface WebSocketManagerOptions {
  enablePtyPatch?: boolean;
  enablePtyBinary?: boolean;
  enablePtyPaste?: boolean;
  onPtyInput?: (sessionId: string, data: string) => Promise<void> | void;
  onPtyKey?: (sessionId: string, key: string) => Promise<void> | void;
  onPtyPaste?: (sessionId: string, data: string) => Promise<void> | void;
}

/**
 * WebSocket manager for handling client connections and event broadcasting
 */
export class WebSocketManager {
  private clients = new Map<ServerWebSocket<unknown> | any, ClientState>();
  private ptySequenceBySession = new Map<string, number>();
  private ptyReplayBufferBySession = new Map<string, PtyOutputMessage[]>();
  private ptyLastFrameBySession = new Map<string, string>();
  private readonly enablePtyPatch: boolean;
  private readonly enablePtyBinary: boolean;
  private readonly enablePtyPaste: boolean;
  private readonly onPtyInput?: (sessionId: string, data: string) => Promise<void> | void;
  private readonly onPtyKey?: (sessionId: string, key: string) => Promise<void> | void;
  private readonly onPtyPaste?: (sessionId: string, data: string) => Promise<void> | void;
  private telemetryStartedAt = Date.now();
  private telemetry: WsTransportTelemetryCounters = {
    totalConnectionsAccepted: 0,
    totalConnectionsDisconnected: 0,
    disconnectReasons: {
      client_disconnect: 0,
      rate_limit: 0,
      backpressure: 0,
      drop: 0,
      send_error: 0,
      shutdown: 0,
    },
    inboundMessages: 0,
    rateLimitedMessages: 0,
    rateLimitedControlMessages: 0,
    rateLimitedPtyInputMessages: 0,
    rateLimitedPtyKeyMessages: 0,
    rateLimitedPtyPasteMessages: 0,
    subscribeOps: 0,
    unsubscribeOps: 0,
    ptyInputOps: 0,
    ptyKeyOps: 0,
    ptyPasteOps: 0,
    ptyInputDispatchErrors: 0,
    helloOps: 0,
    helloAckSent: 0,
    ptyFramesBroadcast: 0,
    ptyPatchFramesBroadcast: 0,
    ptyBinaryFramesBroadcast: 0,
    ptyBytesBroadcast: 0,
    replayRequests: 0,
    replayFramesSent: 0,
    replayMisses: 0,
    sendSuccess: 0,
    sendBackpressureSignals: 0,
    sendQueued: 0,
    sendQueueFlushes: 0,
    sendQueueOverflows: 0,
    sendDrops: 0,
    sendErrors: 0,
  };
  private eventBusUnsubscribes: Array<() => void> = [];
  private isShutdown = false;

  // Valid topic patterns
  private readonly topicPatterns = {
    sessionEvents: /^session:[a-zA-Z0-9-]+:events$/,
    sessionPty: /^session:[a-zA-Z0-9-]+:pty$/,
    sessions: /^sessions$/,
    notifications: /^notifications$/,
  };

  constructor(eventBus: EventBusSubscriber, options: WebSocketManagerOptions = {}) {
    this.enablePtyPatch = options.enablePtyPatch ?? WS_PTY_PATCH_ENABLED;
    this.enablePtyBinary = options.enablePtyBinary ?? WS_PTY_BINARY_ENABLED;
    this.enablePtyPaste = options.enablePtyPaste ?? WS_PTY_PASTE_ENABLED;
    this.onPtyInput = options.onPtyInput;
    this.onPtyKey = options.onPtyKey;
    this.onPtyPaste = options.onPtyPaste;
    // Listen to event bus for session events
    this.eventBusUnsubscribes.push(
      eventBus.on("session:event", (event) => {
        this.handleProviderEvent(event as ProviderEvent);
      })
    );
    this.eventBusUnsubscribes.push(
      eventBus.on("notification:created", (event) => {
        this.handleNotificationEvent("notification_created", event);
      })
    );
    this.eventBusUnsubscribes.push(
      eventBus.on("notification:read", (event) => {
        this.handleNotificationEvent("notification_read", event);
      })
    );
    this.eventBusUnsubscribes.push(
      eventBus.on("notification:counts_updated", (event) => {
        this.handleNotificationEvent("notification_counts_updated", event);
      })
    );
  }

  /**
   * Handle new WebSocket connection
   */
  handleConnection(ws: ServerWebSocket<unknown> | any): void {
    if (this.isShutdown) {
      ws.close();
      return;
    }

    this.clients.set(ws, {
      ws,
      subscriptions: new Set(),
      rateWindowStartedAt: Date.now(),
      controlMessagesInWindow: 0,
      ptyInputMessagesInWindow: 0,
      ptyKeyMessagesInWindow: 0,
      ptyPasteMessagesInWindow: 0,
      consecutiveBackpressure: 0,
      supportsPtyPatch: false,
      supportsPtyBinary: false,
      supportsPtyPaste: false,
      backpressureActive: false,
      pendingOutbound: [],
      pendingOutboundBytes: 0,
      pasteAssemblies: new Map(),
    });
    this.telemetry.totalConnectionsAccepted += 1;
  }

  /**
   * Handle incoming WebSocket message
   */
  handleMessage(ws: ServerWebSocket<unknown> | any, message: WSMessage): void {
    if (this.isShutdown) {
      return;
    }

    const client = this.clients.get(ws);
    if (!client) {
      throw new Error("Client not found");
    }

    // Validate message structure
    if (typeof message !== "object" || typeof message.op !== "string" || !message.op) {
      throw new Error("Invalid message: missing 'op' field");
    }

    const op = message.op;
    const rateClass = this.resolveInboundRateClass(op);
    this.telemetry.inboundMessages += 1;
    if (!this.consumeMessageQuota(client, rateClass)) {
      this.telemetry.rateLimitedMessages += 1;
      this.incrementRateLimitTelemetry(rateClass);
      this.removeClient(ws, "rate_limit", 1008, "Rate limit exceeded");
      throw new Error("WebSocket rate limit exceeded");
    }

    const topic = typeof message.topic === "string" ? message.topic : "";

    switch (op) {
      case "hello":
        this.handleHello(ws, message);
        break;

      case "pty_input":
        this.handlePtyInput(ws, message);
        break;

      case "pty_key":
        this.handlePtyKey(ws, message);
        break;

      case "pty_paste":
        this.handlePtyPaste(ws, message);
        break;

      case "subscribe": {
        const sinceSeq = this.parseOptionalSinceSeq(message.sinceSeq);
        this.handleSubscribe(ws, topic, sinceSeq);
        break;
      }

      case "unsubscribe":
        this.handleUnsubscribe(ws, topic);
        break;

      default:
        throw new Error(`Unknown operation: ${op}`);
    }
  }

  /**
   * Handle client disconnect
   */
  handleDisconnect(ws: ServerWebSocket<unknown> | any): void {
    this.removeClient(ws, "client_disconnect");
  }

  /**
   * Flush queued outbound payloads when Bun notifies socket drain.
   */
  handleDrain(ws: ServerWebSocket<unknown> | any): void {
    const client = this.clients.get(ws);
    if (!client || client.ws.readyState !== 1) {
      return;
    }
    this.flushPendingOutbound(client);
  }

  /**
   * Broadcast PTY data to subscribers
   */
  broadcastPtyData(sessionId: string, output: string, cursor?: TerminalCursor): void {
    if (this.isShutdown) {
      return;
    }

    const topic = `session:${sessionId}:pty` as SessionPtyTopic;
    const previousSeq = this.ptySequenceBySession.get(sessionId) ?? 0;
    const previousFrame = this.ptyLastFrameBySession.get(sessionId);
    const seq = this.nextPtySequence(sessionId);
    this.telemetry.ptyFramesBroadcast += 1;
    this.telemetry.ptyBytesBroadcast += Buffer.byteLength(output, "utf-8");
    const frames = this.createPtyFrames(topic, output, seq, previousSeq, previousFrame, cursor);
    this.ptyLastFrameBySession.set(sessionId, output);

    this.appendToReplayBuffer(sessionId, frames.full);
    this.broadcastPtyFrame(topic, frames.full, frames.patch);
  }

  /**
   * Clear PTY sequence tracking for a completed session.
   */
  clearPtySequence(sessionId: string): void {
    this.ptySequenceBySession.delete(sessionId);
    this.ptyReplayBufferBySession.delete(sessionId);
    this.ptyLastFrameBySession.delete(sessionId);
  }

  /**
   * Broadcast session state change to subscribers
   */
  broadcastSessionChange(message: Record<string, unknown>): void {
    if (this.isShutdown) {
      return;
    }

    const topic: SessionsTopic = "sessions";
    const wsMessage: SessionsMessage = {
      topic,
      ...message,
    };

    this.broadcastToTopic(topic, wsMessage);
  }

  /**
   * Broadcast an event to session event subscribers
   */
  broadcastSessionEvent(sessionId: string, event: Record<string, unknown>): void {
    if (this.isShutdown) return;

    const topic = `session:${sessionId}:events` as SessionEventsTopic;
    const message: SessionEventsMessage = { topic, data: event };
    this.broadcastToTopic(topic, message);
  }

  /**
   * Get connection count (for testing)
   */
  getConnectionCount(): number {
    return this.clients.size;
  }

  /**
   * Get subscriptions for a client (for testing)
   */
  getSubscriptions(ws: ServerWebSocket<unknown> | any): string[] {
    const client = this.clients.get(ws);
    return client ? Array.from(client.subscriptions) : [];
  }

  /**
   * Get a transport telemetry snapshot for diagnostics and tests.
   */
  getTelemetrySnapshot(now: number = Date.now()): WsTransportTelemetrySnapshot {
    return {
      startedAt: this.telemetryStartedAt,
      uptimeMs: Math.max(0, now - this.telemetryStartedAt),
      activeConnections: this.clients.size,
      totalConnectionsAccepted: this.telemetry.totalConnectionsAccepted,
      totalConnectionsDisconnected: this.telemetry.totalConnectionsDisconnected,
      disconnectReasons: {
        ...this.telemetry.disconnectReasons,
      },
      inboundMessages: this.telemetry.inboundMessages,
      rateLimitedMessages: this.telemetry.rateLimitedMessages,
      rateLimitedControlMessages: this.telemetry.rateLimitedControlMessages,
      rateLimitedPtyInputMessages: this.telemetry.rateLimitedPtyInputMessages,
      rateLimitedPtyKeyMessages: this.telemetry.rateLimitedPtyKeyMessages,
      rateLimitedPtyPasteMessages: this.telemetry.rateLimitedPtyPasteMessages,
      subscribeOps: this.telemetry.subscribeOps,
      unsubscribeOps: this.telemetry.unsubscribeOps,
      ptyInputOps: this.telemetry.ptyInputOps,
      ptyKeyOps: this.telemetry.ptyKeyOps,
      ptyPasteOps: this.telemetry.ptyPasteOps,
      ptyInputDispatchErrors: this.telemetry.ptyInputDispatchErrors,
      helloOps: this.telemetry.helloOps,
      helloAckSent: this.telemetry.helloAckSent,
      ptyFramesBroadcast: this.telemetry.ptyFramesBroadcast,
      ptyPatchFramesBroadcast: this.telemetry.ptyPatchFramesBroadcast,
      ptyBinaryFramesBroadcast: this.telemetry.ptyBinaryFramesBroadcast,
      ptyBytesBroadcast: this.telemetry.ptyBytesBroadcast,
      replayRequests: this.telemetry.replayRequests,
      replayFramesSent: this.telemetry.replayFramesSent,
      replayMisses: this.telemetry.replayMisses,
      sendSuccess: this.telemetry.sendSuccess,
      sendBackpressureSignals: this.telemetry.sendBackpressureSignals,
      sendQueued: this.telemetry.sendQueued,
      sendQueueFlushes: this.telemetry.sendQueueFlushes,
      sendQueueOverflows: this.telemetry.sendQueueOverflows,
      sendDrops: this.telemetry.sendDrops,
      sendErrors: this.telemetry.sendErrors,
    };
  }

  /**
   * Shutdown and clean up
   */
  shutdown(): void {
    this.isShutdown = true;
    this.ptySequenceBySession.clear();
    this.ptyReplayBufferBySession.clear();
    this.ptyLastFrameBySession.clear();

    // Unsubscribe from event bus
    for (const unsubscribe of this.eventBusUnsubscribes) {
      unsubscribe();
    }
    this.eventBusUnsubscribes = [];

    // Close all connections
    for (const ws of this.clients.keys()) {
      this.removeClient(ws, "shutdown");
    }
  }

  /**
   * Handle subscribe operation
   */
  private handleHello(ws: ServerWebSocket<unknown> | any, message: WSMessage): void {
    const client = this.clients.get(ws);
    if (!client) {
      throw new Error("Client not found");
    }

    const version = this.parseOptionalProtocolVersion(message.version);
    if (version !== undefined && version !== WS_PROTOCOL_VERSION) {
      throw new Error(`Unsupported protocol version: ${version} (server=${WS_PROTOCOL_VERSION})`);
    }
    client.supportsPtyPatch =
      this.enablePtyPatch && this.parseOptionalPtyPatchSupport(message.supports);
    client.supportsPtyBinary =
      this.enablePtyBinary && this.parseOptionalPtyBinarySupport(message.supports);
    client.supportsPtyPaste =
      this.enablePtyPaste && this.parseOptionalPtyPasteSupport(message.supports);
    this.telemetry.helloOps += 1;

    const ack: HelloAckMessage = {
      op: "hello_ack",
      version: WS_PROTOCOL_VERSION,
      features: {
        ptyReplay: true,
        ptyPatch: this.enablePtyPatch,
        ptyBinary: this.enablePtyBinary,
        ptyPaste: this.enablePtyPaste,
      },
      negotiated: {
        ptyPatch: client.supportsPtyPatch,
        ptyBinary: client.supportsPtyBinary,
        ptyPaste: client.supportsPtyPaste,
      },
    };

    const ok = this.sendToClient(client, JSON.stringify(ack));
    if (!ok) {
      this.removeClient(client.ws, client.pendingDisconnectReason ?? "send_error");
      return;
    }
    this.telemetry.helloAckSent += 1;
  }

  /**
   * Handle live PTY text input operation.
   */
  private handlePtyInput(ws: ServerWebSocket<unknown> | any, message: WSMessage): void {
    if (!this.onPtyInput) {
      throw new Error("PTY input operation is not enabled");
    }

    const client = this.clients.get(ws);
    if (!client) {
      throw new Error("Client not found");
    }

    const sessionId = this.parseRequiredSessionId(message.sessionId);
    const data = this.parseRequiredInputData(message.data);
    const requestId = this.parseOptionalInputRequestId(message.requestId);
    this.telemetry.ptyInputOps += 1;

    this.dispatchInputOperation(client, "pty_input", sessionId, requestId, async () => {
      await this.onPtyInput?.(sessionId, data);
    });
  }

  /**
   * Handle live PTY key input operation.
   */
  private handlePtyKey(ws: ServerWebSocket<unknown> | any, message: WSMessage): void {
    if (!this.onPtyKey) {
      throw new Error("PTY key operation is not enabled");
    }

    const client = this.clients.get(ws);
    if (!client) {
      throw new Error("Client not found");
    }

    const sessionId = this.parseRequiredSessionId(message.sessionId);
    const key = this.parseRequiredInputKey(message.key);
    const requestId = this.parseOptionalInputRequestId(message.requestId);
    this.telemetry.ptyKeyOps += 1;

    this.dispatchInputOperation(client, "pty_key", sessionId, requestId, async () => {
      await this.onPtyKey?.(sessionId, key);
    });
  }

  /**
   * Handle chunked paste operation.
   *
   * Chunks are assembled server-side and dispatched atomically once all chunks
   * arrive in strict order, preventing partial writes on transport interruption.
   */
  private handlePtyPaste(ws: ServerWebSocket<unknown> | any, message: WSMessage): void {
    if (!this.enablePtyPaste) {
      throw new Error("PTY paste operation is disabled");
    }
    if (!(this.onPtyPaste || this.onPtyInput)) {
      throw new Error("PTY paste operation is not enabled");
    }

    const client = this.clients.get(ws);
    if (!client) {
      throw new Error("Client not found");
    }

    this.purgeExpiredPasteAssemblies(client);

    const sessionId = this.parseRequiredSessionId(message.sessionId);
    const chunkData = this.parseRequiredInputData(message.data);
    const chunkIndex = this.parseRequiredPasteChunkIndex(message.chunkIndex);
    const chunkCount = this.parseRequiredPasteChunkCount(message.chunkCount);
    const requestId = this.parseOptionalInputRequestId(message.requestId);

    if (!requestId) {
      throw new Error("Invalid message: 'requestId' is required for pty_paste");
    }

    const chunkBytes = Buffer.byteLength(chunkData, "utf-8");
    if (chunkBytes > MAX_WS_MESSAGE_BYTES) {
      throw new Error("Invalid message: 'data' exceeds max chunk size");
    }

    this.telemetry.ptyPasteOps += 1;
    const now = Date.now();
    let assembly = client.pasteAssemblies.get(requestId);

    if (!assembly) {
      if (client.pasteAssemblies.size >= WS_MAX_ACTIVE_PASTE_ASSEMBLIES_PER_CLIENT) {
        throw new Error("Too many concurrent paste operations");
      }
      if (chunkIndex !== 0) {
        throw new Error("Invalid message: pty_paste chunk stream must start at index 0");
      }

      assembly = {
        sessionId,
        chunkCount,
        nextChunkIndex: 0,
        chunks: new Array(chunkCount),
        totalBytes: 0,
        startedAt: now,
      };
      client.pasteAssemblies.set(requestId, assembly);
    } else {
      if (assembly.sessionId !== sessionId) {
        client.pasteAssemblies.delete(requestId);
        throw new Error("Invalid message: pty_paste requestId/sessionId mismatch");
      }
      if (assembly.chunkCount !== chunkCount) {
        client.pasteAssemblies.delete(requestId);
        throw new Error("Invalid message: pty_paste chunkCount mismatch");
      }
      if (now - assembly.startedAt > WS_PTY_PASTE_ASSEMBLY_TTL_MS) {
        client.pasteAssemblies.delete(requestId);
        throw new Error("Invalid message: pty_paste assembly timed out");
      }
    }

    if (chunkIndex !== assembly.nextChunkIndex) {
      client.pasteAssemblies.delete(requestId);
      throw new Error("Invalid message: pty_paste chunks must arrive in order");
    }

    assembly.chunks[chunkIndex] = chunkData;
    assembly.nextChunkIndex += 1;
    assembly.totalBytes += chunkBytes;

    if (assembly.totalBytes > WS_MAX_PTY_PASTE_BYTES) {
      client.pasteAssemblies.delete(requestId);
      throw new Error(`Invalid message: pty_paste exceeds ${WS_MAX_PTY_PASTE_BYTES} bytes`);
    }

    if (assembly.nextChunkIndex < assembly.chunkCount) {
      return;
    }

    const fullPaste = assembly.chunks.join("");
    client.pasteAssemblies.delete(requestId);

    this.dispatchInputOperation(client, "pty_paste", sessionId, requestId, async () => {
      if (this.onPtyPaste) {
        await this.onPtyPaste(sessionId, fullPaste);
        return;
      }
      await this.onPtyInput?.(sessionId, fullPaste);
    });
  }

  /**
   * Handle subscribe operation
   */
  private handleSubscribe(
    ws: ServerWebSocket<unknown> | any,
    topic: string,
    sinceSeq?: number
  ): void {
    if (!topic) {
      throw new Error("Invalid message: missing 'topic' field");
    }

    // Validate topic format
    this.validateTopic(topic);
    const normalizedTopic = topic as WSTopic;

    const client = this.clients.get(ws);
    if (!client) {
      throw new Error("Client not found");
    }

    if (
      !client.subscriptions.has(normalizedTopic) &&
      client.subscriptions.size >= WS_MAX_SUBSCRIPTIONS
    ) {
      throw new Error(`Too many subscriptions (max ${WS_MAX_SUBSCRIPTIONS})`);
    }

    client.subscriptions.add(normalizedTopic);
    this.telemetry.subscribeOps += 1;

    // Optional replay for PTY topic subscriptions.
    if (sinceSeq !== undefined && this.topicPatterns.sessionPty.test(normalizedTopic)) {
      this.telemetry.replayRequests += 1;
      this.telemetry.replayFramesSent += this.replayPtySince(
        client,
        normalizedTopic as SessionPtyTopic,
        sinceSeq
      );
    }
  }

  /**
   * Handle unsubscribe operation
   */
  private handleUnsubscribe(ws: ServerWebSocket<unknown> | any, topic: string): void {
    if (!topic) {
      throw new Error("Invalid message: missing 'topic' field");
    }
    this.validateTopic(topic);
    const normalizedTopic = topic as WSTopic;

    const client = this.clients.get(ws);
    if (!client) {
      return; // Silently ignore if client not found
    }

    client.subscriptions.delete(normalizedTopic);
    this.telemetry.unsubscribeOps += 1;
  }

  /**
   * Validate topic format
   */
  private validateTopic(topic: string): void {
    const isValid = Object.values(this.topicPatterns).some((pattern) => pattern.test(topic));

    if (!isValid) {
      throw new Error(`Invalid topic format: ${topic}`);
    }
  }

  private resolveInboundRateClass(op: string): InboundRateClass {
    switch (op) {
      case "pty_input":
        return "pty_input";
      case "pty_key":
        return "pty_key";
      case "pty_paste":
        return "pty_paste";
      default:
        return "control";
    }
  }

  private incrementRateLimitTelemetry(rateClass: InboundRateClass): void {
    switch (rateClass) {
      case "pty_input":
        this.telemetry.rateLimitedPtyInputMessages += 1;
        break;
      case "pty_key":
        this.telemetry.rateLimitedPtyKeyMessages += 1;
        break;
      case "pty_paste":
        this.telemetry.rateLimitedPtyPasteMessages += 1;
        break;
      default:
        this.telemetry.rateLimitedControlMessages += 1;
        break;
    }
  }

  /**
   * Sliding fixed-window quotas for inbound messages per client.
   */
  private consumeMessageQuota(client: ClientState, rateClass: InboundRateClass): boolean {
    const now = Date.now();
    if (now - client.rateWindowStartedAt >= WS_RATE_WINDOW_MS) {
      client.rateWindowStartedAt = now;
      client.controlMessagesInWindow = 0;
      client.ptyInputMessagesInWindow = 0;
      client.ptyKeyMessagesInWindow = 0;
      client.ptyPasteMessagesInWindow = 0;
    }

    switch (rateClass) {
      case "pty_input":
        client.ptyInputMessagesInWindow += 1;
        return client.ptyInputMessagesInWindow <= WS_MAX_PTY_INPUT_MESSAGES_PER_WINDOW;
      case "pty_key":
        client.ptyKeyMessagesInWindow += 1;
        return client.ptyKeyMessagesInWindow <= WS_MAX_PTY_KEY_MESSAGES_PER_WINDOW;
      case "pty_paste":
        client.ptyPasteMessagesInWindow += 1;
        return client.ptyPasteMessagesInWindow <= WS_MAX_PTY_PASTE_MESSAGES_PER_WINDOW;
      default:
        client.controlMessagesInWindow += 1;
        return client.controlMessagesInWindow <= WS_MAX_CONTROL_MESSAGES_PER_WINDOW;
    }
  }

  /**
   * Handle provider event from event bus
   */
  private handleProviderEvent(event: ProviderEvent): void {
    if (this.isShutdown) {
      return;
    }

    const topic = `session:${event.sessionId}:events` as SessionEventsTopic;
    const message: SessionEventsMessage = {
      topic,
      data: event,
    };

    this.broadcastToTopic(topic, message);
  }

  /**
   * Handle notification-domain events from event bus.
   */
  private handleNotificationEvent(type: NotificationsMessage["type"], event: unknown): void {
    if (this.isShutdown) {
      return;
    }

    const topic: NotificationsTopic = "notifications";
    const message: NotificationsMessage = {
      topic,
      type,
      data:
        event && typeof event === "object" && !Array.isArray(event)
          ? (event as Record<string, unknown>)
          : {},
    };

    this.broadcastToTopic(topic, message);
  }

  private broadcastPtyFrame(
    topic: SessionPtyTopic,
    fullFrame: PtyOutputMessage,
    patchFrame?: PtyPatchMessage
  ): void {
    const fullMessageStr = JSON.stringify(fullFrame);
    const patchMessageStr = patchFrame ? JSON.stringify(patchFrame) : null;
    const fullMessageBinary = this.enablePtyBinary ? encodePtyBinaryFrame(fullFrame) : null;
    const patchMessageBinary =
      this.enablePtyBinary && patchFrame ? encodePtyBinaryFrame(patchFrame) : null;

    for (const client of this.clients.values()) {
      if (!client.subscriptions.has(topic)) {
        continue;
      }
      if (client.ws.readyState !== 1) {
        continue;
      }

      const shouldUsePatch = Boolean(
        patchFrame && patchMessageStr && this.enablePtyPatch && client.supportsPtyPatch
      );
      const shouldUseBinary = Boolean(this.enablePtyBinary && client.supportsPtyBinary);
      const outboundPayload = shouldUseBinary
        ? shouldUsePatch
          ? (patchMessageBinary ?? (patchMessageStr as string))
          : (fullMessageBinary ?? fullMessageStr)
        : shouldUsePatch
          ? (patchMessageStr as string)
          : fullMessageStr;
      const ok = this.sendToClient(client, outboundPayload);
      if (shouldUsePatch) {
        this.telemetry.ptyPatchFramesBroadcast += 1;
      }
      if (shouldUseBinary && outboundPayload instanceof Uint8Array) {
        this.telemetry.ptyBinaryFramesBroadcast += 1;
      }

      if (!ok) {
        this.removeClient(client.ws, client.pendingDisconnectReason ?? "send_error");
      }
    }
  }

  /**
   * Broadcast message to all clients subscribed to a topic
   */
  private broadcastToTopic(topic: WSTopic, message: OutboundWSMessage): void {
    const messageStr = JSON.stringify(message);

    for (const client of this.clients.values()) {
      // Check if client is subscribed to this topic
      if (!client.subscriptions.has(topic)) {
        continue;
      }

      // Skip closed connections
      if (client.ws.readyState !== 1) {
        // Not OPEN
        continue;
      }

      if (!this.sendToClient(client, messageStr)) {
        this.removeClient(client.ws, client.pendingDisconnectReason ?? "send_error");
      }
    }
  }

  private parseOptionalSinceSeq(value: unknown): number | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw new Error("Invalid message: 'sinceSeq' must be a non-negative integer");
    }
    return value;
  }

  private parseOptionalProtocolVersion(value: unknown): number | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      throw new Error("Invalid message: 'version' must be a positive integer");
    }
    return value;
  }

  private parseRequiredSessionId(value: unknown): string {
    if (typeof value !== "string" || !value) {
      throw new Error("Invalid message: 'sessionId' must be a non-empty string");
    }
    if (!/^[a-zA-Z0-9-]+$/.test(value)) {
      throw new Error("Invalid message: 'sessionId' format is invalid");
    }
    return value;
  }

  private parseRequiredInputData(value: unknown): string {
    if (typeof value !== "string") {
      throw new Error("Invalid message: 'data' must be a string");
    }
    if (!value) {
      throw new Error("Invalid message: 'data' must not be empty");
    }
    return value;
  }

  private parseRequiredInputKey(value: unknown): string {
    if (typeof value !== "string") {
      throw new Error("Invalid message: 'key' must be a string");
    }
    if (!value) {
      throw new Error("Invalid message: 'key' must not be empty");
    }
    if (value.length > 128) {
      throw new Error("Invalid message: 'key' exceeds max length");
    }
    return value;
  }

  private parseRequiredPasteChunkIndex(value: unknown): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw new Error("Invalid message: 'chunkIndex' must be a non-negative integer");
    }
    return value;
  }

  private parseRequiredPasteChunkCount(value: unknown): number {
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value <= 0 ||
      value > WS_MAX_PTY_PASTE_CHUNKS
    ) {
      throw new Error(
        `Invalid message: 'chunkCount' must be an integer between 1 and ${WS_MAX_PTY_PASTE_CHUNKS}`
      );
    }
    return value;
  }

  private parseOptionalPtyPatchSupport(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const candidate = value as Record<string, unknown>;
    return candidate.ptyPatch === true;
  }

  private parseOptionalPtyBinarySupport(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const candidate = value as Record<string, unknown>;
    return candidate.ptyBinary === true;
  }

  private parseOptionalPtyPasteSupport(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const candidate = value as Record<string, unknown>;
    return candidate.ptyPaste === true;
  }

  private parseOptionalInputRequestId(value: unknown): string | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== "string") {
      throw new Error("Invalid message: 'requestId' must be a string");
    }
    if (!value) {
      throw new Error("Invalid message: 'requestId' must not be empty");
    }
    if (value.length > 128) {
      throw new Error("Invalid message: 'requestId' exceeds max length");
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
      throw new Error("Invalid message: 'requestId' format is invalid");
    }
    return value;
  }

  private parsePolicyAction(value: unknown): PolicyAction | undefined {
    if (value === "allow" || value === "deny" || value === "ask") {
      return value;
    }
    return undefined;
  }

  private dispatchInputOperation(
    client: ClientState,
    op: InputOperation,
    sessionId: string,
    requestId: string | undefined,
    dispatch: () => Promise<void>
  ): void {
    void Promise.resolve()
      .then(dispatch)
      .then(() => {
        if (!requestId || client.ws.readyState !== 1) {
          return;
        }

        const payload = JSON.stringify({
          op: `${op}_ack`,
          sessionId,
          requestId,
        });
        if (!this.sendToClient(client, payload)) {
          this.removeClient(client.ws, client.pendingDisconnectReason ?? "send_error");
        }
      })
      .catch((error) => {
        this.telemetry.ptyInputDispatchErrors += 1;
        const errorMsg = error instanceof Error ? error.message : "Unknown dispatch error";
        console.warn(`[ws] ${op} dispatch failed for session ${sessionId}:`, errorMsg);

        if (client.ws.readyState !== 1) {
          return;
        }

        const fallbackErrorMessage =
          op === "pty_key"
            ? "Failed to deliver PTY key input"
            : op === "pty_paste"
              ? "Failed to deliver PTY paste input"
              : "Failed to deliver PTY input";
        const errorRecord =
          typeof error === "object" && error !== null
            ? (error as Record<string, unknown>)
            : undefined;
        const errorCode = typeof errorRecord?.code === "string" ? errorRecord.code : undefined;
        const payloadObject: Record<string, unknown> = {
          op: `${op}_error`,
          sessionId,
          ...(requestId ? { requestId } : {}),
          error: errorCode === "policy_blocked" ? errorMsg : fallbackErrorMessage,
        };

        if (errorCode === "policy_blocked") {
          payloadObject.code = errorCode;
          if (typeof errorRecord?.status === "number" && Number.isFinite(errorRecord.status)) {
            payloadObject.status = Math.trunc(errorRecord.status);
          }
          const policyAction = this.parsePolicyAction(errorRecord?.policyAction);
          if (policyAction) {
            payloadObject.policyAction = policyAction;
          }
          if (typeof errorRecord?.provider === "string") {
            payloadObject.provider = errorRecord.provider;
          }
        }

        const payload = JSON.stringify(payloadObject);
        if (!this.sendToClient(client, payload)) {
          this.removeClient(client.ws, client.pendingDisconnectReason ?? "send_error");
        }
      });
  }

  private purgeExpiredPasteAssemblies(client: ClientState): void {
    if (client.pasteAssemblies.size === 0) {
      return;
    }
    const now = Date.now();
    for (const [requestId, assembly] of client.pasteAssemblies.entries()) {
      if (now - assembly.startedAt > WS_PTY_PASTE_ASSEMBLY_TTL_MS) {
        client.pasteAssemblies.delete(requestId);
      }
    }
  }

  private appendToReplayBuffer(sessionId: string, message: PtyOutputMessage): void {
    const buffer = this.ptyReplayBufferBySession.get(sessionId) ?? [];
    buffer.push(message);
    if (buffer.length > WS_PTY_REPLAY_BUFFER_SIZE) {
      buffer.shift();
    }
    this.ptyReplayBufferBySession.set(sessionId, buffer);
  }

  private replayPtySince(client: ClientState, topic: SessionPtyTopic, sinceSeq: number): number {
    const sessionIdMatch = topic.match(/^session:([a-zA-Z0-9-]+):pty$/);
    const sessionId = sessionIdMatch?.[1];
    if (!sessionId) {
      this.telemetry.replayMisses += 1;
      return 0;
    }

    const buffer = this.ptyReplayBufferBySession.get(sessionId);
    if (!buffer || buffer.length === 0) {
      this.telemetry.replayMisses += 1;
      return 0;
    }

    const replayMessages = buffer.filter((msg) => msg.seq > sinceSeq);
    if (replayMessages.length === 0) {
      this.telemetry.replayMisses += 1;
      return 0;
    }

    let replayedCount = 0;
    for (const message of replayMessages) {
      if (client.ws.readyState !== 1) {
        break;
      }

      const ok = this.sendToClient(client, JSON.stringify(message));
      if (!ok) {
        this.removeClient(client.ws, client.pendingDisconnectReason ?? "send_error");
        break;
      }
      replayedCount += 1;
    }
    return replayedCount;
  }

  private createPtyFrames(
    topic: SessionPtyTopic,
    output: string,
    seq: number,
    previousSeq: number,
    previousFrame?: string,
    cursor?: TerminalCursor
  ): { full: PtyOutputMessage; patch?: PtyPatchMessage } {
    const full: PtyOutputMessage = {
      topic,
      type: "pty_output",
      data: output,
      seq,
      ...(cursor ? { cursor } : {}),
    };

    if (!this.enablePtyPatch || previousFrame === undefined || previousSeq <= 0) {
      return { full };
    }

    const patchRange = this.computePatch(previousFrame, output);
    if (!patchRange) {
      return { full };
    }

    const patch: PtyPatchMessage = {
      topic,
      type: "pty_patch",
      baseSeq: previousSeq,
      seq,
      start: patchRange.start,
      deleteCount: patchRange.deleteCount,
      data: patchRange.data,
      ...(cursor ? { cursor } : {}),
    };

    // Only emit patch when it is actually smaller than full-frame payload.
    if (JSON.stringify(patch).length >= JSON.stringify(full).length) {
      return { full };
    }
    return { full, patch };
  }

  private computePatch(
    previous: string,
    current: string
  ): { start: number; deleteCount: number; data: string } | null {
    if (previous === current) {
      return null;
    }

    let start = 0;
    const minLength = Math.min(previous.length, current.length);
    while (start < minLength && previous.charCodeAt(start) === current.charCodeAt(start)) {
      start += 1;
    }

    let previousEnd = previous.length - 1;
    let currentEnd = current.length - 1;
    while (
      previousEnd >= start &&
      currentEnd >= start &&
      previous.charCodeAt(previousEnd) === current.charCodeAt(currentEnd)
    ) {
      previousEnd -= 1;
      currentEnd -= 1;
    }

    return {
      start,
      deleteCount: Math.max(0, previousEnd - start + 1),
      data: current.slice(start, currentEnd + 1),
    };
  }

  private sendToClient(client: ClientState, message: string | Uint8Array): boolean {
    if (client.backpressureActive || client.pendingOutbound.length > 0) {
      return this.enqueuePendingOutbound(client, message);
    }

    try {
      const status = client.ws.send(message);
      if (typeof status === "number" && status > 0) {
        client.consecutiveBackpressure = 0;
        client.backpressureActive = false;
        client.pendingDisconnectReason = undefined;
        this.telemetry.sendSuccess += 1;
        return true;
      }

      // 0 means dropped, -1 means backpressure.
      if (status === -1) {
        this.telemetry.sendBackpressureSignals += 1;
        client.backpressureActive = true;
        client.consecutiveBackpressure += 1;
        if (client.consecutiveBackpressure < WS_MAX_CONSECUTIVE_BACKPRESSURE) {
          return true;
        }

        client.pendingDisconnectReason = "backpressure";
      } else {
        this.telemetry.sendDrops += 1;
        client.pendingDisconnectReason = "drop";
      }

      // Disconnect persistently slow or dropped clients to avoid unbounded pressure.
      try {
        client.ws.close(1013, "Backpressure");
      } catch {
        // best-effort close
      }
      return false;
    } catch (error) {
      console.error(`Error sending to WebSocket:`, error);
      this.telemetry.sendErrors += 1;
      client.pendingDisconnectReason = "send_error";
      // Connection might be broken, clean it up
      return false;
    }
  }

  private flushPendingOutbound(client: ClientState): void {
    // Bun emitted "drain". If there is no queued payload, treat this as
    // full recovery and reset the backpressure streak.
    if (client.pendingOutbound.length === 0) {
      client.consecutiveBackpressure = 0;
    }
    client.backpressureActive = false;
    client.pendingDisconnectReason = undefined;

    while (client.pendingOutbound.length > 0) {
      if (client.ws.readyState !== 1) {
        return;
      }
      const next = client.pendingOutbound.shift();
      if (!next) {
        break;
      }
      client.pendingOutboundBytes = Math.max(0, client.pendingOutboundBytes - next.bytes);

      try {
        const status = client.ws.send(next.payload);
        if (typeof status === "number" && status > 0) {
          client.consecutiveBackpressure = 0;
          this.telemetry.sendSuccess += 1;
          this.telemetry.sendQueueFlushes += 1;
          continue;
        }

        if (status === -1) {
          this.telemetry.sendBackpressureSignals += 1;
          client.backpressureActive = true;
          client.consecutiveBackpressure += 1;
          if (client.consecutiveBackpressure >= WS_MAX_CONSECUTIVE_BACKPRESSURE) {
            client.pendingDisconnectReason = "backpressure";
            this.removeClient(client.ws, "backpressure", 1013, "Backpressure");
          }
          return;
        }

        this.telemetry.sendDrops += 1;
        client.pendingDisconnectReason = "drop";
        this.removeClient(client.ws, "drop", 1013, "Backpressure");
        return;
      } catch (error) {
        console.error(`Error sending to WebSocket:`, error);
        this.telemetry.sendErrors += 1;
        client.pendingDisconnectReason = "send_error";
        this.removeClient(client.ws, "send_error");
        return;
      }
    }
  }

  private enqueuePendingOutbound(client: ClientState, message: string | Uint8Array): boolean {
    const bytes =
      typeof message === "string" ? Buffer.byteLength(message, "utf-8") : message.byteLength;
    const nextMessageCount = client.pendingOutbound.length + 1;
    const nextByteSize = client.pendingOutboundBytes + bytes;

    if (
      nextMessageCount > WS_MAX_PENDING_OUTBOUND_MESSAGES ||
      nextByteSize > WS_MAX_PENDING_OUTBOUND_BYTES
    ) {
      this.telemetry.sendQueueOverflows += 1;
      client.pendingDisconnectReason = "backpressure";
      try {
        client.ws.close(1013, "Backpressure");
      } catch {
        // best-effort close
      }
      return false;
    }

    client.pendingOutbound.push({ payload: message, bytes });
    client.pendingOutboundBytes = nextByteSize;
    this.telemetry.sendQueued += 1;
    return true;
  }

  private nextPtySequence(sessionId: string): number {
    const current = this.ptySequenceBySession.get(sessionId) ?? 0;
    const next = current >= Number.MAX_SAFE_INTEGER ? 1 : current + 1;
    this.ptySequenceBySession.set(sessionId, next);
    return next;
  }

  private removeClient(
    ws: ServerWebSocket<unknown> | any,
    reason: DisconnectReason,
    closeCode?: number,
    closeReason?: string
  ): void {
    const client = this.clients.get(ws);
    if (!client) {
      return;
    }

    this.clients.delete(ws);
    client.pendingOutbound = [];
    client.pendingOutboundBytes = 0;
    this.telemetry.totalConnectionsDisconnected += 1;
    this.telemetry.disconnectReasons[reason] += 1;

    try {
      if (client.ws.readyState === 1) {
        // OPEN
        if (closeCode !== undefined || closeReason !== undefined) {
          client.ws.close(closeCode, closeReason);
        } else {
          client.ws.close();
        }
      }
    } catch {
      // best-effort close
    }
  }
}

function isValidUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= WS_PTY_BINARY_MAX_UINT32;
}

function encodePtyBinaryFrame(frame: PtyFrameMessage): Uint8Array | null {
  if (!isValidUint32(frame.seq)) {
    return null;
  }

  const topicBytes = WS_BINARY_TEXT_ENCODER.encode(frame.topic);
  const dataBytes = WS_BINARY_TEXT_ENCODER.encode(frame.data);
  if (
    topicBytes.length > WS_PTY_BINARY_MAX_TOPIC_BYTES ||
    dataBytes.length > WS_PTY_BINARY_MAX_UINT32
  ) {
    return null;
  }

  if (
    frame.type === "pty_patch" &&
    !(
      isValidUint32(frame.baseSeq) &&
      isValidUint32(frame.start) &&
      isValidUint32(frame.deleteCount)
    )
  ) {
    return null;
  }

  const payloadMetaBytes =
    frame.type === "pty_patch" ? WS_PTY_BINARY_PATCH_META_BYTES : WS_PTY_BINARY_OUTPUT_META_BYTES;
  const totalBytes =
    WS_PTY_BINARY_HEADER_BYTES + topicBytes.length + payloadMetaBytes + dataBytes.length;
  if (totalBytes > WS_PTY_BINARY_MAX_UINT32) {
    return null;
  }

  const bytes = new Uint8Array(totalBytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  view.setUint8(0, WS_PTY_BINARY_MAGIC);
  view.setUint8(1, WS_PTY_BINARY_VERSION);
  view.setUint8(
    2,
    frame.type === "pty_patch" ? WS_PTY_BINARY_TYPE_PATCH : WS_PTY_BINARY_TYPE_OUTPUT
  );
  view.setUint8(3, 0);
  view.setUint16(4, topicBytes.length, true);
  view.setUint32(6, frame.seq, true);

  let offset = WS_PTY_BINARY_HEADER_BYTES;
  bytes.set(topicBytes, offset);
  offset += topicBytes.length;

  if (frame.type === "pty_patch") {
    view.setUint32(offset, frame.baseSeq, true);
    offset += 4;
    view.setUint32(offset, frame.start, true);
    offset += 4;
    view.setUint32(offset, frame.deleteCount, true);
    offset += 4;
  }

  view.setUint32(offset, dataBytes.length, true);
  offset += 4;
  bytes.set(dataBytes, offset);

  return bytes;
}

interface EventBusSubscriber {
  on(event: string, handler: (event: unknown) => void): () => void;
}
