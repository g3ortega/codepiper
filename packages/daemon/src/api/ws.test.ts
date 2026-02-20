/**
 * Tests for WebSocket streaming support
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ProviderEvent } from "@codepiper/core";
import { EventBus } from "@codepiper/core";
import {
  MAX_WS_MESSAGE_BYTES,
  parseWsMessage,
  WebSocketManager,
  WS_MAX_CONSECUTIVE_BACKPRESSURE,
  WS_MAX_CONTROL_MESSAGES_PER_WINDOW,
  WS_MAX_PENDING_OUTBOUND_MESSAGES,
  WS_MAX_PTY_INPUT_MESSAGES_PER_WINDOW,
  WS_MAX_PTY_KEY_MESSAGES_PER_WINDOW,
  WS_MAX_PTY_PASTE_CHUNKS,
  WS_MAX_PTY_PASTE_MESSAGES_PER_WINDOW,
  WS_MAX_SUBSCRIPTIONS,
  WS_PROTOCOL_VERSION,
  WS_PTY_REPLAY_BUFFER_SIZE,
  WS_RATE_WINDOW_MS,
} from "./ws";

type WsBusEvents = {
  "session:event": ProviderEvent;
  "notification:created": Record<string, unknown>;
  "notification:read": Record<string, unknown>;
  "notification:counts_updated": Record<string, unknown>;
};

// Mock WebSocket connection
class MockWebSocket {
  public readyState: number = 1; // OPEN
  public sentMessages: string[] = [];
  public sentBinaryMessages: Uint8Array[] = [];
  public onmessage?: (event: { data: string }) => void;
  private queuedSendStatuses: number[] = [];

  queueSendStatuses(statuses: number[]): void {
    this.queuedSendStatuses.push(...statuses);
  }

  send(data: string | Buffer | Uint8Array): number {
    if (typeof data === "string") {
      this.sentMessages.push(data);
    } else {
      const bytes =
        data instanceof Uint8Array
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      this.sentBinaryMessages.push(bytes);
    }
    if (this.queuedSendStatuses.length > 0) {
      return this.queuedSendStatuses.shift() as number;
    }
    return typeof data === "string" ? data.length : data.byteLength;
  }

  close(): void {
    this.readyState = 3; // CLOSED
  }
}

function createPolicyBlockedError(
  message: string,
  policyAction: "allow" | "deny" | "ask",
  status: number
): Error {
  const error = new Error(message) as Error & {
    code: string;
    status: number;
    policyAction: "allow" | "deny" | "ask";
    provider: string;
  };
  error.code = "policy_blocked";
  error.status = status;
  error.policyAction = policyAction;
  error.provider = "codex";
  return error;
}

function decodeBinaryPtyFrame(raw: Uint8Array): Record<string, unknown> | null {
  if (raw.byteLength < 14) {
    return null;
  }

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const magic = view.getUint8(0);
  const version = view.getUint8(1);
  const frameType = view.getUint8(2);
  if (magic !== 0x43 || version !== 1) {
    return null;
  }

  const topicLength = view.getUint16(4, true);
  const seq = view.getUint32(6, true);
  let offset = 10;
  const topicEnd = offset + topicLength;
  if (topicEnd > raw.byteLength) {
    return null;
  }
  const decoder = new TextDecoder();
  const topic = decoder.decode(raw.subarray(offset, topicEnd));
  offset = topicEnd;

  if (frameType === 1) {
    if (offset + 4 > raw.byteLength) {
      return null;
    }
    const dataLength = view.getUint32(offset, true);
    offset += 4;
    const dataEnd = offset + dataLength;
    if (dataEnd !== raw.byteLength) {
      return null;
    }
    return {
      topic,
      type: "pty_output",
      seq,
      data: decoder.decode(raw.subarray(offset, dataEnd)),
    };
  }

  if (frameType === 2) {
    if (offset + 16 > raw.byteLength) {
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
    if (dataEnd !== raw.byteLength) {
      return null;
    }
    return {
      topic,
      type: "pty_patch",
      seq,
      baseSeq,
      start,
      deleteCount,
      data: decoder.decode(raw.subarray(offset, dataEnd)),
    };
  }

  return null;
}

describe("WebSocketManager", () => {
  let wsManager: WebSocketManager;
  let eventBus: EventBus<WsBusEvents>;

  beforeEach(() => {
    eventBus = new EventBus();
    wsManager = new WebSocketManager(eventBus);
  });

  afterEach(() => {
    wsManager.shutdown();
  });

  describe("Client connection", () => {
    test("should accept new WebSocket connection", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      // Connection should be tracked
      expect(wsManager.getConnectionCount()).toBe(1);
    });

    test("should handle multiple connections", () => {
      const ws1 = new MockWebSocket() as any;
      const ws2 = new MockWebSocket() as any;
      const ws3 = new MockWebSocket() as any;

      wsManager.handleConnection(ws1);
      wsManager.handleConnection(ws2);
      wsManager.handleConnection(ws3);

      expect(wsManager.getConnectionCount()).toBe(3);
    });

    test("should clean up connection on disconnect", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);
      expect(wsManager.getConnectionCount()).toBe(1);

      // Close connection
      ws.close();
      // Trigger cleanup via handleDisconnect
      wsManager.handleDisconnect(ws);

      expect(wsManager.getConnectionCount()).toBe(0);
    });
  });

  describe("Topic subscription", () => {
    test("should subscribe to session events topic", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:abc123:events",
      });

      const subscriptions = wsManager.getSubscriptions(ws);
      expect(subscriptions).toContain("session:abc123:events");
    });

    test("should subscribe to session PTY topic", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:abc123:pty",
      });

      const subscriptions = wsManager.getSubscriptions(ws);
      expect(subscriptions).toContain("session:abc123:pty");
    });

    test("should subscribe to sessions topic", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "sessions",
      });

      const subscriptions = wsManager.getSubscriptions(ws);
      expect(subscriptions).toContain("sessions");
    });

    test("should subscribe to notifications topic", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "notifications",
      });

      const subscriptions = wsManager.getSubscriptions(ws);
      expect(subscriptions).toContain("notifications");
    });

    test("should support multiple subscriptions per client", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:abc123:events",
      });
      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:def456:pty",
      });
      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "sessions",
      });
      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "notifications",
      });

      const subscriptions = wsManager.getSubscriptions(ws);
      expect(subscriptions).toHaveLength(4);
      expect(subscriptions).toContain("session:abc123:events");
      expect(subscriptions).toContain("session:def456:pty");
      expect(subscriptions).toContain("sessions");
      expect(subscriptions).toContain("notifications");
    });

    test("should not duplicate subscriptions", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:abc123:events",
      });
      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:abc123:events",
      });

      const subscriptions = wsManager.getSubscriptions(ws);
      expect(subscriptions).toHaveLength(1);
    });

    test("should enforce maximum subscriptions per client", () => {
      const originalNow = Date.now;
      let now = 2_000_000;
      Date.now = () => now;

      try {
        const ws = new MockWebSocket() as any;
        wsManager.handleConnection(ws);

        for (let i = 0; i < WS_MAX_SUBSCRIPTIONS; i++) {
          wsManager.handleMessage(ws, {
            op: "subscribe",
            topic: `session:cap-${i}:events`,
          });
          // Advance window to avoid triggering message-rate limiter in this test.
          now += WS_RATE_WINDOW_MS + 1;
        }

        expect(() => {
          wsManager.handleMessage(ws, {
            op: "subscribe",
            topic: "session:cap-overflow:events",
          });
        }).toThrow("Too many subscriptions");
      } finally {
        Date.now = originalNow;
      }
    });

    test("should unsubscribe from topic", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:abc123:events",
      });
      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:def456:events",
      });

      expect(wsManager.getSubscriptions(ws)).toHaveLength(2);

      wsManager.handleMessage(ws, {
        op: "unsubscribe",
        topic: "session:abc123:events",
      });

      const subscriptions = wsManager.getSubscriptions(ws);
      expect(subscriptions).toHaveLength(1);
      expect(subscriptions).toContain("session:def456:events");
    });

    test("should handle unsubscribe from non-existent topic gracefully", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      expect(() => {
        wsManager.handleMessage(ws, {
          op: "unsubscribe",
          topic: "session:abc123:events",
        });
      }).not.toThrow();
    });
  });

  describe("Message format validation", () => {
    test("should reject message without op field", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      expect(() => {
        wsManager.handleMessage(ws, {
          topic: "session:abc123:events",
        });
      }).toThrow("Invalid message: missing 'op' field");
    });

    test("should reject subscribe without topic", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      expect(() => {
        wsManager.handleMessage(ws, {
          op: "subscribe",
        });
      }).toThrow("Invalid message: missing 'topic' field");
    });

    test("should reject invalid topic format", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      expect(() => {
        wsManager.handleMessage(ws, {
          op: "subscribe",
          topic: "invalid topic format!",
        });
      }).toThrow("Invalid topic format");
    });

    test("should accept valid session:id:events topic", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      expect(() => {
        wsManager.handleMessage(ws, {
          op: "subscribe",
          topic: "session:abc-123-def:events",
        });
      }).not.toThrow();
    });

    test("should accept valid session:id:pty topic", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      expect(() => {
        wsManager.handleMessage(ws, {
          op: "subscribe",
          topic: "session:abc-123-def:pty",
        });
      }).not.toThrow();
    });

    test("should accept sessions topic", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      expect(() => {
        wsManager.handleMessage(ws, {
          op: "subscribe",
          topic: "sessions",
        });
      }).not.toThrow();
    });

    test("should accept notifications topic", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      expect(() => {
        wsManager.handleMessage(ws, {
          op: "subscribe",
          topic: "notifications",
        });
      }).not.toThrow();
    });

    test("should reject unknown operation", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      expect(() => {
        wsManager.handleMessage(ws, {
          op: "invalid-op",
          topic: "sessions",
        });
      }).toThrow("Unknown operation");
    });

    test("should dispatch pty_input to input handler", async () => {
      const inputBus = new EventBus<WsBusEvents>();
      const onPtyInput = mock(() => {});
      const inputManager = new WebSocketManager(inputBus, { onPtyInput });

      try {
        const ws = new MockWebSocket() as any;
        inputManager.handleConnection(ws);
        inputManager.handleMessage(ws, {
          op: "pty_input",
          sessionId: "abc123",
          data: "hello",
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(onPtyInput).toHaveBeenCalledTimes(1);
        expect(onPtyInput).toHaveBeenCalledWith("abc123", "hello");
        const telemetry = inputManager.getTelemetrySnapshot();
        expect(telemetry.ptyInputOps).toBe(1);
      } finally {
        inputManager.shutdown();
      }
    });

    test("should send pty_input_ack when dispatch succeeds and requestId is provided", async () => {
      const inputBus = new EventBus<WsBusEvents>();
      const inputManager = new WebSocketManager(inputBus, {
        onPtyInput: async () => {},
      });

      try {
        const ws = new MockWebSocket() as any;
        inputManager.handleConnection(ws);
        inputManager.handleMessage(ws, {
          op: "pty_input",
          sessionId: "abc123",
          data: "hello",
          requestId: "req_in_1",
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(ws.sentMessages).toHaveLength(1);
        const ack = JSON.parse(ws.sentMessages[0]);
        expect(ack.op).toBe("pty_input_ack");
        expect(ack.sessionId).toBe("abc123");
        expect(ack.requestId).toBe("req_in_1");
      } finally {
        inputManager.shutdown();
      }
    });

    test("should not send pty_input_ack when requestId is omitted", async () => {
      const inputBus = new EventBus<WsBusEvents>();
      const inputManager = new WebSocketManager(inputBus, {
        onPtyInput: async () => {},
      });

      try {
        const ws = new MockWebSocket() as any;
        inputManager.handleConnection(ws);
        inputManager.handleMessage(ws, {
          op: "pty_input",
          sessionId: "abc123",
          data: "hello",
        });

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(ws.sentMessages).toHaveLength(0);
      } finally {
        inputManager.shutdown();
      }
    });

    test("should dispatch pty_key to key handler", async () => {
      const keyBus = new EventBus<WsBusEvents>();
      const onPtyKey = mock(() => {});
      const keyManager = new WebSocketManager(keyBus, { onPtyKey });

      try {
        const ws = new MockWebSocket() as any;
        keyManager.handleConnection(ws);
        keyManager.handleMessage(ws, {
          op: "pty_key",
          sessionId: "abc123",
          key: "enter",
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(onPtyKey).toHaveBeenCalledTimes(1);
        expect(onPtyKey).toHaveBeenCalledWith("abc123", "enter");
        const telemetry = keyManager.getTelemetrySnapshot();
        expect(telemetry.ptyKeyOps).toBe(1);
      } finally {
        keyManager.shutdown();
      }
    });

    test("should send pty_key_ack when dispatch succeeds and requestId is provided", async () => {
      const keyBus = new EventBus<WsBusEvents>();
      const keyManager = new WebSocketManager(keyBus, {
        onPtyKey: async () => {},
      });

      try {
        const ws = new MockWebSocket() as any;
        keyManager.handleConnection(ws);
        keyManager.handleMessage(ws, {
          op: "pty_key",
          sessionId: "abc123",
          key: "enter",
          requestId: "req_key_ok",
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(ws.sentMessages).toHaveLength(1);
        const ack = JSON.parse(ws.sentMessages[0]);
        expect(ack.op).toBe("pty_key_ack");
        expect(ack.sessionId).toBe("abc123");
        expect(ack.requestId).toBe("req_key_ok");
      } finally {
        keyManager.shutdown();
      }
    });

    test("should not send pty_key_ack when requestId is omitted", async () => {
      const keyBus = new EventBus<WsBusEvents>();
      const keyManager = new WebSocketManager(keyBus, {
        onPtyKey: async () => {},
      });

      try {
        const ws = new MockWebSocket() as any;
        keyManager.handleConnection(ws);
        keyManager.handleMessage(ws, {
          op: "pty_key",
          sessionId: "abc123",
          key: "enter",
        });

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(ws.sentMessages).toHaveLength(0);
      } finally {
        keyManager.shutdown();
      }
    });

    test("should dispatch pty_paste only after all chunks arrive", async () => {
      const pasteBus = new EventBus<WsBusEvents>();
      const onPtyPaste = mock(async () => {});
      const pasteManager = new WebSocketManager(pasteBus, { onPtyPaste });

      try {
        const ws = new MockWebSocket() as any;
        pasteManager.handleConnection(ws);

        pasteManager.handleMessage(ws, {
          op: "pty_paste",
          sessionId: "abc123",
          requestId: "req_paste_1",
          chunkIndex: 0,
          chunkCount: 2,
          data: "hello ",
        });

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(onPtyPaste).toHaveBeenCalledTimes(0);

        pasteManager.handleMessage(ws, {
          op: "pty_paste",
          sessionId: "abc123",
          requestId: "req_paste_1",
          chunkIndex: 1,
          chunkCount: 2,
          data: "world",
        });

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(onPtyPaste).toHaveBeenCalledTimes(1);
        expect(onPtyPaste).toHaveBeenCalledWith("abc123", "hello world");

        expect(ws.sentMessages).toHaveLength(1);
        const ack = JSON.parse(ws.sentMessages[0]);
        expect(ack.op).toBe("pty_paste_ack");
        expect(ack.sessionId).toBe("abc123");
        expect(ack.requestId).toBe("req_paste_1");

        const telemetry = pasteManager.getTelemetrySnapshot();
        expect(telemetry.ptyPasteOps).toBe(2);
      } finally {
        pasteManager.shutdown();
      }
    });

    test("should reject pty_paste when operation is disabled", () => {
      const pasteBus = new EventBus<WsBusEvents>();
      const pasteManager = new WebSocketManager(pasteBus, {
        enablePtyPaste: false,
        onPtyPaste: () => {},
      });
      const ws = new MockWebSocket() as any;
      pasteManager.handleConnection(ws);

      expect(() => {
        pasteManager.handleMessage(ws, {
          op: "pty_paste",
          sessionId: "abc123",
          requestId: "req_paste_disabled",
          chunkIndex: 0,
          chunkCount: 1,
          data: "x",
        });
      }).toThrow("disabled");

      pasteManager.shutdown();
    });

    test("should reject out-of-order pty_paste chunks", () => {
      const pasteBus = new EventBus<WsBusEvents>();
      const pasteManager = new WebSocketManager(pasteBus, { onPtyPaste: () => {} });
      const ws = new MockWebSocket() as any;
      pasteManager.handleConnection(ws);

      expect(() => {
        pasteManager.handleMessage(ws, {
          op: "pty_paste",
          sessionId: "abc123",
          requestId: "req_paste_2",
          chunkIndex: 1,
          chunkCount: 2,
          data: "oops",
        });
      }).toThrow("must start at index 0");

      pasteManager.shutdown();
    });

    test("should validate pty_paste chunk metadata", () => {
      const pasteBus = new EventBus<WsBusEvents>();
      const pasteManager = new WebSocketManager(pasteBus, { onPtyPaste: () => {} });
      const ws = new MockWebSocket() as any;
      pasteManager.handleConnection(ws);

      expect(() => {
        pasteManager.handleMessage(ws, {
          op: "pty_paste",
          sessionId: "abc123",
          requestId: "req_paste_3",
          chunkIndex: -1,
          chunkCount: 1,
          data: "bad",
        });
      }).toThrow("chunkIndex");

      expect(() => {
        pasteManager.handleMessage(ws, {
          op: "pty_paste",
          sessionId: "abc123",
          requestId: "req_paste_3",
          chunkIndex: 0,
          chunkCount: WS_MAX_PTY_PASTE_CHUNKS + 1,
          data: "bad",
        });
      }).toThrow("chunkCount");

      expect(() => {
        pasteManager.handleMessage(ws, {
          op: "pty_paste",
          sessionId: "abc123",
          chunkIndex: 0,
          chunkCount: 1,
          data: "bad",
        });
      }).toThrow("requestId");

      pasteManager.shutdown();
    });

    test("should validate pty_input required fields", () => {
      const inputBus = new EventBus<WsBusEvents>();
      const inputManager = new WebSocketManager(inputBus, { onPtyInput: () => {} });
      const ws = new MockWebSocket() as any;
      inputManager.handleConnection(ws);

      expect(() => {
        inputManager.handleMessage(ws, {
          op: "pty_input",
          data: "hello",
        });
      }).toThrow("sessionId");

      expect(() => {
        inputManager.handleMessage(ws, {
          op: "pty_input",
          sessionId: "abc123",
        });
      }).toThrow("data");

      expect(() => {
        inputManager.handleMessage(ws, {
          op: "pty_input",
          sessionId: "bad session",
          data: "hello",
        });
      }).toThrow("sessionId");

      inputManager.shutdown();
    });

    test("should validate pty_key required fields", () => {
      const keyBus = new EventBus<WsBusEvents>();
      const keyManager = new WebSocketManager(keyBus, { onPtyKey: () => {} });
      const ws = new MockWebSocket() as any;
      keyManager.handleConnection(ws);

      expect(() => {
        keyManager.handleMessage(ws, {
          op: "pty_key",
          key: "enter",
        });
      }).toThrow("sessionId");

      expect(() => {
        keyManager.handleMessage(ws, {
          op: "pty_key",
          sessionId: "abc123",
        });
      }).toThrow("key");

      keyManager.shutdown();
    });

    test("should validate optional requestId for pty input operations", () => {
      const inputBus = new EventBus<WsBusEvents>();
      const inputManager = new WebSocketManager(inputBus, { onPtyInput: () => {} });
      const ws = new MockWebSocket() as any;
      inputManager.handleConnection(ws);

      expect(() => {
        inputManager.handleMessage(ws, {
          op: "pty_input",
          sessionId: "abc123",
          data: "hello",
          requestId: "",
        });
      }).toThrow("requestId");

      expect(() => {
        inputManager.handleMessage(ws, {
          op: "pty_input",
          sessionId: "abc123",
          data: "hello",
          requestId: "bad id",
        });
      }).toThrow("requestId");

      expect(() => {
        inputManager.handleMessage(ws, {
          op: "pty_input",
          sessionId: "abc123",
          data: "hello",
          requestId: "x".repeat(129),
        });
      }).toThrow("requestId");

      inputManager.shutdown();
    });

    test("should send pty_input_error when dispatch fails", async () => {
      const inputBus = new EventBus<WsBusEvents>();
      const inputManager = new WebSocketManager(inputBus, {
        onPtyInput: async () => {
          throw new Error("session unavailable");
        },
      });

      try {
        const ws = new MockWebSocket() as any;
        inputManager.handleConnection(ws);
        inputManager.handleMessage(ws, {
          op: "pty_input",
          sessionId: "abc123",
          data: "hello",
          requestId: "req_abc123",
        });

        // Wait for async dispatch failure handler.
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(ws.sentMessages).toHaveLength(1);
        const error = JSON.parse(ws.sentMessages[0]);
        expect(error.op).toBe("pty_input_error");
        expect(error.sessionId).toBe("abc123");
        expect(error.requestId).toBe("req_abc123");
        expect(error.error).toContain("Failed to deliver PTY input");

        const telemetry = inputManager.getTelemetrySnapshot();
        expect(telemetry.ptyInputDispatchErrors).toBe(1);
      } finally {
        inputManager.shutdown();
      }
    });

    test("should send pty_key_error with requestId when dispatch fails", async () => {
      const keyBus = new EventBus<WsBusEvents>();
      const keyManager = new WebSocketManager(keyBus, {
        onPtyKey: async () => {
          throw new Error("session unavailable");
        },
      });

      try {
        const ws = new MockWebSocket() as any;
        keyManager.handleConnection(ws);
        keyManager.handleMessage(ws, {
          op: "pty_key",
          sessionId: "abc123",
          key: "enter",
          requestId: "req_key_1",
        });

        // Wait for async dispatch failure handler.
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(ws.sentMessages).toHaveLength(1);
        const error = JSON.parse(ws.sentMessages[0]);
        expect(error.op).toBe("pty_key_error");
        expect(error.sessionId).toBe("abc123");
        expect(error.requestId).toBe("req_key_1");
        expect(error.error).toContain("Failed to deliver PTY key input");
      } finally {
        keyManager.shutdown();
      }
    });

    test("should include policy metadata on pty_input_error", async () => {
      const inputBus = new EventBus<WsBusEvents>();
      const inputManager = new WebSocketManager(inputBus, {
        onPtyInput: async () => {
          throw createPolicyBlockedError("Destructive command blocked", "deny", 403);
        },
      });

      try {
        const ws = new MockWebSocket() as any;
        inputManager.handleConnection(ws);
        inputManager.handleMessage(ws, {
          op: "pty_input",
          sessionId: "abc123",
          data: "rm -rf /",
          requestId: "req_input_policy",
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(ws.sentMessages).toHaveLength(1);
        const error = JSON.parse(ws.sentMessages[0]);
        expect(error.op).toBe("pty_input_error");
        expect(error.requestId).toBe("req_input_policy");
        expect(error.error).toBe("Destructive command blocked");
        expect(error.code).toBe("policy_blocked");
        expect(error.status).toBe(403);
        expect(error.policyAction).toBe("deny");
        expect(error.provider).toBe("codex");
      } finally {
        inputManager.shutdown();
      }
    });

    test("should include policy metadata on pty_key_error", async () => {
      const keyBus = new EventBus<WsBusEvents>();
      const keyManager = new WebSocketManager(keyBus, {
        onPtyKey: async () => {
          throw createPolicyBlockedError(
            "Policy returned ask, but interactive approval is unavailable",
            "ask",
            409
          );
        },
      });

      try {
        const ws = new MockWebSocket() as any;
        keyManager.handleConnection(ws);
        keyManager.handleMessage(ws, {
          op: "pty_key",
          sessionId: "abc123",
          key: "enter",
          requestId: "req_key_policy",
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(ws.sentMessages).toHaveLength(1);
        const error = JSON.parse(ws.sentMessages[0]);
        expect(error.op).toBe("pty_key_error");
        expect(error.requestId).toBe("req_key_policy");
        expect(error.error).toContain("interactive approval");
        expect(error.code).toBe("policy_blocked");
        expect(error.status).toBe(409);
        expect(error.policyAction).toBe("ask");
        expect(error.provider).toBe("codex");
      } finally {
        keyManager.shutdown();
      }
    });

    test("should include policy metadata on pty_paste_error", async () => {
      const pasteBus = new EventBus<WsBusEvents>();
      const pasteManager = new WebSocketManager(pasteBus, {
        onPtyPaste: async () => {
          throw createPolicyBlockedError("Paste blocked by policy", "deny", 403);
        },
      });

      try {
        const ws = new MockWebSocket() as any;
        pasteManager.handleConnection(ws);
        pasteManager.handleMessage(ws, {
          op: "pty_paste",
          sessionId: "abc123",
          requestId: "req_paste_policy",
          chunkIndex: 0,
          chunkCount: 1,
          data: "rm -rf /",
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(ws.sentMessages).toHaveLength(1);
        const error = JSON.parse(ws.sentMessages[0]);
        expect(error.op).toBe("pty_paste_error");
        expect(error.requestId).toBe("req_paste_policy");
        expect(error.error).toBe("Paste blocked by policy");
        expect(error.code).toBe("policy_blocked");
        expect(error.status).toBe(403);
        expect(error.policyAction).toBe("deny");
        expect(error.provider).toBe("codex");
      } finally {
        pasteManager.shutdown();
      }
    });

    test("should accept hello operation and return hello_ack", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      wsManager.handleMessage(ws, {
        op: "hello",
        version: WS_PROTOCOL_VERSION,
      });

      expect(ws.sentMessages).toHaveLength(1);
      const message = JSON.parse(ws.sentMessages[0]);
      expect(message.op).toBe("hello_ack");
      expect(message.version).toBe(WS_PROTOCOL_VERSION);
      expect(message.features.ptyReplay).toBe(true);
      expect(message.features.ptyPatch).toBe(false);
      expect(message.features.ptyBinary).toBe(false);
      expect(message.features.ptyPaste).toBe(true);
      expect(message.negotiated.ptyPatch).toBe(false);
      expect(message.negotiated.ptyBinary).toBe(false);
      expect(message.negotiated.ptyPaste).toBe(false);

      const telemetry = wsManager.getTelemetrySnapshot();
      expect(telemetry.helloOps).toBe(1);
      expect(telemetry.helloAckSent).toBe(1);
    });

    test("should reject unsupported hello protocol version", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      expect(() => {
        wsManager.handleMessage(ws, {
          op: "hello",
          version: WS_PROTOCOL_VERSION + 1,
        });
      }).toThrow("Unsupported protocol version");
    });

    test("should negotiate ptyPatch when enabled and requested by client", () => {
      const patchBus = new EventBus<WsBusEvents>();
      const patchManager = new WebSocketManager(patchBus, { enablePtyPatch: true });

      try {
        const ws = new MockWebSocket() as any;
        patchManager.handleConnection(ws);
        patchManager.handleMessage(ws, {
          op: "hello",
          version: WS_PROTOCOL_VERSION,
          supports: {
            ptyPatch: true,
          },
        });

        const message = JSON.parse(ws.sentMessages[0]);
        expect(message.features.ptyPatch).toBe(true);
        expect(message.negotiated.ptyPatch).toBe(true);
        expect(message.features.ptyPaste).toBe(true);
        expect(message.negotiated.ptyPaste).toBe(false);
      } finally {
        patchManager.shutdown();
      }
    });

    test("should negotiate ptyBinary when enabled and requested by client", () => {
      const binaryBus = new EventBus<WsBusEvents>();
      const binaryManager = new WebSocketManager(binaryBus, { enablePtyBinary: true });

      try {
        const ws = new MockWebSocket() as any;
        binaryManager.handleConnection(ws);
        binaryManager.handleMessage(ws, {
          op: "hello",
          version: WS_PROTOCOL_VERSION,
          supports: {
            ptyBinary: true,
          },
        });

        const message = JSON.parse(ws.sentMessages[0]);
        expect(message.features.ptyBinary).toBe(true);
        expect(message.negotiated.ptyBinary).toBe(true);
        expect(message.features.ptyPaste).toBe(true);
        expect(message.negotiated.ptyPaste).toBe(false);
      } finally {
        binaryManager.shutdown();
      }
    });

    test("should negotiate ptyPaste when enabled and requested by client", () => {
      const pasteBus = new EventBus<WsBusEvents>();
      const pasteManager = new WebSocketManager(pasteBus, { enablePtyPaste: true });

      try {
        const ws = new MockWebSocket() as any;
        pasteManager.handleConnection(ws);
        pasteManager.handleMessage(ws, {
          op: "hello",
          version: WS_PROTOCOL_VERSION,
          supports: {
            ptyPaste: true,
          },
        });

        const message = JSON.parse(ws.sentMessages[0]);
        expect(message.features.ptyPaste).toBe(true);
        expect(message.negotiated.ptyPaste).toBe(true);
      } finally {
        pasteManager.shutdown();
      }
    });

    test("should reject invalid sinceSeq on subscribe", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      expect(() => {
        wsManager.handleMessage(ws, {
          op: "subscribe",
          topic: "session:abc123:pty",
          sinceSeq: -1,
        });
      }).toThrow("sinceSeq");

      expect(() => {
        wsManager.handleMessage(ws, {
          op: "subscribe",
          topic: "session:abc123:pty",
          sinceSeq: 1.5,
        });
      }).toThrow("sinceSeq");
    });

    test("should accept valid sinceSeq on subscribe", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      expect(() => {
        wsManager.handleMessage(ws, {
          op: "subscribe",
          topic: "session:abc123:pty",
          sinceSeq: 0,
        });
      }).not.toThrow();
    });

    test("should enforce per-client message rate limit", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      for (let i = 0; i < WS_MAX_CONTROL_MESSAGES_PER_WINDOW; i++) {
        wsManager.handleMessage(ws, {
          op: "subscribe",
          topic: "sessions",
        });
      }

      expect(() => {
        wsManager.handleMessage(ws, {
          op: "subscribe",
          topic: "sessions",
        });
      }).toThrow("rate limit exceeded");

      expect(ws.readyState).toBe(3); // CLOSED
      expect(wsManager.getConnectionCount()).toBe(0);

      const telemetry = wsManager.getTelemetrySnapshot();
      expect(telemetry.rateLimitedMessages).toBe(1);
      expect(telemetry.rateLimitedControlMessages).toBe(1);
      expect(telemetry.disconnectReasons.rate_limit).toBe(1);
    });

    test("should reset message quota after rate window", () => {
      const originalNow = Date.now;
      let now = 1_000_000;
      Date.now = () => now;

      try {
        const ws = new MockWebSocket() as any;
        wsManager.handleConnection(ws);

        for (let i = 0; i < WS_MAX_CONTROL_MESSAGES_PER_WINDOW; i++) {
          wsManager.handleMessage(ws, {
            op: "subscribe",
            topic: "sessions",
          });
        }

        now += WS_RATE_WINDOW_MS + 1;

        expect(() => {
          wsManager.handleMessage(ws, {
            op: "subscribe",
            topic: "sessions",
          });
        }).not.toThrow();
      } finally {
        Date.now = originalNow;
      }
    });

    test("should isolate pty_key quota from control quota", () => {
      const keyBus = new EventBus<WsBusEvents>();
      const keyManager = new WebSocketManager(keyBus, { onPtyKey: () => {} });

      try {
        const ws = new MockWebSocket() as any;
        keyManager.handleConnection(ws);

        for (let i = 0; i < WS_MAX_CONTROL_MESSAGES_PER_WINDOW + 10; i++) {
          keyManager.handleMessage(ws, {
            op: "pty_key",
            sessionId: "abc123",
            key: "enter",
          });
        }

        expect(() => {
          keyManager.handleMessage(ws, {
            op: "subscribe",
            topic: "sessions",
          });
        }).not.toThrow();
      } finally {
        keyManager.shutdown();
      }
    });

    test("should enforce pty_key quota independently", () => {
      const keyBus = new EventBus<WsBusEvents>();
      const keyManager = new WebSocketManager(keyBus, { onPtyKey: () => {} });

      try {
        const ws = new MockWebSocket() as any;
        keyManager.handleConnection(ws);

        for (let i = 0; i < WS_MAX_PTY_KEY_MESSAGES_PER_WINDOW; i++) {
          keyManager.handleMessage(ws, {
            op: "pty_key",
            sessionId: "abc123",
            key: "enter",
          });
        }

        expect(() => {
          keyManager.handleMessage(ws, {
            op: "pty_key",
            sessionId: "abc123",
            key: "enter",
          });
        }).toThrow("rate limit exceeded");

        const telemetry = keyManager.getTelemetrySnapshot();
        expect(telemetry.rateLimitedMessages).toBe(1);
        expect(telemetry.rateLimitedPtyKeyMessages).toBe(1);
      } finally {
        keyManager.shutdown();
      }
    });

    test("should enforce pty_input quota independently", () => {
      const inputBus = new EventBus<WsBusEvents>();
      const inputManager = new WebSocketManager(inputBus, { onPtyInput: () => {} });

      try {
        const ws = new MockWebSocket() as any;
        inputManager.handleConnection(ws);

        for (let i = 0; i < WS_MAX_PTY_INPUT_MESSAGES_PER_WINDOW; i++) {
          inputManager.handleMessage(ws, {
            op: "pty_input",
            sessionId: "abc123",
            data: "x",
          });
        }

        expect(() => {
          inputManager.handleMessage(ws, {
            op: "pty_input",
            sessionId: "abc123",
            data: "x",
          });
        }).toThrow("rate limit exceeded");

        const telemetry = inputManager.getTelemetrySnapshot();
        expect(telemetry.rateLimitedMessages).toBe(1);
        expect(telemetry.rateLimitedPtyInputMessages).toBe(1);
      } finally {
        inputManager.shutdown();
      }
    });

    test("should enforce pty_paste chunk quota independently", () => {
      const pasteBus = new EventBus<WsBusEvents>();
      const pasteManager = new WebSocketManager(pasteBus, { onPtyPaste: () => {} });

      try {
        const ws = new MockWebSocket() as any;
        pasteManager.handleConnection(ws);

        for (let i = 0; i < WS_MAX_PTY_PASTE_MESSAGES_PER_WINDOW; i++) {
          pasteManager.handleMessage(ws, {
            op: "pty_paste",
            sessionId: "abc123",
            requestId: `req-paste-${i}`,
            chunkIndex: 0,
            chunkCount: 1,
            data: "x",
          });
        }

        expect(() => {
          pasteManager.handleMessage(ws, {
            op: "pty_paste",
            sessionId: "abc123",
            requestId: "req-paste-overflow",
            chunkIndex: 0,
            chunkCount: 1,
            data: "x",
          });
        }).toThrow("rate limit exceeded");

        const telemetry = pasteManager.getTelemetrySnapshot();
        expect(telemetry.rateLimitedMessages).toBe(1);
        expect(telemetry.rateLimitedPtyPasteMessages).toBe(1);
      } finally {
        pasteManager.shutdown();
      }
    });
  });

  describe("Event broadcasting", () => {
    test("should broadcast event to subscribed client", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:abc123:events",
      });

      // Emit event via event bus
      const event: ProviderEvent = {
        sessionId: "abc123",
        type: "SessionStart",
        timestamp: new Date(),
        payload: { cwd: "/test" },
      };

      eventBus.emit("session:event", event);

      // Wait for async processing
      expect(ws.sentMessages).toHaveLength(1);
      const message = JSON.parse(ws.sentMessages[0]);
      expect(message.topic).toBe("session:abc123:events");
      expect(message.data.sessionId).toBe("abc123");
      expect(message.data.type).toBe("SessionStart");
      expect(message.data.payload).toEqual({ cwd: "/test" });
    });

    test("should not broadcast to unsubscribed client", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      // Subscribe to different session
      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:def456:events",
      });

      // Emit event for different session
      const event: ProviderEvent = {
        sessionId: "abc123",
        type: "SessionStart",
        timestamp: new Date(),
        payload: { cwd: "/test" },
      };

      eventBus.emit("session:event", event);

      // Should not receive message
      expect(ws.sentMessages).toHaveLength(0);
    });

    test("should broadcast to multiple subscribed clients", () => {
      const ws1 = new MockWebSocket() as any;
      const ws2 = new MockWebSocket() as any;
      const ws3 = new MockWebSocket() as any;

      wsManager.handleConnection(ws1);
      wsManager.handleConnection(ws2);
      wsManager.handleConnection(ws3);

      wsManager.handleMessage(ws1, {
        op: "subscribe",
        topic: "session:abc123:events",
      });
      wsManager.handleMessage(ws2, {
        op: "subscribe",
        topic: "session:abc123:events",
      });
      wsManager.handleMessage(ws3, {
        op: "subscribe",
        topic: "session:def456:events",
      });

      // Emit event
      const event: ProviderEvent = {
        sessionId: "abc123",
        type: "SessionStart",
        timestamp: new Date(),
        payload: { cwd: "/test" },
      };

      eventBus.emit("session:event", event);

      // Only ws1 and ws2 should receive
      expect(ws1.sentMessages).toHaveLength(1);
      expect(ws2.sentMessages).toHaveLength(1);
      expect(ws3.sentMessages).toHaveLength(0);
    });

    test("should broadcast PTY data to PTY topic subscribers", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:abc123:pty",
      });

      // Broadcast PTY data
      wsManager.broadcastPtyData("abc123", "Hello from PTY\n");

      expect(ws.sentMessages).toHaveLength(1);
      const message = JSON.parse(ws.sentMessages[0]);
      expect(message).toEqual({
        topic: "session:abc123:pty",
        type: "pty_output",
        data: "Hello from PTY\n",
        seq: 1,
      });
    });

    test("should increment PTY sequence per session", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:abc123:pty",
      });

      wsManager.broadcastPtyData("abc123", "one");
      wsManager.broadcastPtyData("abc123", "two");
      wsManager.broadcastPtyData("abc123", "three");

      const messages = ws.sentMessages.map((raw: string) => JSON.parse(raw));
      expect(messages[0].seq).toBe(1);
      expect(messages[1].seq).toBe(2);
      expect(messages[2].seq).toBe(3);
    });

    test("should track PTY sequence independently per session", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:abc123:pty",
      });
      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:def456:pty",
      });

      wsManager.broadcastPtyData("abc123", "a1");
      wsManager.broadcastPtyData("def456", "d1");
      wsManager.broadcastPtyData("abc123", "a2");

      const messages = ws.sentMessages.map((raw: string) => JSON.parse(raw));
      expect(messages[0].topic).toBe("session:abc123:pty");
      expect(messages[0].seq).toBe(1);
      expect(messages[1].topic).toBe("session:def456:pty");
      expect(messages[1].seq).toBe(1);
      expect(messages[2].topic).toBe("session:abc123:pty");
      expect(messages[2].seq).toBe(2);
    });

    test("should replay PTY frames newer than sinceSeq on subscribe", () => {
      wsManager.broadcastPtyData("abc123", "one");
      wsManager.broadcastPtyData("abc123", "two");
      wsManager.broadcastPtyData("abc123", "three");

      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);
      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:abc123:pty",
        sinceSeq: 1,
      });

      expect(ws.sentMessages).toHaveLength(2);
      const replayed = ws.sentMessages.map((raw: string) => JSON.parse(raw));
      expect(replayed[0].seq).toBe(2);
      expect(replayed[1].seq).toBe(3);

      const telemetry = wsManager.getTelemetrySnapshot();
      expect(telemetry.replayRequests).toBe(1);
      expect(telemetry.replayFramesSent).toBe(2);
      expect(telemetry.sendSuccess).toBe(2);
    });

    test("should bound PTY replay buffer size", () => {
      for (let i = 1; i <= WS_PTY_REPLAY_BUFFER_SIZE + 5; i++) {
        wsManager.broadcastPtyData("abc123", `line-${i}`);
      }

      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);
      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:abc123:pty",
        sinceSeq: 0,
      });

      expect(ws.sentMessages).toHaveLength(WS_PTY_REPLAY_BUFFER_SIZE);
      const first = JSON.parse(ws.sentMessages[0]);
      const last = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
      expect(first.seq).toBe(6);
      expect(last.seq).toBe(WS_PTY_REPLAY_BUFFER_SIZE + 5);
    });

    test("should broadcast session state changes to sessions topic", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "sessions",
      });

      // Broadcast session state change
      wsManager.broadcastSessionChange({
        id: "abc123",
        status: "RUNNING",
        provider: "claude-code",
        cwd: "/test",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      expect(ws.sentMessages).toHaveLength(1);
      const message = JSON.parse(ws.sentMessages[0]);
      expect(message.topic).toBe("sessions");
      expect(message.id).toBe("abc123");
      expect(message.status).toBe("RUNNING");
    });

    test("should broadcast notification events to notifications topic", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "notifications",
      });

      eventBus.emit("notification:created", {
        id: 11,
        sessionId: "abc123",
        eventType: "session.turn_completed",
      });
      eventBus.emit("notification:read", {
        id: 11,
      });
      eventBus.emit("notification:counts_updated", {
        totalUnread: 4,
        bySession: { abc123: 2 },
      });

      expect(ws.sentMessages).toHaveLength(3);

      const created = JSON.parse(ws.sentMessages[0]);
      expect(created.topic).toBe("notifications");
      expect(created.type).toBe("notification_created");
      expect(created.data.id).toBe(11);

      const read = JSON.parse(ws.sentMessages[1]);
      expect(read.topic).toBe("notifications");
      expect(read.type).toBe("notification_read");
      expect(read.data.id).toBe(11);

      const counts = JSON.parse(ws.sentMessages[2]);
      expect(counts.topic).toBe("notifications");
      expect(counts.type).toBe("notification_counts_updated");
      expect(counts.data.totalUnread).toBe(4);
    });

    test("should not send to closed connections", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:abc123:events",
      });

      // Close connection
      ws.readyState = 3; // CLOSED

      // Emit event
      const event: ProviderEvent = {
        sessionId: "abc123",
        type: "SessionStart",
        timestamp: new Date(),
        payload: { cwd: "/test" },
      };

      eventBus.emit("session:event", event);

      // Should not send to closed connection
      expect(ws.sentMessages).toHaveLength(0);
    });

    test("should disconnect client on repeated backpressure", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:abc123:events",
      });

      ws.queueSendStatuses(new Array(WS_MAX_CONSECUTIVE_BACKPRESSURE).fill(-1));

      const event: ProviderEvent = {
        sessionId: "abc123",
        type: "SessionStart",
        timestamp: new Date(),
        payload: { cwd: "/test" },
      };

      eventBus.emit("session:event", event);
      for (let i = 1; i < WS_MAX_CONSECUTIVE_BACKPRESSURE; i++) {
        eventBus.emit("session:event", event);
        wsManager.handleDrain(ws);
      }

      expect(ws.readyState).toBe(3); // CLOSED
      expect(wsManager.getConnectionCount()).toBe(0);

      const telemetry = wsManager.getTelemetrySnapshot();
      expect(telemetry.sendBackpressureSignals).toBe(WS_MAX_CONSECUTIVE_BACKPRESSURE);
      expect(telemetry.disconnectReasons.backpressure).toBe(1);
    });

    test("should queue outbound messages while backpressured and flush on drain", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:abc123:events",
      });

      ws.queueSendStatuses([-1, 64]);

      const eventA: ProviderEvent = {
        sessionId: "abc123",
        type: "SessionStart",
        timestamp: new Date(),
        payload: { cwd: "/test-a" },
      };
      const eventB: ProviderEvent = {
        sessionId: "abc123",
        type: "SessionStart",
        timestamp: new Date(),
        payload: { cwd: "/test-b" },
      };

      eventBus.emit("session:event", eventA);
      eventBus.emit("session:event", eventB);

      // First event hit backpressure. Second event should be queued, not sent yet.
      expect(ws.sentMessages).toHaveLength(1);

      wsManager.handleDrain(ws);

      expect(ws.sentMessages).toHaveLength(2);
      const telemetry = wsManager.getTelemetrySnapshot();
      expect(telemetry.sendBackpressureSignals).toBe(1);
      expect(telemetry.sendQueued).toBe(1);
      expect(telemetry.sendQueueFlushes).toBe(1);
    });

    test("should reset backpressure streak after drain even when queue is empty", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:abc123:events",
      });

      ws.queueSendStatuses(new Array(WS_MAX_CONSECUTIVE_BACKPRESSURE + 2).fill(-1));

      const event: ProviderEvent = {
        sessionId: "abc123",
        type: "SessionStart",
        timestamp: new Date(),
        payload: { cwd: "/test" },
      };

      for (let i = 0; i < WS_MAX_CONSECUTIVE_BACKPRESSURE + 1; i++) {
        eventBus.emit("session:event", event);
        expect(ws.readyState).toBe(1);
        wsManager.handleDrain(ws);
      }

      const telemetry = wsManager.getTelemetrySnapshot();
      expect(telemetry.disconnectReasons.backpressure).toBe(0);
    });

    test("should disconnect client when outbound queue overflows under backpressure", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:abc123:events",
      });

      ws.queueSendStatuses([-1]);

      const first: ProviderEvent = {
        sessionId: "abc123",
        type: "SessionStart",
        timestamp: new Date(),
        payload: { cwd: "/first" },
      };
      eventBus.emit("session:event", first);

      for (let i = 0; i < WS_MAX_PENDING_OUTBOUND_MESSAGES + 1; i++) {
        const event: ProviderEvent = {
          sessionId: "abc123",
          type: "SessionStart",
          timestamp: new Date(),
          payload: { i },
        };
        eventBus.emit("session:event", event);
      }

      expect(ws.readyState).toBe(3); // CLOSED
      expect(wsManager.getConnectionCount()).toBe(0);

      const telemetry = wsManager.getTelemetrySnapshot();
      expect(telemetry.sendQueueOverflows).toBeGreaterThan(0);
      expect(telemetry.disconnectReasons.backpressure).toBe(1);
    });

    test("should disconnect client when message is dropped", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:abc123:events",
      });

      ws.queueSendStatuses([0]); // dropped

      const event: ProviderEvent = {
        sessionId: "abc123",
        type: "SessionStart",
        timestamp: new Date(),
        payload: { cwd: "/test" },
      };

      eventBus.emit("session:event", event);

      expect(ws.readyState).toBe(3); // CLOSED
      expect(wsManager.getConnectionCount()).toBe(0);

      const telemetry = wsManager.getTelemetrySnapshot();
      expect(telemetry.sendDrops).toBe(1);
      expect(telemetry.disconnectReasons.drop).toBe(1);
    });

    test("should expose PTY throughput telemetry counters", () => {
      wsManager.broadcastPtyData("abc123", "first");
      wsManager.broadcastPtyData("abc123", "second");

      const telemetry = wsManager.getTelemetrySnapshot();
      expect(telemetry.ptyFramesBroadcast).toBe(2);
      expect(telemetry.ptyBytesBroadcast).toBeGreaterThan(0);
    });

    test("should emit pty_patch frames when patch mode is enabled and patch is smaller", () => {
      const patchBus = new EventBus<WsBusEvents>();
      const patchManager = new WebSocketManager(patchBus, { enablePtyPatch: true });

      try {
        const ws = new MockWebSocket() as any;
        patchManager.handleConnection(ws);
        patchManager.handleMessage(ws, {
          op: "hello",
          version: WS_PROTOCOL_VERSION,
          supports: { ptyPatch: true },
        });
        patchManager.handleMessage(ws, {
          op: "subscribe",
          topic: "session:abc123:pty",
        });

        const firstFrame = `${"x".repeat(399)}a`;
        const secondFrame = `${"x".repeat(399)}b`;
        patchManager.broadcastPtyData("abc123", firstFrame);
        patchManager.broadcastPtyData("abc123", secondFrame);

        expect(ws.sentMessages).toHaveLength(3);
        const first = JSON.parse(ws.sentMessages[1]);
        const second = JSON.parse(ws.sentMessages[2]);
        expect(first.type).toBe("pty_output");
        expect(second.type).toBe("pty_patch");
        expect(second.baseSeq).toBe(1);
        expect(second.seq).toBe(2);

        const patched =
          first.data.slice(0, second.start) +
          second.data +
          first.data.slice(second.start + second.deleteCount);
        expect(patched).toBe(secondFrame);

        const telemetry = patchManager.getTelemetrySnapshot();
        expect(telemetry.ptyPatchFramesBroadcast).toBe(1);
      } finally {
        patchManager.shutdown();
      }
    });

    test("should fallback to pty_output when patch is not smaller", () => {
      const patchBus = new EventBus<WsBusEvents>();
      const patchManager = new WebSocketManager(patchBus, { enablePtyPatch: true });

      try {
        const ws = new MockWebSocket() as any;
        patchManager.handleConnection(ws);
        patchManager.handleMessage(ws, {
          op: "hello",
          version: WS_PROTOCOL_VERSION,
          supports: { ptyPatch: true },
        });
        patchManager.handleMessage(ws, {
          op: "subscribe",
          topic: "session:abc123:pty",
        });

        patchManager.broadcastPtyData("abc123", "abc");
        patchManager.broadcastPtyData("abc123", "xyz");

        expect(ws.sentMessages).toHaveLength(3);
        const second = JSON.parse(ws.sentMessages[2]);
        expect(second.type).toBe("pty_output");
      } finally {
        patchManager.shutdown();
      }
    });

    test("should send patch only to negotiated clients in mixed subscriptions", () => {
      const patchBus = new EventBus<WsBusEvents>();
      const patchManager = new WebSocketManager(patchBus, { enablePtyPatch: true });

      try {
        const wsPatch = new MockWebSocket() as any;
        const wsLegacy = new MockWebSocket() as any;
        patchManager.handleConnection(wsPatch);
        patchManager.handleConnection(wsLegacy);

        patchManager.handleMessage(wsPatch, {
          op: "hello",
          version: WS_PROTOCOL_VERSION,
          supports: { ptyPatch: true },
        });
        patchManager.handleMessage(wsPatch, {
          op: "subscribe",
          topic: "session:abc123:pty",
        });
        patchManager.handleMessage(wsLegacy, {
          op: "subscribe",
          topic: "session:abc123:pty",
        });

        const firstFrame = `${"x".repeat(399)}a`;
        const secondFrame = `${"x".repeat(399)}b`;
        patchManager.broadcastPtyData("abc123", firstFrame);
        patchManager.broadcastPtyData("abc123", secondFrame);

        const patchSecond = JSON.parse(wsPatch.sentMessages[2]);
        const legacySecond = JSON.parse(wsLegacy.sentMessages[1]);
        expect(patchSecond.type).toBe("pty_patch");
        expect(legacySecond.type).toBe("pty_output");
        expect(legacySecond.data).toBe(secondFrame);
      } finally {
        patchManager.shutdown();
      }
    });

    test("should replay full frames even when live patch mode is enabled", () => {
      const patchBus = new EventBus<WsBusEvents>();
      const patchManager = new WebSocketManager(patchBus, { enablePtyPatch: true });

      try {
        const wsLive = new MockWebSocket() as any;
        patchManager.handleConnection(wsLive);
        patchManager.handleMessage(wsLive, {
          op: "hello",
          version: WS_PROTOCOL_VERSION,
          supports: { ptyPatch: true },
        });
        patchManager.handleMessage(wsLive, {
          op: "subscribe",
          topic: "session:abc123:pty",
        });

        const firstFrame = `${"x".repeat(399)}a`;
        const secondFrame = `${"x".repeat(399)}b`;
        patchManager.broadcastPtyData("abc123", firstFrame);
        patchManager.broadcastPtyData("abc123", secondFrame);

        const wsReplay = new MockWebSocket() as any;
        patchManager.handleConnection(wsReplay);
        patchManager.handleMessage(wsReplay, {
          op: "subscribe",
          topic: "session:abc123:pty",
          sinceSeq: 1,
        });

        expect(wsReplay.sentMessages).toHaveLength(1);
        const replay = JSON.parse(wsReplay.sentMessages[0]);
        expect(replay.type).toBe("pty_output");
        expect(replay.seq).toBe(2);
        expect(replay.data).toBe(secondFrame);
      } finally {
        patchManager.shutdown();
      }
    });

    test("should emit binary PTY frames for negotiated binary clients", () => {
      const binaryBus = new EventBus<WsBusEvents>();
      const binaryManager = new WebSocketManager(binaryBus, { enablePtyBinary: true });

      try {
        const ws = new MockWebSocket() as any;
        binaryManager.handleConnection(ws);
        binaryManager.handleMessage(ws, {
          op: "hello",
          version: WS_PROTOCOL_VERSION,
          supports: { ptyBinary: true },
        });
        binaryManager.handleMessage(ws, {
          op: "subscribe",
          topic: "session:abc123:pty",
        });

        binaryManager.broadcastPtyData("abc123", "Hello binary\n");

        expect(ws.sentMessages).toHaveLength(1); // hello_ack
        expect(ws.sentBinaryMessages).toHaveLength(1);
        const decoded = decodeBinaryPtyFrame(ws.sentBinaryMessages[0]);
        expect(decoded).toBeTruthy();
        expect(decoded?.topic).toBe("session:abc123:pty");
        expect(decoded?.type).toBe("pty_output");
        expect(decoded?.seq).toBe(1);
        expect(decoded?.data).toBe("Hello binary\n");

        const telemetry = binaryManager.getTelemetrySnapshot();
        expect(telemetry.ptyBinaryFramesBroadcast).toBe(1);
      } finally {
        binaryManager.shutdown();
      }
    });

    test("should keep JSON PTY frames for non-negotiated clients when binary mode is enabled", () => {
      const binaryBus = new EventBus<WsBusEvents>();
      const binaryManager = new WebSocketManager(binaryBus, { enablePtyBinary: true });

      try {
        const wsBinary = new MockWebSocket() as any;
        const wsLegacy = new MockWebSocket() as any;
        binaryManager.handleConnection(wsBinary);
        binaryManager.handleConnection(wsLegacy);
        binaryManager.handleMessage(wsBinary, {
          op: "hello",
          version: WS_PROTOCOL_VERSION,
          supports: { ptyBinary: true },
        });
        binaryManager.handleMessage(wsBinary, {
          op: "subscribe",
          topic: "session:abc123:pty",
        });
        binaryManager.handleMessage(wsLegacy, {
          op: "subscribe",
          topic: "session:abc123:pty",
        });

        binaryManager.broadcastPtyData("abc123", "mixed-mode\n");

        expect(wsBinary.sentBinaryMessages).toHaveLength(1);
        expect(wsLegacy.sentBinaryMessages).toHaveLength(0);
        expect(wsLegacy.sentMessages).toHaveLength(1);
        const legacyPayload = JSON.parse(wsLegacy.sentMessages[0]);
        expect(legacyPayload.type).toBe("pty_output");
        expect(legacyPayload.data).toBe("mixed-mode\n");
      } finally {
        binaryManager.shutdown();
      }
    });

    test("should emit binary pty_patch when patch and binary are both negotiated", () => {
      const binaryBus = new EventBus<WsBusEvents>();
      const binaryManager = new WebSocketManager(binaryBus, {
        enablePtyPatch: true,
        enablePtyBinary: true,
      });

      try {
        const ws = new MockWebSocket() as any;
        binaryManager.handleConnection(ws);
        binaryManager.handleMessage(ws, {
          op: "hello",
          version: WS_PROTOCOL_VERSION,
          supports: { ptyPatch: true, ptyBinary: true },
        });
        binaryManager.handleMessage(ws, {
          op: "subscribe",
          topic: "session:abc123:pty",
        });

        const firstFrame = `${"x".repeat(399)}a`;
        const secondFrame = `${"x".repeat(399)}b`;
        binaryManager.broadcastPtyData("abc123", firstFrame);
        binaryManager.broadcastPtyData("abc123", secondFrame);

        expect(ws.sentBinaryMessages).toHaveLength(2);
        const first = decodeBinaryPtyFrame(ws.sentBinaryMessages[0]);
        const second = decodeBinaryPtyFrame(ws.sentBinaryMessages[1]);
        expect(first?.type).toBe("pty_output");
        expect(second?.type).toBe("pty_patch");
        expect(second?.seq).toBe(2);
        expect(second?.baseSeq).toBe(1);
      } finally {
        binaryManager.shutdown();
      }
    });

    test("should replay canonical full JSON frames even for negotiated binary clients", () => {
      const binaryBus = new EventBus<WsBusEvents>();
      const binaryManager = new WebSocketManager(binaryBus, { enablePtyBinary: true });

      try {
        const wsLive = new MockWebSocket() as any;
        binaryManager.handleConnection(wsLive);
        binaryManager.handleMessage(wsLive, {
          op: "hello",
          version: WS_PROTOCOL_VERSION,
          supports: { ptyBinary: true },
        });
        binaryManager.handleMessage(wsLive, {
          op: "subscribe",
          topic: "session:abc123:pty",
        });
        binaryManager.broadcastPtyData("abc123", "one");
        binaryManager.broadcastPtyData("abc123", "two");

        const wsReplay = new MockWebSocket() as any;
        binaryManager.handleConnection(wsReplay);
        binaryManager.handleMessage(wsReplay, {
          op: "hello",
          version: WS_PROTOCOL_VERSION,
          supports: { ptyBinary: true },
        });
        binaryManager.handleMessage(wsReplay, {
          op: "subscribe",
          topic: "session:abc123:pty",
          sinceSeq: 1,
        });

        expect(wsReplay.sentBinaryMessages).toHaveLength(0);
        expect(wsReplay.sentMessages).toHaveLength(2); // hello_ack + replay frame
        const replay = JSON.parse(wsReplay.sentMessages[1]);
        expect(replay.type).toBe("pty_output");
        expect(replay.seq).toBe(2);
        expect(replay.data).toBe("two");
      } finally {
        binaryManager.shutdown();
      }
    });
  });

  describe("Topic filtering", () => {
    test("should only send events matching session ID", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:abc123:events",
      });

      // Emit events for different sessions
      eventBus.emit("session:event", {
        sessionId: "abc123",
        type: "SessionStart",
        timestamp: new Date(),
        payload: {},
      });

      eventBus.emit("session:event", {
        sessionId: "def456",
        type: "SessionStart",
        timestamp: new Date(),
        payload: {},
      });

      eventBus.emit("session:event", {
        sessionId: "abc123",
        type: "Notification",
        timestamp: new Date(),
        payload: {},
      });

      // Should only receive 2 messages for abc123
      expect(ws.sentMessages).toHaveLength(2);
    });

    test("should filter by topic type (events vs pty)", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:abc123:events",
      });

      // Emit event (should receive)
      eventBus.emit("session:event", {
        sessionId: "abc123",
        type: "SessionStart",
        timestamp: new Date(),
        payload: {},
      });

      // Broadcast PTY data (should not receive)
      wsManager.broadcastPtyData("abc123", "test");

      // Should only receive 1 message (the event)
      expect(ws.sentMessages).toHaveLength(1);
      expect(JSON.parse(ws.sentMessages[0]).topic).toBe("session:abc123:events");
    });
  });

  describe("Cleanup and shutdown", () => {
    test("should clean up subscriptions on disconnect", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:abc123:events",
      });

      expect(wsManager.getSubscriptions(ws)).toHaveLength(1);

      wsManager.handleDisconnect(ws);

      expect(wsManager.getSubscriptions(ws)).toHaveLength(0);
    });

    test("should remove all connections on shutdown", () => {
      const ws1 = new MockWebSocket() as any;
      const ws2 = new MockWebSocket() as any;

      wsManager.handleConnection(ws1);
      wsManager.handleConnection(ws2);

      expect(wsManager.getConnectionCount()).toBe(2);

      wsManager.shutdown();

      expect(wsManager.getConnectionCount()).toBe(0);
    });

    test("should reset PTY sequence when cleared for a session", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:abc123:pty",
      });

      wsManager.broadcastPtyData("abc123", "first");
      wsManager.clearPtySequence("abc123");
      wsManager.broadcastPtyData("abc123", "second");

      const first = JSON.parse(ws.sentMessages[0]);
      const second = JSON.parse(ws.sentMessages[1]);
      expect(first.seq).toBe(1);
      expect(second.seq).toBe(1);
    });

    test("should clear PTY replay buffer when sequence is cleared", () => {
      wsManager.broadcastPtyData("abc123", "before-clear");
      wsManager.clearPtySequence("abc123");

      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);
      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:abc123:pty",
        sinceSeq: 0,
      });

      expect(ws.sentMessages).toHaveLength(0);
    });

    test("should not process events after shutdown", () => {
      const ws = new MockWebSocket() as any;
      wsManager.handleConnection(ws);

      wsManager.handleMessage(ws, {
        op: "subscribe",
        topic: "session:abc123:events",
      });

      wsManager.shutdown();

      // Emit event
      eventBus.emit("session:event", {
        sessionId: "abc123",
        type: "SessionStart",
        timestamp: new Date(),
        payload: {},
      });

      // Should not send message
      expect(ws.sentMessages).toHaveLength(0);
    });
  });
});

describe("parseWsMessage", () => {
  test("parses valid JSON object messages", () => {
    const parsed = parseWsMessage(JSON.stringify({ op: "subscribe", topic: "sessions" }));
    expect(parsed.op).toBe("subscribe");
    expect(parsed.topic).toBe("sessions");
  });

  test("rejects oversized messages", () => {
    const oversized = JSON.stringify({
      op: "subscribe",
      padding: "x".repeat(MAX_WS_MESSAGE_BYTES),
    });
    expect(() => parseWsMessage(oversized)).toThrow("WebSocket message too large");
  });

  test("rejects invalid JSON", () => {
    expect(() => parseWsMessage("{not-json")).toThrow("Invalid JSON message");
  });

  test("rejects non-object JSON", () => {
    expect(() => parseWsMessage('"hello"')).toThrow("expected JSON object");
  });
});
