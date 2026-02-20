/**
 * SessionManager WebSocket Integration Tests
 *
 * Tests PTY output broadcasting to WebSocket clients
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import { EventBus } from "@codepiper/core";
import type { WebSocketManager } from "../api/ws";
import { Database } from "../db/db";
import type { PTYProcess } from "./ptyProcess";
import { SessionManager } from "./sessionManager";

describe("SessionManager WebSocket Integration", () => {
  let db: Database;
  let eventBus: EventBus;
  let sessionManager: SessionManager;
  let mockWsManager: WebSocketManager;

  beforeEach(async () => {
    db = new Database(":memory:");
    await db.init();
    eventBus = new EventBus();
    sessionManager = new SessionManager(db, eventBus);

    // Create mock WebSocketManager
    mockWsManager = {
      broadcastPtyData: mock(() => {}),
      broadcastSessionChange: mock(() => {}),
      getConnectionCount: mock(() => 0),
      handleConnect: mock(() => {}),
      handleDisconnect: mock(() => {}),
      handleMessage: mock(() => {}),
      handleProviderEvent: mock(() => {}),
      shutdown: mock(() => {}),
    } as unknown as WebSocketManager;
  });

  it("should broadcast PTY data when WebSocketManager is set", async () => {
    // Given: WebSocketManager is wired to SessionManager
    sessionManager.setWebSocketManager(mockWsManager);

    const sessionId = "test-session-123";
    const ptyOutput = "Hello from PTY\n";

    // Create a mock PTY process
    const mockPty = {
      pid: 12345,
      closed: false,
      write: mock(() => {}),
      resize: mock(() => {}),
      kill: mock(() => Promise.resolve()),
      waitExit: mock(() => Promise.resolve({ exitCode: 0, signal: null })),
    } as unknown as PTYProcess;

    // Register a test session
    const session = {
      id: sessionId,
      provider: "claude-code" as const,
      cwd: "/tmp",
      status: "STARTING" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      pid: 12345,
    };

    sessionManager.registerSession(session, mockPty);

    // When: PTY data is received (simulate by calling private method via any cast)
    (sessionManager as any).handlePtyData(sessionId, ptyOutput);

    // Then: WebSocketManager.broadcastPtyData should be called
    expect(mockWsManager.broadcastPtyData).toHaveBeenCalledTimes(1);
    expect(mockWsManager.broadcastPtyData).toHaveBeenCalledWith(sessionId, ptyOutput);
  });

  it("should not broadcast PTY data when WebSocketManager is not set", async () => {
    // Given: No WebSocketManager wired (default state)
    const sessionId = "test-session-456";
    const ptyOutput = "Output without WS\n";

    const mockPty = {
      pid: 12346,
      closed: false,
      write: mock(() => {}),
      resize: mock(() => {}),
      kill: mock(() => Promise.resolve()),
      waitExit: mock(() => Promise.resolve({ exitCode: 0, signal: null })),
    } as unknown as PTYProcess;

    const session = {
      id: sessionId,
      provider: "claude-code" as const,
      cwd: "/tmp",
      status: "STARTING" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      pid: 12346,
    };

    sessionManager.registerSession(session, mockPty);

    // When: PTY data is received
    (sessionManager as any).handlePtyData(sessionId, ptyOutput);

    // Then: No error should occur (graceful degradation)
    // And broadcastPtyData should not have been called (since wsManager is undefined)
    expect(mockWsManager.broadcastPtyData).not.toHaveBeenCalled();
  });

  it("should update session status to RUNNING on first PTY output", async () => {
    // Given: WebSocketManager is wired
    sessionManager.setWebSocketManager(mockWsManager);

    const sessionId = "test-session-789";
    const ptyOutput = "First output\n";

    const mockPty = {
      pid: 12347,
      closed: false,
      write: mock(() => {}),
      resize: mock(() => {}),
      kill: mock(() => Promise.resolve()),
      waitExit: mock(() => Promise.resolve({ exitCode: 0, signal: null })),
    } as unknown as PTYProcess;

    const session = {
      id: sessionId,
      provider: "claude-code" as const,
      cwd: "/tmp",
      status: "STARTING" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      pid: 12347,
    };

    sessionManager.registerSession(session, mockPty);

    // When: First PTY data is received
    (sessionManager as any).handlePtyData(sessionId, ptyOutput);

    // Then: Session status should be updated to RUNNING
    const updatedSession = sessionManager.getSession(sessionId);
    expect(updatedSession?.status).toBe("RUNNING");

    // And PTY data should still be broadcast
    expect(mockWsManager.broadcastPtyData).toHaveBeenCalledWith(sessionId, ptyOutput);
  });

  it("should broadcast multiple PTY outputs in sequence", async () => {
    // Given: WebSocketManager is wired and session is RUNNING
    sessionManager.setWebSocketManager(mockWsManager);

    const sessionId = "test-session-999";
    const outputs = ["Output 1\n", "Output 2\n", "Output 3\n"];

    const mockPty = {
      pid: 12348,
      closed: false,
      write: mock(() => {}),
      resize: mock(() => {}),
      kill: mock(() => Promise.resolve()),
      waitExit: mock(() => Promise.resolve({ exitCode: 0, signal: null })),
    } as unknown as PTYProcess;

    const session = {
      id: sessionId,
      provider: "claude-code" as const,
      cwd: "/tmp",
      status: "RUNNING" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      pid: 12348,
    };

    sessionManager.registerSession(session, mockPty);

    // When: Multiple PTY outputs are received
    for (const output of outputs) {
      (sessionManager as any).handlePtyData(sessionId, output);
    }

    // Then: All outputs should be broadcast
    expect(mockWsManager.broadcastPtyData).toHaveBeenCalledTimes(outputs.length);

    for (let i = 0; i < outputs.length; i++) {
      expect(mockWsManager.broadcastPtyData).toHaveBeenNthCalledWith(i + 1, sessionId, outputs[i]);
    }
  });

  it("should allow setting WebSocketManager after SessionManager creation", () => {
    // Given: SessionManager created without WebSocketManager
    const newSessionManager = new SessionManager(db, eventBus);

    // When: WebSocketManager is set later
    newSessionManager.setWebSocketManager(mockWsManager);

    const sessionId = "test-session-late";
    const ptyOutput = "Late WS setup\n";

    const mockPty = {
      pid: 12349,
      closed: false,
      write: mock(() => {}),
      resize: mock(() => {}),
      kill: mock(() => Promise.resolve()),
      waitExit: mock(() => Promise.resolve({ exitCode: 0, signal: null })),
    } as unknown as PTYProcess;

    const session = {
      id: sessionId,
      provider: "claude-code" as const,
      cwd: "/tmp",
      status: "STARTING" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      pid: 12349,
    };

    newSessionManager.registerSession(session, mockPty);

    // Then: PTY output should still be broadcast
    (newSessionManager as any).handlePtyData(sessionId, ptyOutput);
    expect(mockWsManager.broadcastPtyData).toHaveBeenCalledWith(sessionId, ptyOutput);
  });
});
