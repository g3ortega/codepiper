/**
 * Integration tests for transcript tailing with SessionManager
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus } from "@codepiper/core";
import { Database } from "../db/db";
import type { PTYProcess } from "./ptyProcess";
import { SessionManager } from "./sessionManager";

// Mock PTY process for testing
class MockPTYProcess implements PTYProcess {
  pid = 12345;
  closed = false;

  write(_data: string): void {
    // No-op
  }

  async kill(_signal: string): Promise<void> {
    this.closed = true;
  }
}

describe("Transcript Tailing Integration", () => {
  let testDir: string;
  let db: Database;
  let eventBus: EventBus;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    // Create temp directory for test transcripts
    testDir = mkdtempSync(join(tmpdir(), "transcript-test-"));

    // Initialize database
    db = new Database(":memory:");
    await db.init();

    // Initialize event bus
    eventBus = new EventBus();

    // Initialize session manager
    sessionManager = new SessionManager(db, eventBus);
  });

  afterEach(async () => {
    // Cleanup
    await sessionManager.stopAll();
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should auto-start tailer when transcript_path is set", async () => {
    const sessionId = crypto.randomUUID();
    const transcriptPath = join(testDir, "transcript.jsonl");

    // Create session in database
    db.createSession({
      id: sessionId,
      provider: "claude-code",
      cwd: testDir,
      status: "STARTING",
    });

    // Register session in SessionManager
    sessionManager.registerSession(
      {
        id: sessionId,
        provider: "claude-code",
        cwd: testDir,
        status: "STARTING",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      new MockPTYProcess()
    );

    // Create empty transcript file
    writeFileSync(transcriptPath, "");

    // Set transcript path (should trigger tailer start)
    await sessionManager.setTranscriptPath(sessionId, transcriptPath, db, eventBus);

    // Verify tailer is running
    expect(sessionManager.hasActiveTailer(sessionId)).toBe(true);
  });

  it("should parse lines and store events in database", async () => {
    const sessionId = crypto.randomUUID();
    const transcriptPath = join(testDir, "transcript.jsonl");

    // Create session
    db.createSession({
      id: sessionId,
      provider: "claude-code",
      cwd: testDir,
      status: "RUNNING",
      transcriptPath,
    });

    sessionManager.registerSession(
      {
        id: sessionId,
        provider: "claude-code",
        cwd: testDir,
        status: "RUNNING",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      new MockPTYProcess()
    );

    // Create transcript with sample events
    const events = [
      { type: "user_message", content: "Hello" },
      { type: "assistant_message", content: "Hi there" },
    ];

    writeFileSync(transcriptPath, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);

    // Start tailer
    await sessionManager.setTranscriptPath(sessionId, transcriptPath, db, eventBus);

    // Wait for events to be processed
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify events were stored
    const storedEvents = db.getEventsBySessionId(sessionId, {
      source: "transcript",
    });

    expect(storedEvents.length).toBe(2);
    expect(storedEvents[0].type).toBe("user_message");
    expect(storedEvents[1].type).toBe("assistant_message");
  });

  it("should emit events on event bus", async () => {
    const sessionId = crypto.randomUUID();
    const transcriptPath = join(testDir, "transcript.jsonl");

    // Create session
    db.createSession({
      id: sessionId,
      provider: "claude-code",
      cwd: testDir,
      status: "RUNNING",
      transcriptPath,
    });

    sessionManager.registerSession(
      {
        id: sessionId,
        provider: "claude-code",
        cwd: testDir,
        status: "RUNNING",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      new MockPTYProcess()
    );

    // Setup event listener
    const receivedEvents: any[] = [];
    eventBus.on("session:event", (event) => {
      if (event.sessionId === sessionId) {
        receivedEvents.push(event);
      }
    });

    // Create transcript
    writeFileSync(transcriptPath, `${JSON.stringify({ type: "test_event" })}\n`);

    // Start tailer
    await sessionManager.setTranscriptPath(sessionId, transcriptPath, db, eventBus);

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify event was emitted
    expect(receivedEvents.length).toBeGreaterThan(0);
    expect(receivedEvents[0].type).toBe("test_event");
  });

  it("should stop tailer when session ends", async () => {
    const sessionId = crypto.randomUUID();
    const transcriptPath = join(testDir, "transcript.jsonl");

    // Create session
    db.createSession({
      id: sessionId,
      provider: "claude-code",
      cwd: testDir,
      status: "RUNNING",
      transcriptPath,
    });

    sessionManager.registerSession(
      {
        id: sessionId,
        provider: "claude-code",
        cwd: testDir,
        status: "RUNNING",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      new MockPTYProcess()
    );

    writeFileSync(transcriptPath, "");

    // Start tailer
    await sessionManager.setTranscriptPath(sessionId, transcriptPath, db, eventBus);
    expect(sessionManager.hasActiveTailer(sessionId)).toBe(true);

    // Stop tailer
    await sessionManager.stopTranscriptTailer(sessionId);

    // Verify tailer stopped
    expect(sessionManager.hasActiveTailer(sessionId)).toBe(false);
  });

  it("should handle multiple concurrent sessions with tailers", async () => {
    const sessions = [
      { id: crypto.randomUUID(), path: join(testDir, "transcript1.jsonl") },
      { id: crypto.randomUUID(), path: join(testDir, "transcript2.jsonl") },
      { id: crypto.randomUUID(), path: join(testDir, "transcript3.jsonl") },
    ];

    // Create sessions and transcripts
    for (const session of sessions) {
      db.createSession({
        id: session.id,
        provider: "claude-code",
        cwd: testDir,
        status: "RUNNING",
        transcriptPath: session.path,
      });

      sessionManager.registerSession(
        {
          id: session.id,
          provider: "claude-code",
          cwd: testDir,
          status: "RUNNING",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        new MockPTYProcess()
      );

      writeFileSync(session.path, `${JSON.stringify({ type: "event" })}\n`);
      await sessionManager.setTranscriptPath(session.id, session.path, db, eventBus);
    }

    // Verify all tailers are running
    for (const session of sessions) {
      expect(sessionManager.hasActiveTailer(session.id)).toBe(true);
    }

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify events for each session
    for (const session of sessions) {
      const events = db.getEventsBySessionId(session.id, { source: "transcript" });
      expect(events.length).toBeGreaterThan(0);
    }

    // Stop all tailers
    for (const session of sessions) {
      await sessionManager.stopTranscriptTailer(session.id);
    }
  });

  it("should resume from last offset after restart", async () => {
    const sessionId = crypto.randomUUID();
    const transcriptPath = join(testDir, "transcript.jsonl");

    // Create session
    db.createSession({
      id: sessionId,
      provider: "claude-code",
      cwd: testDir,
      status: "RUNNING",
      transcriptPath,
    });

    sessionManager.registerSession(
      {
        id: sessionId,
        provider: "claude-code",
        cwd: testDir,
        status: "RUNNING",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      new MockPTYProcess()
    );

    // Write initial events
    const initialEvents = [{ type: "event1" }, { type: "event2" }];
    writeFileSync(transcriptPath, `${initialEvents.map((e) => JSON.stringify(e)).join("\n")}\n`);

    // Start tailer
    await sessionManager.setTranscriptPath(sessionId, transcriptPath, db, eventBus);

    // Wait long enough for periodic save to trigger (1000ms interval + buffer)
    await new Promise((resolve) => setTimeout(resolve, 1200));

    // Get current offset (should be saved by periodic interval)
    let offset = db.getTranscriptOffset(sessionId, transcriptPath);

    // If not saved yet, stop tailer to force final save
    if (offset.byteOffset === 0) {
      await sessionManager.stopTranscriptTailer(sessionId);
      offset = db.getTranscriptOffset(sessionId, transcriptPath);
    }

    expect(offset.byteOffset).toBeGreaterThan(0);

    // Stop tailer (might be already stopped above)
    await sessionManager.stopTranscriptTailer(sessionId);

    // Append new events
    appendFileSync(transcriptPath, `${JSON.stringify({ type: "event3" })}\n`);

    // Restart tailer
    await sessionManager.setTranscriptPath(sessionId, transcriptPath, db, eventBus);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify only new event was processed
    const events = db.getEventsBySessionId(sessionId, { source: "transcript" });
    const eventTypes = events.map((e) => e.type);

    // Should have all 3 events
    expect(eventTypes).toContain("event1");
    expect(eventTypes).toContain("event2");
    expect(eventTypes).toContain("event3");

    // But event3 should only appear once (not duplicated)
    expect(events.filter((e) => e.type === "event3").length).toBe(1);
  });

  it("should handle transcript file not created yet (wait/retry)", async () => {
    const sessionId = crypto.randomUUID();
    const transcriptPath = join(testDir, "delayed-transcript.jsonl");

    // Create session
    db.createSession({
      id: sessionId,
      provider: "claude-code",
      cwd: testDir,
      status: "RUNNING",
      transcriptPath,
    });

    sessionManager.registerSession(
      {
        id: sessionId,
        provider: "claude-code",
        cwd: testDir,
        status: "RUNNING",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      new MockPTYProcess()
    );

    // Start tailer (file doesn't exist yet)
    await sessionManager.setTranscriptPath(sessionId, transcriptPath, db, eventBus);

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Create file now
    writeFileSync(transcriptPath, `${JSON.stringify({ type: "delayed_event" })}\n`);

    // Wait for file to be detected and processed
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Verify event was processed
    const events = db.getEventsBySessionId(sessionId, { source: "transcript" });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe("delayed_event");
  });
});
