/**
 * Tests for workflow database operations
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "./db";
import { createWorkflowDb } from "./workflowDb";

describe("WorkflowDb", () => {
  let db: Database;
  let workflowDb: ReturnType<typeof createWorkflowDb>;

  beforeEach(async () => {
    db = new Database(":memory:");
    await db.init();
    workflowDb = createWorkflowDb(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("Workflow CRUD", () => {
    test("createWorkflow - creates a new workflow", () => {
      const workflow = {
        id: "wf-1",
        name: "Test Workflow",
        description: "A test workflow",
        definition: {
          steps: [
            {
              name: "step1",
              type: "session",
              provider: "claude-code",
              prompt: "test",
            },
          ],
        },
      };

      workflowDb.createWorkflow(workflow);

      const retrieved = workflowDb.getWorkflow("wf-1");
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe("wf-1");
      expect(retrieved?.name).toBe("Test Workflow");
      expect(retrieved?.description).toBe("A test workflow");
      expect(retrieved?.definition).toEqual(workflow.definition);
      expect(retrieved?.createdAt).toBeInstanceOf(Date);
      expect(retrieved?.updatedAt).toBeInstanceOf(Date);
    });

    test("createWorkflow - workflow without description", () => {
      const workflow = {
        id: "wf-2",
        name: "Minimal Workflow",
        definition: { steps: [] },
      };

      workflowDb.createWorkflow(workflow);

      const retrieved = workflowDb.getWorkflow("wf-2");
      expect(retrieved).toBeDefined();
      expect(retrieved?.description).toBeUndefined();
    });

    test("getWorkflow - returns undefined for non-existent workflow", () => {
      const retrieved = workflowDb.getWorkflow("non-existent");
      expect(retrieved).toBeUndefined();
    });

    test("updateWorkflow - updates workflow fields", () => {
      const workflow = {
        id: "wf-3",
        name: "Original Name",
        definition: { steps: [] },
      };

      workflowDb.createWorkflow(workflow);

      workflowDb.updateWorkflow("wf-3", {
        name: "Updated Name",
        description: "Added description",
      });

      const retrieved = workflowDb.getWorkflow("wf-3");
      expect(retrieved?.name).toBe("Updated Name");
      expect(retrieved?.description).toBe("Added description");
    });

    test("updateWorkflow - updates definition", () => {
      const workflow = {
        id: "wf-4",
        name: "Test",
        definition: { steps: [] },
      };

      workflowDb.createWorkflow(workflow);

      const newDefinition = {
        steps: [{ name: "new-step", type: "session" }],
      };

      workflowDb.updateWorkflow("wf-4", {
        definition: newDefinition,
      });

      const retrieved = workflowDb.getWorkflow("wf-4");
      expect(retrieved?.definition).toEqual(newDefinition);
    });

    test("deleteWorkflow - deletes a workflow", () => {
      const workflow = {
        id: "wf-5",
        name: "To Delete",
        definition: { steps: [] },
      };

      workflowDb.createWorkflow(workflow);
      expect(workflowDb.getWorkflow("wf-5")).toBeDefined();

      workflowDb.deleteWorkflow("wf-5");
      expect(workflowDb.getWorkflow("wf-5")).toBeUndefined();
    });

    test("listWorkflows - returns all workflows", () => {
      workflowDb.createWorkflow({
        id: "wf-1",
        name: "Workflow 1",
        definition: { steps: [] },
      });

      workflowDb.createWorkflow({
        id: "wf-2",
        name: "Workflow 2",
        definition: { steps: [] },
      });

      const workflows = workflowDb.listWorkflows();
      expect(workflows).toHaveLength(2);
      expect(workflows.map((w) => w.id).sort()).toEqual(["wf-1", "wf-2"]);
    });

    test("listWorkflows - returns empty array when no workflows", () => {
      const workflows = workflowDb.listWorkflows();
      expect(workflows).toEqual([]);
    });
  });

  describe("Workflow Execution CRUD", () => {
    beforeEach(() => {
      // Create a workflow for execution tests
      workflowDb.createWorkflow({
        id: "wf-test",
        name: "Test Workflow",
        definition: { steps: [] },
      });
    });

    test("createExecution - creates a new execution", () => {
      const execution = {
        id: "exec-1",
        workflowId: "wf-test",
        status: "pending" as const,
        context: { var1: "value1" },
      };

      workflowDb.createExecution(execution);

      const retrieved = workflowDb.getExecution("exec-1");
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe("exec-1");
      expect(retrieved?.workflowId).toBe("wf-test");
      expect(retrieved?.status).toBe("pending");
      expect(retrieved?.context).toEqual({ var1: "value1" });
      expect(retrieved?.startedAt).toBeInstanceOf(Date);
      expect(retrieved?.completedAt).toBeUndefined();
      expect(retrieved?.errorMessage).toBeUndefined();
    });

    test("createExecution - execution without context", () => {
      const execution = {
        id: "exec-2",
        workflowId: "wf-test",
        status: "pending" as const,
      };

      workflowDb.createExecution(execution);

      const retrieved = workflowDb.getExecution("exec-2");
      expect(retrieved?.context).toBeUndefined();
    });

    test("getExecution - returns undefined for non-existent execution", () => {
      const retrieved = workflowDb.getExecution("non-existent");
      expect(retrieved).toBeUndefined();
    });

    test("updateExecution - updates status", () => {
      workflowDb.createExecution({
        id: "exec-3",
        workflowId: "wf-test",
        status: "pending",
      });

      workflowDb.updateExecution("exec-3", {
        status: "running",
      });

      const retrieved = workflowDb.getExecution("exec-3");
      expect(retrieved?.status).toBe("running");
    });

    test("updateExecution - updates completed_at and error_message", () => {
      workflowDb.createExecution({
        id: "exec-4",
        workflowId: "wf-test",
        status: "running",
      });

      const completedAt = new Date();
      workflowDb.updateExecution("exec-4", {
        status: "failed",
        completedAt,
        errorMessage: "Something went wrong",
      });

      const retrieved = workflowDb.getExecution("exec-4");
      expect(retrieved?.status).toBe("failed");
      expect(retrieved?.completedAt).toBeInstanceOf(Date);
      expect(retrieved?.errorMessage).toBe("Something went wrong");
    });

    test("updateExecution - updates context", () => {
      workflowDb.createExecution({
        id: "exec-5",
        workflowId: "wf-test",
        status: "running",
        context: { step1: "done" },
      });

      workflowDb.updateExecution("exec-5", {
        context: { step1: "done", step2: "done" },
      });

      const retrieved = workflowDb.getExecution("exec-5");
      expect(retrieved?.context).toEqual({ step1: "done", step2: "done" });
    });

    test("listExecutions - returns all executions for workflow", () => {
      workflowDb.createExecution({
        id: "exec-1",
        workflowId: "wf-test",
        status: "pending",
      });

      workflowDb.createExecution({
        id: "exec-2",
        workflowId: "wf-test",
        status: "running",
      });

      const executions = workflowDb.listExecutions("wf-test");
      expect(executions).toHaveLength(2);
      expect(executions.map((e) => e.id).sort()).toEqual(["exec-1", "exec-2"]);
    });

    test("listExecutions - filters by status", () => {
      workflowDb.createExecution({
        id: "exec-1",
        workflowId: "wf-test",
        status: "completed",
      });

      workflowDb.createExecution({
        id: "exec-2",
        workflowId: "wf-test",
        status: "failed",
      });

      workflowDb.createExecution({
        id: "exec-3",
        workflowId: "wf-test",
        status: "completed",
      });

      const completedExecutions = workflowDb.listExecutions("wf-test", {
        status: "completed",
      });
      expect(completedExecutions).toHaveLength(2);
      expect(completedExecutions.map((e) => e.id).sort()).toEqual(["exec-1", "exec-3"]);
    });

    test("listExecutions - returns empty array when no executions", () => {
      const executions = workflowDb.listExecutions("wf-test");
      expect(executions).toEqual([]);
    });

    test("deleteExecution - cascades to delete steps", () => {
      workflowDb.createExecution({
        id: "exec-del",
        workflowId: "wf-test",
        status: "completed",
      });

      workflowDb.createStep({
        executionId: "exec-del",
        stepName: "step1",
        status: "completed",
      });

      // Verify step exists
      const stepsBefore = workflowDb.getSteps("exec-del");
      expect(stepsBefore).toHaveLength(1);

      // Delete execution (should cascade)
      const bunDb = (db as any).db;
      const stmt = bunDb.prepare("DELETE FROM workflow_executions WHERE id = ?");
      stmt.run("exec-del");

      // Verify steps are deleted
      const stepsAfter = workflowDb.getSteps("exec-del");
      expect(stepsAfter).toEqual([]);
    });
  });

  describe("Workflow Step CRUD", () => {
    beforeEach(() => {
      // Create workflow and execution for step tests
      workflowDb.createWorkflow({
        id: "wf-test",
        name: "Test Workflow",
        definition: { steps: [] },
      });

      workflowDb.createExecution({
        id: "exec-test",
        workflowId: "wf-test",
        status: "running",
      });
    });

    test("createStep - creates a new step", () => {
      const step = {
        executionId: "exec-test",
        stepName: "step1",
        status: "pending" as const,
      };

      const stepId = workflowDb.createStep(step);

      expect(stepId).toBeGreaterThan(0);

      const steps = workflowDb.getSteps("exec-test");
      expect(steps).toHaveLength(1);
      expect(steps[0].id).toBe(stepId);
      expect(steps[0].stepName).toBe("step1");
      expect(steps[0].status).toBe("pending");
      expect(steps[0].sessionId).toBeUndefined();
      expect(steps[0].startedAt).toBeUndefined();
      expect(steps[0].completedAt).toBeUndefined();
    });

    test("createStep - creates step with session", () => {
      // Create a session first
      db.createSession({
        id: "session-1",
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });

      const step = {
        executionId: "exec-test",
        stepName: "step-with-session",
        sessionId: "session-1",
        status: "running" as const,
      };

      workflowDb.createStep(step);

      const steps = workflowDb.getSteps("exec-test");
      expect(steps[0].sessionId).toBe("session-1");
    });

    test("updateStep - updates step status and timestamps", () => {
      const stepId = workflowDb.createStep({
        executionId: "exec-test",
        stepName: "step2",
        status: "pending",
      });

      const startedAt = new Date();
      workflowDb.updateStep(stepId, {
        status: "running",
        startedAt,
      });

      const steps = workflowDb.getSteps("exec-test");
      expect(steps[0].status).toBe("running");
      expect(steps[0].startedAt).toBeInstanceOf(Date);

      const completedAt = new Date();
      workflowDb.updateStep(stepId, {
        status: "completed",
        completedAt,
        result: { output: "success" },
      });

      const updatedSteps = workflowDb.getSteps("exec-test");
      expect(updatedSteps[0].status).toBe("completed");
      expect(updatedSteps[0].completedAt).toBeInstanceOf(Date);
      expect(updatedSteps[0].result).toEqual({ output: "success" });
    });

    test("updateStep - updates error message", () => {
      const stepId = workflowDb.createStep({
        executionId: "exec-test",
        stepName: "step3",
        status: "running",
      });

      workflowDb.updateStep(stepId, {
        status: "failed",
        errorMessage: "Step failed",
      });

      const steps = workflowDb.getSteps("exec-test");
      expect(steps[0].status).toBe("failed");
      expect(steps[0].errorMessage).toBe("Step failed");
    });

    test("getSteps - returns all steps for execution in order", () => {
      workflowDb.createStep({
        executionId: "exec-test",
        stepName: "step1",
        status: "completed",
      });

      workflowDb.createStep({
        executionId: "exec-test",
        stepName: "step2",
        status: "running",
      });

      workflowDb.createStep({
        executionId: "exec-test",
        stepName: "step3",
        status: "pending",
      });

      const steps = workflowDb.getSteps("exec-test");
      expect(steps).toHaveLength(3);
      expect(steps.map((s) => s.stepName)).toEqual(["step1", "step2", "step3"]);
    });

    test("getSteps - returns empty array when no steps", () => {
      const steps = workflowDb.getSteps("exec-test");
      expect(steps).toEqual([]);
    });

    test("getSteps - filters by status", () => {
      workflowDb.createStep({
        executionId: "exec-test",
        stepName: "step1",
        status: "completed",
      });

      workflowDb.createStep({
        executionId: "exec-test",
        stepName: "step2",
        status: "failed",
      });

      workflowDb.createStep({
        executionId: "exec-test",
        stepName: "step3",
        status: "completed",
      });

      const completedSteps = workflowDb.getSteps("exec-test", { status: "completed" });
      expect(completedSteps).toHaveLength(2);
      expect(completedSteps.map((s) => s.stepName)).toEqual(["step1", "step3"]);
    });
  });

  describe("Foreign Key Constraints", () => {
    test("deleteWorkflow - cascades to delete executions", () => {
      workflowDb.createWorkflow({
        id: "wf-cascade",
        name: "Test",
        definition: { steps: [] },
      });

      workflowDb.createExecution({
        id: "exec-cascade",
        workflowId: "wf-cascade",
        status: "completed",
      });

      workflowDb.deleteWorkflow("wf-cascade");

      const execution = workflowDb.getExecution("exec-cascade");
      expect(execution).toBeUndefined();
    });

    test("deleteSession - sets session_id to null in steps", () => {
      // Create workflow and execution
      workflowDb.createWorkflow({
        id: "wf-session",
        name: "Test",
        definition: { steps: [] },
      });

      workflowDb.createExecution({
        id: "exec-session",
        workflowId: "wf-session",
        status: "running",
      });

      // Create session
      db.createSession({
        id: "session-test",
        provider: "claude-code",
        cwd: "/test",
        status: "RUNNING",
      });

      // Create step with session
      workflowDb.createStep({
        executionId: "exec-session",
        stepName: "step-with-session",
        sessionId: "session-test",
        status: "running",
      });

      // Delete session
      db.deleteSession("session-test");

      // Step should still exist but session_id should be null
      const steps = workflowDb.getSteps("exec-session");
      expect(steps).toHaveLength(1);
      expect(steps[0].sessionId).toBeUndefined();
    });
  });
});
