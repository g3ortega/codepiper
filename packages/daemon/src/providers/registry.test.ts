import { describe, expect, test } from "bun:test";
import { getProviderDefinition, isProviderId, listSupportedProviders } from "./registry";

describe("provider registry command builders", () => {
  test("builds claude command with dangerous mode", () => {
    const claude = getProviderDefinition("claude-code");
    const command = claude.buildCommand({
      sessionId: "session-1",
      settingsPath: "/tmp/session-1.json",
      providerArgs: ["--model", "opus"],
      dangerousMode: true,
    });

    expect(command).toEqual([
      "claude",
      "--session-id",
      "session-1",
      "--dangerously-skip-permissions",
      "--settings",
      "/tmp/session-1.json",
      "--model",
      "opus",
    ]);
  });

  test("builds claude resume command", () => {
    const claude = getProviderDefinition("claude-code");
    const command = claude.buildCommand({
      sessionId: "session-1",
      settingsPath: "/tmp/session-1.json",
      providerArgs: ["--model", "sonnet"],
      dangerousMode: false,
      providerResume: {
        providerSessionId: "provider-session-9",
        mode: "resume",
      },
    });

    expect(command).toEqual([
      "claude",
      "--resume",
      "provider-session-9",
      "--settings",
      "/tmp/session-1.json",
      "--model",
      "sonnet",
    ]);
  });

  test("builds claude fork command", () => {
    const claude = getProviderDefinition("claude-code");
    const command = claude.buildCommand({
      sessionId: "session-1",
      settingsPath: undefined,
      providerArgs: [],
      dangerousMode: false,
      providerResume: {
        providerSessionId: "provider-session-9",
        mode: "fork",
      },
    });

    expect(command).toEqual(["claude", "--resume", "provider-session-9", "--fork-session"]);
  });

  test("lists supported providers and validates provider IDs", () => {
    expect(listSupportedProviders()).toEqual(["claude-code", "codex"]);
    expect(isProviderId("claude-code")).toBe(true);
    expect(isProviderId("codex")).toBe(true);
    expect(isProviderId("future-provider")).toBe(false);
  });

  test("throws a clear error for unsupported providers", () => {
    expect(() => getProviderDefinition("future-provider")).toThrow("Unsupported provider");
  });
});
