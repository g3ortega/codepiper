import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { spawn } from "bun";

const CLI_PATH = path.join(import.meta.dir, "main.ts");

async function runCLI(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const proc = spawn(["bun", "run", CLI_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  await proc.exited;
  const exitCode = (await proc.exitCode) || 0;

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  return { stdout, stderr, exitCode };
}

describe("CLI entry point", () => {
  test("shows help when no arguments provided", async () => {
    const { stdout, exitCode } = await runCLI([]);

    expect(stdout).toContain("Usage: codepiper <command>");
    expect(stdout).toContain("Commands:");
    expect(exitCode).toBe(0);
  });

  test("shows help with --help flag", async () => {
    const { stdout, exitCode } = await runCLI(["--help"]);

    expect(stdout).toContain("Usage: codepiper <command>");
    expect(exitCode).toBe(0);
  });

  test("shows help with -h flag", async () => {
    const { stdout, exitCode } = await runCLI(["-h"]);

    expect(stdout).toContain("Usage: codepiper <command>");
    expect(exitCode).toBe(0);
  });

  test("shows command help", async () => {
    const { stdout, exitCode } = await runCLI(["start", "--help"]);

    expect(stdout).toContain("Usage: codepiper start");
    expect(stdout).toContain("--provider");
    expect(exitCode).toBe(0);
  });

  test("shows error for unknown command", async () => {
    const { stderr, exitCode } = await runCLI(["unknown"]);

    expect(stderr).toContain("Unknown command 'unknown'");
    expect(exitCode).toBe(1);
  });

  test("shows error when daemon not running", async () => {
    const { stderr, exitCode } = await runCLI([
      "start",
      "--provider",
      "claude-code",
      "--socket",
      "/tmp/nonexistent-codepiper-test.sock",
    ]);

    // Bun may throw different errors for socket connection failures
    expect(
      stderr.includes("Failed to connect to daemon") ||
        stderr.includes("Was there a typo in the url or port?") ||
        stderr.includes("ENOENT")
    ).toBe(true);
    expect(exitCode).toBe(1);
  });
});
