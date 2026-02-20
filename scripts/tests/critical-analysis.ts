/**
 * Critical Analysis Test - Find Real Issues
 *
 * This test explores edge cases, race conditions, error scenarios,
 * and potential bugs in the CodePiper system.
 */

import { Database } from "./packages/daemon/src/db/db";

const SOCKET_PATH = "/tmp/codepiper.sock";
const DB_PATH = "/tmp/test-critical-codepiper.db";

interface TestResult {
  name: string;
  status: "pass" | "fail" | "warning";
  message: string;
  details?: any;
}

const results: TestResult[] = [];

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiRequest(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`http://localhost${path}`, {
    unix: SOCKET_PATH,
    ...options,
  });
}

async function test(name: string, fn: () => Promise<void>) {
  console.log(`\n🧪 Testing: ${name}`);
  try {
    await fn();
    results.push({ name, status: "pass", message: "Passed" });
    console.log(`   ✅ PASS`);
  } catch (err: any) {
    results.push({
      name,
      status: "fail",
      message: err.message,
      details: err.stack,
    });
    console.log(`   ❌ FAIL: ${err.message}`);
  }
}

async function warn(name: string, message: string, details?: any) {
  results.push({ name, status: "warning", message, details });
  console.log(`   ⚠️  WARNING: ${message}`);
}

async function main() {
  console.log("🔍 Critical Analysis Test - Finding Real Issues\n");
  console.log("=".repeat(60));

  // 1. Test daemon availability
  await test("Daemon is running", async () => {
    const response = await apiRequest("/health");
    if (!response.ok) {
      throw new Error("Daemon not responding");
    }
  });

  // 2. Test rapid session creation (resource exhaustion)
  await test("Rapid session creation (10 sessions)", async () => {
    console.log("   Creating 10 sessions rapidly...");
    const sessionIds: string[] = [];

    for (let i = 0; i < 10; i++) {
      const response = await apiRequest("/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "claude-code",
          cwd: "/tmp",
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create session ${i + 1}: ${response.status}`);
      }

      const { session } = await response.json();
      sessionIds.push(session.id);
    }

    console.log(`   Created ${sessionIds.length} sessions`);

    // Check if all sessions are tracked
    const listResponse = await apiRequest("/sessions");
    const { sessions } = await listResponse.json();

    if (sessions.length < sessionIds.length) {
      await warn(
        "Session tracking",
        `Only ${sessions.length}/${sessionIds.length} sessions tracked`,
        { created: sessionIds.length, tracked: sessions.length }
      );
    }

    // Cleanup
    for (const id of sessionIds) {
      await apiRequest(`/sessions/${id}/stop`, { method: "POST" });
    }

    await sleep(1000); // Give time for cleanup
  });

  // 3. Test session that doesn't exist
  await test("Request non-existent session", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await apiRequest(`/sessions/${fakeId}`);

    if (response.status !== 404) {
      throw new Error(`Expected 404, got ${response.status}`);
    }
  });

  // 4. Test malformed requests
  await test("Malformed JSON request", async () => {
    const response = await apiRequest("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ invalid json",
    });

    if (response.status !== 400 && response.status !== 500) {
      await warn(
        "Malformed request handling",
        `Malformed JSON returned ${response.status} instead of 400`,
        { status: response.status }
      );
    }
  });

  // 5. Test missing required fields
  await test("Missing required fields", async () => {
    const response = await apiRequest("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "claude-code" }), // Missing cwd
    });

    if (response.ok) {
      await warn("Field validation", "Session created without required 'cwd' field", {
        response: await response.json(),
      });
    }
  });

  // 6. Test invalid provider
  await test("Invalid provider", async () => {
    const response = await apiRequest("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "invalid-provider-xyz",
        cwd: "/tmp",
      }),
    });

    if (response.ok) {
      throw new Error("Session created with invalid provider");
    }
  });

  // 7. Test EventBus under load
  await test("EventBus message delivery under load", async () => {
    const db = new Database(DB_PATH);
    await db.init();

    // Get initial message count
    const beforeCount = db.db
      .query("SELECT COUNT(*) as count FROM event_bus_messages")
      .get() as any;

    console.log(`   Initial messages: ${beforeCount.count}`);

    // Create a session and send multiple prompts rapidly
    const response = await apiRequest("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "claude-code",
        cwd: "/tmp",
      }),
    });

    const { session } = await response.json();
    await sleep(2000); // Wait for session to be ready

    // Send 5 prompts rapidly
    for (let i = 0; i < 5; i++) {
      await apiRequest(`/sessions/${session.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `test ${i}`,
          newline: true,
        }),
      });
    }

    await sleep(5000); // Wait for processing

    const afterCount = db.db.query("SELECT COUNT(*) as count FROM event_bus_messages").get() as any;

    console.log(`   After messages: ${afterCount.count}`);
    console.log(`   Messages added: ${afterCount.count - beforeCount.count}`);

    if (afterCount.count <= beforeCount.count) {
      await warn("EventBus message delivery", "No new messages in EventBus after sending prompts", {
        before: beforeCount.count,
        after: afterCount.count,
      });
    }

    // Cleanup
    await apiRequest(`/sessions/${session.id}/stop`, { method: "POST" });
    db.close();
  });

  // 8. Test database corruption recovery
  await test("Database query with corrupted data", async () => {
    const db = new Database(DB_PATH);
    await db.init();

    // Try to query events with invalid session ID
    const events = db.db
      .query("SELECT * FROM events WHERE session_id = ?")
      .all("invalid-uuid-format") as any[];

    // Should return empty array, not crash
    console.log(`   Query with invalid UUID returned ${events.length} events`);

    db.close();
  });

  // 9. Test session lifecycle
  await test("Session lifecycle (create → send → stop → verify cleanup)", async () => {
    const db = new Database(DB_PATH);
    await db.init();

    // Create session
    const createResponse = await apiRequest("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "claude-code",
        cwd: "/tmp",
      }),
    });

    const { session } = await createResponse.json();
    const sessionId = session.id;

    await sleep(2000);

    // Send message
    await apiRequest(`/sessions/${sessionId}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello", newline: true }),
    });

    await sleep(3000);

    // Check session exists
    const beforeStop = db.db
      .query("SELECT status FROM sessions WHERE id = ?")
      .get(sessionId) as any;

    console.log(`   Before stop: ${beforeStop?.status || "NOT FOUND"}`);

    // Stop session
    await apiRequest(`/sessions/${sessionId}/stop`, { method: "POST" });

    await sleep(2000);

    // Verify session status changed
    const afterStop = db.db.query("SELECT status FROM sessions WHERE id = ?").get(sessionId) as any;

    console.log(`   After stop: ${afterStop?.status || "NOT FOUND"}`);

    if (!afterStop) {
      await warn("Session cleanup", "Session removed from database after stop");
    } else if (afterStop.status === "RUNNING") {
      await warn("Session stop", "Session still in RUNNING state after stop");
    }

    // Check for zombie tmux sessions
    const { spawn } = Bun;
    const proc = spawn(["tmux", "list-sessions"], { stdout: "pipe", stderr: "pipe" });
    const output = await new Response(proc.stdout).text();

    if (output.includes(`codepiper-${sessionId}`)) {
      await warn("Tmux cleanup", `Tmux session still exists after stop: codepiper-${sessionId}`, {
        tmuxSessions: output.split("\n").length,
      });
    }

    db.close();
  });

  // 10. Test concurrent operations
  await test("Concurrent sends to same session", async () => {
    const createResponse = await apiRequest("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "claude-code",
        cwd: "/tmp",
      }),
    });

    const { session } = await createResponse.json();
    await sleep(2000);

    // Send 3 messages concurrently
    const sends = await Promise.allSettled([
      apiRequest(`/sessions/${session.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "concurrent 1", newline: true }),
      }),
      apiRequest(`/sessions/${session.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "concurrent 2", newline: true }),
      }),
      apiRequest(`/sessions/${session.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "concurrent 3", newline: true }),
      }),
    ]);

    const failed = sends.filter((s) => s.status === "rejected");
    if (failed.length > 0) {
      await warn("Concurrent sends", `${failed.length}/3 concurrent sends failed`, {
        failures: failed,
      });
    }

    // Cleanup
    await apiRequest(`/sessions/${session.id}/stop`, { method: "POST" });
  });

  // 11. Test EventBus consumer tracking
  await test("EventBus consumer tracking consistency", async () => {
    const db = new Database(DB_PATH);
    await db.init();

    const consumers = db.db.query("SELECT * FROM event_bus_consumers").all() as any[];

    console.log(`   Active consumers: ${consumers.length}`);

    for (const consumer of consumers) {
      console.log(
        `      ${consumer.consumer_group}/${consumer.consumer_name} on ${consumer.channel}`
      );

      // Check if last_processed_id makes sense
      if (consumer.last_processed_id < 0) {
        await warn(
          "Consumer tracking",
          `Negative last_processed_id: ${consumer.last_processed_id}`,
          consumer
        );
      }
    }

    db.close();
  });

  // 12. Test memory leaks (EventBus message accumulation)
  await test("EventBus message accumulation (memory leak check)", async () => {
    const db = new Database(DB_PATH);
    await db.init();

    const totalMessages = db.db
      .query("SELECT COUNT(*) as count FROM event_bus_messages")
      .get() as any;

    console.log(`   Total EventBus messages: ${totalMessages.count}`);

    // Check per-channel limits
    const perChannel = db.db
      .query("SELECT channel, COUNT(*) as count FROM event_bus_messages GROUP BY channel")
      .all() as any[];

    for (const row of perChannel) {
      console.log(`      ${row.channel}: ${row.count} messages`);

      if (row.count > 10000) {
        await warn(
          "EventBus trimming",
          `Channel ${row.channel} has ${row.count} messages (should trim at 10k)`,
          row
        );
      }
    }

    db.close();
  });

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("\n📊 Test Results Summary:\n");

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const warnings = results.filter((r) => r.status === "warning").length;

  console.log(`✅ Passed:   ${passed}`);
  console.log(`❌ Failed:   ${failed}`);
  console.log(`⚠️  Warnings: ${warnings}`);
  console.log(`📋 Total:    ${results.length}\n`);

  if (failed > 0) {
    console.log("Failed Tests:");
    results
      .filter((r) => r.status === "fail")
      .forEach((r) => {
        console.log(`  ❌ ${r.name}: ${r.message}`);
      });
    console.log();
  }

  if (warnings > 0) {
    console.log("Warnings:");
    results
      .filter((r) => r.status === "warning")
      .forEach((r) => {
        console.log(`  ⚠️  ${r.name}: ${r.message}`);
      });
    console.log();
  }

  // Write detailed report
  const report = {
    timestamp: new Date().toISOString(),
    summary: { passed, failed, warnings, total: results.length },
    results,
  };

  await Bun.write("test-critical-analysis-report.json", JSON.stringify(report, null, 2));
  console.log("📄 Detailed report: test-critical-analysis-report.json\n");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌ Critical test error:", err);
  process.exit(1);
});
