import type { ProviderCapabilities, ProviderInfo } from "../types/api";

export type SessionDetailTab = "terminal" | "git" | "policies" | "logs" | "events";

export const DEFAULT_SESSION_DETAIL_TABS: readonly SessionDetailTab[] = [
  "terminal",
  "git",
  "policies",
  "logs",
  "events",
] as const;

const CORE_SESSION_DETAIL_TABS: readonly SessionDetailTab[] = [
  "terminal",
  "git",
  "policies",
] as const;

const UNKNOWN_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  nativeHooks: false,
  supportsDangerousMode: false,
  supportsModelSwitch: false,
  supportsTranscriptTailing: false,
  supportsTmuxAdoption: false,
  policyChannel: "none",
  metricsChannel: "none",
};

export const FALLBACK_PROVIDER_OPTIONS: readonly ProviderInfo[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    runtime: "tmux",
    capabilities: {
      nativeHooks: true,
      supportsDangerousMode: true,
      supportsModelSwitch: true,
      supportsTranscriptTailing: true,
      supportsTmuxAdoption: true,
      policyChannel: "native-hooks",
      metricsChannel: "transcript",
    },
    launchHints: {
      dangerousModeFlags: ["--dangerously-skip-permissions"],
      resumeCommands: {
        resume: "claude --resume {id}",
        fork: "claude --resume {id} --fork-session",
        idPlaceholder: "claude session id",
      },
    },
  },
  {
    id: "codex",
    label: "Codex",
    runtime: "tmux",
    capabilities: {
      nativeHooks: false,
      supportsDangerousMode: true,
      supportsModelSwitch: false,
      supportsTranscriptTailing: false,
      supportsTmuxAdoption: true,
      policyChannel: "input-preflight",
      metricsChannel: "pty",
    },
    launchHints: {
      dangerousModeFlags: ["--dangerously-bypass-approvals-and-sandbox"],
      resumeCommands: {
        resume: "codex resume {id}",
        fork: "codex fork {id}",
        idPlaceholder: "019c7285-ba64-7462-bbfc-4227f3e24e88",
      },
    },
  },
] as const;

const FALLBACK_PROVIDER_MAP: Map<string, ProviderInfo> = new Map(
  FALLBACK_PROVIDER_OPTIONS.map((provider) => [provider.id, provider])
);

function formatProviderLabel(providerId: string): string {
  const clean = providerId.trim();
  if (clean.length === 0) {
    return "Provider";
  }
  return clean
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function getProviderInfo(
  providerId: string,
  providers?: readonly ProviderInfo[]
): ProviderInfo {
  const fromServer = providers?.find((provider) => provider.id === providerId);
  if (fromServer) {
    return fromServer;
  }

  const fallback = FALLBACK_PROVIDER_MAP.get(providerId);
  if (fallback) {
    return fallback;
  }

  return {
    id: providerId,
    label: formatProviderLabel(providerId),
    runtime: "tmux",
    capabilities: UNKNOWN_PROVIDER_CAPABILITIES,
  };
}

export function describeProvider(provider: ProviderInfo): string {
  if (provider.capabilities.nativeHooks) {
    return "Native hook integration, richer policy and transcript metrics.";
  }
  if (provider.capabilities.policyChannel === "input-preflight") {
    return "Tmux-first integration with preflight policy checks (no native hooks).";
  }
  return "Tmux session with limited policy and analytics integration.";
}

export function supportsSessionHistoryViews(capabilities: ProviderCapabilities): boolean {
  return capabilities.nativeHooks || capabilities.supportsTranscriptTailing;
}

export function getSessionDetailTabsByCapabilities(
  capabilities: ProviderCapabilities
): readonly SessionDetailTab[] {
  if (supportsSessionHistoryViews(capabilities)) {
    return DEFAULT_SESSION_DETAIL_TABS;
  }
  return CORE_SESSION_DETAIL_TABS;
}

export function getSessionDetailTabsForProvider(
  providerId: string,
  providers?: readonly ProviderInfo[]
): readonly SessionDetailTab[] {
  return getSessionDetailTabsByCapabilities(getProviderInfo(providerId, providers).capabilities);
}
