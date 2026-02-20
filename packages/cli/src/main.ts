#!/usr/bin/env bun

import { runAnalyticsCommand } from "./commands/analytics";
import { runAttachCommand } from "./commands/attach";
import { runAuditCommand } from "./commands/audit";
import { runAuthCommand } from "./commands/auth";
import { runDaemonCommand } from "./commands/daemon";
import { runDoctorCommand } from "./commands/doctor";
import { runEnvSetCommand } from "./commands/env-set";
import { runHookForwardCommand } from "./commands/hook-forward";
import { runKeysCommand } from "./commands/keys";
import { runKillCommand } from "./commands/kill";
import { runLogsCommand } from "./commands/logs";
import { runModelCommand } from "./commands/model";
import { runPolicyCommand } from "./commands/policy";
import { runPolicySetCommand } from "./commands/policy-set";
import { runProvidersCommand } from "./commands/providers";
import { runResizeCommand } from "./commands/resize";
import { runSendCommand } from "./commands/send";
import { runSessionsCommand } from "./commands/sessions";
import { runSlashCommand } from "./commands/slash";
import { runStartCommand } from "./commands/start";
import { runStopCommand } from "./commands/stop";
import { runTailCommand } from "./commands/tail";
import { runWorkflowCommand } from "./commands/workflow";
import { runWorkspaceCommand } from "./commands/workspace";

const COMMANDS = {
  auth: runAuthCommand,
  daemon: runDaemonCommand,
  start: runStartCommand,
  stop: runStopCommand,
  kill: runKillCommand,
  resize: runResizeCommand,
  sessions: runSessionsCommand,
  attach: runAttachCommand,
  send: runSendCommand,
  keys: runKeysCommand,
  slash: runSlashCommand,
  tail: runTailCommand,
  model: runModelCommand,
  providers: runProvidersCommand,
  policy: runPolicyCommand,
  "policy-set": runPolicySetCommand,
  audit: runAuditCommand,
  analytics: runAnalyticsCommand,
  workspace: runWorkspaceCommand,
  "env-set": runEnvSetCommand,
  logs: runLogsCommand,
  doctor: runDoctorCommand,
  workflow: runWorkflowCommand,
  "hook-forward": runHookForwardCommand,
} as const;

type CommandName = keyof typeof COMMANDS;

function printUsage(): void {
  console.log(`Usage: codepiper <command> [options]

Commands:
  auth          Manage authentication (status, reset-password, reset-mfa, sessions)
  daemon        Start/stop/status of the codepiper daemon
  start         Start a new session
  stop          Stop a session gracefully
  kill          Force kill a session
  resize        Resize a session terminal
  sessions      List all sessions
  attach        Attach to a session (interactive or follow mode)
  send          Send text to a session
  keys          Send key sequences to a session
  slash         Execute a slash command in a session
  tail          Tail session output log
  model         Get or switch model for a session (claude-code only)
  providers     List supported providers and capabilities
  policy        Manage permission policies (list, get, create, update, delete, toggle, default)
  policy-set    Manage policy sets (list, get, create, update, delete, add-policy, remove-policy)
  audit         View policy decision audit log
  analytics     View analytics (overview, sessions, tools, costs, activity)
  workspace     Manage workspaces (list, get, create, update, delete)
  env-set       Manage environment sets (list, get, create, update, delete)
  logs          View event logs for a session
  doctor        Run diagnostics and health checks
  workflow      Manage and execute workflows

Internal Commands (called by hooks, not for direct use):
  hook-forward    Forward hook events to daemon

Options:
  -h, --help  Show help for a command

Examples:
  codepiper daemon --detach                              # Start daemon in background
  codepiper daemon stop                                  # Stop daemon
  codepiper start --provider claude-code --dir /path     # Start session
  codepiper start --provider codex --dir /path           # Start Codex session
  codepiper stop <session-id>                            # Stop session
  codepiper sessions                                     # List sessions
  codepiper attach <session-id>                          # Attach to session
  codepiper policy list                                  # List all policies
  codepiper policy-set list                              # List policy sets
  codepiper analytics                                    # View analytics overview
  codepiper workspace list                               # List workspaces
  codepiper audit --session <id>                         # View audit log

For more information, visit: https://github.com/codepiper/codepiper
`);
}

function printCommandHelp(command: CommandName): void {
  const help: Record<CommandName, string> = {
    auth: `Usage: codepiper auth <subcommand> [options]

Manage authentication and security settings.

Subcommands:
  status          Show auth configuration status
  reset-password  Reset the dashboard password
  reset-mfa       Disable two-factor authentication
  sessions        List active login sessions
  revoke-all      Revoke all active sessions

Options:
  -s, --socket <path>   Daemon socket path (default: /tmp/codepiper.sock)

Examples:
  codepiper auth status
  codepiper auth reset-password
  codepiper auth reset-mfa
  codepiper auth sessions
  codepiper auth revoke-all`,

    daemon: `Usage: codepiper daemon [start|stop|status] [options]

Start, stop, or check status of the codepiper daemon.

Subcommands:
  start         Start the daemon (default if no subcommand)
  stop          Stop the running daemon
  status        Show daemon status

Options:
  -s, --socket <path>         Unix socket path (default: /tmp/codepiper.sock)
  --detach                    Start daemon in background
  --web                       Enable web dashboard
  --port <port>               HTTP port for web dashboard (default: 3000)
  --web-dir <directory>       Custom web assets directory

Examples:
  codepiper daemon                          # Start daemon (foreground)
  codepiper daemon --detach                 # Start daemon (background)
  codepiper daemon --detach --socket /tmp/codepiper-dev.sock
  codepiper daemon --detach --web           # Background + web dashboard
  codepiper daemon stop                     # Stop daemon
  codepiper daemon status                   # Check daemon status

Environment Variables:
  CODEPIPER_SOCKET       Unix socket path (default: /tmp/codepiper.sock)
  CODEPIPER_DB_PATH      SQLite database path (default: ~/.codepiper/codepiper.db)
  CODEPIPER_WS_PORT      WebSocket port (default: 9999)
  CODEPIPER_HTTP_PORT    HTTP port (default: 3000, overridden by --port)`,

    start: `Usage: codepiper start [options]

Start a new session with the specified provider.

Options:
  -p, --provider <provider>   Provider to use (claude-code, codex)
  -d, --dir <directory>       Working directory (default: current directory)
  -s, --socket <path>         Daemon socket path (default: /tmp/codepiper.sock)
  -b, --billing <mode>        Billing mode: subscription (default) or api
  --dangerous                 Bypass CodePiper policy checks for this session
  --env-set <id>              Environment set to apply (repeatable)
  --worktree                  Enable git worktree isolation
  --create-branch <name>      Create a new branch in worktree
  --workspace <id>            Workspace to use
  --validate                  Validate configuration before starting
  -- [args...]                Additional arguments to pass to the provider

Examples:
  codepiper start --provider claude-code
  codepiper start -p claude-code -d /path/to/repo
  codepiper start -p codex -d /path/to/repo
  codepiper start --provider claude-code --worktree --create-branch feature-x
  codepiper start --provider codex --dangerous
  codepiper start --provider claude-code --env-set prod-keys
  codepiper start --provider claude-code -- --verbose`,

    stop: `Usage: codepiper stop <session-id> [options]

Stop a session gracefully.

Options:
  -s, --socket <path>         Daemon socket path (default: /tmp/codepiper.sock)

Examples:
  codepiper stop abc123def`,

    kill: `Usage: codepiper kill <session-id> [options]

Force kill a session.

Options:
  -s, --socket <path>         Daemon socket path (default: /tmp/codepiper.sock)

Examples:
  codepiper kill abc123def`,

    resize: `Usage: codepiper resize <session-id> <cols> <rows> [options]

Resize a session terminal.

Options:
  -s, --socket <path>         Daemon socket path (default: /tmp/codepiper.sock)

Examples:
  codepiper resize abc123def 120 40`,

    sessions: `Usage: codepiper sessions [options]

List all sessions managed by the daemon.

Options:
  -s, --socket <path>         Daemon socket path (default: /tmp/codepiper.sock)
  -f, --format <format>       Output format (table, json) (default: table)
  -p, --provider <provider>   Filter by provider
  --status <status>           Filter by status

Examples:
  codepiper sessions
  codepiper sessions --format json
  codepiper sessions --provider claude-code --status RUNNING`,

    attach: `Usage: codepiper attach <session-id> [options]

Attach to a running session for interactive use or to follow output.

Options:
  -s, --socket <path>         Daemon socket path (default: /tmp/codepiper.sock)
  -f, --follow                Follow mode (read-only, no input)

Examples:
  codepiper attach abc123def
  codepiper attach abc123def --follow`,

    send: `Usage: codepiper send <session-id> [text] [options]

Send text and/or an image to a session.

Options:
  -s, --socket <path>         Daemon socket path (default: /tmp/codepiper.sock)
  -n, --newline               Append newline (default: true)
  --no-newline                Don't append newline
  -i, --image <path-or-url>   Attach an image (local file or URL)

Examples:
  codepiper send abc123def "What is the capital of France?"
  codepiper send abc123def "Analyze this" --image ./screenshot.png
  codepiper send abc123def --image ./chart.png
  codepiper send abc123def -i https://example.com/diagram.png "Explain this"
  codepiper send abc123def "partial text" --no-newline`,

    keys: `Usage: codepiper keys <session-id> <key...> [options]

Send key sequences to a session.

Options:
  -s, --socket <path>         Daemon socket path (default: /tmp/codepiper.sock)

Supported keys:
  ctrl+c, ctrl+d, ctrl+r, enter, escape, tab, up, down, left, right

Examples:
  codepiper keys abc123def ctrl+c
  codepiper keys abc123def enter
  codepiper keys abc123def up up enter`,

    slash: `Usage: codepiper slash <session-id> <command> [args...] [options]

Execute a slash command in a session.

Options:
  -s, --socket <path>         Daemon socket path (default: /tmp/codepiper.sock)

Examples:
  codepiper slash abc123def status
  codepiper slash abc123def help
  codepiper slash abc123def clear`,

    model: `Usage: codepiper model <session-id> [model] [options]

Get or switch model for a session (claude-code only).

Options:
  -s, --socket <path>         Daemon socket path (default: /tmp/codepiper.sock)

Available models:
  sonnet, opus, haiku, opusplan
  claude-sonnet-4-5, claude-opus-4-6, claude-haiku-4-5

Examples:
  codepiper model abc123def                   # Get current model
  codepiper model abc123def sonnet            # Switch to sonnet
  codepiper model abc123def claude-opus-4-6   # Switch to opus`,

    providers: `Usage: codepiper providers [options]

List provider capabilities reported by the daemon.

Options:
  -s, --socket <path>         Daemon socket path (default: /tmp/codepiper.sock)
  -f, --format <format>       Output format (table, json) (default: table)

Examples:
  codepiper providers
  codepiper providers --format json`,

    policy: `Usage: codepiper policy <subcommand> [options]

Manage permission policies.

Subcommands:
  list          List all policies
  get <id>      Show policy details
  create        Create a new policy
  update <id>   Update a policy
  delete <id>   Delete a policy
  toggle <id>   Toggle policy enabled/disabled

Options:
  --session <id>    Filter by or assign to session
  --name <name>     Policy name
  --rules <json>    Policy rules (JSON string)
  --priority <n>    Policy priority
  --enabled <bool>  Enable/disable

Examples:
  codepiper policy list
  codepiper policy list --session abc123def
  codepiper policy get 1
  codepiper policy create --name "Allow reads" --rules '[{"pattern":"Read","action":"allow"}]'
  codepiper policy toggle 1`,

    "policy-set": `Usage: codepiper policy-set <subcommand> [options]

Manage policy sets.

Subcommands:
  list                              List all policy sets
  get <id>                          Show policy set details with member policies
  create                            Create a new policy set
  update <id>                       Update a policy set
  delete <id>                       Delete a policy set
  add-policy <set-id> <policy-id>   Add a policy to the set
  remove-policy <set-id> <policy-id> Remove a policy from the set

Options:
  --name <name>          Set name
  --description <desc>   Set description
  --default              Mark as default (auto-applied to new sessions)

Examples:
  codepiper policy-set list
  codepiper policy-set create --name "Production" --default
  codepiper policy-set add-policy 1 5`,

    audit: `Usage: codepiper audit [options]

View policy decision audit log.

Options:
  --session <id>    Filter by session
  --limit <n>       Number of decisions to show (default: 50)
  -s, --socket <path>  Daemon socket path

Examples:
  codepiper audit
  codepiper audit --session abc123def
  codepiper audit --limit 100`,

    analytics: `Usage: codepiper analytics [subcommand] [options]

View analytics and usage statistics.

Subcommands:
  overview      Summary statistics (default)
  sessions      Session metrics
  tools         Tool usage breakdown
  costs         Token costs and billing
  activity      Activity timeline

Options:
  --days <n>        Time range in days (default: 7)
  -s, --socket <path>  Daemon socket path

Examples:
  codepiper analytics
  codepiper analytics costs --days 30
  codepiper analytics tools`,

    workspace: `Usage: codepiper workspace <subcommand> [options]

Manage workspaces.

Subcommands:
  list          List all workspaces
  get <id>      Show workspace details
  create        Create a new workspace
  update <id>   Update a workspace
  delete <id>   Delete a workspace

Options:
  --name <name>         Workspace name
  --path <path>         Workspace directory path
  --description <desc>  Workspace description

Examples:
  codepiper workspace list
  codepiper workspace create --name "Backend" --path /opt/repos/backend
  codepiper workspace get 1`,

    "env-set": `Usage: codepiper env-set <subcommand> [options]

Manage environment variable sets.

Subcommands:
  list          List all environment sets
  get <id>      Show env set details with variables
  create        Create a new env set
  update <id>   Update an env set
  delete <id>   Delete an env set

Options:
  --name <name>         Set name
  --description <desc>  Set description
  --var KEY=VALUE       Add a variable (repeatable)

Examples:
  codepiper env-set list
  codepiper env-set create --name "Production" --var API_KEY=xxx --var DB_HOST=prod-db
  codepiper env-set get 1`,

    tail: `Usage: codepiper tail <session-id> [options]

Tail the session output log file.

Options:
  -f, --follow                Follow mode (stream new output)
  -n, --lines <count>         Number of lines to show (default: 50)

Examples:
  codepiper tail abc123def
  codepiper tail abc123def --lines 100
  codepiper tail abc123def --follow`,

    logs: `Usage: codepiper logs <session-id> [options]

View event logs for a session.

Options:
  -s, --socket <path>         Daemon socket path (default: /tmp/codepiper.sock)
  -f, --follow                Follow mode (stream new events)
  -n, --tail <count>          Number of events to show (default: 100)
  --since <event-id>          Show events after this ID
  --format <format>           Output format (pretty, json) (default: pretty)

Examples:
  codepiper logs abc123def
  codepiper logs abc123def --tail 50
  codepiper logs abc123def --follow
  codepiper logs abc123def --format json`,

    doctor: `Usage: codepiper doctor [options]

Run diagnostics to check the health of the codepiper installation.

Checks:
  - Claude Code installation and version
  - Environment variables (ANTHROPIC_API_KEY warning)
  - Daemon status

Options:
  -s, --socket <path>         Daemon socket path (default: /tmp/codepiper.sock)

Examples:
  codepiper doctor`,

    workflow: `Usage: codepiper workflow <subcommand> [options]

Manage and execute workflows.

Subcommands:
  create      Create a workflow from a YAML or JSON file
  list        List all workflows
  show        Show a workflow definition
  run         Execute a workflow
  status      Get execution status
  cancel      Cancel a running execution
  logs        View execution logs

Examples:
  codepiper workflow create workflow.yaml
  codepiper workflow list
  codepiper workflow run <workflow-id>
  codepiper workflow status <execution-id>`,

    "hook-forward": `Usage: codepiper hook-forward

INTERNAL COMMAND - Not for direct use

This command is called by Claude Code hooks to forward events to the daemon.
It reads JSON from stdin, POSTs to the daemon's hooks endpoint, and handles
PermissionRequest responses.

Environment variables (set by daemon when spawning session):
  CODEPIPER_UNIX_SOCK    Path to daemon socket
  CODEPIPER_SESSION      Session ID for metadata
  CODEPIPER_SECRET       Authentication token

Exit codes:
  0   Success
  2   Block action (for PermissionRequest deny)
  1   Error`,
  };

  console.log(help[command]);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    printUsage();
    return;
  }

  const command = args[0] as CommandName;

  if (args[1] === "-h" || args[1] === "--help") {
    if (command in COMMANDS) {
      printCommandHelp(command);
    } else {
      printUsage();
    }
    return;
  }

  if (!(command in COMMANDS)) {
    console.error(`Error: Unknown command '${command}'`);
    console.error("Run 'codepiper --help' for usage information.");
    process.exit(1);
  }

  const commandArgs = args.slice(1);

  try {
    await COMMANDS[command](commandArgs);
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
