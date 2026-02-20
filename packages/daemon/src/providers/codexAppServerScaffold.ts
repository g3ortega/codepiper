import type { ProviderBuildCommandArgs } from "./types";

export interface CodexAppServerSpikeState {
  configured: boolean;
  enrolled: boolean;
  mode: "tmux-cli-fallback";
}

const CODEX_HOST_ACCESS_RUNTIME_ARGS = [
  "--sandbox",
  "danger-full-access",
  "-a",
  "on-request",
] as const;

export function resolveCodexAppServerSpikeState(
  args: Pick<ProviderBuildCommandArgs, "terminalFeatures">
): CodexAppServerSpikeState {
  const configured = args.terminalFeatures?.codexAppServerSpikeEnabled === true;
  const enrolled = configured;

  return {
    configured,
    enrolled,
    // Scaffold phase: enrollment metadata exists, runtime remains tmux CLI.
    // Intentionally boolean-only (no canary): CodePiper targets single-user deployments.
    mode: "tmux-cli-fallback",
  };
}

export function buildCodexCommand(args: ProviderBuildCommandArgs): string[] {
  const command = ["codex"];
  if (args.dangerousMode) {
    command.push("--dangerously-bypass-approvals-and-sandbox");
  } else if (args.codexHostAccessProfileEnabled) {
    command.push(...CODEX_HOST_ACCESS_RUNTIME_ARGS);
  }

  if (args.providerResume) {
    const mode = args.providerResume.mode === "fork" ? "fork" : "resume";
    command.push(mode);
    command.push(...args.providerArgs);
    command.push(args.providerResume.providerSessionId);
    return command;
  }

  command.push(...args.providerArgs);
  return command;
}
