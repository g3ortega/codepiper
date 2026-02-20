# Built-in Workflows

This directory contains pre-built workflow examples that demonstrate various orchestration patterns.

## Available Workflows

### 1. Sequential Code Review (`sequential-review.yaml`)

**Pattern:** Sequential multi-agent workflow

A three-step code review workflow:
1. **Developer** - Implements a feature
2. **Reviewer** - Reviews the code and provides feedback
3. **Fixer** - Applies review feedback

**Variables:**
- `CWD` - Working directory (required)
- `FEATURE` - Feature description (required)

**Usage:**
```bash
codepiper workflow create packages/daemon/src/workflows/builtin/sequential-review.yaml
codepiper workflow run <workflow-id> --var CWD=/path/to/repo --var FEATURE="user authentication"
```

### 2. Parallel Research (`parallel-research.yaml`)

**Pattern:** Parallel execution with synthesis

Research a topic from multiple sources simultaneously:
1. **Parallel Research Phase:**
   - `research-docs` - Official documentation
   - `research-code` - Codebase analysis
   - `research-community` - Community examples
2. **Synthesis Phase:**
   - Combines all findings into comprehensive guide

**Variables:**
- `CWD` - Working directory (required)
- `TOPIC` - Research topic (required)

**Usage:**
```bash
codepiper workflow create packages/daemon/src/workflows/builtin/parallel-research.yaml
codepiper workflow run <workflow-id> --var CWD=/path/to/repo --var TOPIC="React hooks"
```

### 3. Test and Fix (`test-and-fix.yaml`)

**Pattern:** Conditional branching

Automated test-fix-retest workflow:
1. **Run Tests** - Execute test suite
2. **Conditional Check:**
   - If tests fail → Fix tests → Rerun tests
   - If tests pass → Success

**Variables:**
- `CWD` - Working directory (required)

**Usage:**
```bash
codepiper workflow create packages/daemon/src/workflows/builtin/test-and-fix.yaml
codepiper workflow run <workflow-id> --var CWD=/path/to/repo
```

## Workflow Patterns

### Sequential
Steps execute one after another. Each step can pass results to the next.

```yaml
steps:
  - name: step1
    # ...
  - name: step2
    # Uses results from step1
    prompt: "Process ${steps.step1.result}"
```

### Parallel
Multiple steps execute concurrently, with results combined later.

```yaml
steps:
  - name: parallel-tasks
    type: parallel
    wait_for: all
    steps:
      - name: task-a
        # ...
      - name: task-b
        # ...
```

### Conditional
Steps execute based on runtime conditions.

```yaml
steps:
  - name: check
    type: if
    condition: "${steps.previous.status} == 'failed'"
    then:
      - name: fix
        # ...
    else:
      - name: continue
        # ...
```

## Creating Custom Workflows

1. Create a YAML file with your workflow definition
2. Use built-in examples as templates
3. Test with `codepiper workflow create <file>`
4. Execute with `codepiper workflow run <workflow-id>`

See the [Workflow system feature doc](../../../../../docs/features/workflow-system.md) for syntax and operational details.
