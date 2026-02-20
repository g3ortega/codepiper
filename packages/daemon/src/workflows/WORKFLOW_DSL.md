# Workflow DSL & Parser

**Status:** ✅ COMPLETE
**Version:** Current

## Overview

Complete implementation of the Workflow DSL (Domain-Specific Language) for defining multi-session orchestration workflows. The system enables users to define complex workflows using YAML or JSON that coordinate multiple CLI sessions with dependencies, wait conditions, and result propagation.

## Architecture

### Components

1. **Type Definitions** (`workflowTypes.ts`)
   - Comprehensive TypeScript interfaces for all workflow elements
   - Type-safe step definitions
   - Validation error types

2. **Parser** (`workflowParser.ts`)
   - Parses JSON and YAML workflow definitions
   - Variable substitution engine
   - Robust error handling

3. **Validator** (`workflowValidator.ts`)
   - Validates workflow structure and configuration
   - Detects circular dependencies
   - Validates all step types and configurations

## DSL Syntax

### Basic Structure

```yaml
name: "Workflow Name"
description: "Optional description"
env:
  GLOBAL_VAR: "value"
cwd: /default/path

steps:
  - name: step-name
    type: session | if | parallel | foreach | log
    # Step-specific configuration
```

### Step Types

#### 1. Session Step

Spawns a CLI session (Claude Code).

```yaml
- name: developer
  type: session
  provider: claude-code
  cwd: /path/to/repo
  args: ["--verbose"]
  env:
    KEY: "value"
  prompt: "Initial prompt"
  wait:
    - type: idle_prompt
      timeout: 30000
  extract:
    result:
      type: regex
      pattern: "Result: (.*)"
  onError: retry
  retry:
    maxAttempts: 3
    delay: 1000
```

**Fields:**
- `provider`: `claude-code`
- `cwd`: Working directory (required)
- `args`: Additional CLI arguments
- `env`: Environment variables
- `prompt`: Initial text to send
- `wait`: Array of wait conditions
- `extract`: Result extraction configuration
- `onError`: Error handling strategy (`continue` | `fail` | `retry`)
- `retry`: Retry configuration (if onError=retry)

#### 2. Conditional Step

Executes different steps based on a condition.

```yaml
- name: check-results
  type: if
  condition: "${steps.previous.status} == 'success'"
  then:
    - name: success-step
      type: log
      message: "Success!"
  else:
    - name: failure-step
      type: log
      message: "Failed!"
```

#### 3. Parallel Step

Executes multiple steps concurrently.

```yaml
- name: parallel-tasks
  type: parallel
  waitFor: all  # all | any | none
  steps:
    - name: task1
      type: session
      provider: claude-code
      cwd: /tmp
    - name: task2
      type: session
      provider: claude-code
      cwd: /tmp
```

#### 4. Foreach Step

Iterates over items and executes a step template for each.

```yaml
- name: process-files
  type: foreach
  items: "${files}"
  step:
    name: process-file
    type: session
    provider: claude-code
    cwd: /tmp
    prompt: "Process ${item}"
```

#### 5. Log Step

Outputs a message (useful for debugging and status updates).

```yaml
- name: log-message
  type: log
  message: "Processing complete!"
```

### Wait Conditions

Wait conditions control when a step completes and the workflow continues.

```yaml
wait:
  - type: idle_prompt    # Session waiting for input
    timeout: 30000

  - type: permission_prompt  # Session needs approval

  - type: stop  # Turn completed (Stop hook fired)

  - type: event  # Custom event
    eventType: "custom-event"

  - type: timeout  # Time-based
    timeout: 60000
```

### Result Extraction

Extract data from session transcripts to pass between steps.

```yaml
extract:
  # Regex extraction
  files:
    type: regex
    pattern: "Created file: (.*)"

  # JSONPath extraction
  data:
    type: jsonpath
    path: "$.results[0].value"

  # XPath extraction
  element:
    type: xpath
    path: "//div[@id='result']"
```

### Variable Substitution

Use `${variable}` syntax to reference variables and step results.

**Supported Patterns:**
- `${variable}` - Global variable
- `${steps.stepName.field}` - Step result field
- `${steps.stepName.extractedData.key}` - Extracted data
- `${CWD}`, `${FEATURE}` - Environment-style variables

**Examples:**
```yaml
prompt: "Process ${FEATURE} in ${steps.previous.result}"
condition: "${steps.test.status} == 'success'"
items: "${files}"
```

## API

### Parser Functions

```typescript
import { parseWorkflow, parseWorkflowFromYaml, substituteVariables } from "./workflowParser";

// Parse JSON
const workflow = parseWorkflow(jsonString);

// Parse YAML
const workflow = parseWorkflowFromYaml(yamlString);

// Substitute variables
const context: WorkflowContext = {
  steps: {
    step1: { status: "completed", extractedData: { result: "success" } }
  },
  variables: { name: "value" }
};
const result = substituteVariables("Status: ${steps.step1.status}", context);
```

### Validator Functions

```typescript
import { validateWorkflow } from "./workflowValidator";

const errors = validateWorkflow(workflow);

if (errors.length > 0) {
  console.error("Validation errors:", errors);
  // [{ message: "...", path: "...", stepName: "..." }]
}
```

## Validation Rules

The validator checks:

1. **Structure**
   - At least one step required
   - No duplicate step names
   - Valid step types

2. **Session Steps**
   - Required: `provider`, `cwd`
   - Valid provider names
   - Valid wait condition types
   - Valid extract configurations
   - Retry config required if onError=retry

3. **Conditional Steps**
   - Non-empty condition
   - At least one step in `then` branch
   - Valid nested steps

4. **Parallel Steps**
   - At least one step
   - Valid `waitFor` value
   - Valid nested steps

5. **Foreach Steps**
   - Non-empty `items`
   - Valid step template

6. **Dependencies**
   - Detects circular dependencies
   - Validates variable references

## Example Workflows

### Sequential Review Workflow

```yaml
name: "Sequential Code Review"
description: "Developer → Reviewer → Fixer"

steps:
  - name: developer
    type: session
    provider: claude-code
    cwd: /tmp/repo
    prompt: "Implement the login feature"
    wait:
      - type: idle_prompt
        timeout: 300000
    extract:
      files:
        type: regex
        pattern: "Created file: (.*)"

  - name: reviewer
    type: session
    provider: claude-code
    cwd: /tmp/repo
    prompt: "Review: ${steps.developer.files}"
    wait:
      - type: stop

  - name: fixer
    type: session
    provider: claude-code
    cwd: /tmp/repo
    prompt: "Fix issues"
    wait:
      - type: idle_prompt
```

### Parallel Research Workflow

```yaml
name: "Parallel Research"

steps:
  - name: research
    type: parallel
    waitFor: all
    steps:
      - name: docs
        type: session
        provider: claude-code
        cwd: /tmp
        prompt: "Research documentation"
      - name: code
        type: session
        provider: claude-code
        cwd: /tmp
        prompt: "Analyze code"

  - name: synthesize
    type: session
    provider: claude-code
    cwd: /tmp
    prompt: "Synthesize: ${steps.docs.result} + ${steps.code.result}"
```

## Testing

### Test Coverage

- **Parser Tests**: 27 tests
  - JSON parsing
  - YAML parsing
  - Variable substitution
  - All step types
  - Error handling

- **Validator Tests**: 27 tests
  - Structure validation
  - Required fields
  - Configuration validation
  - Circular dependency detection
  - Nested step validation

- **Golden File Tests**: 9 tests
  - Real workflow examples
  - End-to-end parsing and validation

**Total: 63 tests, 92.79% line coverage**

### Running Tests

```bash
# All workflow tests
bun test packages/daemon/src/workflows/

# Specific test files
bun test packages/daemon/src/workflows/workflowParser.test.ts
bun test packages/daemon/src/workflows/workflowValidator.test.ts
bun test packages/daemon/src/workflows/workflowGolden.test.ts

# With coverage
bun test packages/daemon/src/workflows/ --coverage
```

## Files

```
packages/daemon/src/workflows/
├── index.ts                    # Public exports
├── workflowTypes.ts            # Type definitions
├── workflowParser.ts           # Parser implementation
├── workflowParser.test.ts      # Parser tests
├── workflowValidator.ts        # Validator implementation
├── workflowValidator.test.ts   # Validator tests
└── workflowGolden.test.ts      # Golden file tests

test/fixtures/workflows/
├── sequential-review.yaml
├── parallel-research.yaml
├── conditional-test-fix.yaml
├── foreach-files.yaml
├── retry-strategy.yaml
└── invalid-missing-cwd.yaml
```

## Future Enhancements

1. **Schema Validation**
   - JSON Schema generation
   - IDE autocomplete support

2. **Advanced Features**
   - Workflow templates/inheritance
   - Macro expansion
   - Custom validators

3. **Tooling**
   - Workflow visualization
   - Dry-run mode
   - Interactive workflow builder

## References

- [Workflow system feature doc](../../../../docs/features/workflow-system.md)
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks) - Hook integration
- [js-yaml Documentation](https://github.com/nodeca/js-yaml) - YAML parsing
