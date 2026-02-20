/**
 * Crash recovery tests for transcript tailing
 * Verifies offset tracking prevents duplicates after crashes
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

describe("Transcript Crash Recovery", () => {
  let testDir: string;
  let db: Database;
  let eventBus: EventBus;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), "transcript-recovery-"));
    db = new Database(":memory:");
    await db.init();
    eventBus = new EventBus();
    sessionManager = new SessionManager(db, eventBus);
  });

  afterEach(async () => {
    await sessionManager.stopAll();
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should resume from last offset after crash", async () => {
    const sessionId = crypto.randomUUID();
    const transcriptPath = join(testDir, "transcript.jsonl");

    // Create session
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

    // Write initial events
    const events1 = [
      { type: "event1", seq: 1 },
      { type: "event2", seq: 2 },
      { type: "event3", seq: 3 },
    ];

    writeFileSync(transcriptPath, `${events1.map((e) => JSON.stringify(e)).join("\n")}\n`);

    // Start tailer
    await sessionManager.setTranscriptPath(sessionId, transcriptPath, db, eventBus);
    await new Promise((resolve) => setTimeout(resolve, 1200)); // Wait for periodic save

    // Verify events processed
    const storedEvents1 = db.getEventsBySessionId(sessionId, { source: "transcript" });
    expect(storedEvents1.length).toBe(3);

    // Simulate crash - abruptly stop without cleanup
    await sessionManager.stopTranscriptTailer(sessionId);

    // Append new events while "crashed"
    const events2 = [
      { type: "event4", seq: 4 },
      { type: "event5", seq: 5 },
    ];
    appendFileSync(transcriptPath, `${events2.map((e) => JSON.stringify(e)).join("\n")}\n`);

    // Simulate daemon restart - create new SessionManager
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

    // Resume from offset
    await sessionManager2.setTranscriptPath(sessionId, transcriptPath, db, eventBus);
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Verify no duplicates
    const allEvents = db.getEventsBySessionId(sessionId, { source: "transcript" });

    // Count occurrences of each event
    const eventCounts = new Map<string, number>();
    for (const evt of allEvents) {
      const count = eventCounts.get(evt.type) || 0;
      eventCounts.set(evt.type, count + 1);
    }

    // Each event should appear exactly once
    expect(eventCounts.get("event1")).toBe(1);
    expect(eventCounts.get("event2")).toBe(1);
    expect(eventCounts.get("event3")).toBe(1);
    expect(eventCounts.get("event4")).toBe(1);
    expect(eventCounts.get("event5")).toBe(1);

    await sessionManager2.stopAll();
  });

  it("should handle crash mid-parse", async () => {
    const sessionId = crypto.randomUUID();
    const transcriptPath = join(testDir, "transcript.jsonl");

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

    // Write events
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({ type: "event1" })}\n${JSON.stringify({ type: "event2" })}\n`
    );

    // Start tailer and let it process some events
    await sessionManager.setTranscriptPath(sessionId, transcriptPath, db, eventBus);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Crash (no save on purpose - simulate instant crash)
    const tailer = sessionManager.tailers.get(sessionId);
    if (tailer) {
      await tailer.stop();
      sessionManager.tailers.delete(sessionId);
    }

    // Clear save interval without triggering save
    const interval = sessionManager.saveOffsetIntervals.get(sessionId);
    if (interval) {
      clearInterval(interval);
      sessionManager.saveOffsetIntervals.delete(sessionId);
    }

    // Append more events
    appendFileSync(transcriptPath, `${JSON.stringify({ type: "event3" })}\n`);

    // Restart with potentially partial offset
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

    await sessionManager2.setTranscriptPath(sessionId, transcriptPath, db, eventBus);
    await new Promise((resolve) => setTimeout(resolve, 200));

    // All events should be present (might have duplicates due to crash mid-parse)
    const events = db.getEventsBySessionId(sessionId, { source: "transcript" });

    // Should have at least 3 events
    expect(events.length).toBeGreaterThanOrEqual(3);

    // Event 3 should definitely be there
    expect(events.some((e) => e.type === "event3")).toBe(true);

    await sessionManager2.stopAll();
  });

  it("should handle multiple crash/restart cycles", async () => {
    const sessionId = crypto.randomUUID();
    const transcriptPath = join(testDir, "transcript.jsonl");

    db.createSession({
      id: sessionId,
      provider: "claude-code",
      cwd: testDir,
      status: "RUNNING",
    });

    writeFileSync(transcriptPath, "");

    let currentEventNum = 1;

    // Simulate 3 crash/restart cycles (reduced from 5 for speed)
    for (let cycle = 0; cycle < 3; cycle++) {
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

      // Add events for this cycle
      for (let i = 0; i < 2; i++) {
        appendFileSync(
          transcriptPath,
          `${JSON.stringify({ type: `event${currentEventNum}`, cycle, seq: i })}\n`
        );
        currentEventNum++;
      }

      // Start tailer
      await sessionManager.setTranscriptPath(sessionId, transcriptPath, db, eventBus);
      await new Promise((resolve) => setTimeout(resolve, 1200)); // Wait for save

      // Stop cleanly
      await sessionManager.stopTranscriptTailer(sessionId);
    }

    // Verify all events captured exactly once
    const allEvents = db.getEventsBySessionId(sessionId, { source: "transcript" });
    expect(allEvents.length).toBe(6); // 3 cycles * 2 events each

    // Verify sequence integrity
    for (let i = 1; i <= 6; i++) {
      const eventType = `event${i}`;
      const matching = allEvents.filter((e) => e.type === eventType);
      expect(matching.length).toBe(1);
    }
  });

  it("should not miss events written during restart", async () => {
    const sessionId = crypto.randomUUID();
    const transcriptPath = join(testDir, "transcript.jsonl");

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

    // Initial events
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({ type: "event1" })}\n${JSON.stringify({ type: "event2" })}\n`
    );

    await sessionManager.setTranscriptPath(sessionId, transcriptPath, db, eventBus);
    await new Promise((resolve) => setTimeout(resolve, 1200));

    // Stop
    await sessionManager.stopTranscriptTailer(sessionId);

    // Write events during "downtime"
    for (let i = 3; i <= 6; i++) {
      appendFileSync(transcriptPath, `${JSON.stringify({ type: `event${i}` })}\n`);
    }

    // Restart with same sessionManager
    await sessionManager.setTranscriptPath(sessionId, transcriptPath, db, eventBus);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Verify all events present
    const events = db.getEventsBySessionId(sessionId, { source: "transcript" });
    expect(events.length).toBe(6);

    for (let i = 1; i <= 6; i++) {
      expect(events.some((e) => e.type === `event${i}`)).toBe(true);
    }
  });
});
