/**
 * Golden File Tests for Workflows
 *
 * Tests parsing and validation of real workflow examples
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseWorkflowFromYaml } from "./workflowParser";
import { validateWorkflow } from "./workflowValidator";

const FIXTURES_DIR = path.join(__dirname, "../../../../test/fixtures/workflows");

describe("Golden Workflow Files", () => {
  test("should parse and validate sequential-review.yaml", () => {
    const yamlPath = path.join(FIXTURES_DIR, "sequential-review.yaml");
    const yamlContent = fs.readFileSync(yamlPath, "utf-8");

    const workflow = parseWorkflowFromYaml(yamlContent);
    expect(workflow).not.toBeNull();

    if (workflow) {
      expect(workflow.name).toBe("Sequential Code Review");
      expect(workflow.description).toBe("Developer → Reviewer → Fixer workflow");
      expect(workflow.steps).toHaveLength(3);
      expect(workflow.env?.GLOBAL_VAR).toBe("test");

      // Validate step names
      expect(workflow.steps[0].name).toBe("developer");
      expect(workflow.steps[1].name).toBe("reviewer");
      expect(workflow.steps[2].name).toBe("fixer");

      // Validate the workflow
      const errors = validateWorkflow(workflow);
      expect(errors).toHaveLength(0);
    }
  });

  test("should parse and validate parallel-research.yaml", () => {
    const yamlPath = path.join(FIXTURES_DIR, "parallel-research.yaml");
    const yamlContent = fs.readFileSync(yamlPath, "utf-8");

    const workflow = parseWorkflowFromYaml(yamlContent);
    expect(workflow).not.toBeNull();

    if (workflow) {
      expect(workflow.name).toBe("Parallel Research");
      expect(workflow.steps).toHaveLength(2);

      // Check parallel step
      const parallelStep = workflow.steps[0];
      expect(parallelStep.type).toBe("parallel");

      if (parallelStep.type === "parallel") {
        expect(parallelStep.steps).toHaveLength(3);
        expect(parallelStep.waitFor).toBe("all");
      }

      // Validate the workflow
      const errors = validateWorkflow(workflow);
      expect(errors).toHaveLength(0);
    }
  });

  test("should parse and validate conditional-test-fix.yaml", () => {
    const yamlPath = path.join(FIXTURES_DIR, "conditional-test-fix.yaml");
    const yamlContent = fs.readFileSync(yamlPath, "utf-8");

    const workflow = parseWorkflowFromYaml(yamlContent);
    expect(workflow).not.toBeNull();

    if (workflow) {
      expect(workflow.name).toBe("Test and Fix");
      expect(workflow.steps).toHaveLength(2);

      // Check conditional step
      const conditionalStep = workflow.steps[1];
      expect(conditionalStep.type).toBe("if");

      if (conditionalStep.type === "if") {
        expect(conditionalStep.condition).toContain("steps.run-tests.test_status");
        expect(conditionalStep.then).toHaveLength(2);
        expect(conditionalStep.else).toHaveLength(1);
      }

      // Validate the workflow
      const errors = validateWorkflow(workflow);
      expect(errors).toHaveLength(0);
    }
  });

  test("should parse and validate foreach-files.yaml", () => {
    const yamlPath = path.join(FIXTURES_DIR, "foreach-files.yaml");
    const yamlContent = fs.readFileSync(yamlPath, "utf-8");

    const workflow = parseWorkflowFromYaml(yamlContent);
    expect(workflow).not.toBeNull();

    if (workflow) {
      expect(workflow.name).toBe("Process Files");
      expect(workflow.steps).toHaveLength(2);

      // Check foreach step
      const foreachStep = workflow.steps[0];
      expect(foreachStep.type).toBe("foreach");

      if (foreachStep.type === "foreach") {
        expect(foreachStep.items).toBe("${files}");
        expect(foreachStep.step.name).toBe("process-file");
      }

      // Validate the workflow
      const errors = validateWorkflow(workflow);
      expect(errors).toHaveLength(0);
    }
  });

  test("should parse and validate retry-strategy.yaml", () => {
    const yamlPath = path.join(FIXTURES_DIR, "retry-strategy.yaml");
    const yamlContent = fs.readFileSync(yamlPath, "utf-8");

    const workflow = parseWorkflowFromYaml(yamlContent);
    expect(workflow).not.toBeNull();

    if (workflow) {
      expect(workflow.name).toBe("Retry Strategy");
      expect(workflow.steps).toHaveLength(2);

      // Check retry configuration
      const retryStep = workflow.steps[0];
      expect(retryStep.type).toBe("session");

      if (retryStep.type === "session") {
        expect(retryStep.onError).toBe("retry");
        expect(retryStep.retry).toBeDefined();
        expect(retryStep.retry?.maxAttempts).toBe(3);
        expect(retryStep.retry?.delay).toBe(1000);
      }

      // Validate the workflow
      const errors = validateWorkflow(workflow);
      expect(errors).toHaveLength(0);
    }
  });

  test("should parse but fail validation for invalid-missing-cwd.yaml", () => {
    const yamlPath = path.join(FIXTURES_DIR, "invalid-missing-cwd.yaml");
    const yamlContent = fs.readFileSync(yamlPath, "utf-8");

    const workflow = parseWorkflowFromYaml(yamlContent);
    expect(workflow).not.toBeNull();

    if (workflow) {
      expect(workflow.name).toBe("Invalid Workflow - Missing CWD");

      // Validation should fail
      const errors = validateWorkflow(workflow);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.message.includes("cwd"))).toBe(true);
    }
  });

  test("should handle all step types in complex workflow", () => {
    const yamlContent = `
name: "Complex Workflow"
description: "Contains all step types"

steps:
  - name: session-step
    type: session
    provider: claude-code
    cwd: /tmp
    prompt: "Test"

  - name: parallel-step
    type: parallel
    waitFor: all
    steps:
      - name: task1
        type: log
        message: "Task 1"
      - name: task2
        type: log
        message: "Task 2"

  - name: conditional-step
    type: if
    condition: "\${test} == 'true'"
    then:
      - name: success
        type: log
        message: "Success"

  - name: loop-step
    type: foreach
    items: "\${items}"
    step:
      name: process
      type: log
      message: "Processing \${item}"

  - name: log-step
    type: log
    message: "All done"
`;

    const workflow = parseWorkflowFromYaml(yamlContent);
    expect(workflow).not.toBeNull();

    if (workflow) {
      expect(workflow.steps).toHaveLength(5);

      // Verify each step type
      expect(workflow.steps[0].type).toBe("session");
      expect(workflow.steps[1].type).toBe("parallel");
      expect(workflow.steps[2].type).toBe("if");
      expect(workflow.steps[3].type).toBe("foreach");
      expect(workflow.steps[4].type).toBe("log");

      // Validate
      const errors = validateWorkflow(workflow);
      expect(errors).toHaveLength(0);
    }
  });

  test("should validate extract configurations", () => {
    const yamlContent = `
name: "Extract Test"
steps:
  - name: extract-step
    type: session
    provider: claude-code
    cwd: /tmp
    extract:
      regex_result:
        type: regex
        pattern: "Result: (.*)"
      json_result:
        type: jsonpath
        path: "$.data.value"
      xml_result:
        type: xpath
        path: "//result/text()"
`;

    const workflow = parseWorkflowFromYaml(yamlContent);
    expect(workflow).not.toBeNull();

    if (workflow) {
      const step = workflow.steps[0];
      expect(step.type).toBe("session");

      if (step.type === "session") {
        expect(step.extract).toBeDefined();
        expect(step.extract?.regex_result.type).toBe("regex");
        expect(step.extract?.json_result.type).toBe("jsonpath");
        expect(step.extract?.xml_result.type).toBe("xpath");
      }

      // Validate
      const errors = validateWorkflow(workflow);
      expect(errors).toHaveLength(0);
    }
  });

  test("should validate wait conditions", () => {
    const yamlContent = `
name: "Wait Conditions Test"
steps:
  - name: wait-step
    type: session
    provider: claude-code
    cwd: /tmp
    wait:
      - type: idle_prompt
        timeout: 5000
      - type: permission_prompt
      - type: stop
      - type: event
        eventType: "custom-event"
      - type: timeout
        timeout: 10000
`;

    const workflow = parseWorkflowFromYaml(yamlContent);
    expect(workflow).not.toBeNull();

    if (workflow) {
      const step = workflow.steps[0];
      expect(step.type).toBe("session");

      if (step.type === "session") {
        expect(step.wait).toHaveLength(5);
        expect(step.wait?.[0].type).toBe("idle_prompt");
        expect(step.wait?.[3].type).toBe("event");
        expect(step.wait?.[3].eventType).toBe("custom-event");
      }

      // Validate
      const errors = validateWorkflow(workflow);
      expect(errors).toHaveLength(0);
    }
  });
});
