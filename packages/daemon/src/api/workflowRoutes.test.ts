/**
 * Tests for workflow API routes
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Database } from "../db/db";
import { createWorkflowDb } from "../db/workflowDb";
import type { RouteContext } from "./routes";
import {
  clearActiveWorkflowRunnersForTests,
  getWorkflowCancellationMetricsForTests,
  handleCancelExecution,
  handleCancelExecutionById,
  handleCreateWorkflow,
  handleDeleteWorkflow,
  handleExecuteWorkflow,
  handleGetExecution,
  handleGetExecutionById,
  handleGetWorkflow,
  handleListExecutions,
  handleListWorkflows,
  registerActiveWorkflowRunnerForTests,
} from "./workflowRoutes";

describe("Workflow API Routes", () => {
  let db: Database;
  let ctx: RouteContext;

  beforeEach(async () => {
    clearActiveWorkflowRunnersForTests();

    db = new Database(":memory:");
    await db.init();

    // Create minimal context for routes
    ctx = {
      db,
      sessionManager: {} as any,
      eventBus: {} as any,
      policyEngine: {} as any,
      auditLogger: {} as any,
    };
  });

  afterEach(() => {
    clearActiveWorkflowRunnersForTests();
    mock.restore();
    db.close();
  });

  describe("POST /workflows - Create workflow", () => {
    test("creates a new workflow", async () => {
      const req = new Request("http://localhost/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "wf-1",
          name: "Test Workflow",
          description: "A test workflow",
          definition: {
            steps: [
              {
                name: "step1",
                type: "session",
                provider: "claude-code",
                cwd: "/tmp",
              },
            ],
          },
        }),
      });

      const response = await handleCreateWorkflow(req, ctx);
      expect(response.status).toBe(201);

      const data = await response.json();
      expect(data.workflow).toBeDefined();
      expect(data.workflow.id).toBe("wf-1");
      expect(data.workflow.name).toBe("Test Workflow");
      expect(data.workflow.description).toBe("A test workflow");
    });

    test("creates workflow without description", async () => {
      const req = new Request("http://localhost/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "wf-2",
          name: "Minimal Workflow",
          definition: {
            steps: [
              {
                name: "log-step",
                type: "log",
                message: "hello",
              },
            ],
          },
        }),
      });

      const response = await handleCreateWorkflow(req, ctx);
      expect(response.status).toBe(201);

      const data = await response.json();
      expect(data.workflow.description).toBeUndefined();
    });

    test("returns 409 when workflow id already exists", async () => {
      const createRequest = new Request("http://localhost/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "wf-dup",
          name: "Duplicate Workflow",
          definition: {
            steps: [
              {
                name: "log-step",
                type: "log",
                message: "hello",
              },
            ],
          },
        }),
      });

      const firstResponse = await handleCreateWorkflow(createRequest, ctx);
      expect(firstResponse.status).toBe(201);

      const duplicateRequest = new Request("http://localhost/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "wf-dup",
          name: "Duplicate Workflow",
          definition: {
            steps: [
              {
                name: "log-step",
                type: "log",
                message: "hello",
              },
            ],
          },
        }),
      });

      const duplicateResponse = await handleCreateWorkflow(duplicateRequest, ctx);
      expect(duplicateResponse.status).toBe(409);

      const data = await duplicateResponse.json();
      expect(data.error).toContain("already exists");
    });

    test("returns 400 if id is missing", async () => {
      const req = new Request("http://localhost/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test",
          definition: {},
        }),
      });

      const response = await handleCreateWorkflow(req, ctx);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain("id");
    });

    test("returns 400 if name is missing", async () => {
      const req = new Request("http://localhost/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "wf-1",
          definition: {},
        }),
      });

      const response = await handleCreateWorkflow(req, ctx);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain("name");
    });

    test("returns 400 if definition is missing", async () => {
      const req = new Request("http://localhost/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "wf-1",
          name: "Test",
        }),
      });

      const response = await handleCreateWorkflow(req, ctx);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain("definition");
    });

    test("returns 400 if definition is not an object", async () => {
      const req = new Request("http://localhost/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "wf-3",
          name: "Bad Workflow",
          definition: [],
        }),
      });

      const response = await handleCreateWorkflow(req, ctx);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain("definition");
    });

    test("returns 422 for invalid workflow definition shape", async () => {
      const req = new Request("http://localhost/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "wf-4",
          name: "Invalid Workflow",
          definition: {
            steps: [
              {
                name: "broken-session",
                type: "session",
                provider: "claude-code",
              },
            ],
          },
        }),
      });

      const response = await handleCreateWorkflow(req, ctx);
      expect(response.status).toBe(422);

      const data = await response.json();
      expect(data.error).toContain("validation");
      expect(Array.isArray(data.validationErrors)).toBe(true);
      expect(data.validationErrors.length).toBeGreaterThan(0);
    });

    test("normalizes wait_for in submitted workflow definition", async () => {
      const req = new Request("http://localhost/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "wf-5",
          name: "Normalized Workflow",
          definition: {
            steps: [
              {
                name: "parallel-step",
                type: "parallel",
                wait_for: "any",
                steps: [
                  {
                    name: "child-1",
                    type: "log",
                    message: "one",
                  },
                  {
                    name: "child-2",
                    type: "log",
                    message: "two",
                  },
                ],
              },
            ],
          },
        }),
      });

      const response = await handleCreateWorkflow(req, ctx);
      expect(response.status).toBe(201);

      const data = await response.json();
      expect(data.workflow.definition.steps[0].waitFor).toBe("any");
    });

    test("returns 400 if body is invalid JSON", async () => {
      const req = new Request("http://localhost/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json",
      });

      const response = await handleCreateWorkflow(req, ctx);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain("JSON");
    });
  });

  describe("GET /workflows - List workflows", () => {
    test("returns empty array when no workflows", async () => {
      const req = new Request("http://localhost/workflows");
      const response = await handleListWorkflows(req, ctx);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.workflows).toEqual([]);
    });

    test("returns all workflows", async () => {
      const workflowDb = createWorkflowDb(db);

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

      const req = new Request("http://localhost/workflows");
      const response = await handleListWorkflows(req, ctx);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.workflows).toHaveLength(2);
      expect(data.workflows.map((w: any) => w.id).sort()).toEqual(["wf-1", "wf-2"]);
    });
  });

  describe("GET /workflows/:id - Get workflow", () => {
    test("returns workflow by id", async () => {
      const workflowDb = createWorkflowDb(db);

      workflowDb.createWorkflow({
        id: "wf-1",
        name: "Test Workflow",
        description: "A test",
        definition: { steps: [{ name: "step1" }] },
      });

      const req = new Request("http://localhost/workflows/wf-1");
      const response = await handleGetWorkflow(req, ctx, "wf-1");

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.workflow.id).toBe("wf-1");
      expect(data.workflow.name).toBe("Test Workflow");
      expect(data.workflow.definition).toEqual({ steps: [{ name: "step1" }] });
    });

    test("returns 404 if workflow not found", async () => {
      const req = new Request("http://localhost/workflows/non-existent");
      const response = await handleGetWorkflow(req, ctx, "non-existent");

      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toContain("not found");
    });
  });

  describe("DELETE /workflows/:id - Delete workflow", () => {
    test("deletes a workflow", async () => {
      const workflowDb = createWorkflowDb(db);

      workflowDb.createWorkflow({
        id: "wf-del",
        name: "To Delete",
        definition: { steps: [] },
      });

      const req = new Request("http://localhost/workflows/wf-del");
      const response = await handleDeleteWorkflow(req, ctx, "wf-del");

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);

      // Verify deletion
      const deleted = workflowDb.getWorkflow("wf-del");
      expect(deleted).toBeUndefined();
    });

    test("returns 404 if workflow not found", async () => {
      const req = new Request("http://localhost/workflows/non-existent");
      const response = await handleDeleteWorkflow(req, ctx, "non-existent");

      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toContain("not found");
    });
  });

  describe("POST /workflows/:id/execute - Execute workflow", () => {
    beforeEach(() => {
      const workflowDb = createWorkflowDb(db);
      workflowDb.createWorkflow({
        id: "wf-exec",
        name: "Executable Workflow",
        definition: {
          steps: [
            {
              name: "step1",
              type: "session",
              provider: "claude-code",
              cwd: "/tmp",
            },
          ],
        },
      });
    });

    test("starts workflow execution", async () => {
      const req = new Request("http://localhost/workflows/wf-exec/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variables: { CWD: "/test" },
        }),
      });

      const response = await handleExecuteWorkflow(req, ctx, "wf-exec");
      expect(response.status).toBe(202);

      const data = await response.json();
      expect(data.executionId).toBeDefined();
      expect(data.status).toBe("pending");
    });

    test("starts execution without variables", async () => {
      const req = new Request("http://localhost/workflows/wf-exec/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const response = await handleExecuteWorkflow(req, ctx, "wf-exec");
      expect(response.status).toBe(202);
    });

    test("returns 404 if workflow not found", async () => {
      const req = new Request("http://localhost/workflows/non-existent/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const response = await handleExecuteWorkflow(req, ctx, "non-existent");
      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toContain("not found");
    });

    test("returns 400 if body is invalid JSON", async () => {
      const req = new Request("http://localhost/workflows/wf-exec/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid json",
      });

      const response = await handleExecuteWorkflow(req, ctx, "wf-exec");
      expect(response.status).toBe(400);
    });

    test("returns 400 if variables is not an object", async () => {
      const req = new Request("http://localhost/workflows/wf-exec/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variables: "not-an-object",
        }),
      });

      const response = await handleExecuteWorkflow(req, ctx, "wf-exec");
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain("variables");
    });
  });

  describe("GET /workflows/:id/executions - List executions", () => {
    beforeEach(() => {
      const workflowDb = createWorkflowDb(db);
      workflowDb.createWorkflow({
        id: "wf-list-exec",
        name: "Test Workflow",
        definition: { steps: [] },
      });
    });

    test("returns empty array when no executions", async () => {
      const req = new Request("http://localhost/workflows/wf-list-exec/executions");
      const response = await handleListExecutions(req, ctx, "wf-list-exec");

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.executions).toEqual([]);
    });

    test("returns all executions for workflow", async () => {
      const workflowDb = createWorkflowDb(db);

      workflowDb.createExecution({
        id: "exec-1",
        workflowId: "wf-list-exec",
        status: "completed",
      });

      workflowDb.createExecution({
        id: "exec-2",
        workflowId: "wf-list-exec",
        status: "failed",
      });

      const req = new Request("http://localhost/workflows/wf-list-exec/executions");
      const response = await handleListExecutions(req, ctx, "wf-list-exec");

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.executions).toHaveLength(2);
    });

    test("filters executions by status", async () => {
      const workflowDb = createWorkflowDb(db);

      workflowDb.createExecution({
        id: "exec-1",
        workflowId: "wf-list-exec",
        status: "completed",
      });

      workflowDb.createExecution({
        id: "exec-2",
        workflowId: "wf-list-exec",
        status: "failed",
      });

      const req = new Request(
        "http://localhost/workflows/wf-list-exec/executions?status=completed"
      );
      const response = await handleListExecutions(req, ctx, "wf-list-exec");

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.executions).toHaveLength(1);
      expect(data.executions[0].id).toBe("exec-1");
    });

    test("limits number of results", async () => {
      const workflowDb = createWorkflowDb(db);

      for (let i = 0; i < 10; i++) {
        workflowDb.createExecution({
          id: `exec-${i}`,
          workflowId: "wf-list-exec",
          status: "completed",
        });
      }

      const req = new Request("http://localhost/workflows/wf-list-exec/executions?limit=5");
      const response = await handleListExecutions(req, ctx, "wf-list-exec");

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.executions).toHaveLength(5);
    });

    test("returns 422 for invalid status query parameter", async () => {
      const req = new Request("http://localhost/workflows/wf-list-exec/executions?status=unknown");
      const response = await handleListExecutions(req, ctx, "wf-list-exec");

      expect(response.status).toBe(422);
      const data = await response.json();
      expect(data.error).toContain("Invalid status query parameter");
    });

    test("returns 422 for invalid limit query parameter", async () => {
      const req = new Request("http://localhost/workflows/wf-list-exec/executions?limit=0");
      const response = await handleListExecutions(req, ctx, "wf-list-exec");

      expect(response.status).toBe(422);
      const data = await response.json();
      expect(data.error).toContain("Invalid limit query parameter");
    });
  });

  describe("GET /workflows/:id/executions/:execId - Get execution", () => {
    beforeEach(() => {
      const workflowDb = createWorkflowDb(db);
      workflowDb.createWorkflow({
        id: "wf-get-exec",
        name: "Test Workflow",
        definition: { steps: [] },
      });

      workflowDb.createExecution({
        id: "exec-get",
        workflowId: "wf-get-exec",
        status: "running",
        context: { var1: "value1" },
      });
    });

    test("returns execution with steps", async () => {
      const workflowDb = createWorkflowDb(db);

      workflowDb.createStep({
        executionId: "exec-get",
        stepName: "step1",
        status: "completed",
      });

      workflowDb.createStep({
        executionId: "exec-get",
        stepName: "step2",
        status: "running",
      });

      const req = new Request("http://localhost/workflows/wf-get-exec/executions/exec-get");
      const response = await handleGetExecution(req, ctx, "wf-get-exec", "exec-get");

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.execution.id).toBe("exec-get");
      expect(data.execution.status).toBe("running");
      expect(data.execution.context).toEqual({ var1: "value1" });
      expect(data.steps).toHaveLength(2);
      expect(data.steps.map((s: any) => s.stepName)).toEqual(["step1", "step2"]);
    });

    test("returns 404 if execution not found", async () => {
      const req = new Request("http://localhost/workflows/wf-get-exec/executions/non-existent");
      const response = await handleGetExecution(req, ctx, "wf-get-exec", "non-existent");

      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toContain("not found");
    });

    test("returns 404 when execution does not belong to workflow", async () => {
      const workflowDb = createWorkflowDb(db);
      workflowDb.createWorkflow({
        id: "wf-other",
        name: "Other Workflow",
        definition: { steps: [] },
      });
      workflowDb.createExecution({
        id: "exec-other",
        workflowId: "wf-other",
        status: "running",
      });

      const req = new Request("http://localhost/workflows/wf-get-exec/executions/exec-other");
      const response = await handleGetExecution(req, ctx, "wf-get-exec", "exec-other");

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain("not found");
    });

    test("supports execution lookup without workflow ID", async () => {
      const req = new Request("http://localhost/workflows/executions/exec-get");
      const response = await handleGetExecutionById(req, ctx, "exec-get");

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.execution.id).toBe("exec-get");
      expect(data.execution.workflowId).toBe("wf-get-exec");
    });
  });

  describe("POST /workflows/:id/executions/:execId/cancel - Cancel execution", () => {
    beforeEach(() => {
      const workflowDb = createWorkflowDb(db);
      workflowDb.createWorkflow({
        id: "wf-cancel",
        name: "Test Workflow",
        definition: { steps: [] },
      });

      workflowDb.createExecution({
        id: "exec-cancel",
        workflowId: "wf-cancel",
        status: "running",
      });
    });

    test("cancels a running execution", async () => {
      const req = new Request(
        "http://localhost/workflows/wf-cancel/executions/exec-cancel/cancel",
        {
          method: "POST",
        }
      );

      const response = await handleCancelExecution(req, ctx, "wf-cancel", "exec-cancel");

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.cancelMode).toBe("fallback");

      // Verify execution was cancelled
      const workflowDb = createWorkflowDb(db);
      const execution = workflowDb.getExecution("exec-cancel");
      expect(execution?.status).toBe("cancelled");
      expect((execution?.context as any)?.__codepiperMeta?.cancellation?.mode).toBe("fallback");
      expect(getWorkflowCancellationMetricsForTests()).toEqual({
        runner: 0,
        fallback: 1,
        runnerErrors: 0,
      });
    });

    test("uses active runner cancellation when available", async () => {
      const workflowDb = createWorkflowDb(db);
      const cancelMock = mock(async (executionId: string) => {
        workflowDb.updateExecution(executionId, {
          status: "cancelled",
          completedAt: new Date(),
        });
      });

      registerActiveWorkflowRunnerForTests("exec-cancel", {
        cancel: cancelMock,
      } as any);

      const req = new Request(
        "http://localhost/workflows/wf-cancel/executions/exec-cancel/cancel",
        {
          method: "POST",
        }
      );

      const response = await handleCancelExecution(req, ctx, "wf-cancel", "exec-cancel");
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.cancelMode).toBe("runner");
      expect(cancelMock).toHaveBeenCalledWith("exec-cancel");

      const execution = workflowDb.getExecution("exec-cancel");
      expect(execution?.status).toBe("cancelled");
      expect((execution?.context as any)?.__codepiperMeta?.cancellation?.mode).toBe("runner");
      expect(getWorkflowCancellationMetricsForTests()).toEqual({
        runner: 1,
        fallback: 0,
        runnerErrors: 0,
      });
    });

    test("returns 500 and increments error metric when runner cancel fails", async () => {
      const cancelMock = mock(async () => {
        throw new Error("runner cancel failed");
      });

      registerActiveWorkflowRunnerForTests("exec-cancel", {
        cancel: cancelMock,
      } as any);

      const req = new Request(
        "http://localhost/workflows/wf-cancel/executions/exec-cancel/cancel",
        {
          method: "POST",
        }
      );

      const response = await handleCancelExecution(req, ctx, "wf-cancel", "exec-cancel");
      expect(response.status).toBe(500);

      const data = await response.json();
      expect(data.error).toContain("Failed to cancel active workflow execution");

      const workflowDb = createWorkflowDb(db);
      const execution = workflowDb.getExecution("exec-cancel");
      expect(execution?.status).toBe("running");
      expect(getWorkflowCancellationMetricsForTests()).toEqual({
        runner: 0,
        fallback: 0,
        runnerErrors: 1,
      });
    });

    test("returns 404 if execution not found", async () => {
      const req = new Request(
        "http://localhost/workflows/wf-cancel/executions/non-existent/cancel",
        {
          method: "POST",
        }
      );

      const response = await handleCancelExecution(req, ctx, "wf-cancel", "non-existent");

      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.error).toContain("not found");
    });

    test("returns 404 when execution does not belong to workflow", async () => {
      const workflowDb = createWorkflowDb(db);
      workflowDb.createWorkflow({
        id: "wf-other-cancel",
        name: "Other Cancel Workflow",
        definition: { steps: [] },
      });
      workflowDb.createExecution({
        id: "exec-other-cancel",
        workflowId: "wf-other-cancel",
        status: "running",
      });

      const req = new Request(
        "http://localhost/workflows/wf-cancel/executions/exec-other-cancel/cancel",
        {
          method: "POST",
        }
      );
      const response = await handleCancelExecution(req, ctx, "wf-cancel", "exec-other-cancel");

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain("not found");
    });

    test("supports execution cancel without workflow ID", async () => {
      const req = new Request("http://localhost/workflows/executions/exec-cancel/cancel", {
        method: "POST",
      });
      const response = await handleCancelExecutionById(req, ctx, "exec-cancel");

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.cancelMode).toBe("fallback");
    });

    test("returns 400 if execution already completed", async () => {
      const workflowDb = createWorkflowDb(db);

      workflowDb.createExecution({
        id: "exec-completed",
        workflowId: "wf-cancel",
        status: "completed",
      });

      const req = new Request(
        "http://localhost/workflows/wf-cancel/executions/exec-completed/cancel",
        {
          method: "POST",
        }
      );

      const response = await handleCancelExecution(req, ctx, "wf-cancel", "exec-completed");

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain("Cannot cancel");
    });
  });
});
