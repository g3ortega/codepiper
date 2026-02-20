/**
 * Test session database cleanup functionality
 */

import * as fs from "node:fs";
import { Database } from "./packages/daemon/src/db/db";

async function main() {
  console.log("🧹 Session Cleanup Test\n");

  const testDbPath = "/tmp/test-cleanup.db";

  // Remove existing test DB
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  const db = new Database(testDbPath);
  await db.init();

  // Create some test sessions with different ages
  const now = Date.now();
  const oneHourAgo = now - 1 * 60 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;

  // Session 1: Recent STOPPED (should NOT be cleaned up with 24h threshold)
  console.log("1️⃣  Creating recent STOPPED session (1 hour old)...");
  db.createSession({
    id: "session-1-hour",
    provider: "claude-code",
    cwd: "/tmp",
    status: "STOPPED",
    pid: 1001,
  });
  // Manually update timestamp to 1 hour ago
  db.db
    .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
    .run(oneHourAgo, "session-1-hour");

  // Session 2: Old STOPPED (should be cleaned up with 24h threshold)
  console.log("2️⃣  Creating old STOPPED session (3 days old)...");
  db.createSession({
    id: "session-3-days",
    provider: "claude-code",
    cwd: "/tmp",
    status: "STOPPED",
    pid: 1002,
  });
  db.db
    .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
    .run(threeDaysAgo, "session-3-days");

  // Session 3: Old CRASHED (should be cleaned up)
  console.log("3️⃣  Creating old CRASHED session (3 days old)...");
  db.createSession({
    id: "session-crashed",
    provider: "claude-code",
    cwd: "/tmp",
    status: "CRASHED",
    pid: 1003,
  });
  db.db
    .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
    .run(threeDaysAgo, "session-crashed");

  // Session 4: Old RUNNING (should NOT be cleaned up)
  console.log("4️⃣  Creating old RUNNING session (1 day old)...");
  db.createSession({
    id: "session-running",
    provider: "claude-code",
    cwd: "/tmp",
    status: "RUNNING",
    pid: 1004,
  });
  db.db
    .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
    .run(oneDayAgo, "session-running");

  // Check sessions before cleanup
  const beforeCleanup = db.listSessions();
  console.log(`\n📊 Before cleanup: ${beforeCleanup.length} sessions`);
  for (const session of beforeCleanup) {
    console.log(`   - ${session.id}: ${session.status}`);
  }

  // Run cleanup (24 hour threshold)
  console.log("\n🧹 Running cleanup (threshold: 24 hours)...");
  const cleaned = db.cleanupOldSessions(24 * 60 * 60 * 1000);
  console.log(`   Cleaned up: ${cleaned} session(s)`);

  // Check sessions after cleanup
  const afterCleanup = db.listSessions();
  console.log(`\n📊 After cleanup: ${afterCleanup.length} sessions`);
  for (const session of afterCleanup) {
    console.log(`   - ${session.id}: ${session.status}`);
  }

  // Verify results
  console.log("\n✅ Verification:");
  const hasRecentStopped = afterCleanup.some((s) => s.id === "session-1-hour");
  const hasOldStopped = afterCleanup.some((s) => s.id === "session-3-days");
  const hasOldCrashed = afterCleanup.some((s) => s.id === "session-crashed");
  const hasRunning = afterCleanup.some((s) => s.id === "session-running");

  console.log(`   Recent STOPPED (1h old): ${hasRecentStopped ? "✅ Kept" : "❌ Deleted"}`);
  console.log(`   Old STOPPED (3d old): ${hasOldStopped ? "❌ Kept" : "✅ Deleted"}`);
  console.log(`   Old CRASHED (3d old): ${hasOldCrashed ? "❌ Kept" : "✅ Deleted"}`);
  console.log(`   Old RUNNING (1d old): ${hasRunning ? "✅ Kept" : "❌ Deleted"}`);

  const allCorrect =
    hasRecentStopped && !hasOldStopped && !hasOldCrashed && hasRunning && cleaned === 2;

  if (allCorrect) {
    console.log("\n🎉 Session cleanup test passed!");
  } else {
    console.log("\n❌ Session cleanup test failed!");
    console.log(`   Expected 2 sessions cleaned, got ${cleaned}`);
    process.exit(1);
  }

  // Cleanup
  db.close();
  fs.unlinkSync(testDbPath);
}

main().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
