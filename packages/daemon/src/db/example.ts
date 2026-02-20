/**
 * Example usage of the Database class
 *
 * Run with: bun run packages/daemon/src/db/example.ts
 */

import { Database } from "./db";
import { MigrationManager, migration001, migration002 } from "./migrations";

async function main(): Promise<void> {
  console.log("Database Example\n");

  // Create an in-memory database
  const db = new Database(":memory:");
  await db.init();

  console.log("1. Creating sessions...");
  db.createSession({
    id: "session-1",
    provider: "claude-code",
    cwd: "/workspace/project-1",
    status: "RUNNING",
    pid: 12345,
    ptyRows: 30,
    ptyCols: 120,
    transcriptPath: "/tmp/transcript-1.jsonl",
    metadata: { model: "claude-3-5-sonnet" },
  });

  db.createSession({
    id: "session-2",
    provider: "claude-code",
    cwd: "/workspace/project-2",
    status: "STARTING",
  });

  console.log("2. Listing sessions...");
  const sessions = db.listSessions();
  console.log(`   Found ${sessions.length} sessions:`);
  sessions.forEach((s) => {
    console.log(`   - ${s.id} (${s.provider}): ${s.status}`);
  });

  console.log("\n3. Updating session status...");
  db.updateSession("session-2", { status: "RUNNING", pid: 67890 });
  const session2 = db.getSession("session-2");
  console.log(`   Session 2 status: ${session2?.status}, PID: ${session2?.pid}`);

  console.log("\n4. Inserting events...");
  db.insertEvent({
    sessionId: "session-1",
    source: "hook",
    type: "SessionStart",
    payload: {
      transcript_path: "/tmp/transcript-1.jsonl",
      model: "claude-3-5-sonnet",
    },
  });

  db.insertEvent({
    sessionId: "session-1",
    source: "hook",
    type: "Notification",
    payload: { type: "idle_prompt" },
  });

  db.insertEvent({
    sessionId: "session-1",
    source: "transcript",
    type: "UserPrompt",
    payload: { text: "Hello, Claude!" },
  });

  console.log("5. Querying events...");
  const events = db.getEventsBySessionId("session-1");
  console.log(`   Found ${events.length} events for session-1:`);
  events.forEach((e) => {
    console.log(`   - [${e.source}] ${e.type}`);
  });

  console.log("\n6. Filtering events by source...");
  const hookEvents = db.getEventsBySessionId("session-1", { source: "hook" });
  console.log(`   Found ${hookEvents.length} hook events`);

  console.log("\n7. Managing transcript offsets...");
  db.updateTranscriptOffset("session-1", "/tmp/transcript-1.jsonl", {
    byteOffset: 1024,
    lastLineHash: "abc123def456",
  });

  const offset = db.getTranscriptOffset("session-1", "/tmp/transcript-1.jsonl");
  console.log(`   Offset: ${offset.byteOffset} bytes, hash: ${offset.lastLineHash}`);

  console.log("\n8. Testing migrations...");
  const migrationManager = new MigrationManager(db.db);
  migrationManager.register(migration001);
  migrationManager.register(migration002);

  console.log(`   Current version: ${migrationManager.getCurrentVersion()}`);
  migrationManager.migrate();
  console.log(`   After migration: ${migrationManager.getCurrentVersion()}`);

  console.log("\n9. Filtering sessions...");
  const runningSessions = db.listSessions({ status: "RUNNING" });
  console.log(`   Running sessions: ${runningSessions.length}`);

  const claudeSessions = db.listSessions({ provider: "claude-code" });
  console.log(`   Claude Code sessions: ${claudeSessions.length}`);

  console.log("\n10. Cleanup...");
  db.deleteSession("session-2");
  const remainingSessions = db.listSessions();
  console.log(`   Remaining sessions: ${remainingSessions.length}`);

  db.close();
  console.log("\n✅ Database example completed successfully!");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
