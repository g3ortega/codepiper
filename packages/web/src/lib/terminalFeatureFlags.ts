import type { DaemonTerminalFeaturesSettings } from "@/types/api";

export interface TerminalFeatureGateState {
  enabled: boolean;
  source: "default" | "env" | "local_override";
}

export interface TerminalFeatureFlags {
  sessionId: string;
  wsPtyPaste: TerminalFeatureGateState;
  latencyProbes: TerminalFeatureGateState;
  diagnosticsPanel: TerminalFeatureGateState;
}

type FeatureConfig = {
  enabledEnv: string | undefined;
  defaultEnabled: boolean;
  localStorageKey: string;
};

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["0", "false", "off", "no", "disable", "disabled"].includes(normalized)) {
    return false;
  }
  if (["1", "true", "on", "yes", "enable", "enabled"].includes(normalized)) {
    return true;
  }
  return fallback;
}

function parseLocalOverride(value: string | null): boolean | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "on", "yes", "enable", "enabled"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "off", "no", "disable", "disabled"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function getLocalOverride(storageKey: string): boolean | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    return parseLocalOverride(window.localStorage.getItem(storageKey));
  } catch {
    return undefined;
  }
}

function resolveFeatureState(config: FeatureConfig): TerminalFeatureGateState {
  const override = getLocalOverride(config.localStorageKey);
  if (override !== undefined) {
    return {
      enabled: override,
      source: "local_override",
    };
  }

  const source = config.enabledEnv === undefined ? "default" : "env";
  const envEnabled = parseBooleanEnv(config.enabledEnv, config.defaultEnabled);
  return {
    enabled: envEnabled,
    source,
  };
}

export function getTerminalFeatureFlags(
  sessionId: string,
  daemonTerminalFeatures?: DaemonTerminalFeaturesSettings
): TerminalFeatureFlags {
  const wsPtyPaste = resolveFeatureState({
    enabledEnv: import.meta.env.VITE_CODEPIPER_FEATURE_WS_PTY_PASTE,
    defaultEnabled: daemonTerminalFeatures?.wsPtyPasteEnabled ?? true,
    localStorageKey: "codepiper:feature:ws_pty_paste",
  });

  const latencyProbes = resolveFeatureState({
    enabledEnv: import.meta.env.VITE_CODEPIPER_FEATURE_TERMINAL_LATENCY_PROBES,
    defaultEnabled: daemonTerminalFeatures?.latencyProbesEnabled ?? true,
    localStorageKey: "codepiper:feature:terminal_latency_probes",
  });

  const diagnosticsPanel = resolveFeatureState({
    enabledEnv: import.meta.env.VITE_CODEPIPER_FEATURE_TERMINAL_DIAGNOSTICS,
    defaultEnabled: daemonTerminalFeatures?.diagnosticsPanelEnabled ?? false,
    localStorageKey: "codepiper:feature:terminal_diagnostics",
  });

  return {
    sessionId,
    wsPtyPaste,
    latencyProbes,
    diagnosticsPanel,
  };
}
