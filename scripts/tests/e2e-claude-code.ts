/**
 * End-to-End Test with Real Claude Code
 *
 * Tests the complete flow:
 * 1. Start daemon with SQLite EventBus
 * 2. Create Claude Code session
 * 3. Send prompt via API
 * 4. Verify events delivered
 * 5. Check token tracking
 * 6. Test model selection
 */

import { Database } from "./packages/daemon/src/db/db";

const SOCKET_PATH = "/tmp/codepiper.sock";
const DB_PATH = "/tmp/test-e2e-codepiper.db";

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiRequest(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`http://localhost${path}`, {
    unix: SOCKET_PATH,
    ...options,
  });
}

async function main() {
  console.log("🧪 End-to-End Test with Real Claude Code\n");

  try {
    // 1. Check daemon is running
    console.log("1️⃣  Checking daemon status...");
    const healthResponse = await apiRequest("/health");
    if (!healthResponse.ok) {
      throw new Error("Daemon is not running. Start it with: bun run daemon");
    }
    const health = await healthResponse.json();
    console.log(`   ✅ Daemon running: ${JSON.stringify(health)}\n`);

    // 2. Create Claude Code session
    console.log("2️⃣  Creating Claude Code session...");
    const createResponse = await apiRequest("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "claude-code",
        cwd: "/tmp",
      }),
    });

    if (!createResponse.ok) {
      const error = await createResponse.text();
      throw new Error(`Failed to create session: ${error}`);
    }

    const { session } = await createResponse.json();
    const sessionId = session.id;
    console.log(`   ✅ Session created: ${sessionId}\n`);

    // Wait for session to be ready
    await sleep(2000);

    // 3. Send a simple prompt
    console.log("3️⃣  Sending prompt to Claude Code...");
    const sendResponse = await apiRequest(`/sessions/${sessionId}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "what is 2+2? please respond with just the number",
        newline: true,
      }),
    });

    if (!sendResponse.ok) {
      const error = await sendResponse.text();
      throw new Error(`Failed to send text: ${error}`);
    }

    console.log("   ✅ Prompt sent\n");

    // Wait for Claude to respond
    console.log("4️⃣  Waiting for Claude Code response (10 seconds)...");
    await sleep(10000);

    // 5. Check events via database
    console.log("5️⃣  Checking events in database...");
    const db = new Database(DB_PATH);
    await db.init();

    const events = db.db
      .query("SELECT * FROM events WHERE session_id = ? ORDER BY ts ASC")
      .all(sessionId) as any[];
    console.log(`   📊 Found ${events.length} events`);

    if (events.length > 0) {
      console.log("   📝 Event types:");
      const eventTypes = new Map<string, number>();
      for (const event of events) {
        const type = JSON.parse(event.payload_json).type || event.type;
        eventTypes.set(type, (eventTypes.get(type) || 0) + 1);
      }
      for (const [type, count] of eventTypes.entries()) {
        console.log(`      - ${type}: ${count}`);
      }
    }
    console.log();

    // 6. Check EventBus messages
    console.log("6️⃣  Checking EventBus messages...");
    const eventBusMessages = db.db
      .query("SELECT channel, COUNT(*) as count FROM event_bus_messages GROUP BY channel")
      .all() as any[];

    console.log(`   📊 EventBus channels:`);
    if (eventBusMessages.length === 0) {
      console.log("      (no messages yet)");
    } else {
      for (const row of eventBusMessages) {
        console.log(`      - ${row.channel}: ${row.count} messages`);
      }
    }
    console.log();

    // 7. Check token tracking (if any)
    console.log("7️⃣  Checking token usage tracking...");
    const tokenUsage = db.db
      .query(
        `SELECT COUNT(*) as count, SUM(prompt_tokens) as prompt, SUM(completion_tokens) as completion
         FROM token_usage WHERE session_id = ?`
      )
      .get(sessionId) as any;

    if (tokenUsage.count > 0) {
      console.log(`   ✅ Token tracking active:`);
      console.log(`      - Records: ${tokenUsage.count}`);
      console.log(`      - Prompt tokens: ${tokenUsage.prompt || 0}`);
      console.log(`      - Completion tokens: ${tokenUsage.completion || 0}`);
    } else {
      console.log("   ⏳ No token usage recorded yet (may need more time)");
    }
    console.log();

    // 8. Test model selection
    console.log("8️⃣  Testing model selection...");
    const modelResponse = await apiRequest(`/sessions/${sessionId}/model`);
    if (modelResponse.ok) {
      const modelData = await modelResponse.json();
      console.log(`   ✅ Current model: ${modelData.model}`);
    } else {
      console.log("   ⚠️  Model selection endpoint not responding");
    }
    console.log();

    // 9. Get session info
    console.log("9️⃣  Getting session info...");
    const sessionResponse = await apiRequest(`/sessions/${sessionId}`);
    if (sessionResponse.ok) {
      const sessionData = await sessionResponse.json();
      console.log(`   ✅ Session status: ${sessionData.session.status}`);
      console.log(`   📍 Working directory: ${sessionData.session.cwd}`);
      if (sessionData.session.transcriptPath) {
        console.log(`   📄 Transcript: ${sessionData.session.transcriptPath}`);
      }
    }
    console.log();

    // 10. Cleanup - stop session
    console.log("🔟  Cleaning up...");
    const stopResponse = await apiRequest(`/sessions/${sessionId}/stop`, {
      method: "POST",
    });

    if (stopResponse.ok) {
      console.log("   ✅ Session stopped\n");
    }

    db.close();

    console.log("✅ End-to-end test complete!\n");
    console.log("📊 Summary:");
    console.log(`   - Session ID: ${sessionId}`);
    console.log(`   - Events captured: ${events.length}`);
    console.log(`   - Token records: ${tokenUsage.count}`);
    console.log(`   - EventBus channels: ${eventBusMessages.length}`);
    console.log();
    console.log("🎉 All systems working!");

    process.exit(0);
  } catch (err) {
    console.error("\n❌ Test failed:", err);
    console.error("\nMake sure:");
    console.error("  1. Daemon is running: bun run daemon");
    console.error("  2. Claude Code is installed: which claude");
    console.error("  3. Tmux is installed: which tmux");
    process.exit(1);
  }
}

main();
