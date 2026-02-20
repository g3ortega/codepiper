/**
 * Integration tests for workflow API routes
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { EventBus } from "@codepiper/core";
import { Database } from "../db/db";
import { SessionManager } from "../sessions/sessionManager";
import { createServer } from "./server";
import { clearActiveWorkflowRunnersForTests } from "./workflowRoutes";

describe("Workflow Routes Integration", () => {
  let socketPath: string;
  let server: Awaited<ReturnType<typeof createServer>>;
  let sessionManager: SessionManager;

  let db: Database;
  let eventBus: EventBus;

  beforeEach(async () => {
    clearActiveWorkflowRunnersForTests();

    // Use unique socket path for each test to avoid conflicts
    socketPath = `/tmp/codepiper-test-workflow-${Math.random().toString(36).substring(7)}.sock`;

    // Clean up socket if it exists
    try {
      unlinkSync(socketPath);
    } catch {
      // Ignore
    }

    db = new Database(":memory:");
    await db.init();
    eventBus = new EventBus();

    sessionManager = new SessionManager(db, eventBus);

    server = await createServer(socketPath, sessionManager, db, eventBus);
  });

  afterEach(async () => {
    clearActiveWorkflowRunnersForTests();

    // Stop all sessions before closing server/DB to avoid "closed database" errors
    if (sessionManager) {
      await sessionManager.stopAll();
    }
    await server.stop();
  });

  test("full workflow lifecycle", async () => {
    // 1. Create a workflow
    const createResponse = await fetch("http://localhost/workflows", {
      unix: socketPath,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "test-wf",
        name: "Test Workflow",
        description: "Integration test workflow",
        definition: {
          steps: [
            {
              name: "step1",
              type: "session",
              provider: "claude-code",
              cwd: "/tmp",
              prompt: "test",
            },
          ],
        },
      }),
    });

    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    expect(created.workflow.id).toBe("test-wf");

    // 2. List workflows
    const listResponse = await fetch("http://localhost/workflows", {
      unix: socketPath,
    });

    expect(listResponse.status).toBe(200);
    const listed = await listResponse.json();
    expect(listed.workflows).toHaveLength(1);
    expect(listed.workflows[0].id).toBe("test-wf");

    // 3. Get workflow
    const getResponse = await fetch("http://localhost/workflows/test-wf", {
      unix: socketPath,
    });

    expect(getResponse.status).toBe(200);
    const retrieved = await getResponse.json();
    expect(retrieved.workflow.name).toBe("Test Workflow");

    // 4. Execute workflow
    const executeResponse = await fetch("http://localhost/workflows/test-wf/execute", {
      unix: socketPath,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        variables: { CWD: "/test" },
      }),
    });

    expect(executeResponse.status).toBe(202);
    const executed = await executeResponse.json();
    expect(executed.executionId).toBeDefined();
    const executionId = executed.executionId;

    // 5. List executions
    const listExecResponse = await fetch("http://localhost/workflows/test-wf/executions", {
      unix: socketPath,
    });

    expect(listExecResponse.status).toBe(200);
    const listedExec = await listExecResponse.json();
    expect(listedExec.executions).toHaveLength(1);
    expect(listedExec.executions[0].id).toBe(executionId);

    // 6. Get execution status (nested route)
    const getExecResponse = await fetch(
      `http://localhost/workflows/test-wf/executions/${executionId}`,
      {
        unix: socketPath,
      }
    );

    expect(getExecResponse.status).toBe(200);
    const execStatus = await getExecResponse.json();
    expect(execStatus.execution.id).toBe(executionId);
    // Status may be "pending" or "running" depending on timing — the background
    // runner may have started before this check fires
    expect(["pending", "running"]).toContain(execStatus.execution.status);

    // 7. Get execution status (execution-centric route)
    const getExecByIdResponse = await fetch(
      `http://localhost/workflows/executions/${executionId}`,
      {
        unix: socketPath,
      }
    );
    expect(getExecByIdResponse.status).toBe(200);
    const execByIdStatus = await getExecByIdResponse.json();
    expect(execByIdStatus.execution.id).toBe(executionId);

    // 8. Nested route enforces workflow ownership
    const wrongWorkflowResponse = await fetch(
      `http://localhost/workflows/wrong-id/executions/${executionId}`,
      {
        unix: socketPath,
      }
    );
    expect(wrongWorkflowResponse.status).toBe(404);

    // 9. Cancel execution (execution-centric route)
    const cancelResponse = await fetch(
      `http://localhost/workflows/executions/${executionId}/cancel`,
      {
        unix: socketPath,
        method: "POST",
      }
    );

    expect(cancelResponse.status).toBe(200);
    const cancelBody = await cancelResponse.json();
    expect(cancelBody.success).toBe(true);
    expect(["runner", "fallback"]).toContain(cancelBody.cancelMode);

    // 10. Verify cancellation
    const verifyResponse = await fetch(
      `http://localhost/workflows/test-wf/executions/${executionId}`,
      {
        unix: socketPath,
      }
    );

    const verified = await verifyResponse.json();
    expect(verified.execution.status).toBe("cancelled");
    expect(["runner", "fallback"]).toContain(
      verified.execution.context?.__codepiperMeta?.cancellation?.mode
    );

    // 11. Delete workflow
    const deleteResponse = await fetch("http://localhost/workflows/test-wf", {
      unix: socketPath,
      method: "DELETE",
    });

    expect(deleteResponse.status).toBe(200);

    // 12. Verify deletion
    const verifyDeleteResponse = await fetch("http://localhost/workflows/test-wf", {
      unix: socketPath,
    });

    expect(verifyDeleteResponse.status).toBe(404);
  });

  test("workflow with multiple executions", async () => {
    // Create workflow
    await fetch("http://localhost/workflows", {
      unix: socketPath,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "multi-exec-wf",
        name: "Multi Execution Workflow",
        definition: {
          steps: [
            {
              name: "log-step",
              type: "log",
              message: "ready",
            },
          ],
        },
      }),
    });

    // Create multiple executions
    const execIds: string[] = [];

    for (let i = 0; i < 3; i++) {
      const response = await fetch("http://localhost/workflows/multi-exec-wf/execute", {
        unix: socketPath,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const data = await response.json();
      execIds.push(data.executionId);
    }

    // List all executions
    const listResponse = await fetch("http://localhost/workflows/multi-exec-wf/executions", {
      unix: socketPath,
    });

    const listed = await listResponse.json();
    expect(listed.executions).toHaveLength(3);

    // Verify all execution IDs are present
    const listedIds = listed.executions.map((e: any) => e.id);
    for (const id of execIds) {
      expect(listedIds).toContain(id);
    }
  });

  // NOTE: "workflow execution filtering by status" integration test removed — empty-step
  // workflows complete instantly in the background runner, making cancel-before-complete
  // impossible. The filtering logic is covered by unit tests in workflowRoutes.test.ts.
});
