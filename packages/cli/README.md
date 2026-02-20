# @codepiper/cli

Command-line interface for the CodePiper daemon.

## Installation

This package is part of the CodePiper monorepo and installed via the workspace.

## Usage

```bash
# Via package.json script
bun run cli <command> [options]

# Or directly
bun run packages/cli/src/main.ts <command> [options]
```

## Commands

### start

Start a new session with the specified provider.

```bash
codepiper start --provider claude-code --dir /path/to/repo
codepiper start --provider codex --dir /path/to/repo
codepiper start -p claude-code -d /repo -- --verbose
```

Options:
- `-p, --provider <provider>` - Provider to use (`claude-code`, `codex`)
- `-d, --dir <directory>` - Working directory (default: current directory)
- `-s, --socket <path>` - Daemon socket path (default: /tmp/codepiper.sock)
- `-b, --billing <mode>` - Billing mode (`subscription`, `api`)
- `--dangerous` - Bypass CodePiper policy checks for this session
- `--env-set <id>` - Apply encrypted environment set (repeatable)
- `--worktree` - Enable git worktree isolation
- `--create-branch <name>` - Create branch in worktree mode
- `--workspace <id>` - Use a named workspace
- `--validate` - Validate config before starting
- `-- [args...]` - Additional arguments to pass to the provider

### sessions

List all sessions managed by the daemon.

```bash
codepiper sessions
codepiper sessions --format json
codepiper sessions --provider claude-code --status RUNNING
```

Options:
- `-s, --socket <path>` - Daemon socket path
- `-f, --format <format>` - Output format (table, json)
- `-p, --provider <provider>` - Filter by provider
- `--status <status>` - Filter by status

### attach

Attach to a running session for interactive use or to follow output.

```bash
codepiper attach abc123def
codepiper attach abc123def --follow
# Direct tmux attach (local terminal)
tmux attach-session -t codepiper-abc123def
# Detach safely without stopping session (run from another terminal)
tmux detach-client -s codepiper-abc123def
```

Options:
- `-s, --socket <path>` - Daemon socket path
- `-f, --follow` - Follow mode (read-only, no input)

**Note:** Full interactive attach uses the WebSocket connection to stream terminal output.
**Tmux tip:** To leave a direct tmux attach without stopping the session, press `Ctrl+B` then `D` (do not use `exit`/`Ctrl+D` unless you want to stop it).

### send

Send text and/or an image to a session.

```bash
codepiper send abc123def "What is the capital of France?"
codepiper send abc123def "Analyze this" --image ./screenshot.png
codepiper send abc123def "partial text" --no-newline
```

Options:
- `-s, --socket <path>` - Daemon socket path
- `-n, --newline` - Append newline (default: true)
- `--no-newline` - Don't append newline
- `-i, --image <path-or-url>` - Attach local or remote image

### keys

Send key sequences to a session.

```bash
codepiper keys abc123def ctrl+c
codepiper keys abc123def enter
codepiper keys abc123def up up enter
```

Options:
- `-s, --socket <path>` - Daemon socket path

Supported keys:
- ctrl+c, ctrl+d, ctrl+r, enter, escape, tab, up, down, left, right

### slash

Execute a slash command in a session.

```bash
codepiper slash abc123def status
codepiper slash abc123def help
codepiper slash abc123def clear
```

Options:
- `-s, --socket <path>` - Daemon socket path

### policy

Manage policies and default behavior.

```bash
codepiper policy list
codepiper policy create --id p1 --name "Read only" --priority 10 --rules '[{"id":"r1","action":"allow","tool":["Read","Glob","Grep"]}]'
codepiper policy default ask
```

Options:
- `-s, --socket <path>` - Daemon socket path

### logs

View event logs for a session.

```bash
codepiper logs abc123def
codepiper logs abc123def --tail 50
codepiper logs abc123def --format json
```

Options:
- `-s, --socket <path>` - Daemon socket path
- `-f, --follow` - Follow mode (stream new events)
- `-n, --tail <count>` - Number of events to show (default: 100)
- `--since <event-id>` - Show events after this ID
- `--format <format>` - Output format (pretty, json)

**Note:** Follow mode streams new events via the WebSocket connection.

### stop / kill

Stop or force kill a session.

```bash
codepiper stop abc123def
codepiper kill abc123def
```

### resize

Resize a session terminal.

```bash
codepiper resize abc123def 120 40
```

### tail

Tail session output.

```bash
codepiper tail abc123def
codepiper tail abc123def --follow
```

### model

Get or switch the Claude Code model for a session.

```bash
codepiper model abc123def
codepiper model abc123def opus
```

### daemon

Start the CodePiper daemon.

```bash
codepiper daemon
codepiper daemon --web --port 3456
codepiper daemon --detach
```

### auth

Manage authentication.

```bash
codepiper auth status
codepiper auth reset-password
codepiper auth reset-mfa
```

### analytics

View analytics data.

```bash
codepiper analytics overview
codepiper analytics sessions
codepiper analytics costs
```

### workspace / env-set

Manage workspaces and encrypted environment sets.

```bash
codepiper workspace list
codepiper env-set list
```

### workflow

Manage and run workflows.

```bash
codepiper workflow list
codepiper workflow create workflow.yaml
codepiper workflow run <id>
```

### audit / policy-set

View policy audit log and manage policy sets.

```bash
codepiper audit <session-id>
codepiper policy-set list
```

### doctor

Run diagnostics to check the health of the CodePiper installation.

```bash
codepiper doctor
```

Checks:
- Tmux installation and version
- Claude Code installation and version
- Environment variables and billing mode status (ANTHROPIC_API_KEY handling)
- Daemon status

Options:
- `-s, --socket <path>` - Daemon socket path

## Development

### Running Tests

```bash
# All tests
bun test packages/cli/

# Specific command tests
bun test packages/cli/src/commands/start.test.ts
```

### Test Coverage

The CLI has comprehensive test coverage following TDD principles:

- 103 tests across 10 test files
- 180 expect() calls
- All commands have unit tests for:
  - Argument parsing
  - Request formatting
  - Response handling
  - Error scenarios

### Architecture

Each command follows a consistent structure:

1. **Parsing** - `parseXxxOptions(args)` - Validates and extracts arguments
2. **Execution** - `xxxCommand(options)` - Makes HTTP request to daemon
3. **Output** - Formats response for the user

All commands:
- Use `fetch()` with `unix` socket parameter
- Handle connection errors gracefully
- Support custom socket paths via `--socket` flag
- Provide helpful error messages

### Adding a New Command

1. Create test file: `packages/cli/src/commands/mycommand.test.ts`
2. Write tests for parsing and execution
3. Create implementation: `packages/cli/src/commands/mycommand.ts`
4. Export `runMycommandCommand` function
5. Add to `COMMANDS` in `main.ts`
6. Add help text to `printCommandHelp()`
7. Run tests and verify

## API

### fetch with Unix Sockets

All commands use Bun's fetch API with Unix socket support:

```typescript
const response = await fetch("http://localhost/sessions", {
  unix: "/tmp/codepiper.sock",
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
```

Key points:
- URL host is ignored when `unix` option is provided
- Socket path defaults to `/tmp/codepiper.sock`
- All endpoints support error responses with `{ error: string }`

### Error Handling

Commands follow this error handling pattern:

```typescript
try {
  const response = await fetch(...);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json();
} catch (error: any) {
  if (error.code === "ENOENT" || error.message?.includes("ENOENT")) {
    throw new Error(`Failed to connect to daemon at ${socket}. Is the daemon running?`);
  }
  throw error;
}
```

## License

Part of the CodePiper project.
