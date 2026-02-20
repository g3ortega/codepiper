# CLI Testing Guide

## Overview

The CLI package has comprehensive test coverage using Bun's built-in test runner, following Test-Driven Development (TDD) principles.

## Test Statistics

- **Total Tests:** 103
- **Test Files:** 10
- **Assertions:** 180 expect() calls
- **Status:** All passing ✓

## Running Tests

### All Tests

```bash
# From project root
bun test packages/cli/

# Or with verbose output
bun test packages/cli/ --verbose
```

### Individual Command Tests

```bash
bun test packages/cli/src/commands/start.test.ts
bun test packages/cli/src/commands/sessions.test.ts
bun test packages/cli/src/commands/send.test.ts
bun test packages/cli/src/commands/keys.test.ts
bun test packages/cli/src/commands/slash.test.ts
bun test packages/cli/src/commands/policy.test.ts
bun test packages/cli/src/commands/logs.test.ts
bun test packages/cli/src/commands/attach.test.ts
bun test packages/cli/src/commands/doctor.test.ts
bun test packages/cli/src/main.test.ts
```

## Test Coverage by Command

### start (13 tests)
- ✓ Parsing basic options with required flags
- ✓ Using current directory as default
- ✓ Parsing provider aliases
- ✓ Validating provider value
- ✓ Requiring provider flag
- ✓ Parsing additional args
- ✓ Parsing socket path
- ✓ Using default socket path
- ✓ Sending POST request to daemon
- ✓ Including additional args in request
- ✓ Handling daemon connection error
- ✓ Handling daemon error response
- ✓ Handling invalid JSON response

### sessions (11 tests)
- ✓ Parsing default options
- ✓ Parsing socket path
- ✓ Parsing output format
- ✓ Validating format value
- ✓ Parsing filter by provider
- ✓ Parsing filter by status
- ✓ Fetching sessions from daemon
- ✓ Including query parameters for filters
- ✓ Handling empty session list
- ✓ Handling daemon connection error
- ✓ Handling daemon error response

### send (13 tests)
- ✓ Parsing session ID and text
- ✓ Requiring session ID
- ✓ Requiring text
- ✓ Parsing socket path
- ✓ Parsing newline flag
- ✓ Defaulting newline to true
- ✓ Parsing no-newline flag
- ✓ Joining multiple text arguments
- ✓ Handling text with flags after
- ✓ Sending POST request with text and newline
- ✓ Sending text without newline
- ✓ Handling session not found error
- ✓ Handling daemon connection error

### keys (10 tests)
- ✓ Parsing session ID and keys
- ✓ Parsing multiple keys
- ✓ Requiring session ID
- ✓ Requiring at least one key
- ✓ Parsing socket path
- ✓ Filtering out socket flag from keys
- ✓ Sending POST request with keys array
- ✓ Handling single key
- ✓ Handling session not found error
- ✓ Handling daemon connection error

### slash (10 tests)
- ✓ Parsing session ID and command
- ✓ Requiring session ID
- ✓ Requiring command
- ✓ Parsing socket path
- ✓ Parsing command arguments
- ✓ Filtering out socket flag from args
- ✓ Sending POST request with command
- ✓ Including command arguments
- ✓ Handling session not found error
- ✓ Handling daemon connection error

### policy (11 tests)
- ✓ Parsing session ID for get
- ✓ Requiring session ID
- ✓ Parsing set action with rules
- ✓ Requiring policy for set action
- ✓ Validating policy JSON format
- ✓ Parsing socket path
- ✓ Fetching policy from daemon
- ✓ Handling session not found error
- ✓ Handling daemon connection error
- ✓ Sending PUT request with policy
- ✓ Handling validation error

### logs (14 tests)
- ✓ Parsing session ID
- ✓ Requiring session ID
- ✓ Parsing socket path
- ✓ Parsing follow flag
- ✓ Parsing tail count
- ✓ Defaulting tail to 100
- ✓ Parsing since event ID
- ✓ Parsing format option
- ✓ Validating format value
- ✓ Fetching events from daemon
- ✓ Including query parameters
- ✓ Handling empty event list
- ✓ Handling session not found error
- ✓ Handling daemon connection error

### attach (7 tests)
- ✓ Parsing session ID from first argument
- ✓ Requiring session ID
- ✓ Parsing socket path
- ✓ Parsing follow mode
- ✓ Defaulting follow mode to false
- ✓ Parsing short socket flag
- ✓ Parsing short follow flag

### doctor (8 tests)
- ✓ Parsing default options
- ✓ Parsing socket path
- ✓ Detecting claude binary in PATH
- ✓ Detecting missing claude binary
- ✓ Getting claude version
- ✓ Detecting running daemon
- ✓ Detecting daemon not running
- ✓ Handling daemon error response

### main (6 tests)
- ✓ Shows help when no arguments provided
- ✓ Shows help with --help flag
- ✓ Shows help with -h flag
- ✓ Shows command help
- ✓ Shows error for unknown command
- ✓ Shows error when daemon not running

## Test Patterns

### 1. Argument Parsing Tests

Every command has tests for:
- Valid argument combinations
- Required arguments
- Default values
- Flag aliases (short/long)
- Invalid inputs

Example:
```typescript
test("parses basic options with required flags", () => {
  const args = ["--provider", "claude-code", "--dir", "/path/to/repo"];
  const options = parseStartOptions(args);

  expect(options.provider).toBe("claude-code");
  expect(options.dir).toBe("/path/to/repo");
});
```

### 2. HTTP Request Tests

Commands that make HTTP requests test:
- Correct URL construction
- Request method
- Request headers
- Request body formatting
- Unix socket parameter

Example:
```typescript
test("sends POST request to daemon with correct payload", async () => {
  const mockFetch = mock(async (url: string, options: any) => {
    expect(url).toBe("http://localhost/sessions");
    expect(options.unix).toBe("/tmp/codepiper.sock");
    expect(options.method).toBe("POST");

    return new Response(JSON.stringify({ ... }), { status: 201 });
  });

  global.fetch = mockFetch as any;
  await startSession(options);
});
```

### 3. Error Handling Tests

All commands test:
- Daemon connection errors (ENOENT)
- HTTP error responses (4xx, 5xx)
- Invalid response formats

Example:
```typescript
test("handles daemon connection error", async () => {
  const mockFetch = mock(async () => {
    throw new Error("ENOENT: no such file or directory");
  });

  global.fetch = mockFetch as any;

  await expect(
    startSession(options)
  ).rejects.toThrow("Failed to connect to daemon");
});
```

## Mocking Strategy

### fetch() Mocking

Tests use Bun's `mock()` function to mock fetch. **Important:** Always save and restore `globalThis.fetch` to prevent test pollution across parallel test files.

```typescript
import { afterEach, mock } from "bun:test";

const originalFetch = globalThis.fetch;

describe("my command", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("sends request", async () => {
    const mockFetch = mock(async (url: string, options: any) => {
      expect(url).toBe(...);
      return new Response(JSON.stringify({ ... }), { status: 200 });
    });

    global.fetch = mockFetch as any;
    await myCommand(options);
  });
});
```

### Bun.spawn Mocking

For commands that spawn processes (like doctor):

```typescript
const mockSpawn = {
  exited: Promise.resolve(),
  exitCode: Promise.resolve(0),
  stdout: {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from("output\n");
    },
  },
  stderr: {
    async *[Symbol.asyncIterator]() {},
  },
};

const originalSpawn = Bun.spawn;
Bun.spawn = mock(() => mockSpawn as any);

// ... test code ...

Bun.spawn = originalSpawn; // Restore
```

## Integration Testing

### End-to-End CLI Tests

The `main.test.ts` file runs the actual CLI executable:

```typescript
async function runCLI(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const proc = spawn(["bun", "run", CLI_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  await proc.exited;
  const exitCode = (await proc.exitCode) || 0;

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  return { stdout, stderr, exitCode };
}
```

This ensures:
- CLI entry point works
- Command routing functions
- Help text displays correctly
- Error handling works end-to-end

## Continuous Testing

### Watch Mode

```bash
# Auto-run tests on file changes
bun test --watch packages/cli/
```

### Pre-commit Hook

Add to `.git/hooks/pre-commit`:

```bash
#!/bin/sh
bun test packages/cli/
```

## Future Test Enhancements

### Integration with Real Daemon

Once the daemon is implemented:

```typescript
describe("integration tests", () => {
  let daemonProc;

  beforeAll(async () => {
    // Start daemon in test mode
    daemonProc = spawn(["bun", "run", "daemon", "--test"]);
    await waitForSocket("/tmp/codepiper-test.sock");
  });

  afterAll(async () => {
    daemonProc.kill();
  });

  test("creates and lists session", async () => {
    const session = await startSession({
      provider: "claude-code",
      dir: "/tmp/test-repo",
      socket: "/tmp/codepiper-test.sock",
    });

    const sessions = await listSessions({
      socket: "/tmp/codepiper-test.sock",
      format: "table",
    });

    expect(sessions).toContainEqual(expect.objectContaining({
      id: session.id,
    }));
  });
});
```

### Contract Testing

Test against OpenAPI spec:

```typescript
test("sessions response matches schema", async () => {
  const sessions = await listSessions(options);

  const schema = await loadOpenAPISchema();
  expect(sessions).toMatchSchema(schema.components.schemas.SessionList);
});
```

## Troubleshooting

### Tests Failing with Connection Errors

If you see real connection attempts in unit tests:
- Verify mocks are set up correctly
- Check that `global.fetch` is being replaced
- Ensure mocks run before the actual function call

### Flaky Tests

If tests are intermittent:
- Check for race conditions in async tests
- Ensure proper cleanup in `afterEach`
- Verify mocks are reset between tests

### Slow Tests

If tests are slow:
- Profile with `bun test --inspect`
- Check for unnecessary async waits
- Consider parallelizing independent tests

## Resources

- [Bun Test Documentation](https://bun.sh/docs/cli/test)
- [Bun Test Runner API](https://bun.sh/docs/test/writing)
- [Jest Matchers Reference](https://jestjs.io/docs/expect)
