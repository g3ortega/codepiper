import {
  type BillingMode,
  type ProviderId,
  type SessionHandle,
  SUPPORTED_PROVIDERS,
} from "@codepiper/core";
import { readErrorJson, readJson, responseErrorMessage } from "../lib/api";
import { getRequiredValue } from "../lib/args";

export interface StartOptions {
  provider: ProviderId;
  dir: string;
  socket: string;
  additionalArgs?: string[];
  billingMode?: BillingMode;
  dangerous?: boolean;
  envSetIds?: string[];
  worktree?: { enabled: boolean; branch?: string; createBranch?: boolean };
  workspaceId?: string;
  validate?: boolean;
}

export type ParsedStartOptions = StartOptions;

const PROVIDER_ALIASES: Record<string, ProviderId> = {
  claude: "claude-code",
  "claude-code": "claude-code",
  codex: "codex",
};

const VALID_PROVIDERS: ProviderId[] = [...SUPPORTED_PROVIDERS];

export function parseStartOptions(args: string[]): ParsedStartOptions {
  let provider: string | undefined;
  let dir: string = process.cwd();
  let socket: string = "/tmp/codepiper.sock";
  let billingMode: BillingMode | undefined;
  let dangerous = false;
  const envSetIds: string[] = [];
  let worktree: StartOptions["worktree"];
  let workspaceId: string | undefined;
  let validate = false;
  const additionalArgs: string[] = [];

  let inAdditionalArgs = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (inAdditionalArgs) {
      additionalArgs.push(arg);
      continue;
    }

    if (arg === "--") {
      inAdditionalArgs = true;
      continue;
    }

    if (arg === "--provider" || arg === "-p") {
      provider = getRequiredValue(args, i, arg);
      i++;
    } else if (arg === "--dir" || arg === "-d") {
      dir = getRequiredValue(args, i, arg);
      i++;
    } else if (arg === "--socket" || arg === "-s") {
      socket = getRequiredValue(args, i, arg);
      i++;
    } else if (arg === "--billing" || arg === "-b") {
      const mode = getRequiredValue(args, i, arg);
      i++;
      if (mode !== "subscription" && mode !== "api") {
        throw new Error(`Invalid billing mode: ${mode}. Must be "subscription" or "api"`);
      }
      billingMode = mode as BillingMode;
    } else if (arg === "--env-set") {
      envSetIds.push(getRequiredValue(args, i, arg));
      i++;
    } else if (arg === "--worktree") {
      worktree = { enabled: true, ...worktree };
    } else if (arg === "--create-branch") {
      const branch = getRequiredValue(args, i, arg);
      i++;
      worktree = { enabled: true, branch, createBranch: true };
    } else if (arg === "--workspace") {
      workspaceId = getRequiredValue(args, i, arg);
      i++;
    } else if (arg === "--validate") {
      validate = true;
    } else if (arg === "--dangerous") {
      dangerous = true;
    }
  }

  if (!provider) {
    throw new Error("--provider is required");
  }

  const resolvedProvider = PROVIDER_ALIASES[provider];
  if (!(resolvedProvider && VALID_PROVIDERS.includes(resolvedProvider))) {
    throw new Error(`Invalid provider: ${provider}. Valid options: ${VALID_PROVIDERS.join(", ")}`);
  }

  const parsed: ParsedStartOptions = {
    provider: resolvedProvider,
    dir,
    socket,
  };
  if (additionalArgs.length > 0) {
    parsed.additionalArgs = additionalArgs;
  }
  if (billingMode !== undefined) {
    parsed.billingMode = billingMode;
  }
  if (dangerous) {
    parsed.dangerous = true;
  }
  if (envSetIds.length > 0) {
    parsed.envSetIds = envSetIds;
  }
  if (worktree !== undefined) {
    parsed.worktree = worktree;
  }
  if (workspaceId !== undefined) {
    parsed.workspaceId = workspaceId;
  }
  if (validate) {
    parsed.validate = true;
  }

  return parsed;
}

export async function startSession(options: StartOptions): Promise<SessionHandle> {
  const payload: Record<string, unknown> = {
    provider: options.provider,
    cwd: options.dir,
    args: options.additionalArgs,
  };
  if (options.billingMode) payload.billingMode = options.billingMode;
  if (options.dangerous) payload.dangerousMode = true;
  if (options.envSetIds) payload.envSetIds = options.envSetIds;
  if (options.worktree) payload.worktree = options.worktree;
  if (options.workspaceId) payload.workspaceId = options.workspaceId;
  if (options.validate) payload.validate = options.validate;

  try {
    const response = await fetch("http://localhost/sessions", {
      unix: options.socket,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await readErrorJson(response);
      throw new Error(responseErrorMessage(response, errorData));
    }

    const data = await readJson<{ session: any }>(response);
    const session = data.session; // API returns { session: {...} }

    return {
      id: session.id,
      provider: session.provider,
      cwd: session.cwd,
      status: session.status,
      createdAt: new Date(session.createdAt),
      updatedAt: new Date(session.updatedAt),
      pid: session.pid,
      transcriptPath: session.transcriptPath,
      metadata: session.metadata,
    };
  } catch (error: any) {
    if (error.code === "ENOENT" || error.message?.includes("ENOENT")) {
      throw new Error(`Failed to connect to daemon at ${options.socket}. Is the daemon running?`);
    }
    throw error;
  }
}

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

export async function runStartCommand(args: string[]): Promise<void> {
  const options = parseStartOptions(args);

  console.log(
    `${colors.dim}Starting ${colors.cyan}${options.provider}${colors.dim} session in ${colors.reset}${options.dir}${colors.dim}...${colors.reset}`
  );
  if (options.dangerous) {
    console.log(
      `${colors.yellow}Warning:${colors.reset} dangerous mode enabled — CodePiper policy checks are bypassed for this session.`
    );
  }

  const session = await startSession(options);

  console.log(
    `\n${colors.green}✓${colors.reset} ${colors.bold}Session created successfully!${colors.reset}`
  );
  console.log(
    `  ${colors.dim}ID:${colors.reset}        ${colors.cyan}${session.id}${colors.reset}`
  );
  console.log(`  ${colors.dim}Provider:${colors.reset}  ${session.provider}`);
  console.log(`  ${colors.dim}Directory:${colors.reset} ${session.cwd}`);
  console.log(
    `  ${colors.dim}Status:${colors.reset}    ${colors.yellow}${session.status}${colors.reset}`
  );

  if (session.pid) {
    console.log(`  ${colors.dim}PID:${colors.reset}       ${session.pid}`);
  }

  // Show output log location
  console.log(
    `  ${colors.dim}Output:${colors.reset}    ${colors.gray}~/.codepiper/sessions/${session.id.slice(0, 8)}.../output.log${colors.reset}`
  );

  console.log(`\n${colors.bold}Next steps:${colors.reset}`);
  console.log(
    `  ${colors.cyan}codepiper attach ${session.id}${colors.reset}     ${colors.dim}# Attach to session${colors.reset}`
  );
  console.log(
    `  ${colors.cyan}codepiper send ${session.id.slice(0, 8)}... "prompt"${colors.reset}  ${colors.dim}# Send input${colors.reset}`
  );
  console.log(
    `  ${colors.cyan}codepiper logs ${session.id.slice(0, 8)}...${colors.reset}            ${colors.dim}# View events${colors.reset}`
  );
}
