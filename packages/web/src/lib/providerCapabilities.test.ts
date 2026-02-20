import { describe, expect, test } from "bun:test";
import type { ProviderInfo } from "../types/api";
import {
  DEFAULT_SESSION_DETAIL_TABS,
  FALLBACK_PROVIDER_OPTIONS,
  getProviderInfo,
  getSessionDetailTabsByCapabilities,
  getSessionDetailTabsForProvider,
  supportsSessionHistoryViews,
} from "./providerCapabilities";

describe("providerCapabilities", () => {
  test("uses fallback provider definitions when API metadata is unavailable", () => {
    const codex = getProviderInfo("codex");
    expect(codex.label).toBe("Codex");
    expect(codex.capabilities.nativeHooks).toBe(false);
    expect(codex.capabilities.policyChannel).toBe("input-preflight");
    expect(codex.launchHints?.dangerousModeFlags).toEqual([
      "--dangerously-bypass-approvals-and-sandbox",
    ]);
  });

  test("formats unknown providers and defaults to safe capabilities", () => {
    const unknown = getProviderInfo("new-provider");
    expect(unknown.id).toBe("new-provider");
    expect(unknown.label).toBe("New Provider");
    expect(unknown.capabilities.nativeHooks).toBe(false);
    expect(unknown.capabilities.supportsTranscriptTailing).toBe(false);
  });

  test("returns full session-detail tabs when hooks/transcript capabilities are available", () => {
    const claude = FALLBACK_PROVIDER_OPTIONS.find((provider) => provider.id === "claude-code");
    expect(claude).toBeDefined();
    if (!claude) {
      throw new Error("Expected claude-code fallback provider");
    }

    const tabs = getSessionDetailTabsByCapabilities(claude.capabilities);
    expect(tabs).toEqual(DEFAULT_SESSION_DETAIL_TABS);
  });

  test("hides logs/events tabs for providers without hooks/transcript channels", () => {
    const codex = FALLBACK_PROVIDER_OPTIONS.find((provider) => provider.id === "codex");
    expect(codex).toBeDefined();
    if (!codex) {
      throw new Error("Expected codex fallback provider");
    }

    const tabs = getSessionDetailTabsByCapabilities(codex.capabilities);
    expect(tabs).toEqual(["terminal", "git", "policies"]);
    expect(supportsSessionHistoryViews(codex.capabilities)).toBe(false);
  });

  test("prefers server-reported capabilities over fallback assumptions", () => {
    const providers: ProviderInfo[] = [
      {
        id: "codex",
        label: "Codex",
        runtime: "tmux",
        capabilities: {
          nativeHooks: true,
          supportsDangerousMode: true,
          supportsModelSwitch: false,
          supportsTranscriptTailing: false,
          supportsTmuxAdoption: true,
          policyChannel: "native-hooks",
          metricsChannel: "pty",
        },
      },
    ];

    const tabs = getSessionDetailTabsForProvider("codex", providers);
    expect(tabs).toEqual(DEFAULT_SESSION_DETAIL_TABS);
  });
});
