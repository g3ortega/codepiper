import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

type WebSocketModule = typeof import("./websocket");

class MockWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  sentMessages: Array<string | Uint8Array> = [];
  url: string;

  // Keep constructor signature compatible with browser WebSocket.
  constructor(url: string) {
    this.url = url;
  }

  send(message: string | Uint8Array): number {
    this.sentMessages.push(message);
    return 1;
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }
}

describe("WebSocketManager input request lifecycle", () => {
  let WebSocketManager: WebSocketModule["WebSocketManager"];
  let originalWindow: unknown;
  let originalWebSocket: unknown;

  beforeAll(async () => {
    originalWindow = (globalThis as { window?: unknown }).window;
    originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;

    (globalThis as { window?: unknown }).window = {
      location: {
        protocol: "http:",
        host: "localhost:3000",
      },
    };
    (globalThis as { WebSocket?: unknown }).WebSocket = MockWebSocket;

    const mod = await import("./websocket");
    WebSocketManager = mod.WebSocketManager;
  });

  afterAll(() => {
    (globalThis as { window?: unknown }).window = originalWindow;
    (globalThis as { WebSocket?: unknown }).WebSocket = originalWebSocket;
  });

  beforeEach(() => {
    mock.restore();
  });

  function pendingRequestCount(manager: unknown): number {
    return (manager as unknown as { pendingInputRequests: Map<string, unknown> })
      .pendingInputRequests.size;
  }

  test("clears pending request on matched pty_input_ack", () => {
    const manager = new WebSocketManager("ws://localhost:3000/ws");
    const ws = new MockWebSocket("ws://localhost:3000/ws");
    (manager as unknown as { ws: unknown }).ws = ws;

    const fallback = mock(() => {});
    const sent = manager.sendPtyInput("session-1", "echo hi\n", { onDispatchError: fallback });
    expect(sent).toBe(true);
    expect(pendingRequestCount(manager)).toBe(1);

    const outbound = JSON.parse(String(ws.sentMessages[0])) as { requestId: string };
    (manager as unknown as { handleMessage: (message: unknown) => void }).handleMessage({
      op: "pty_input_ack",
      sessionId: "session-1",
      requestId: outbound.requestId,
    });

    expect(pendingRequestCount(manager)).toBe(0);
    expect(fallback).not.toHaveBeenCalled();
    const telemetry = manager.getTelemetrySnapshot();
    expect(telemetry.ptyInputAcksReceived).toBe(1);
    expect(telemetry.ptyInputAckUnmatched).toBe(0);
  });

  test("invokes fallback and clears pending request on matched pty_key_error", async () => {
    const manager = new WebSocketManager("ws://localhost:3000/ws");
    const ws = new MockWebSocket("ws://localhost:3000/ws");
    (manager as unknown as { ws: unknown }).ws = ws;

    const fallback = mock(async () => {});
    const sent = manager.sendPtyKey("session-2", "enter", { onDispatchError: fallback });
    expect(sent).toBe(true);

    const outbound = JSON.parse(String(ws.sentMessages[0])) as { requestId: string };
    (manager as unknown as { handleMessage: (message: unknown) => void }).handleMessage({
      op: "pty_key_error",
      sessionId: "session-2",
      requestId: outbound.requestId,
      error: "Failed to deliver PTY key input",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(pendingRequestCount(manager)).toBe(0);
    const telemetry = manager.getTelemetrySnapshot();
    expect(telemetry.ptyKeyErrorsReceived).toBe(1);
    expect(telemetry.ptyKeyFallbackTriggered).toBe(1);
  });

  test("matches compatibility error path without requestId using op+session", async () => {
    const manager = new WebSocketManager("ws://localhost:3000/ws");
    const ws = new MockWebSocket("ws://localhost:3000/ws");
    (manager as unknown as { ws: unknown }).ws = ws;

    const fallback = mock(async () => {});
    const sent = manager.sendPtyInput("session-compat", "echo compat\n", {
      onDispatchError: fallback,
    });
    expect(sent).toBe(true);
    expect(pendingRequestCount(manager)).toBe(1);

    (manager as unknown as { handleMessage: (message: unknown) => void }).handleMessage({
      op: "pty_input_error",
      sessionId: "session-compat",
      error: "Failed to deliver PTY input",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(pendingRequestCount(manager)).toBe(0);
  });

  test("increments unmatched ack telemetry for unknown request", () => {
    const manager = new WebSocketManager("ws://localhost:3000/ws");
    const ws = new MockWebSocket("ws://localhost:3000/ws");
    (manager as unknown as { ws: unknown }).ws = ws;

    (manager as unknown as { handleMessage: (message: unknown) => void }).handleMessage({
      op: "pty_input_ack",
      sessionId: "session-3",
      requestId: "unknown-request-id",
    });

    const telemetry = manager.getTelemetrySnapshot();
    expect(telemetry.ptyInputAcksReceived).toBe(1);
    expect(telemetry.ptyInputAckUnmatched).toBe(1);
  });

  test("streams pty_paste chunks and clears pending request on pty_paste_ack", async () => {
    const manager = new WebSocketManager("ws://localhost:3000/ws");
    const ws = new MockWebSocket("ws://localhost:3000/ws");
    (manager as unknown as { ws: unknown }).ws = ws;

    const fallback = mock(async () => {});
    const payload = "x".repeat(10_000);
    const sent = manager.sendPtyPaste("session-paste", payload, { onDispatchError: fallback });
    expect(sent).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ws.sentMessages.length).toBeGreaterThan(1);

    const first = JSON.parse(String(ws.sentMessages[0])) as {
      op: string;
      requestId: string;
      chunkIndex: number;
      chunkCount: number;
    };
    const last = JSON.parse(String(ws.sentMessages[ws.sentMessages.length - 1])) as {
      requestId: string;
      chunkIndex: number;
      chunkCount: number;
    };

    expect(first.op).toBe("pty_paste");
    expect(first.chunkIndex).toBe(0);
    expect(last.chunkIndex).toBe(last.chunkCount - 1);
    expect(first.requestId).toBe(last.requestId);

    (manager as unknown as { handleMessage: (message: unknown) => void }).handleMessage({
      op: "pty_paste_ack",
      sessionId: "session-paste",
      requestId: first.requestId,
    });

    expect(pendingRequestCount(manager)).toBe(0);
    expect(fallback).not.toHaveBeenCalled();
  });

  test("invokes fallback on pty_paste_error", async () => {
    const manager = new WebSocketManager("ws://localhost:3000/ws");
    const ws = new MockWebSocket("ws://localhost:3000/ws");
    (manager as unknown as { ws: unknown }).ws = ws;

    const fallback = mock(async () => {});
    const sent = manager.sendPtyPaste("session-paste-error", "hello world", {
      onDispatchError: fallback,
    });
    expect(sent).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 0));
    const outbound = JSON.parse(String(ws.sentMessages[0])) as { requestId: string };
    (manager as unknown as { handleMessage: (message: unknown) => void }).handleMessage({
      op: "pty_paste_error",
      sessionId: "session-paste-error",
      requestId: outbound.requestId,
      error: "Failed to deliver PTY paste input",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(pendingRequestCount(manager)).toBe(0);
  });

  test("disables pty_paste send when server does not negotiate support", () => {
    const manager = new WebSocketManager("ws://localhost:3000/ws");
    const ws = new MockWebSocket("ws://localhost:3000/ws");
    (
      manager as unknown as {
        ws: unknown;
        serverHelloAcknowledged: boolean;
        serverNegotiatedPtyPaste: boolean;
      }
    ).ws = ws;
    (
      manager as unknown as {
        ws: unknown;
        serverHelloAcknowledged: boolean;
        serverNegotiatedPtyPaste: boolean;
      }
    ).serverHelloAcknowledged = true;
    (
      manager as unknown as {
        ws: unknown;
        serverHelloAcknowledged: boolean;
        serverNegotiatedPtyPaste: boolean;
      }
    ).serverNegotiatedPtyPaste = false;

    const sent = manager.sendPtyPaste("session-unsupported", "hello");
    expect(sent).toBe(false);
    expect(ws.sentMessages).toHaveLength(0);
  });
});
