import { readErrorJson, readJson, responseErrorMessage } from "../lib/api";
import { getRequiredValue } from "../lib/args";
import { colors, table } from "../lib/format";

type OutputFormat = "table" | "json";

interface ProviderCapabilities {
  nativeHooks: boolean;
  supportsDangerousMode: boolean;
  supportsModelSwitch: boolean;
  supportsTranscriptTailing: boolean;
  supportsTmuxAdoption: boolean;
  policyChannel: "native-hooks" | "input-preflight" | "none";
  metricsChannel: "transcript" | "pty" | "none";
}

interface ProviderInfo {
  id: string;
  label: string;
  runtime: "tmux" | "pty";
  capabilities: ProviderCapabilities;
}

export interface ProvidersOptions {
  socket: string;
  format: OutputFormat;
}

const VALID_FORMATS: OutputFormat[] = ["table", "json"];

export function parseProvidersOptions(args: string[]): ProvidersOptions {
  let socket = "/tmp/codepiper.sock";
  let format: OutputFormat = "table";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--socket" || arg === "-s") {
      socket = getRequiredValue(args, i, arg);
      i++;
      continue;
    }

    if (arg === "--format" || arg === "-f") {
      const formatValue = getRequiredValue(args, i, arg);
      i++;
      if (!VALID_FORMATS.includes(formatValue as OutputFormat)) {
        throw new Error(
          `Invalid format: ${formatValue}. Valid options: ${VALID_FORMATS.join(", ")}`
        );
      }
      format = formatValue as OutputFormat;
    }
  }

  return { socket, format };
}

export async function listProviders(options: ProvidersOptions): Promise<ProviderInfo[]> {
  try {
    const response = await fetch("http://localhost/providers", {
      unix: options.socket,
      method: "GET",
    });

    if (!response.ok) {
      const errorData = await readErrorJson(response);
      throw new Error(responseErrorMessage(response, errorData));
    }

    const data = await readJson<{ providers?: ProviderInfo[] }>(response);
    return data.providers ?? [];
  } catch (error: any) {
    if (error.code === "ENOENT" || error.message?.includes("ENOENT")) {
      throw new Error(`Failed to connect to daemon at ${options.socket}. Is the daemon running?`);
    }
    throw error;
  }
}

function printProviderTable(providers: ProviderInfo[]): void {
  if (providers.length === 0) {
    console.log(`${colors.dim}No providers reported by daemon.${colors.reset}`);
    return;
  }

  const rows = providers.map((provider) => [
    provider.id,
    provider.runtime,
    provider.capabilities.nativeHooks ? "yes" : "no",
    provider.capabilities.policyChannel,
    provider.capabilities.metricsChannel,
    provider.capabilities.supportsModelSwitch ? "yes" : "no",
    provider.capabilities.supportsDangerousMode ? "yes" : "no",
  ]);

  console.log(`${colors.bold}Available Providers${colors.reset}\n`);
  console.log(table(["ID", "RUNTIME", "HOOKS", "POLICY", "METRICS", "MODEL", "DANGEROUS"], rows));
}

export async function runProvidersCommand(args: string[]): Promise<void> {
  const options = parseProvidersOptions(args);
  const providers = await listProviders(options);

  if (options.format === "json") {
    console.log(JSON.stringify(providers, null, 2));
    return;
  }

  printProviderTable(providers);
}
