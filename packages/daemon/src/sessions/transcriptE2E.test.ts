/**
 * End-to-end tests for transcript tailing
 * Tests complete flow from session creation through transcript processing
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus } from "@codepiper/core";
import { Database } from "../db/db";
import type { PTYProcess } from "./ptyProcess";
import { SessionManager } from "./sessionManager";

// Mock PTY process
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

describe("Transcript Tailing E2E", () => {
  let testDir: string;
  let db: Database;
  let eventBus: EventBus;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    // Create temp directory
    testDir = mkdtempSync(join(tmpdir(), "transcript-e2e-"));

    // Initialize components
    db = new Database(":memory:");
    await db.init();

    eventBus = new EventBus();
    sessionManager = new SessionManager(db, eventBus);
  });

  afterEach(async () => {
    // Cleanup
    await sessionManager.stopAll();
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should handle full session lifecycle with transcript", async () => {
    const sessionId = crypto.randomUUID();
    const transcriptPath = join(testDir, "session.jsonl");

    // 1. Create session
    db.createSession({
      id: sessionId,
      provider: "claude-code",
      cwd: testDir,
      status: "STARTING",
    });

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

    // 2. Simulate SessionStart hook with transcript_path
    db.updateSession(sessionId, {
      status: "RUNNING",
      transcriptPath,
    });

    // Create initial transcript
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({ type: "session_start", model: "claude-3-5-sonnet" })}\n`
    );

    // Start tailer
    await sessionManager.setTranscriptPath(sessionId, transcriptPath, db, eventBus);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // 3. Send user message
    appendFileSync(
      transcriptPath,
      `${JSON.stringify({ type: "user_message", content: "What is 2+2?" })}\n`
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    // 4. Assistant response
    appendFileSync(
      transcriptPath,
      `${JSON.stringify({ type: "assistant_message", content: "2+2 equals 4" })}\n`
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    // 5. Tool call
    appendFileSync(
      transcriptPath,
      `${JSON.stringify({ type: "tool_use", name: "read_file", path: "/tmp/test.txt" })}\n`
    );

    await new Promise((resolve) => setTimeout(resolve, 100));

    // 6. Verify all events stored
    const events = db.getEventsBySessionId(sessionId, { source: "transcript" });

    expect(events.length).toBe(4);
    expect(events[0].type).toBe("session_start");
    expect(events[1].type).toBe("user_message");
    expect(events[2].type).toBe("assistant_message");
    expect(events[3].type).toBe("tool_use");

    // 7. Stop session
    await sessionManager.stopSession(sessionId);

    // Verify tailer stopped
    expect(sessionManager.hasActiveTailer(sessionId)).toBe(false);
  });

  it("should emit events on bus during session", async () => {
    const sessionId = crypto.randomUUID();
    const transcriptPath = join(testDir, "session.jsonl");

    const receivedEvents: any[] = [];
    eventBus.on("session:event", (event) => {
      if (event.sessionId === sessionId && event.source === "transcript") {
        receivedEvents.push(event);
      }
    });

    // Setup session
    db.createSession({
      id: sessionId,
      provider: "claude-code",
      cwd: testDir,
      status: "RUNNING",
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
    await sessionManager.setTranscriptPath(sessionId, transcriptPath, db, eventBus);

    // Append events
    const events = [
      { type: "event1", data: "test1" },
      { type: "event2", data: "test2" },
      { type: "event3", data: "test3" },
    ];

    for (const evt of events) {
      appendFileSync(transcriptPath, `${JSON.stringify(evt)}\n`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify all events emitted
    expect(receivedEvents.length).toBe(3);
    expect(receivedEvents[0].type).toBe("event1");
    expect(receivedEvents[1].type).toBe("event2");
    expect(receivedEvents[2].type).toBe("event3");
  });

  it("should handle session restart and resume", async () => {
    const sessionId = crypto.randomUUID();
    const transcriptPath = join(testDir, "session.jsonl");

    // First session run
    db.createSession({
      id: sessionId,
      provider: "claude-code",
      cwd: testDir,
      status: "RUNNING",
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

    writeFileSync(
      transcriptPath,
      `${JSON.stringify({ type: "event1" })}\n${JSON.stringify({ type: "event2" })}\n`
    );

    await sessionManager.setTranscriptPath(sessionId, transcriptPath, db, eventBus);
    await new Promise((resolve) => setTimeout(resolve, 1200)); // Wait for save

    // Stop session
    await sessionManager.stopTranscriptTailer(sessionId);

    // Simulate daemon restart
    const sessionManager2 = new SessionManager(db, eventBus);
    sessionManager2.registerSession(
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

    // Append new event
    appendFileSync(transcriptPath, `${JSON.stringify({ type: "event3" })}\n`);

    // Resume with existing offset
    await sessionManager2.setTranscriptPath(sessionId, transcriptPath, db, eventBus);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify no duplicate events
    const events = db.getEventsBySessionId(sessionId, { source: "transcript" });
    const eventTypes = events.map((e) => e.type);

    expect(eventTypes.filter((t) => t === "event1").length).toBe(1);
    expect(eventTypes.filter((t) => t === "event2").length).toBe(1);
    expect(eventTypes.filter((t) => t === "event3").length).toBe(1);

    await sessionManager2.stopAll();
  });

  it("should handle malformed JSON lines gracefully", async () => {
    const sessionId = crypto.randomUUID();
    const transcriptPath = join(testDir, "session.jsonl");

    db.createSession({
      id: sessionId,
      provider: "claude-code",
      cwd: testDir,
      status: "RUNNING",
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

    // Write mix of valid and invalid lines
    writeFileSync(
      transcriptPath,
      JSON.stringify({ type: "valid1" }) +
        "\n" +
        '{"incomplete":' +
        "\n" +
        JSON.stringify({ type: "valid2" }) +
        "\n"
    );

    await sessionManager.setTranscriptPath(sessionId, transcriptPath, db, eventBus);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should only store valid events
    const events = db.getEventsBySessionId(sessionId, { source: "transcript" });
    expect(events.length).toBe(2);
    expect(events[0].type).toBe("valid1");
    expect(events[1].type).toBe("valid2");
  });

  it("should handle rapid concurrent writes", async () => {
    const sessionId = crypto.randomUUID();
    const transcriptPath = join(testDir, "session.jsonl");

    db.createSession({
      id: sessionId,
      provider: "claude-code",
      cwd: testDir,
      status: "RUNNING",
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
    await sessionManager.setTranscriptPath(sessionId, transcriptPath, db, eventBus);

    // Write 50 events rapidly
    const eventCount = 50;
    for (let i = 0; i < eventCount; i++) {
      appendFileSync(transcriptPath, `${JSON.stringify({ type: "event", index: i })}\n`);
    }

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify all events captured
    const events = db.getEventsBySessionId(sessionId, { source: "transcript" });
    expect(events.length).toBe(eventCount);
  });
});
