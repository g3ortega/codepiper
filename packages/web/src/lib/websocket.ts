/**
 * WebSocket manager for real-time updates
 */

import type { WsPayloadForTopic, WsTopic } from "@/types/websocket";
import { isWsSessionPtyTopic, isWsTopic } from "@/types/websocket";

interface WebSocketMessage {
  topic: string;
  [key: string]: unknown; // Allow any additional fields (type, data, session, etc.)
}

interface WebSocketControlMessage {
  op: string;
  [key: string]: unknown;
}

export const WS_PROTOCOL_VERSION = 1;
const WS_CLIENT_PTY_PATCH_ENABLED = import.meta.env.VITE_CODEPIPER_WS_PTY_PATCH === "1";
const WS_CLIENT_PTY_BINARY_ENABLED = import.meta.env.VITE_CODEPIPER_WS_PTY_BINARY === "1";
const WS_CLIENT_PTY_PASTE_ENABLED = import.meta.env.VITE_CODEPIPER_WS_PTY_PASTE !== "0";
const WS_PTY_BINARY_MAGIC = 0x43; // "C"
const WS_PTY_BINARY_VERSION = 1;
const WS_PTY_BINARY_TYPE_OUTPUT = 1;
const WS_PTY_BINARY_TYPE_PATCH = 2;
const WS_PTY_BINARY_HEADER_BYTES = 10;
const WS_PTY_BINARY_PATCH_META_BYTES = 16;
const WS_PTY_BINARY_OUTPUT_META_BYTES = 4;
const WS_BINARY_TEXT_DECODER = new TextDecoder();
const WS_TEXT_ENCODER = new TextEncoder();

type MessageHandler<TPayload> = (data: TPayload) => void;
type ConnectionStateHandler = (connected: boolean) => void;
type SubscribeOptions = {
  /** Return last applied PTY seq so server can replay missed frames on reconnect. */
  getReplayCursor?: () => number | undefined;
};

type InputOperation = "pty_input" | "pty_key" | "pty_paste";
type InputFailureHandler = () => Promise<void> | void;

interface InputErrorControlMessage extends WebSocketControlMessage {
  op: "pty_input_error" | "pty_key_error" | "pty_paste_error";
  sessionId: string;
  requestId?: string;
  error?: string;
}

interface InputAckControlMessage extends WebSocketControlMessage {
  op: "pty_input_ack" | "pty_key_ack" | "pty_paste_ack";
  sessionId: string;
  requestId: string;
}

interface PendingInputRequest {
  op: InputOperation;
  sessionId: string;
  onError: InputFailureHandler;
  timeout: ReturnType<typeof setTimeout>;
}

type SendInputOptions = {
  onDispatchError?: InputFailureHandler;
  requestId?: string;
};

const WS_INPUT_REQUEST_TTL_MS = 30_000;
const WS_PTY_PASTE_CHUNK_CHARS = 8192;
const WS_PTY_PASTE_MAX_CHUNKS = 512;
const WS_PTY_PASTE_MAX_BYTES = 2 * 1024 * 1024;
const WS_PTY_PASTE_BUFFERED_AMOUNT_LIMIT = 256 * 1024;
const WS_PTY_PASTE_BUFFER_WAIT_MS = 8;
const WS_PTY_PASTE_MAX_BUFFER_WAITS = 80;
let wsInputRequestSequence = 0;

export interface WebSocketTransportTelemetrySnapshot {
  startedAt: number;
  uptimeMs: number;
  connected: boolean;
  reconnectAttempts: number;
  connectionsOpened: number;
  connectionsClosed: number;
  reconnectSchedules: number;
  reconnectSuccesses: number;
  maxReconnectExhausted: number;
  messagesReceived: number;
  parseErrors: number;
  invalidMessageShape: number;
  invalidTopic: number;
  helloSent: number;
  helloAckReceived: number;
  helloAckVersionMismatch: number;
  clientAdvertisesPtyPatch: boolean;
  clientAdvertisesPtyBinary: boolean;
  clientAdvertisesPtyPaste: boolean;
  serverNegotiatedPtyPatch: boolean;
  serverNegotiatedPtyBinary: boolean;
  serverNegotiatedPtyPaste: boolean;
  subscribeSent: number;
  subscribeWithReplayCursorSent: number;
  unsubscribeSent: number;
  ptyInputSent: number;
  ptyKeySent: number;
  ptyPasteSent: number;
  ptyInputAcksReceived: number;
  ptyKeyAcksReceived: number;
  ptyPasteAcksReceived: number;
  ptyInputAckUnmatched: number;
  ptyKeyAckUnmatched: number;
  ptyPasteAckUnmatched: number;
  ptyInputErrorsReceived: number;
  ptyKeyErrorsReceived: number;
  ptyPasteErrorsReceived: number;
  ptyInputErrorUnmatched: number;
  ptyKeyErrorUnmatched: number;
  ptyPasteErrorUnmatched: number;
  ptyInputFallbackTriggered: number;
  ptyKeyFallbackTriggered: number;
  ptyPasteFallbackTriggered: number;
  ptyFallbackHandlerErrors: number;
  pendingInputRequests: number;
  pendingPasteSessionQueues: number;
}

interface WebSocketTransportTelemetryCounters {
  connectionsOpened: number;
  connectionsClosed: number;
  reconnectSchedules: number;
  reconnectSuccesses: number;
  maxReconnectExhausted: number;
  messagesReceived: number;
  parseErrors: number;
  invalidMessageShape: number;
  invalidTopic: number;
  helloSent: number;
  helloAckReceived: number;
  helloAckVersionMismatch: number;
  subscribeSent: number;
  subscribeWithReplayCursorSent: number;
  unsubscribeSent: number;
  ptyInputSent: number;
  ptyKeySent: number;
  ptyPasteSent: number;
  ptyInputAcksReceived: number;
  ptyKeyAcksReceived: number;
  ptyPasteAcksReceived: number;
  ptyInputAckUnmatched: number;
  ptyKeyAckUnmatched: number;
  ptyPasteAckUnmatched: number;
  ptyInputErrorsReceived: number;
  ptyKeyErrorsReceived: number;
  ptyPasteErrorsReceived: number;
  ptyInputErrorUnmatched: number;
  ptyKeyErrorUnmatched: number;
  ptyPasteErrorUnmatched: number;
  ptyInputFallbackTriggered: number;
  ptyKeyFallbackTriggered: number;
  ptyPasteFallbackTriggered: number;
  ptyFallbackHandlerErrors: number;
}

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private url: string;
  private subscribers = new Map<WsTopic, Set<MessageHandler<unknown>>>();
  private subscriptionOptions = new Map<WsTopic, SubscribeOptions | undefined>();
  private connectionStateHandlers = new Set<ConnectionStateHandler>();
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private isIntentionallyClosed = false;
  private connected = false;
  private pendingInputRequests = new Map<string, PendingInputRequest>();
  private pendingPasteSends = new Map<string, Promise<void>>();
  private telemetryStartedAt = Date.now();
  private serverHelloAcknowledged = false;
  private serverNegotiatedPtyPatch = false;
  private serverNegotiatedPtyBinary = false;
  private serverNegotiatedPtyPaste = false;
  private telemetry: WebSocketTransportTelemetryCounters = {
    connectionsOpened: 0,
    connectionsClosed: 0,
    reconnectSchedules: 0,
    reconnectSuccesses: 0,
    maxReconnectExhausted: 0,
    messagesReceived: 0,
    parseErrors: 0,
    invalidMessageShape: 0,
    invalidTopic: 0,
    helloSent: 0,
    helloAckReceived: 0,
    helloAckVersionMismatch: 0,
    subscribeSent: 0,
    subscribeWithReplayCursorSent: 0,
    unsubscribeSent: 0,
    ptyInputSent: 0,
    ptyKeySent: 0,
    ptyPasteSent: 0,
    ptyInputAcksReceived: 0,
    ptyKeyAcksReceived: 0,
    ptyPasteAcksReceived: 0,
    ptyInputAckUnmatched: 0,
    ptyKeyAckUnmatched: 0,
    ptyPasteAckUnmatched: 0,
    ptyInputErrorsReceived: 0,
    ptyKeyErrorsReceived: 0,
    ptyPasteErrorsReceived: 0,
    ptyInputErrorUnmatched: 0,
    ptyKeyErrorUnmatched: 0,
    ptyPasteErrorUnmatched: 0,
    ptyInputFallbackTriggered: 0,
    ptyKeyFallbackTriggered: 0,
    ptyPasteFallbackTriggered: 0,
    ptyFallbackHandlerErrors: 0,
  };

  constructor(url: string) {
    this.url = url;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.isIntentionallyClosed = false;

    try {
      this.ws = new WebSocket(this.url);
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => {
        console.log("[WebSocket] Connected");
        this.telemetry.connectionsOpened += 1;
        this.serverHelloAcknowledged = false;
        this.serverNegotiatedPtyPatch = false;
        this.serverNegotiatedPtyBinary = false;
        this.serverNegotiatedPtyPaste = false;
        if (this.reconnectAttempts > 0) {
          this.telemetry.reconnectSuccesses += 1;
        }
        this.reconnectAttempts = 0;
        this.setConnectedState(true);
        this.sendHello();

        // Resubscribe to all topics
        for (const topic of this.subscribers.keys()) {
          this.sendSubscribe(topic, this.subscriptionOptions.get(topic));
        }
      };

      this.ws.onmessage = (event) => {
        this.telemetry.messagesReceived += 1;
        try {
          if (typeof event.data === "string") {
            const message: unknown = JSON.parse(event.data);
            this.handleMessage(message);
            return;
          }

          if (!(event.data instanceof ArrayBuffer)) {
            console.error("[WebSocket] Received unsupported binary payload type");
            return;
          }

          const message = decodePtyBinaryFrame(event.data);
          if (!message) {
            this.telemetry.parseErrors += 1;
            console.error("[WebSocket] Failed to decode binary PTY frame");
            return;
          }
          this.handleMessage(message);
        } catch (error) {
          this.telemetry.parseErrors += 1;
          console.error("[WebSocket] Failed to parse message:", error);
        }
      };

      this.ws.onerror = (error) => {
        console.error("[WebSocket] Error:", error);
      };

      this.ws.onclose = () => {
        console.log("[WebSocket] Disconnected");
        this.telemetry.connectionsClosed += 1;
        this.setConnectedState(false);

        if (!this.isIntentionallyClosed) {
          this.scheduleReconnect();
        }
      };
    } catch (error) {
      console.error("[WebSocket] Connection failed:", error);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.telemetry.maxReconnectExhausted += 1;
      console.error("[WebSocket] Max reconnect attempts reached");
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
    this.reconnectAttempts++;
    this.telemetry.reconnectSchedules += 1;

    console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private handleMessage(message: unknown): void {
    if (isWebSocketControlMessage(message) && !("topic" in message)) {
      this.handleControlMessage(message);
      return;
    }

    if (!isWebSocketMessage(message)) {
      this.telemetry.invalidMessageShape += 1;
      console.error("[WebSocket] Invalid message payload shape");
      return;
    }

    if (!isWsTopic(message.topic)) {
      this.telemetry.invalidTopic += 1;
      console.warn(`[WebSocket] Ignoring message for invalid topic: ${message.topic}`);
      return;
    }

    const handlers = this.subscribers.get(message.topic);
    if (handlers) {
      // Pass the full message object (excluding topic) to handlers
      // This allows handlers to access type, data, session, etc.
      const { topic, ...payload } = message;

      for (const handler of handlers) {
        try {
          handler(payload);
        } catch (error) {
          console.error(`[WebSocket] Error in handler for ${message.topic}:`, error);
        }
      }
    }
  }

  private handleControlMessage(message: WebSocketControlMessage): void {
    if (message.op === "hello_ack") {
      this.telemetry.helloAckReceived += 1;
      this.serverHelloAcknowledged = true;
      const version = message.version;
      if (typeof version === "number" && version !== WS_PROTOCOL_VERSION) {
        this.telemetry.helloAckVersionMismatch += 1;
        console.warn(
          `[WebSocket] Protocol mismatch: client=${WS_PROTOCOL_VERSION}, server=${version}`
        );
      }

      if (message.features && typeof message.features === "object") {
        const features = message.features as Record<string, unknown>;
        this.serverNegotiatedPtyPaste = features.ptyPaste === true;
      }
      if (message.negotiated && typeof message.negotiated === "object") {
        const negotiated = message.negotiated as Record<string, unknown>;
        this.serverNegotiatedPtyPatch = negotiated.ptyPatch === true;
        this.serverNegotiatedPtyBinary = negotiated.ptyBinary === true;
        if ("ptyPaste" in negotiated) {
          this.serverNegotiatedPtyPaste = negotiated.ptyPaste === true;
        }
      }
      return;
    }

    if (
      message.op === "pty_input_ack" ||
      message.op === "pty_key_ack" ||
      message.op === "pty_paste_ack"
    ) {
      this.handleInputAckControlMessage(message as InputAckControlMessage);
      return;
    }

    if (
      message.op === "pty_input_error" ||
      message.op === "pty_key_error" ||
      message.op === "pty_paste_error"
    ) {
      this.handleInputErrorControlMessage(message as InputErrorControlMessage);
    }
  }

  private sendHello(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    this.telemetry.helloSent += 1;
    this.ws.send(
      JSON.stringify({
        op: "hello",
        version: WS_PROTOCOL_VERSION,
        supports: {
          ptyPatch: WS_CLIENT_PTY_PATCH_ENABLED,
          ptyBinary: WS_CLIENT_PTY_BINARY_ENABLED,
          ptyPaste: WS_CLIENT_PTY_PASTE_ENABLED,
        },
      })
    );
  }

  private sendSubscribe(topic: WsTopic, options?: SubscribeOptions): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const payload: Record<string, unknown> = { op: "subscribe", topic };
      const replayCursor = options?.getReplayCursor?.();
      this.telemetry.subscribeSent += 1;
      if (
        isWsSessionPtyTopic(topic) &&
        typeof replayCursor === "number" &&
        Number.isInteger(replayCursor) &&
        replayCursor >= 0
      ) {
        payload.sinceSeq = replayCursor;
        this.telemetry.subscribeWithReplayCursorSent += 1;
      }
      this.ws.send(JSON.stringify(payload));
    }
  }

  private sendUnsubscribe(topic: WsTopic): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.telemetry.unsubscribeSent += 1;
      this.ws.send(JSON.stringify({ op: "unsubscribe", topic }));
    }
  }

  sendPtyInput(sessionId: string, data: string, options?: SendInputOptions): boolean {
    if (!(sessionId && data)) {
      return false;
    }

    const sent = this.sendInputOperation("pty_input", sessionId, { data }, options);
    if (sent) {
      this.telemetry.ptyInputSent += 1;
    }
    return sent;
  }

  sendPtyKey(sessionId: string, key: string, options?: SendInputOptions): boolean {
    if (!(sessionId && key)) {
      return false;
    }

    const sent = this.sendInputOperation("pty_key", sessionId, { key }, options);
    if (sent) {
      this.telemetry.ptyKeySent += 1;
    }
    return sent;
  }

  sendPtyPaste(sessionId: string, data: string, options?: SendInputOptions): boolean {
    if (!(sessionId && data)) {
      return false;
    }
    if (!WS_CLIENT_PTY_PASTE_ENABLED) {
      return false;
    }
    if (this.serverHelloAcknowledged && !this.serverNegotiatedPtyPaste) {
      return false;
    }
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return false;
    }

    const chunks = splitIntoPasteChunks(data);
    if (!chunks || chunks.length === 0) {
      return false;
    }

    const requestId = this.resolveInputRequestId({
      requestId: options?.requestId,
      // pty_paste needs a request id for multi-chunk assembly and ack correlation.
      onDispatchError: options?.onDispatchError ?? (() => undefined),
    });
    if (!requestId) {
      return false;
    }

    const onDispatchError: InputFailureHandler = options?.onDispatchError ?? (() => undefined);
    this.registerPendingInputRequest("pty_paste", sessionId, requestId, onDispatchError);
    this.enqueuePtyPasteSend(sessionId, requestId, chunks, onDispatchError);
    return true;
  }

  subscribe<TTopic extends WsTopic>(
    topic: TTopic,
    handler: MessageHandler<WsPayloadForTopic<TTopic>>,
    options?: SubscribeOptions
  ): () => void {
    if (!this.subscribers.has(topic)) {
      this.subscribers.set(topic, new Set<MessageHandler<unknown>>());
      this.subscriptionOptions.set(topic, options);
      this.sendSubscribe(topic, options);
    } else if (options) {
      this.subscriptionOptions.set(topic, options);
    }

    const rawHandler = handler as MessageHandler<unknown>;
    this.subscribers.get(topic)?.add(rawHandler);

    // Return unsubscribe function
    return () => {
      const handlers = this.subscribers.get(topic);
      if (handlers) {
        handlers.delete(rawHandler);

        // If no more handlers, unsubscribe from topic
        if (handlers.size === 0) {
          this.subscribers.delete(topic);
          this.subscriptionOptions.delete(topic);
          this.sendUnsubscribe(topic);
        }
      }
    };
  }

  close(): void {
    this.isIntentionallyClosed = true;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setConnectedState(false);
    this.serverHelloAcknowledged = false;
    this.serverNegotiatedPtyPatch = false;
    this.serverNegotiatedPtyBinary = false;
    this.serverNegotiatedPtyPaste = false;
    this.clearPendingInputRequests();
    this.pendingPasteSends.clear();

    this.subscribers.clear();
    this.subscriptionOptions.clear();
  }

  getReadyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getTelemetrySnapshot(now: number = Date.now()): WebSocketTransportTelemetrySnapshot {
    return {
      startedAt: this.telemetryStartedAt,
      uptimeMs: Math.max(0, now - this.telemetryStartedAt),
      connected: this.connected,
      reconnectAttempts: this.reconnectAttempts,
      connectionsOpened: this.telemetry.connectionsOpened,
      connectionsClosed: this.telemetry.connectionsClosed,
      reconnectSchedules: this.telemetry.reconnectSchedules,
      reconnectSuccesses: this.telemetry.reconnectSuccesses,
      maxReconnectExhausted: this.telemetry.maxReconnectExhausted,
      messagesReceived: this.telemetry.messagesReceived,
      parseErrors: this.telemetry.parseErrors,
      invalidMessageShape: this.telemetry.invalidMessageShape,
      invalidTopic: this.telemetry.invalidTopic,
      helloSent: this.telemetry.helloSent,
      helloAckReceived: this.telemetry.helloAckReceived,
      helloAckVersionMismatch: this.telemetry.helloAckVersionMismatch,
      clientAdvertisesPtyPatch: WS_CLIENT_PTY_PATCH_ENABLED,
      clientAdvertisesPtyBinary: WS_CLIENT_PTY_BINARY_ENABLED,
      clientAdvertisesPtyPaste: WS_CLIENT_PTY_PASTE_ENABLED,
      serverNegotiatedPtyPatch: this.serverNegotiatedPtyPatch,
      serverNegotiatedPtyBinary: this.serverNegotiatedPtyBinary,
      serverNegotiatedPtyPaste: this.serverNegotiatedPtyPaste,
      subscribeSent: this.telemetry.subscribeSent,
      subscribeWithReplayCursorSent: this.telemetry.subscribeWithReplayCursorSent,
      unsubscribeSent: this.telemetry.unsubscribeSent,
      ptyInputSent: this.telemetry.ptyInputSent,
      ptyKeySent: this.telemetry.ptyKeySent,
      ptyPasteSent: this.telemetry.ptyPasteSent,
      ptyInputAcksReceived: this.telemetry.ptyInputAcksReceived,
      ptyKeyAcksReceived: this.telemetry.ptyKeyAcksReceived,
      ptyPasteAcksReceived: this.telemetry.ptyPasteAcksReceived,
      ptyInputAckUnmatched: this.telemetry.ptyInputAckUnmatched,
      ptyKeyAckUnmatched: this.telemetry.ptyKeyAckUnmatched,
      ptyPasteAckUnmatched: this.telemetry.ptyPasteAckUnmatched,
      ptyInputErrorsReceived: this.telemetry.ptyInputErrorsReceived,
      ptyKeyErrorsReceived: this.telemetry.ptyKeyErrorsReceived,
      ptyPasteErrorsReceived: this.telemetry.ptyPasteErrorsReceived,
      ptyInputErrorUnmatched: this.telemetry.ptyInputErrorUnmatched,
      ptyKeyErrorUnmatched: this.telemetry.ptyKeyErrorUnmatched,
      ptyPasteErrorUnmatched: this.telemetry.ptyPasteErrorUnmatched,
      ptyInputFallbackTriggered: this.telemetry.ptyInputFallbackTriggered,
      ptyKeyFallbackTriggered: this.telemetry.ptyKeyFallbackTriggered,
      ptyPasteFallbackTriggered: this.telemetry.ptyPasteFallbackTriggered,
      ptyFallbackHandlerErrors: this.telemetry.ptyFallbackHandlerErrors,
      pendingInputRequests: this.pendingInputRequests.size,
      pendingPasteSessionQueues: this.pendingPasteSends.size,
    };
  }

  getSessionInputQueueDepth(sessionId: string): {
    pendingInputRequests: number;
    hasPendingPasteQueue: boolean;
  } {
    let pendingInputRequests = 0;
    for (const pending of this.pendingInputRequests.values()) {
      if (pending.sessionId === sessionId) {
        pendingInputRequests += 1;
      }
    }
    return {
      pendingInputRequests,
      hasPendingPasteQueue: this.pendingPasteSends.has(sessionId),
    };
  }

  onConnectionChange(handler: ConnectionStateHandler): () => void {
    this.connectionStateHandlers.add(handler);
    return () => {
      this.connectionStateHandlers.delete(handler);
    };
  }

  private setConnectedState(connected: boolean): void {
    if (this.connected === connected) {
      return;
    }

    this.connected = connected;
    for (const handler of this.connectionStateHandlers) {
      try {
        handler(connected);
      } catch (error) {
        console.error("[WebSocket] Error in connection state handler:", error);
      }
    }
  }

  private handleInputAckControlMessage(message: InputAckControlMessage): void {
    const op: InputOperation =
      message.op === "pty_key_ack"
        ? "pty_key"
        : message.op === "pty_paste_ack"
          ? "pty_paste"
          : "pty_input";
    if (op === "pty_key") {
      this.telemetry.ptyKeyAcksReceived += 1;
    } else if (op === "pty_paste") {
      this.telemetry.ptyPasteAcksReceived += 1;
    } else {
      this.telemetry.ptyInputAcksReceived += 1;
    }

    if (typeof message.sessionId !== "string" || !message.sessionId) {
      console.warn(`[WebSocket] Ignoring ${message.op} with invalid sessionId`);
      return;
    }
    if (typeof message.requestId !== "string" || !message.requestId) {
      if (op === "pty_key") {
        this.telemetry.ptyKeyAckUnmatched += 1;
      } else if (op === "pty_paste") {
        this.telemetry.ptyPasteAckUnmatched += 1;
      } else {
        this.telemetry.ptyInputAckUnmatched += 1;
      }
      console.warn(`[WebSocket] Ignoring ${message.op} with invalid requestId`);
      return;
    }

    const pending = this.pendingInputRequests.get(message.requestId);
    if (!pending || pending.op !== op || pending.sessionId !== message.sessionId) {
      if (op === "pty_key") {
        this.telemetry.ptyKeyAckUnmatched += 1;
      } else if (op === "pty_paste") {
        this.telemetry.ptyPasteAckUnmatched += 1;
      } else {
        this.telemetry.ptyInputAckUnmatched += 1;
      }
      console.warn(
        `[WebSocket] Received unmatched ${message.op} for session ${message.sessionId}`,
        { requestId: message.requestId }
      );
      return;
    }

    this.takePendingInputRequest(message.requestId);
  }

  private handleInputErrorControlMessage(message: InputErrorControlMessage): void {
    const op: InputOperation =
      message.op === "pty_key_error"
        ? "pty_key"
        : message.op === "pty_paste_error"
          ? "pty_paste"
          : "pty_input";
    if (op === "pty_key") {
      this.telemetry.ptyKeyErrorsReceived += 1;
    } else if (op === "pty_paste") {
      this.telemetry.ptyPasteErrorsReceived += 1;
    } else {
      this.telemetry.ptyInputErrorsReceived += 1;
    }

    if (typeof message.sessionId !== "string" || !message.sessionId) {
      console.warn(`[WebSocket] Ignoring ${message.op} with invalid sessionId`);
      return;
    }

    const requestId =
      typeof message.requestId === "string" && message.requestId ? message.requestId : undefined;
    let pending =
      requestId && this.pendingInputRequests.has(requestId)
        ? this.pendingInputRequests.get(requestId)
        : undefined;
    if (requestId && pending && pending.op === op && pending.sessionId === message.sessionId) {
      this.takePendingInputRequest(requestId);
    } else if (requestId) {
      pending = undefined;
    }

    // Compatibility path: older daemon versions may not echo requestId.
    if (!pending) {
      pending = this.takeFirstPendingInputRequest(op, message.sessionId);
    }

    if (!pending || pending.op !== op || pending.sessionId !== message.sessionId) {
      if (op === "pty_key") {
        this.telemetry.ptyKeyErrorUnmatched += 1;
      } else if (op === "pty_paste") {
        this.telemetry.ptyPasteErrorUnmatched += 1;
      } else {
        this.telemetry.ptyInputErrorUnmatched += 1;
      }
      console.warn(
        `[WebSocket] Received unmatched ${message.op} for session ${message.sessionId}`,
        requestId ? { requestId } : undefined
      );
      return;
    }

    if (op === "pty_key") {
      this.telemetry.ptyKeyFallbackTriggered += 1;
    } else if (op === "pty_paste") {
      this.telemetry.ptyPasteFallbackTriggered += 1;
    } else {
      this.telemetry.ptyInputFallbackTriggered += 1;
    }

    void Promise.resolve(pending.onError()).catch((error) => {
      this.telemetry.ptyFallbackHandlerErrors += 1;
      console.error(`[WebSocket] ${message.op} fallback failed:`, error);
    });
  }

  private sendInputOperation(
    op: InputOperation,
    sessionId: string,
    payload: { data?: string; key?: string },
    options?: SendInputOptions
  ): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return false;
    }

    const requestId = this.resolveInputRequestId(options);
    if (requestId && options?.onDispatchError) {
      this.registerPendingInputRequest(op, sessionId, requestId, options.onDispatchError);
    }

    try {
      this.ws.send(
        JSON.stringify({
          op,
          sessionId,
          ...payload,
          ...(requestId ? { requestId } : {}),
        })
      );
      return true;
    } catch (error) {
      if (requestId) {
        this.takePendingInputRequest(requestId);
      }
      console.error(`[WebSocket] Failed to send ${op}:`, error);
      return false;
    }
  }

  private resolveInputRequestId(options?: SendInputOptions): string | undefined {
    const provided = options?.requestId;
    if (typeof provided === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(provided)) {
      return provided;
    }
    if (!options?.onDispatchError) {
      return undefined;
    }
    wsInputRequestSequence = (wsInputRequestSequence + 1) % Number.MAX_SAFE_INTEGER;
    return `wr${Date.now().toString(36)}_${wsInputRequestSequence.toString(36)}`;
  }

  private registerPendingInputRequest(
    op: InputOperation,
    sessionId: string,
    requestId: string,
    onError: InputFailureHandler
  ): void {
    const existing = this.pendingInputRequests.get(requestId);
    if (existing) {
      clearTimeout(existing.timeout);
    }
    const timeout = setTimeout(() => {
      this.pendingInputRequests.delete(requestId);
    }, WS_INPUT_REQUEST_TTL_MS);
    this.pendingInputRequests.set(requestId, {
      op,
      sessionId,
      onError,
      timeout,
    });
  }

  private takePendingInputRequest(requestId: string): PendingInputRequest | undefined {
    const pending = this.pendingInputRequests.get(requestId);
    if (!pending) {
      return undefined;
    }
    clearTimeout(pending.timeout);
    this.pendingInputRequests.delete(requestId);
    return pending;
  }

  private takeFirstPendingInputRequest(
    op: InputOperation,
    sessionId: string
  ): PendingInputRequest | undefined {
    for (const [requestId, pending] of this.pendingInputRequests.entries()) {
      if (pending.op === op && pending.sessionId === sessionId) {
        return this.takePendingInputRequest(requestId);
      }
    }
    return undefined;
  }

  private clearPendingInputRequests(): void {
    for (const pending of this.pendingInputRequests.values()) {
      clearTimeout(pending.timeout);
    }
    this.pendingInputRequests.clear();
  }

  private enqueuePtyPasteSend(
    sessionId: string,
    requestId: string,
    chunks: string[],
    onDispatchError: InputFailureHandler
  ): void {
    const previous = this.pendingPasteSends.get(sessionId) ?? Promise.resolve();
    const queued = previous
      .catch(() => undefined)
      .then(async () => {
        await this.sendPtyPasteChunks(sessionId, requestId, chunks);
      })
      .catch((error) => {
        this.takePendingInputRequest(requestId);
        this.telemetry.ptyPasteFallbackTriggered += 1;
        console.error("[WebSocket] Failed to send pty_paste:", error);
        return Promise.resolve(onDispatchError()).catch((fallbackError) => {
          this.telemetry.ptyFallbackHandlerErrors += 1;
          console.error("[WebSocket] pty_paste fallback failed:", fallbackError);
        });
      });

    const tracked = queued.finally(() => {
      if (this.pendingPasteSends.get(sessionId) === tracked) {
        this.pendingPasteSends.delete(sessionId);
      }
    });
    this.pendingPasteSends.set(sessionId, tracked);
  }

  private async sendPtyPasteChunks(
    sessionId: string,
    requestId: string,
    chunks: string[]
  ): Promise<void> {
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error("WebSocket is not connected");
      }

      await this.waitForPasteBufferDrain(ws);

      ws.send(
        JSON.stringify({
          op: "pty_paste",
          sessionId,
          requestId,
          chunkIndex,
          chunkCount: chunks.length,
          data: chunks[chunkIndex],
        })
      );
      this.telemetry.ptyPasteSent += 1;
    }
  }

  private async waitForPasteBufferDrain(ws: WebSocket): Promise<void> {
    let waits = 0;
    while (
      ws.readyState === WebSocket.OPEN &&
      ws.bufferedAmount > WS_PTY_PASTE_BUFFERED_AMOUNT_LIMIT &&
      waits < WS_PTY_PASTE_MAX_BUFFER_WAITS
    ) {
      waits += 1;
      await new Promise((resolve) => setTimeout(resolve, WS_PTY_PASTE_BUFFER_WAIT_MS));
    }

    if (ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket disconnected while streaming paste");
    }
  }
}

function isWebSocketMessage(value: unknown): value is WebSocketMessage {
  if (!(value && typeof value === "object")) {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.topic === "string";
}

function isWebSocketControlMessage(value: unknown): value is WebSocketControlMessage {
  if (!(value && typeof value === "object")) {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.op === "string";
}

function decodePtyBinaryFrame(raw: ArrayBuffer): WebSocketMessage | null {
  const bytes = new Uint8Array(raw);
  if (bytes.byteLength < WS_PTY_BINARY_HEADER_BYTES + WS_PTY_BINARY_OUTPUT_META_BYTES) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint8(0);
  const version = view.getUint8(1);
  const frameType = view.getUint8(2);
  if (magic !== WS_PTY_BINARY_MAGIC || version !== WS_PTY_BINARY_VERSION) {
    return null;
  }

  const topicLength = view.getUint16(4, true);
  const seq = view.getUint32(6, true);
  let offset = WS_PTY_BINARY_HEADER_BYTES;
  const topicEnd = offset + topicLength;
  if (topicEnd > bytes.byteLength) {
    return null;
  }
  const topic = WS_BINARY_TEXT_DECODER.decode(bytes.subarray(offset, topicEnd));
  offset = topicEnd;

  if (frameType === WS_PTY_BINARY_TYPE_OUTPUT) {
    const minSize = offset + WS_PTY_BINARY_OUTPUT_META_BYTES;
    if (minSize > bytes.byteLength) {
      return null;
    }
    const dataLength = view.getUint32(offset, true);
    offset += 4;
    const dataEnd = offset + dataLength;
    if (dataEnd !== bytes.byteLength) {
      return null;
    }
    const data = WS_BINARY_TEXT_DECODER.decode(bytes.subarray(offset, dataEnd));
    return {
      topic,
      type: "pty_output",
      data,
      seq,
    };
  }

  if (frameType === WS_PTY_BINARY_TYPE_PATCH) {
    const minSize = offset + WS_PTY_BINARY_PATCH_META_BYTES;
    if (minSize > bytes.byteLength) {
      return null;
    }

    const baseSeq = view.getUint32(offset, true);
    offset += 4;
    const start = view.getUint32(offset, true);
    offset += 4;
    const deleteCount = view.getUint32(offset, true);
    offset += 4;
    const dataLength = view.getUint32(offset, true);
    offset += 4;
    const dataEnd = offset + dataLength;
    if (dataEnd !== bytes.byteLength) {
      return null;
    }
    const data = WS_BINARY_TEXT_DECODER.decode(bytes.subarray(offset, dataEnd));
    return {
      topic,
      type: "pty_patch",
      baseSeq,
      seq,
      start,
      deleteCount,
      data,
    };
  }

  return null;
}

function splitIntoPasteChunks(data: string): string[] | null {
  if (!data) {
    return [];
  }

  if (WS_TEXT_ENCODER.encode(data).byteLength > WS_PTY_PASTE_MAX_BYTES) {
    return null;
  }

  if (data.length > WS_PTY_PASTE_CHUNK_CHARS * WS_PTY_PASTE_MAX_CHUNKS) {
    return null;
  }

  const chunks: string[] = [];
  for (let i = 0; i < data.length; i += WS_PTY_PASTE_CHUNK_CHARS) {
    chunks.push(data.slice(i, i + WS_PTY_PASTE_CHUNK_CHARS));
  }
  return chunks;
}

// Singleton instance - use relative path so Vite proxy handles it in dev,
// and production builds connect to the same host
const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
export const websocketManager = new WebSocketManager(wsUrl);
