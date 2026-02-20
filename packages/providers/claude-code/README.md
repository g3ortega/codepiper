# Claude Code Provider

Provider implementation for managing Claude Code sessions through CodePiper.

## Features

- **PTY-based session management**: Spawns Claude Code in a pseudo-terminal for full interactivity
- **Billing mode handling**: Conditionally handles ANTHROPIC_API_KEY based on billing mode (subscription scrubs for Max plan, api preserves for pay-per-token)
- **Hooks integration**: Generates per-session overlay settings that configure hooks to forward events to the CodePiper daemon
- **Key simulation**: Translates key names to terminal control sequences (enter, ctrl+c, arrows, etc.)
- **Event streaming**: Emits PTY output and exit events for monitoring and logging

## Usage

```typescript
import { ClaudeCodeProvider } from "@codepiper/provider-claude-code";

const provider = new ClaudeCodeProvider({
  socketPath: "/tmp/codepiper.sock",
  enableStatusline: false // optional
});

// Start a session
const handle = await provider.startSession({
  id: "my-session-123",
  cwd: "/path/to/workspace",
  env: process.env,
  args: ["--verbose"] // optional Claude Code flags
});

// Send text input
await provider.sendText("my-session-123", "Analyze this codebase\n");

// Send keys
await provider.sendKeys("my-session-123", ["ctrl+c", "enter"]);

// Listen for events
provider.onEvent((event) => {
  console.log("Event:", event.type, event.payload);
});

// Stop session
await provider.stopSession("my-session-123");
```

## Overlay Settings

The provider automatically generates a per-session settings overlay file that configures Claude Code hooks to forward events to the CodePiper daemon. The settings file:

- Configures all hook types: `SessionStart`, `Notification`, `PermissionRequest`, `Stop`
- Passes environment variables: `CODEPIPER_UNIX_SOCK`, `CODEPIPER_SESSION`, `CODEPIPER_SECRET`
- Uses `codepiper hook-forward` as the handler command
- Optionally configures statusline for session state tracking

## Billing Mode Handling

The provider conditionally handles `ANTHROPIC_API_KEY` based on the configured billing mode:

- **subscription** (default): Scrubs `ANTHROPIC_API_KEY` from the environment before spawning Claude Code, so sessions use Max plan billing.
- **api**: Preserves `ANTHROPIC_API_KEY` for pay-per-token billing, required for automated/agentic workflows per Anthropic ToS.

Users are responsible for choosing the correct billing mode. See LEGAL_NOTICE.md for full disclaimer.

## Key Sequences

Supported key names:
- **Basic**: `enter`, `tab`, `escape`, `space`, `backspace`, `delete`
- **Control**: `ctrl+a` through `ctrl+z`
- **Arrows**: `up`, `down`, `left`, `right`
- **Function**: `f1` through `f12`
- **Special**: `home`, `end`, `pageup`, `pagedown`, `insert`

## Testing

```bash
# Run all tests
bun test packages/providers/claude-code/src/

# Run specific test suite
bun test packages/providers/claude-code/src/provider.test.ts
bun test packages/providers/claude-code/src/overlaySettings.test.ts
```

## Architecture

```
ClaudeCodeProvider
├── startSession()
│   ├── Handle ANTHROPIC_API_KEY per billing mode
│   ├── Generate overlay settings
│   ├── Spawn PTY with claude command
│   └── Return SessionHandle
├── sendText()
│   └── Write to PTY
├── sendKeys()
│   ├── Translate key names to sequences
│   └── Write to PTY
├── stopSession()
│   └── Kill PTY process
└── onEvent()
    └── Register event callbacks
```

## Dependencies

- `@codepiper/core`: Core types and interfaces
- `@codepiper/daemon`: PTYProcess wrapper for Bun terminal API

## References

- [Claude Code Hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code Settings](https://code.claude.com/docs/en/settings)
- [Claude Code Interactive Mode](https://code.claude.com/docs/en/interactive-mode)
- [Using Claude Code with Max Plan](https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan)
