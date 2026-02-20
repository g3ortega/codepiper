# Workflow Execution Engine

This directory contains the workflow execution engine for Phase 4 of the CodePiper project.

## Components

### Core Types (`workflowTypes.ts`)
TypeScript type definitions for the workflow system.

### Wait Condition Poller (`waitConditionPoller.ts`)
Polls database events to check if wait conditions are satisfied.

**Supported Conditions:**
- `idle_prompt` - Session waiting for user input
- `permission_prompt` - Session needs permission approval
- `stop` - Agent turn completed
- `event` - Custom event type
- `timeout` - Maximum wait time

### Result Extractor (`resultExtractor.ts`)
Extracts structured data from transcript events.

**Extraction Methods:**
- **Regex** - Pattern matching with capture groups
- **JSONPath** - Query JSON content using JSONPath syntax

### Context Manager (`contextManager.ts`)
Manages workflow variables and substitution.

**Features:**
- Store and retrieve variables
- Nested path access (`user.name`, `data.items.0`)
- Variable substitution (`${variable}`)

### Workflow Runner (`workflowRunner.ts`)
Main execution engine that orchestrates workflow steps.

**Capabilities:**
- Sequential step execution
- Session management (spawn, prompt, wait)
- Result extraction and context passing
- Error handling (fail, continue)
- Execution tracking and cancellation

## Usage Example

```typescript
import { WorkflowRunner } from "./workflowRunner.ts";
import { SessionManager } from "../sessions/sessionManager.ts";
import { Database } from "../db/db.ts";
import { EventBus } from "@codepiper/core";

// Initialize dependencies
const db = new Database("./codepiper.db");
await db.init();

const sessionManager = new SessionManager();
const eventBus = new EventBus();

// Create runner
const runner = new WorkflowRunner({
  sessionManager,
  database: db,
  eventBus,
});

// Define workflow
const workflow = {
  name: "sequential-code-review",
  description: "Developer → Reviewer workflow",
  steps: [
    {
      name: "developer",
      type: "session",
      provider: "claude-code",
      cwd: "/path/to/repo",
      prompt: "Implement the login feature",
      wait: [
        { type: "idle_prompt", timeout: 300000 } // 5 min
      ],
      extract: {
        files: {
          type: "regex",
          pattern: "Created file: (.+)"
        }
      }
    },
    {
      name: "reviewer",
      type: "session",
      provider: "claude-code",
      cwd: "/path/to/repo",
      prompt: "Review the following files: ${steps.developer.files}",
      wait: [
        { type: "stop" }
      ],
      extract: {
        feedback: {
          type: "jsonpath",
          path: "$.review.feedback"
        }
      }
    }
  ]
};

// Start execution
const executionId = await runner.start(workflow);
console.log(`Workflow started: ${executionId}`);

// Monitor progress
const checkStatus = setInterval(() => {
  const execution = runner.getExecution(executionId);
  console.log(`Status: ${execution.status}`);

  if (execution.status !== "running") {
    clearInterval(checkStatus);

    if (execution.status === "completed") {
      console.log("Workflow completed successfully!");
      console.log("Context:", execution.context);
    } else {
      console.error("Workflow failed:", execution.error);
    }
  }
}, 1000);

// Or wait for completion
await runner.waitForCompletion(executionId, 600000); // 10 min timeout
```

## Workflow Definition Format

```typescript
interface WorkflowDefinition {
  name: string;
  description?: string;
  steps: WorkflowStep[];
}

interface SessionStep {
  name: string;
  type: "session";
  provider: "claude-code";
  cwd: string;
  args?: string[];
  env?: Record<string, string>;
  prompt?: string;
  wait?: WaitCondition[];
  extract?: Record<string, ExtractConfig>;
  onError?: "fail" | "continue" | "retry";
  retry?: {
    maxAttempts: number;
    delay: number;
  };
}
```

## Wait Conditions

```typescript
// Wait for idle prompt
{ type: "idle_prompt" }

// Wait for stop with timeout
{ type: "stop", timeout: 60000 }

// Wait for custom event
{ type: "event", eventType: "CustomEvent" }

// Multiple conditions (OR logic)
[
  { type: "idle_prompt" },
  { type: "stop", timeout: 300000 }
]
```

## Result Extraction

```typescript
// Regex extraction
{
  filename: {
    type: "regex",
    pattern: "Created: (.+)"
  }
}

// JSONPath extraction
{
  issues: {
    type: "jsonpath",
    path: "$.review.issues[*]"
  }
}
```

## Context and Variables

Variables are stored in the workflow execution context and can be referenced in subsequent steps:

```typescript
// Step 1 extracts data
{
  name: "step1",
  extract: {
    result: { type: "regex", pattern: "Result: (.+)" }
  }
}

// Step 2 uses extracted data
{
  name: "step2",
  prompt: "Process the result: ${steps.step1.result}"
}
```

## Error Handling

```typescript
// Fail workflow on step error (default)
{
  name: "critical-step",
  onError: "fail"
}

// Continue to next step on error
{
  name: "optional-step",
  onError: "continue"
}

// Retry on error (not yet implemented)
{
  name: "flaky-step",
  onError: "retry",
  retry: {
    maxAttempts: 3,
    delay: 1000
  }
}
```

## Testing

All components have comprehensive test coverage:

```bash
# Run all workflow tests
bun test packages/daemon/src/workflows/

# Run specific component tests
bun test packages/daemon/src/workflows/waitConditionPoller.test.ts
bun test packages/daemon/src/workflows/resultExtractor.test.ts
bun test packages/daemon/src/workflows/contextManager.test.ts
bun test packages/daemon/src/workflows/workflowRunner.test.ts
```

## Architecture Notes

### Execution Model
- Workflows execute asynchronously in background
- `start()` returns immediately with execution ID
- Poll `getExecution()` for status or use `waitForCompletion()`
- Executions stored in-memory (database persistence pending)

### Step Execution
- Steps execute sequentially (parallel not yet implemented)
- Each step spawns a new session
- Sessions remain active after step completion
- Manual cleanup required (or implement auto-cleanup)

### Event Integration
- Wait conditions poll database events
- Events inserted by hooks (SessionStart, Stop, Notification)
- Transcript events parsed and stored by TranscriptTailer

### Future Work
- Parallel step execution
- Conditional branching (if/then/else)
- Loop steps (foreach)
- WebSocket streaming of progress
- Pause/resume support
