/**
 * Workflow Parser Tests
 *
 * Tests for parsing YAML/JSON workflow definitions and variable substitution
 */

import { describe, expect, test } from "bun:test";
import { parseWorkflow, parseWorkflowFromYaml, substituteVariables } from "./workflowParser";

describe("parseWorkflow", () => {
  test("should parse valid JSON workflow", () => {
    const json = JSON.stringify({
      name: "Test Workflow",
      description: "A test workflow",
      steps: [
        {
          name: "step1",
          type: "session",
          provider: "claude-code",
          cwd: "/tmp",
          prompt: "Hello",
        },
      ],
    });

    const workflow = parseWorkflow(json);

    expect(workflow).not.toBeNull();
    expect(workflow?.name).toBe("Test Workflow");
    expect(workflow?.description).toBe("A test workflow");
    expect(workflow?.steps).toHaveLength(1);
    expect(workflow?.steps[0].name).toBe("step1");
    expect(workflow?.steps[0].type).toBe("session");
  });

  test("should parse workflow without description", () => {
    const json = JSON.stringify({
      name: "Simple Workflow",
      steps: [
        {
          name: "step1",
          type: "session",
          provider: "claude-code",
          cwd: "/tmp",
        },
      ],
    });

    const workflow = parseWorkflow(json);

    expect(workflow).not.toBeNull();
    expect(workflow?.name).toBe("Simple Workflow");
    expect(workflow?.description).toBeUndefined();
  });

  test("should parse session step with all fields", () => {
    const json = JSON.stringify({
      name: "Full Session",
      steps: [
        {
          name: "session1",
          type: "session",
          provider: "claude-code",
          cwd: "/tmp",
          args: ["--verbose"],
          env: { KEY: "value" },
          prompt: "Do something",
          wait: [{ type: "idle_prompt", timeout: 5000 }, { type: "stop" }],
          extract: {
            result: {
              type: "regex",
              pattern: "Result: (.*)",
            },
          },
          onError: "retry",
          retry: {
            maxAttempts: 3,
            delay: 1000,
          },
        },
      ],
    });

    const workflow = parseWorkflow(json);

    expect(workflow).not.toBeNull();
    const step = workflow?.steps[0];
    expect(step?.type).toBe("session");

    if (step?.type === "session") {
      expect(step.provider).toBe("claude-code");
      expect(step.cwd).toBe("/tmp");
      expect(step.args).toEqual(["--verbose"]);
      expect(step.env).toEqual({ KEY: "value" });
      expect(step.prompt).toBe("Do something");
      expect(step.wait).toHaveLength(2);
      expect(step.wait?.[0].type).toBe("idle_prompt");
      expect(step.wait?.[0].timeout).toBe(5000);
      expect(step.extract?.result.type).toBe("regex");
      expect(step.extract?.result.pattern).toBe("Result: (.*)");
      expect(step.onError).toBe("retry");
      expect(step.retry?.maxAttempts).toBe(3);
    }
  });

  test("should parse conditional step", () => {
    const json = JSON.stringify({
      name: "Conditional Workflow",
      steps: [
        {
          name: "check",
          type: "if",
          condition: "${steps.prev.status} == 'success'",
          then: [
            {
              name: "success-step",
              type: "session",
              provider: "claude-code",
              cwd: "/tmp",
            },
          ],
          else: [
            {
              name: "failure-step",
              type: "session",
              provider: "claude-code",
              cwd: "/tmp",
            },
          ],
        },
      ],
    });

    const workflow = parseWorkflow(json);

    expect(workflow).not.toBeNull();
    const step = workflow?.steps[0];
    expect(step?.type).toBe("if");

    if (step?.type === "if") {
      expect(step.condition).toBe("${steps.prev.status} == 'success'");
      expect(step.then).toHaveLength(1);
      expect(step.else).toHaveLength(1);
      expect(step.then[0].name).toBe("success-step");
      expect(step.else?.[0].name).toBe("failure-step");
    }
  });

  test("should parse parallel step", () => {
    const json = JSON.stringify({
      name: "Parallel Workflow",
      steps: [
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
            },
            {
              name: "task2",
              type: "session",
              provider: "claude-code",
              cwd: "/tmp",
            },
          ],
        },
      ],
    });

    const workflow = parseWorkflow(json);

    expect(workflow).not.toBeNull();
    const step = workflow?.steps[0];
    expect(step?.type).toBe("parallel");

    if (step?.type === "parallel") {
      expect(step.waitFor).toBe("all");
      expect(step.steps).toHaveLength(2);
      expect(step.steps[0].name).toBe("task1");
      expect(step.steps[1].name).toBe("task2");
    }
  });

  test("should parse foreach step", () => {
    const json = JSON.stringify({
      name: "Loop Workflow",
      steps: [
        {
          name: "process-files",
          type: "foreach",
          items: "${files}",
          step: {
            name: "process-file",
            type: "session",
            provider: "claude-code",
            cwd: "/tmp",
            prompt: "Process ${item}",
          },
        },
      ],
    });

    const workflow = parseWorkflow(json);

    expect(workflow).not.toBeNull();
    const step = workflow?.steps[0];
    expect(step?.type).toBe("foreach");

    if (step?.type === "foreach") {
      expect(step.items).toBe("${files}");
      expect(step.step.name).toBe("process-file");
      expect(step.step.type).toBe("session");
    }
  });

  test("should parse log step", () => {
    const json = JSON.stringify({
      name: "Log Workflow",
      steps: [
        {
          name: "log1",
          type: "log",
          message: "Processing complete",
        },
      ],
    });

    const workflow = parseWorkflow(json);

    expect(workflow).not.toBeNull();
    const step = workflow?.steps[0];
    expect(step?.type).toBe("log");

    if (step?.type === "log") {
      expect(step.message).toBe("Processing complete");
    }
  });

  test("should return null for invalid JSON", () => {
    const workflow = parseWorkflow("{ invalid json }");
    expect(workflow).toBeNull();
  });

  test("should return null for missing name", () => {
    const json = JSON.stringify({
      steps: [],
    });

    const workflow = parseWorkflow(json);
    expect(workflow).toBeNull();
  });

  test("should return null for missing steps", () => {
    const json = JSON.stringify({
      name: "Test",
    });

    const workflow = parseWorkflow(json);
    expect(workflow).toBeNull();
  });

  test("should parse workflow with global env and cwd", () => {
    const json = JSON.stringify({
      name: "Global Config",
      env: { GLOBAL_VAR: "value" },
      cwd: "/default/path",
      steps: [
        {
          name: "step1",
          type: "session",
          provider: "claude-code",
          cwd: "/tmp",
        },
      ],
    });

    const workflow = parseWorkflow(json);

    expect(workflow).not.toBeNull();
    expect(workflow?.env).toEqual({ GLOBAL_VAR: "value" });
    expect(workflow?.cwd).toBe("/default/path");
  });

  test("should handle multiple steps", () => {
    const json = JSON.stringify({
      name: "Multi-Step",
      steps: [
        {
          name: "step1",
          type: "session",
          provider: "claude-code",
          cwd: "/tmp",
        },
        {
          name: "step2",
          type: "log",
          message: "Done",
        },
        {
          name: "step3",
          type: "session",
          provider: "claude-code",
          cwd: "/tmp",
        },
      ],
    });

    const workflow = parseWorkflow(json);

    expect(workflow).not.toBeNull();
    expect(workflow?.steps).toHaveLength(3);
    expect(workflow?.steps[0].name).toBe("step1");
    expect(workflow?.steps[1].name).toBe("step2");
    expect(workflow?.steps[2].name).toBe("step3");
  });
});

describe("parseWorkflowFromYaml", () => {
  test("should parse valid YAML workflow", () => {
    const yaml = `
name: YAML Workflow
description: Test YAML parsing
steps:
  - name: step1
    type: session
    provider: claude-code
    cwd: /tmp
    prompt: Hello from YAML
`;

    const workflow = parseWorkflowFromYaml(yaml);

    expect(workflow).not.toBeNull();
    expect(workflow?.name).toBe("YAML Workflow");
    expect(workflow?.description).toBe("Test YAML parsing");
    expect(workflow?.steps).toHaveLength(1);
    expect(workflow?.steps[0].name).toBe("step1");
  });

  test("should parse YAML with arrays and objects", () => {
    const yaml = `
name: Complex YAML
steps:
  - name: session1
    type: session
    provider: claude-code
    cwd: /tmp
    args:
      - --verbose
      - --debug
    env:
      KEY1: value1
      KEY2: value2
    wait:
      - type: idle_prompt
        timeout: 5000
      - type: stop
    extract:
      result:
        type: regex
        pattern: "Result: (.*)"
`;

    const workflow = parseWorkflowFromYaml(yaml);

    expect(workflow).not.toBeNull();
    const step = workflow?.steps[0];

    if (step?.type === "session") {
      expect(step.args).toEqual(["--verbose", "--debug"]);
      expect(step.env).toEqual({ KEY1: "value1", KEY2: "value2" });
      expect(step.wait).toHaveLength(2);
      expect(step.extract?.result.type).toBe("regex");
    }
  });

  test("should return null for invalid YAML", () => {
    const yaml = `
name: Invalid
steps:
  - name: broken
    type: session
    bad_indent:
  wrong level
`;

    const workflow = parseWorkflowFromYaml(yaml);
    expect(workflow).toBeNull();
  });

  test("should parse nested conditional steps in YAML", () => {
    const yaml = `
name: Nested YAML
steps:
  - name: check
    type: if
    condition: "\${test} == 'true'"
    then:
      - name: success
        type: log
        message: Success!
    else:
      - name: failure
        type: log
        message: Failed!
`;

    const workflow = parseWorkflowFromYaml(yaml);

    expect(workflow).not.toBeNull();
    const step = workflow?.steps[0];

    if (step?.type === "if") {
      expect(step.then).toHaveLength(1);
      expect(step.else).toHaveLength(1);
    }
  });

  test("should normalize wait_for to waitFor in YAML parallel steps", () => {
    const yaml = `
name: Parallel YAML
steps:
  - name: research
    type: parallel
    wait_for: any
    steps:
      - name: child-1
        type: log
        message: one
      - name: child-2
        type: log
        message: two
`;

    const workflow = parseWorkflowFromYaml(yaml);
    expect(workflow).not.toBeNull();

    const step = workflow?.steps[0];
    expect(step?.type).toBe("parallel");

    if (step?.type === "parallel") {
      expect(step.waitFor).toBe("any");
      expect(step.steps).toHaveLength(2);
    }
  });
});

describe("substituteVariables", () => {
  test("should substitute simple variable", () => {
    const context = {
      steps: {},
      variables: { name: "World" },
    };

    const result = substituteVariables("Hello ${name}!", context);
    expect(result).toBe("Hello World!");
  });

  test("should substitute multiple variables", () => {
    const context = {
      steps: {},
      variables: { first: "John", last: "Doe" },
    };

    const result = substituteVariables("${first} ${last}", context);
    expect(result).toBe("John Doe");
  });

  test("should substitute step result", () => {
    const context = {
      steps: {
        previous: {
          status: "completed",
          extractedData: { result: "success" },
        },
      },
      variables: {},
    };

    const result = substituteVariables("Status: ${steps.previous.status}", context);
    expect(result).toBe("Status: completed");
  });

  test("should substitute nested step data", () => {
    const context = {
      steps: {
        task1: {
          status: "completed",
          extractedData: { code: "ABC123" },
        },
      },
      variables: {},
    };

    const result = substituteVariables("Code is ${steps.task1.extractedData.code}", context);
    expect(result).toBe("Code is ABC123");
  });

  test("should handle missing variable gracefully", () => {
    const context = {
      steps: {},
      variables: {},
    };

    const result = substituteVariables("Missing ${unknown}", context);
    expect(result).toBe("Missing ${unknown}");
  });

  test("should handle multiple substitutions in one string", () => {
    const context = {
      steps: {
        step1: { status: "completed" },
        step2: { status: "running" },
      },
      variables: { count: "2" },
    };

    const result = substituteVariables(
      "Step1: ${steps.step1.status}, Step2: ${steps.step2.status}, Total: ${count}",
      context
    );
    expect(result).toBe("Step1: completed, Step2: running, Total: 2");
  });

  test("should not substitute escaped variables", () => {
    const context = {
      steps: {},
      variables: { name: "test" },
    };

    const result = substituteVariables("\\${name} is ${name}", context);
    expect(result).toBe("\\${name} is test");
  });

  test("should handle non-string values", () => {
    const context = {
      steps: {},
      variables: { count: 42, enabled: true },
    };

    const result1 = substituteVariables("Count: ${count}", context);
    expect(result1).toBe("Count: 42");

    const result2 = substituteVariables("Enabled: ${enabled}", context);
    expect(result2).toBe("Enabled: true");
  });

  test("should handle objects as JSON", () => {
    const context = {
      steps: {},
      variables: { config: { key: "value", nested: { data: 123 } } },
    };

    const result = substituteVariables("Config: ${config}", context);
    expect(result).toBe('Config: {"key":"value","nested":{"data":123}}');
  });

  test("should return original string if no variables", () => {
    const context = {
      steps: {},
      variables: {},
    };

    const result = substituteVariables("No variables here", context);
    expect(result).toBe("No variables here");
  });

  test("should handle environment variable syntax", () => {
    const context = {
      steps: {},
      variables: { CWD: "/home/user", FEATURE: "login" },
    };

    const result = substituteVariables("Working in ${CWD} for ${FEATURE}", context);
    expect(result).toBe("Working in /home/user for login");
  });
});
