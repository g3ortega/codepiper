/**
 * Stress Test - Push the system to its limits
 */

const SOCKET_PATH = "/tmp/codepiper.sock";

async function apiRequest(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`http://localhost${path}`, {
    unix: SOCKET_PATH,
    ...options,
  });
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("🔥 Stress Test - Pushing System to Limits\n");

  // Test 1: Rapid session creation and deletion
  console.log("1️⃣  Rapid session creation/deletion (20 iterations)...");
  const startTime = Date.now();
  for (let i = 0; i < 20; i++) {
    const response = await apiRequest("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "claude-code", cwd: "/tmp" }),
    });
    const { session } = await response.json();

    // Immediately stop without waiting
    await apiRequest(`/sessions/${session.id}/stop`, { method: "POST" });
  }
  const duration = Date.now() - startTime;
  console.log(`   ✅ Completed in ${duration}ms (avg: ${duration / 20}ms per cycle)\n`);

  // Test 2: Many sessions alive at once
  console.log("2️⃣  Creating 15 simultaneous sessions...");
  const sessionIds: string[] = [];
  for (let i = 0; i < 15; i++) {
    const response = await apiRequest("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "claude-code", cwd: "/tmp" }),
    });
    const { session } = await response.json();
    sessionIds.push(session.id);
  }
  console.log(`   Created: ${sessionIds.length} sessions`);

  // Check if all are tracked
  const listResponse = await apiRequest("/sessions");
  const { sessions } = await listResponse.json();
  console.log(`   Tracked: ${sessions.length} sessions`);

  // Cleanup
  for (const id of sessionIds) {
    await apiRequest(`/sessions/${id}/stop`, { method: "POST" });
  }
  console.log(`   ✅ Cleaned up\n`);

  // Test 3: Large number of rapid sends to same session
  console.log("3️⃣  Sending 50 messages rapidly to single session...");
  const response = await apiRequest("/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "claude-code", cwd: "/tmp" }),
  });
  const { session } = await response.json();
  await sleep(2000); // Let session initialize

  const sendStart = Date.now();
  const promises = [];
  for (let i = 0; i < 50; i++) {
    promises.push(
      apiRequest(`/sessions/${session.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `msg${i}`, newline: false }),
      })
    );
  }
  await Promise.all(promises);
  const sendDuration = Date.now() - sendStart;
  console.log(`   ✅ Sent 50 messages in ${sendDuration}ms (${sendDuration / 50}ms avg)\n`);

  await apiRequest(`/sessions/${session.id}/stop`, { method: "POST" });

  // Test 4: Invalid/malicious inputs
  console.log("4️⃣  Testing invalid inputs...");

  // Extremely long text
  const longText = "a".repeat(100000);
  const longResponse = await apiRequest("/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "claude-code", cwd: longText }),
  });
  console.log(`   Long cwd (100k chars): ${longResponse.status}`);

  // SQL injection attempt
  const sqlResponse = await apiRequest("/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "claude-code",
      cwd: "/tmp'; DROP TABLE sessions; --",
    }),
  });
  console.log(`   SQL injection attempt: ${sqlResponse.status}`);

  // Verify sessions table still exists
  const verifyResponse = await apiRequest("/sessions");
  console.log(`   Sessions table intact: ${verifyResponse.ok ? "✅ Yes" : "❌ No"}\n`);

  // Test 5: Check for zombie processes
  console.log("5️⃣  Checking for zombie tmux sessions...");
  const { spawn } = Bun;
  const proc = spawn(["tmux", "list-sessions"], { stdout: "pipe", stderr: "pipe" });
  const output = await new Response(proc.stdout).text();
  const tmuxSessions = output.split("\n").filter((line) => line.includes("codepiper-"));
  console.log(`   Found ${tmuxSessions.length} codepiper tmux sessions`);
  if (tmuxSessions.length > 0) {
    console.log("   ⚠️  Zombie sessions detected:");
    for (const s of tmuxSessions) {
      console.log(`      ${s.substring(0, 80)}`);
    }
  } else {
    console.log("   ✅ No zombie sessions\n");
  }

  console.log("\n🎉 Stress test complete!");
}

main().catch((err) => {
  console.error("❌ Stress test failed:", err);
  process.exit(1);
});
