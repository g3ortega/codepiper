import { describe, expect, test } from "bun:test";
import { buildCodexCommand, resolveCodexAppServerSpikeState } from "./codexAppServerScaffold";

describe("codexAppServerScaffold", () => {
  test("is disabled by default", () => {
    const state = resolveCodexAppServerSpikeState({
      terminalFeatures: undefined,
    });

    expect(state.configured).toBe(false);
    expect(state.enrolled).toBe(false);
    expect(state.mode).toBe("tmux-cli-fallback");
  });

  test("enrolls when enabled", () => {
    const state = resolveCodexAppServerSpikeState({
      terminalFeatures: {
        codexAppServerSpikeEnabled: true,
      },
    });

    expect(state.configured).toBe(true);
    expect(state.enrolled).toBe(true);
  });

  test("does not enroll when disabled", () => {
    const state = resolveCodexAppServerSpikeState({
      terminalFeatures: {
        codexAppServerSpikeEnabled: false,
      },
    });

    expect(state.configured).toBe(false);
    expect(state.enrolled).toBe(false);
  });

  test("builds codex command with optional dangerous mode flag", () => {
    const safe = buildCodexCommand({
      sessionId: "s1",
      providerArgs: ["--model", "gpt-5"],
      dangerousMode: false,
    });
    const dangerous = buildCodexCommand({
      sessionId: "s1",
      providerArgs: ["--model", "gpt-5"],
      dangerousMode: true,
    });

    expect(safe).toEqual(["codex", "--model", "gpt-5"]);
    expect(dangerous).toEqual([
      "codex",
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      "gpt-5",
    ]);
  });

  test("builds codex command with host-access runtime profile", () => {
    const command = buildCodexCommand({
      sessionId: "s1",
      providerArgs: ["--model", "gpt-5"],
      dangerousMode: false,
      codexHostAccessProfileEnabled: true,
    });

    expect(command).toEqual([
      "codex",
      "--sandbox",
      "danger-full-access",
      "-a",
      "on-request",
      "--model",
      "gpt-5",
    ]);
  });

  test("builds codex resume command", () => {
    const resumed = buildCodexCommand({
      sessionId: "s1",
      providerArgs: ["--model", "gpt-5"],
      dangerousMode: false,
      codexHostAccessProfileEnabled: true,
      providerResume: {
        providerSessionId: "session-abc",
        mode: "resume",
      },
    });

    expect(resumed).toEqual([
      "codex",
      "--sandbox",
      "danger-full-access",
      "-a",
      "on-request",
      "resume",
      "--model",
      "gpt-5",
      "session-abc",
    ]);
  });

  test("builds codex fork command with dangerous mode", () => {
    const forked = buildCodexCommand({
      sessionId: "s1",
      providerArgs: ["--model", "gpt-5"],
      dangerousMode: true,
      codexHostAccessProfileEnabled: true,
      providerResume: {
        providerSessionId: "session-abc",
        mode: "fork",
      },
    });

    expect(forked).toEqual([
      "codex",
      "--dangerously-bypass-approvals-and-sandbox",
      "fork",
      "--model",
      "gpt-5",
      "session-abc",
    ]);
  });
});
