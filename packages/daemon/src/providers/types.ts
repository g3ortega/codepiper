import type { ProviderId } from "@codepiper/core";

export type ProviderPolicyChannel = "native-hooks" | "input-preflight" | "none";
export type ProviderMetricsChannel = "transcript" | "pty" | "none";

export interface ProviderCapabilities {
  nativeHooks: boolean;
  supportsDangerousMode: boolean;
  supportsModelSwitch: boolean;
  supportsTranscriptTailing: boolean;
  supportsTmuxAdoption: boolean;
  policyChannel: ProviderPolicyChannel;
  metricsChannel: ProviderMetricsChannel;
}

export interface ProviderResumeCommandHints {
  /**
   * Command template for standard resume mode.
   * Use "{id}" placeholder for provider session id interpolation.
   */
  resume: string;
  /**
   * Optional command template for fork resume mode.
   */
  fork?: string;
  /**
   * Optional UI placeholder for provider session ids.
   */
  idPlaceholder?: string;
}

export interface ProviderLaunchHints {
  /**
   * Provider-native dangerous mode flags expected to be applied by daemon.
   */
  dangerousModeFlags: string[];
  /**
   * Optional resume/fork command preview templates for UI.
   */
  resumeCommands?: ProviderResumeCommandHints;
}

export interface ProviderPrepareSessionArgs {
  sessionId: string;
  runtimeDir: string;
  socketPath: string;
  secret: string;
}

export interface ProviderPrepareSessionResult {
  settingsPath?: string;
  cleanupArtifacts?: string[];
}

export type ProviderResumeMode = "resume" | "fork";

export interface ProviderResumeTarget {
  providerSessionId: string;
  mode?: ProviderResumeMode;
}

export interface ProviderBuildCommandArgs {
  sessionId: string;
  settingsPath?: string;
  providerArgs: string[];
  dangerousMode: boolean;
  providerResume?: ProviderResumeTarget;
  codexHostAccessProfileEnabled?: boolean;
  terminalFeatures?: {
    codexAppServerSpikeEnabled?: boolean;
  };
}

export interface ProviderDefinition {
  id: ProviderId;
  label: string;
  runtime: "tmux" | "pty";
  capabilities: ProviderCapabilities;
  launchHints?: ProviderLaunchHints;
  prepareSession?: (args: ProviderPrepareSessionArgs) => Promise<ProviderPrepareSessionResult>;
  buildCommand: (args: ProviderBuildCommandArgs) => string[];
}
