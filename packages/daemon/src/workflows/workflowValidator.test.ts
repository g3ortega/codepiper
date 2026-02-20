/**
 * Workflow Validator Tests
 *
 * Tests for validating workflow structure, dependencies, and configurations
 */

import { describe, expect, test } from "bun:test";
import type { WorkflowDefinition } from "./workflowTypes";
import { validateWorkflow } from "./workflowValidator";

describe("validateWorkflow", () => {
  test("should validate simple workflow", () => {
    const workflow: WorkflowDefinition = {
      name: "Simple Workflow",
      steps: [
        {
          name: "step1",
          type: "session",
          provider: "claude-code",
          cwd: "/tmp",
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors).toHaveLength(0);
  });

  test("should reject empty steps array", () => {
    const workflow: WorkflowDefinition = {
      name: "Empty Workflow",
      steps: [],
    };

    const errors = validateWorkflow(workflow);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("at least one step");
  });

  test("should reject duplicate step names", () => {
    const workflow: WorkflowDefinition = {
      name: "Duplicate Steps",
      steps: [
        {
          name: "step1",
          type: "session",
          provider: "claude-code",
          cwd: "/tmp",
        },
        {
          name: "step1",
          type: "log",
          message: "Duplicate",
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message.toLowerCase()).toContain("duplicate");
    expect(errors[0].message).toContain("step1");
  });

  test("should validate session step required fields", () => {
    const workflow: WorkflowDefinition = {
      name: "Invalid Session",
      steps: [
        {
          name: "session1",
          type: "session",
          provider: "claude-code",
          // Missing cwd
        } as any,
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("cwd");
  });

  test("should validate valid provider names", () => {
    const validWorkflow: WorkflowDefinition = {
      name: "Valid Providers",
      steps: [
        {
          name: "claude",
          type: "session",
          provider: "claude-code",
          cwd: "/tmp",
        },
      ],
    };

    const errors = validateWorkflow(validWorkflow);
    expect(errors).toHaveLength(0);
  });

  test("should allow codex provider with timeout-only wait condition", () => {
    const workflow: WorkflowDefinition = {
      name: "Codex Timeout Wait",
      steps: [
        {
          name: "step1",
          type: "session",
          provider: "codex",
          cwd: "/tmp",
          wait: [{ type: "timeout", timeout: 1000 }],
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors).toHaveLength(0);
  });

  test("should reject invalid provider", () => {
    const workflow: WorkflowDefinition = {
      name: "Invalid Provider",
      steps: [
        {
          name: "step1",
          type: "session",
          provider: "invalid-provider" as any,
          cwd: "/tmp",
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("provider");
  });

  test("should reject hook-based wait conditions for codex provider", () => {
    const workflow: WorkflowDefinition = {
      name: "Codex Invalid Wait",
      steps: [
        {
          name: "step1",
          type: "session",
          provider: "codex",
          cwd: "/tmp",
          wait: [{ type: "idle_prompt" }],
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((error) => error.message.includes("requires native hooks"))).toBe(true);
  });

  test("should reject extract config for codex provider", () => {
    const workflow: WorkflowDefinition = {
      name: "Codex Invalid Extract",
      steps: [
        {
          name: "step1",
          type: "session",
          provider: "codex",
          cwd: "/tmp",
          extract: {
            result: { type: "regex", pattern: "Result: (.*)" },
          },
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((error) => error.message.includes("requires transcript tailing"))).toBe(
      true
    );
  });

  test("should validate wait condition types", () => {
    const workflow: WorkflowDefinition = {
      name: "Valid Wait",
      steps: [
        {
          name: "step1",
          type: "session",
          provider: "claude-code",
          cwd: "/tmp",
          wait: [
            { type: "idle_prompt" },
            { type: "permission_prompt" },
            { type: "stop" },
            { type: "event", eventType: "custom" },
            { type: "timeout", timeout: 5000 },
          ],
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors).toHaveLength(0);
  });

  test("should require eventType for event wait condition", () => {
    const workflow: WorkflowDefinition = {
      name: "Missing Event Type",
      steps: [
        {
          name: "step1",
          type: "session",
          provider: "claude-code",
          cwd: "/tmp",
          wait: [{ type: "event" }],
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("eventType");
  });

  test("should validate extract configuration", () => {
    const workflow: WorkflowDefinition = {
      name: "Valid Extract",
      steps: [
        {
          name: "step1",
          type: "session",
          provider: "claude-code",
          cwd: "/tmp",
          extract: {
            result1: { type: "regex", pattern: "Result: (.*)" },
            result2: { type: "jsonpath", path: "$.data.value" },
            result3: { type: "xpath", path: "//div[@id='result']" },
          },
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors).toHaveLength(0);
  });

  test("should require pattern for regex extraction", () => {
    const workflow: WorkflowDefinition = {
      name: "Missing Pattern",
      steps: [
        {
          name: "step1",
          type: "session",
          provider: "claude-code",
          cwd: "/tmp",
          extract: {
            result: { type: "regex" },
          },
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("pattern");
  });

  test("should require path for jsonpath extraction", () => {
    const workflow: WorkflowDefinition = {
      name: "Missing Path",
      steps: [
        {
          name: "step1",
          type: "session",
          provider: "claude-code",
          cwd: "/tmp",
          extract: {
            result: { type: "jsonpath" },
          },
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("path");
  });

  test("should validate retry configuration", () => {
    const workflow: WorkflowDefinition = {
      name: "Valid Retry",
      steps: [
        {
          name: "step1",
          type: "session",
          provider: "claude-code",
          cwd: "/tmp",
          onError: "retry",
          retry: {
            maxAttempts: 3,
            delay: 1000,
          },
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors).toHaveLength(0);
  });

  test("should require retry config when onError is retry", () => {
    const workflow: WorkflowDefinition = {
      name: "Missing Retry Config",
      steps: [
        {
          name: "step1",
          type: "session",
          provider: "claude-code",
          cwd: "/tmp",
          onError: "retry",
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("retry");
  });

  test("should validate conditional step structure", () => {
    const workflow: WorkflowDefinition = {
      name: "Valid Conditional",
      steps: [
        {
          name: "check",
          type: "if",
          condition: "${test} == 'true'",
          then: [
            {
              name: "success",
              type: "log",
              message: "Success!",
            },
          ],
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors).toHaveLength(0);
  });

  test("should require condition in conditional step", () => {
    const workflow: WorkflowDefinition = {
      name: "Missing Condition",
      steps: [
        {
          name: "check",
          type: "if",
          condition: "",
          then: [
            {
              name: "success",
              type: "log",
              message: "Success!",
            },
          ],
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("condition");
  });

  test("should require then steps in conditional", () => {
    const workflow: WorkflowDefinition = {
      name: "Missing Then",
      steps: [
        {
          name: "check",
          type: "if",
          condition: "${test}",
          then: [],
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("then");
  });

  test("should validate parallel step structure", () => {
    const workflow: WorkflowDefinition = {
      name: "Valid Parallel",
      steps: [
        {
          name: "parallel-tasks",
          type: "parallel",
          waitFor: "all",
          steps: [
            {
              name: "task1",
              type: "log",
              message: "Task 1",
            },
            {
              name: "task2",
              type: "log",
              message: "Task 2",
            },
          ],
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors).toHaveLength(0);
  });

  test("should require steps in parallel step", () => {
    const workflow: WorkflowDefinition = {
      name: "Empty Parallel",
      steps: [
        {
          name: "parallel-tasks",
          type: "parallel",
          waitFor: "all",
          steps: [],
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("at least one");
  });

  test("should validate foreach step structure", () => {
    const workflow: WorkflowDefinition = {
      name: "Valid Foreach",
      steps: [
        {
          name: "loop",
          type: "foreach",
          items: "${files}",
          step: {
            name: "process",
            type: "log",
            message: "Processing ${item}",
          },
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors).toHaveLength(0);
  });

  test("should require items in foreach step", () => {
    const workflow: WorkflowDefinition = {
      name: "Missing Items",
      steps: [
        {
          name: "loop",
          type: "foreach",
          items: "",
          step: {
            name: "process",
            type: "log",
            message: "Process",
          },
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("items");
  });

  test("should validate log step structure", () => {
    const workflow: WorkflowDefinition = {
      name: "Valid Log",
      steps: [
        {
          name: "log1",
          type: "log",
          message: "Hello, world!",
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors).toHaveLength(0);
  });

  test("should require message in log step", () => {
    const workflow: WorkflowDefinition = {
      name: "Empty Log",
      steps: [
        {
          name: "log1",
          type: "log",
          message: "",
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("message");
  });

  test("should detect circular dependencies in variable references", () => {
    const workflow: WorkflowDefinition = {
      name: "Circular Deps",
      steps: [
        {
          name: "step1",
          type: "session",
          provider: "claude-code",
          cwd: "/tmp",
          prompt: "${steps.step2.result}",
        },
        {
          name: "step2",
          type: "session",
          provider: "claude-code",
          cwd: "/tmp",
          prompt: "${steps.step1.result}",
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message.toLowerCase()).toContain("circular");
  });

  test("should allow forward references in sequential steps", () => {
    const workflow: WorkflowDefinition = {
      name: "Forward Refs",
      steps: [
        {
          name: "step1",
          type: "session",
          provider: "claude-code",
          cwd: "/tmp",
        },
        {
          name: "step2",
          type: "session",
          provider: "claude-code",
          cwd: "/tmp",
          prompt: "${steps.step1.result}",
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors).toHaveLength(0);
  });

  test("should validate nested steps in conditionals", () => {
    const workflow: WorkflowDefinition = {
      name: "Nested Validation",
      steps: [
        {
          name: "check",
          type: "if",
          condition: "${test}",
          then: [
            {
              name: "nested",
              type: "session",
              provider: "invalid" as any,
              cwd: "/tmp",
            },
          ],
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("provider");
  });

  test("should validate nested steps in parallel", () => {
    const workflow: WorkflowDefinition = {
      name: "Nested Parallel",
      steps: [
        {
          name: "parallel",
          type: "parallel",
          waitFor: "all",
          steps: [
            {
              name: "task1",
              type: "session",
              provider: "claude-code",
              // Missing cwd
            } as any,
          ],
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("cwd");
  });

  test("should allow complex valid workflows", () => {
    const workflow: WorkflowDefinition = {
      name: "Complex Workflow",
      description: "A complex multi-step workflow",
      env: { GLOBAL: "value" },
      cwd: "/default",
      steps: [
        {
          name: "init",
          type: "session",
          provider: "claude-code",
          cwd: "/tmp",
          prompt: "Initialize project",
          wait: [{ type: "idle_prompt", timeout: 30000 }],
        },
        {
          name: "parallel-tasks",
          type: "parallel",
          waitFor: "all",
          steps: [
            {
              name: "task1",
              type: "session",
              provider: "claude-code",
              cwd: "/tmp",
              prompt: "Task 1",
              extract: {
                result: { type: "regex", pattern: "Result: (.*)" },
              },
            },
            {
              name: "task2",
              type: "session",
              provider: "claude-code",
              cwd: "/tmp",
              prompt: "Task 2",
            },
          ],
        },
        {
          name: "check-results",
          type: "if",
          condition: "${steps.task1.result} == 'success'",
          then: [
            {
              name: "success-log",
              type: "log",
              message: "All tasks completed successfully",
            },
          ],
          else: [
            {
              name: "retry-task",
              type: "session",
              provider: "claude-code",
              cwd: "/tmp",
              prompt: "Retry failed task",
              onError: "retry",
              retry: { maxAttempts: 3, delay: 1000 },
            },
          ],
        },
      ],
    };

    const errors = validateWorkflow(workflow);
    expect(errors).toHaveLength(0);
  });
});
