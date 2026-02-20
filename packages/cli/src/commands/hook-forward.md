# Hook Forward Command

## Overview

The `hook-forward` command is an internal command used by Claude Code hooks to forward hook events to the codepiper daemon. It is **not meant to be called directly by users**.

## Purpose

When the codepiper daemon spawns a Claude Code session, it configures Claude Code hooks to call `codepiper hook-forward` with hook event JSON on stdin. This command:

1. Reads the hook event JSON from stdin
2. Adds CodePiper metadata (session ID)
3. POSTs the event to the daemon's `/hooks/claude` endpoint
4. For `PermissionRequest` events, returns the daemon's decision to Claude Code

## Environment Variables

The daemon sets these environment variables when spawning sessions:

- `CODEPIPER_UNIX_SOCK`: Path to the daemon's Unix socket (e.g., `/tmp/codepiper.sock`)
- `CODEPIPER_SESSION`: The CodePiper session ID (UUID)
- `CODEPIPER_SECRET`: Authentication token for daemon communication

## Hook Event Types

The command handles all Claude Code hook events:

### SessionStart
- Fired when a Claude Code session starts
- Contains `session_id`, `transcript_path`, `cwd`, `model`, etc.
- No output to stdout (per Claude Code spec to avoid context injection)

### Notification
- Fired for various notifications (`idle_prompt`, `permission_prompt`, `auth_success`, etc.)
- Used to update session state in the daemon
- No output to stdout

### PermissionRequest
- Fired when Claude Code needs permission to run a tool
- **Special handling**: Outputs decision JSON to stdout for Claude Code to read
- Decision can be `allow` or `deny`
- Can include `updatedInput` or `updatedPermissions`

### Stop
- Fired when the agent finishes responding
- Used for orchestration timing
- No output to stdout

## Exit Codes

Following Claude Code hook spec:

- `0`: Success (or allow for PermissionRequest)
- `2`: Block action (for PermissionRequest deny)
- `1`: Error

## Example Hook Event Flow

### SessionStart Event

**Input (stdin):**
```json
{
  "event": "SessionStart",
  "session_id": "abc-123-def",
  "transcript_path": "/tmp/claude/transcript-abc-123.jsonl",
  "cwd": "/home/user/project",
  "permission_mode": "plan",
  "model": "claude-sonnet-4-5"
}
```

**Posted to daemon:**
```json
{
  "event": "SessionStart",
  "session_id": "abc-123-def",
  "transcript_path": "/tmp/claude/transcript-abc-123.jsonl",
  "cwd": "/home/user/project",
  "permission_mode": "plan",
  "model": "claude-sonnet-4-5",
  "codepiperSessionId": "codepiper-uuid-456"
}
```

**Output:** None

**Exit code:** 0

### PermissionRequest Event

**Input (stdin):**
```json
{
  "event": "PermissionRequest",
  "session_id": "abc-123-def",
  "tool_name": "Bash",
  "tool_input": {
    "command": "ls -la"
  },
  "transcript_path": "/tmp/claude/transcript-abc-123.jsonl"
}
```

**Daemon response (allow):**
```json
{
  "decision": "allow"
}
```

**Output (stdout):**
```json
{"decision":"allow"}
```

**Exit code:** 0

---

**Daemon response (deny):**
```json
{
  "decision": "deny",
  "denialMessage": "Dangerous command blocked"
}
```

**Output (stdout):**
```json
{"decision":"deny","denialMessage":"Dangerous command blocked"}
```

**Exit code:** 2 (blocks action)

## Integration with Overlay Settings

The daemon generates overlay settings that configure Claude Code hooks to call this command:

```json
{
  "hooks": {
    "SessionStart": {
      "command": "sh '/Users/.../.codepiper/sessions/<session-id>/<session-id>.hook-forward.sh'",
      "stdin": "event"
    },
    "PermissionRequest": {
      "command": "sh '/Users/.../.codepiper/sessions/<session-id>/<session-id>.hook-forward.sh'",
      "stdin": "event",
      "stdout": "context"
    }
  }
}
```

## Testing

The command includes comprehensive tests covering:

- JSON parsing (valid, invalid, empty, multiline)
- Environment variable handling
- HTTP communication with daemon
- PermissionRequest decision handling
- Error handling (connection failures, HTTP errors, malformed responses)
- Exit code behavior

Run tests:
```bash
bun test packages/cli/src/commands/hook-forward.test.ts
```

## Security Considerations

1. **Authentication**: Uses `X-CodePiper-Secret` header for daemon authentication
2. **Socket Security**: Uses Unix domain socket by default (file permissions)
3. **Input Validation**: Validates JSON input and required environment variables
4. **No User Input**: Reads only from stdin (controlled by Claude Code)

## Debugging

If hook forwarding fails, check:

1. Is the daemon running?
   ```bash
   curl --unix-socket /tmp/codepiper.sock http://localhost/health
   ```

2. Are environment variables set correctly?
   ```bash
   echo $CODEPIPER_UNIX_SOCK
   echo $CODEPIPER_SESSION
   echo $CODEPIPER_SECRET   # usually set by daemon startup
   ```

3. Is the socket path correct and accessible?
   ```bash
   ls -la /tmp/codepiper.sock
   ```

4. Check daemon logs for hook event ingestion errors

## Related Files

- **Implementation**: `packages/cli/src/commands/hook-forward.ts`
- **Tests**: `packages/cli/src/commands/hook-forward.test.ts`
- **Overlay Settings Generator**: `packages/providers/claude-code/src/overlaySettings.ts`
- **Daemon Hook Ingestion**: `packages/daemon/src/api/routes.ts` (POST `/hooks/claude`)
