/**
 * Basic usage example for ClaudeCodeProvider
 *
 * This example demonstrates:
 * - Creating a provider instance
 * - Starting a session
 * - Sending text and key input
 * - Listening to events
 * - Stopping a session
 */

import { ClaudeCodeProvider } from "../src/index";

async function main() {
  // Create provider instance
  const provider = new ClaudeCodeProvider({
    socketPath: "/tmp/codepiper-example.sock",
    enableStatusline: false,
  });

  console.log("Provider created:", provider.id);

  // Register event listener
  provider.onEvent((event) => {
    console.log(
      `[${event.timestamp.toISOString()}] ${event.type}:`,
      event.type === "pty_output"
        ? `${(event.payload as any).data.substring(0, 50)}...`
        : event.payload
    );
  });

  // Start a session
  const sessionId = `demo-${Date.now()}`;
  console.log(`\nStarting session: ${sessionId}`);

  try {
    const handle = await provider.startSession({
      id: sessionId,
      cwd: process.cwd(),
      env: {
        ...process.env,
        // Example of adding custom env vars
        DEMO_MODE: "true",
      },
      args: ["--verbose"], // Optional Claude Code flags
    });

    console.log("Session started:", {
      id: handle.id,
      pid: handle.pid,
      status: handle.status,
      cwd: handle.cwd,
    });

    // Wait a bit for Claude Code to initialize
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Send a prompt
    console.log("\nSending prompt...");
    await provider.sendText(sessionId, "What is the CodePiper project?\n");

    // Wait for response
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Send key sequence (Ctrl+C to interrupt)
    console.log("\nSending Ctrl+C...");
    await provider.sendKeys(sessionId, ["ctrl+c"]);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Stop the session
    console.log("\nStopping session...");
    await provider.stopSession(sessionId);

    console.log("Session stopped successfully");
  } catch (error) {
    console.error("Error:", error);

    // Try to clean up
    try {
      await provider.stopSession(sessionId);
    } catch (_cleanupError) {
      // Ignore cleanup errors
    }
  }
}

// Run if executed directly
if (import.meta.main) {
  main().catch(console.error);
}
