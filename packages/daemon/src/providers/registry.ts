import { type KnownProviderId, type ProviderId, SUPPORTED_PROVIDERS } from "@codepiper/core";
import { generateOverlaySettings } from "@codepiper/provider-claude-code";
import { buildCodexCommand } from "./codexAppServerScaffold";
import type { ProviderDefinition } from "./types";

const PROVIDERS: Record<KnownProviderId, ProviderDefinition> = {
  "claude-code": {
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
    async prepareSession(args) {
      const settingsPath = await generateOverlaySettings({
        sessionId: args.sessionId,
        socketPath: args.socketPath,
        secret: args.secret,
        outputDir: args.runtimeDir,
        enableStatusline: false,
      });

      return {
        settingsPath,
        cleanupArtifacts: [
          `${args.sessionId}.json`,
          `${args.sessionId}.hook-forward.sh`,
          `${args.sessionId}.statusline-forward.sh`,
        ],
      };
    },
    buildCommand(args) {
      const command = ["claude"];
      if (args.providerResume) {
        command.push("--resume", args.providerResume.providerSessionId);
        if (args.providerResume.mode === "fork") {
          command.push("--fork-session");
        }
      } else {
        command.push("--session-id", args.sessionId);
      }
      if (args.dangerousMode) {
        command.push("--dangerously-skip-permissions");
      }
      if (args.settingsPath) {
        command.push("--settings", args.settingsPath);
      }
      command.push(...args.providerArgs);
      return command;
    },
  },
  codex: {
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
    buildCommand(args) {
      return buildCodexCommand(args);
    },
  },
};

export function listSupportedProviders(): KnownProviderId[] {
  return [...SUPPORTED_PROVIDERS];
}

export function isProviderId(value: string): value is KnownProviderId {
  return listSupportedProviders().includes(value as KnownProviderId);
}

export function getProviderDefinition(providerId: ProviderId): ProviderDefinition {
  const definition = PROVIDERS[providerId as KnownProviderId];
  if (!definition) {
    throw new Error(`Unsupported provider: ${providerId}`);
  }
  return definition;
}

export function listProviderDefinitions(): ProviderDefinition[] {
  return listSupportedProviders().map((providerId) => getProviderDefinition(providerId));
}
