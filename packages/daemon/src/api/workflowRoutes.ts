/**
 * Workflow API route handlers
 */

import {
  createWorkflowDb,
  type WorkflowDb,
  type WorkflowExecution,
  type WorkflowExecutionStatus,
} from "../db/workflowDb";
import { parseWorkflow } from "../workflows/workflowParser";
import { WorkflowRunner } from "../workflows/workflowRunner";
import { validateWorkflow } from "../workflows/workflowValidator";
import type { RouteContext } from "./routes";

const activeWorkflowRunners = new Map<string, WorkflowRunner>();
const EXECUTION_TRACK_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours
type CancellationMode = "runner" | "fallback";
const VALID_WORKFLOW_EXECUTION_STATUSES = new Set<WorkflowExecutionStatus>([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

interface CancellationMetrics {
  runner: number;
  fallback: number;
  runnerErrors: number;
}

const cancellationMetrics: CancellationMetrics = {
  runner: 0,
  fallback: 0,
  runnerErrors: 0,
};

function recordCancellation(mode: CancellationMode): void {
  cancellationMetrics[mode] += 1;

  if (mode !== "fallback") {
    return;
  }

  const total = cancellationMetrics.runner + cancellationMetrics.fallback;
  const fallbackRate = total > 0 ? cancellationMetrics.fallback / total : 0;

  // Emit periodic alert when cancellation relies heavily on DB-only fallback path.
  if (
    cancellationMetrics.fallback === 1 ||
    (fallbackRate >= 0.25 && cancellationMetrics.fallback % 5 === 0)
  ) {
    console.warn(
      `[workflow] cancellation fallback path used ${cancellationMetrics.fallback}/${total} times (${(fallbackRate * 100).toFixed(1)}%). Check runner lifecycle tracking.`
    );
  }
}

function getCancellationMetricsSnapshot(): CancellationMetrics {
  return { ...cancellationMetrics };
}

function withCancellationMeta(context: unknown, mode: CancellationMode): Record<string, any> {
  const base =
    context && typeof context === "object" && !Array.isArray(context)
      ? { ...(context as Record<string, any>) }
      : {};

  const existingMeta =
    base.__codepiperMeta &&
    typeof base.__codepiperMeta === "object" &&
    !Array.isArray(base.__codepiperMeta)
      ? (base.__codepiperMeta as Record<string, any>)
      : {};

  base.__codepiperMeta = {
    ...existingMeta,
    cancellation: {
      mode,
      timestamp: new Date().toISOString(),
    },
  };

  return base;
}

async function trackExecutionLifecycle(executionId: string, runner: WorkflowRunner): Promise<void> {
  try {
    await runner.waitForCompletion(executionId, EXECUTION_TRACK_TIMEOUT_MS);
  } catch (error) {
    // Timeout or unexpected runner error should not crash route handling.
    console.warn(`[workflow] execution tracking ended for ${executionId}:`, error);
  } finally {
    activeWorkflowRunners.delete(executionId);
  }
}

export function clearActiveWorkflowRunnersForTests(): void {
  activeWorkflowRunners.clear();
  cancellationMetrics.runner = 0;
  cancellationMetrics.fallback = 0;
  cancellationMetrics.runnerErrors = 0;
}

export function registerActiveWorkflowRunnerForTests(
  executionId: string,
  runner: WorkflowRunner
): void {
  activeWorkflowRunners.set(executionId, runner);
}

export function getWorkflowCancellationMetricsForTests(): CancellationMetrics {
  return getCancellationMetricsSnapshot();
}

function resolveExecutionForRoute(
  workflowDb: WorkflowDb,
  executionId: string,
  workflowId?: string
): { execution: WorkflowExecution } | { response: Response } {
  const execution = workflowDb.getExecution(executionId);
  if (!execution) {
    return {
      response: Response.json({ error: `Execution not found: ${executionId}` }, { status: 404 }),
    };
  }

  if (workflowId && execution.workflowId !== workflowId) {
    return {
      response: Response.json({ error: `Execution not found: ${executionId}` }, { status: 404 }),
    };
  }

  return { execution };
}

async function getExecutionWithSteps(
  ctx: RouteContext,
  executionId: string,
  workflowId?: string
): Promise<Response> {
  try {
    const workflowDb = createWorkflowDb(ctx.db);
    const resolved = resolveExecutionForRoute(workflowDb, executionId, workflowId);
    if ("response" in resolved) {
      return resolved.response;
    }

    const steps = workflowDb.getSteps(executionId);
    return Response.json({ execution: resolved.execution, steps });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

async function cancelExecutionById(
  ctx: RouteContext,
  executionId: string,
  workflowId?: string
): Promise<Response> {
  try {
    const workflowDb = createWorkflowDb(ctx.db);
    const resolved = resolveExecutionForRoute(workflowDb, executionId, workflowId);
    if ("response" in resolved) {
      return resolved.response;
    }
    const execution = resolved.execution;

    // Check if execution can be cancelled
    if (
      execution.status === "completed" ||
      execution.status === "failed" ||
      execution.status === "cancelled"
    ) {
      return Response.json(
        { error: `Cannot cancel execution with status: ${execution.status}` },
        { status: 400 }
      );
    }

    let cancelMode: CancellationMode;
    const runner = activeWorkflowRunners.get(executionId);
    if (runner) {
      try {
        await runner.cancel(executionId);
        activeWorkflowRunners.delete(executionId);
      } catch (error) {
        cancellationMetrics.runnerErrors += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[workflow] failed to cancel execution ${executionId} via runner path: ${message}`
        );
        return Response.json(
          { error: "Failed to cancel active workflow execution" },
          { status: 500 }
        );
      }
      cancelMode = "runner";
      recordCancellation(cancelMode);
    } else {
      // Fallback for stale/missing in-memory runner references
      // (e.g. daemon restart between execute and cancel).
      workflowDb.updateExecution(executionId, {
        status: "cancelled",
        completedAt: new Date(),
      });
      cancelMode = "fallback";
      recordCancellation(cancelMode);
    }

    workflowDb.updateExecution(executionId, {
      context: withCancellationMeta(execution.context, cancelMode),
    });
    const metrics = getCancellationMetricsSnapshot();
    console.info(
      `[workflow] cancelled execution ${executionId} via ${cancelMode} path` +
        ` (runner=${metrics.runner}, fallback=${metrics.fallback}, runnerErrors=${metrics.runnerErrors})`
    );

    return Response.json({ success: true, cancelMode });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * POST /workflows - Create a new workflow
 */
export async function handleCreateWorkflow(req: Request, ctx: RouteContext): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  // Validate required fields
  if (!body.id) {
    return Response.json({ error: "Missing required field: id" }, { status: 400 });
  }
  if (!body.name) {
    return Response.json({ error: "Missing required field: name" }, { status: 400 });
  }
  if (!body.definition) {
    return Response.json({ error: "Missing required field: definition" }, { status: 400 });
  }

  if (
    typeof body.definition !== "object" ||
    body.definition === null ||
    Array.isArray(body.definition)
  ) {
    return Response.json(
      { error: "Invalid workflow definition: expected object" },
      { status: 400 }
    );
  }

  try {
    const rawDefinition: Record<string, unknown> = {
      ...(body.definition as Record<string, unknown>),
      name: body.name,
    };
    if (body.description !== undefined && rawDefinition.description === undefined) {
      rawDefinition.description = body.description;
    }

    const parsedDefinition = parseWorkflow(JSON.stringify(rawDefinition));
    if (!parsedDefinition) {
      return Response.json({ error: "Invalid workflow definition format" }, { status: 400 });
    }

    const validationErrors = validateWorkflow(parsedDefinition);
    if (validationErrors.length > 0) {
      return Response.json(
        {
          error: "Workflow definition validation failed",
          validationErrors,
        },
        { status: 422 }
      );
    }

    const workflowDb = createWorkflowDb(ctx.db);

    workflowDb.createWorkflow({
      id: body.id,
      name: body.name,
      description: body.description,
      definition: parsedDefinition,
    });

    const workflow = workflowDb.getWorkflow(body.id);

    return Response.json({ workflow }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("UNIQUE constraint failed")) {
      return Response.json({ error: `Workflow already exists: ${body.id}` }, { status: 409 });
    }

    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * GET /workflows - List all workflows
 */
export async function handleListWorkflows(_req: Request, ctx: RouteContext): Promise<Response> {
  try {
    const workflowDb = createWorkflowDb(ctx.db);
    const workflows = workflowDb.listWorkflows();

    return Response.json({ workflows });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * GET /workflows/:id - Get a specific workflow
 */
export async function handleGetWorkflow(
  _req: Request,
  ctx: RouteContext,
  workflowId: string
): Promise<Response> {
  try {
    const workflowDb = createWorkflowDb(ctx.db);
    const workflow = workflowDb.getWorkflow(workflowId);

    if (!workflow) {
      return Response.json({ error: `Workflow not found: ${workflowId}` }, { status: 404 });
    }

    return Response.json({ workflow });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /workflows/:id - Delete a workflow
 */
export async function handleDeleteWorkflow(
  _req: Request,
  ctx: RouteContext,
  workflowId: string
): Promise<Response> {
  try {
    const workflowDb = createWorkflowDb(ctx.db);

    // Check if workflow exists
    const workflow = workflowDb.getWorkflow(workflowId);
    if (!workflow) {
      return Response.json({ error: `Workflow not found: ${workflowId}` }, { status: 404 });
    }

    workflowDb.deleteWorkflow(workflowId);

    return Response.json({ success: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * POST /workflows/:id/execute - Start workflow execution
 */
export async function handleExecuteWorkflow(
  req: Request,
  ctx: RouteContext,
  workflowId: string
): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  try {
    const variables = body.variables ?? {};
    if (typeof variables !== "object" || variables === null || Array.isArray(variables)) {
      return Response.json({ error: "Invalid variables: expected object" }, { status: 400 });
    }

    const workflowDb = createWorkflowDb(ctx.db);

    // Check if workflow exists
    const workflow = workflowDb.getWorkflow(workflowId);
    if (!workflow) {
      return Response.json({ error: `Workflow not found: ${workflowId}` }, { status: 404 });
    }

    // Generate execution ID
    const executionId = crypto.randomUUID();

    // Create execution record with pending status
    workflowDb.createExecution({
      id: executionId,
      workflowId,
      status: "pending",
      context: variables,
    });

    // Start workflow execution in background
    if (ctx.sessionManager) {
      const runner = new WorkflowRunner({
        sessionManager: ctx.sessionManager,
        database: ctx.db,
        eventBus: ctx.eventBus,
      });

      activeWorkflowRunners.set(executionId, runner);

      // Run in background - don't await
      runner
        .start(workflow.definition, executionId, variables as Record<string, any>)
        .then(() => {
          void trackExecutionLifecycle(executionId, runner);
        })
        .catch((error) => {
          console.error(`Workflow execution ${executionId} failed:`, error);
          workflowDb.updateExecution(executionId, {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : String(error),
          });
          activeWorkflowRunners.delete(executionId);
        });
    }

    return Response.json(
      {
        executionId,
        status: "pending",
      },
      { status: 202 }
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * GET /workflows/:id/executions - List executions for a workflow
 */
export async function handleListExecutions(
  req: Request,
  ctx: RouteContext,
  workflowId: string
): Promise<Response> {
  try {
    const workflowDb = createWorkflowDb(ctx.db);

    // Parse query parameters
    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status");
    const limitParam = url.searchParams.get("limit");

    const options: any = {};

    if (statusParam !== null) {
      if (!VALID_WORKFLOW_EXECUTION_STATUSES.has(statusParam as WorkflowExecutionStatus)) {
        return Response.json(
          {
            error:
              "Invalid status query parameter. Must be one of: pending, running, completed, failed, cancelled",
          },
          { status: 422 }
        );
      }
      options.status = statusParam;
    }

    if (limitParam !== null) {
      if (!/^\d+$/.test(limitParam)) {
        return Response.json(
          { error: "Invalid limit query parameter. Must be a positive integer" },
          { status: 422 }
        );
      }
      const parsedLimit = Number.parseInt(limitParam, 10);
      if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
        return Response.json(
          { error: "Invalid limit query parameter. Must be a positive integer" },
          { status: 422 }
        );
      }
      options.limit = parsedLimit;
    }

    const executions = workflowDb.listExecutions(workflowId, options);

    return Response.json({ executions });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * GET /workflows/:id/executions/:execId - Get execution status
 */
export async function handleGetExecution(
  _req: Request,
  ctx: RouteContext,
  workflowId: string,
  executionId: string
): Promise<Response> {
  return getExecutionWithSteps(ctx, executionId, workflowId);
}

/**
 * GET /workflows/executions/:execId - Get execution status by execution ID
 */
export async function handleGetExecutionById(
  _req: Request,
  ctx: RouteContext,
  executionId: string
): Promise<Response> {
  return getExecutionWithSteps(ctx, executionId);
}

/**
 * POST /workflows/:id/executions/:execId/cancel - Cancel execution
 */
export async function handleCancelExecution(
  _req: Request,
  ctx: RouteContext,
  workflowId: string,
  executionId: string
): Promise<Response> {
  return cancelExecutionById(ctx, executionId, workflowId);
}

/**
 * POST /workflows/executions/:execId/cancel - Cancel execution by execution ID
 */
export async function handleCancelExecutionById(
  _req: Request,
  ctx: RouteContext,
  executionId: string
): Promise<Response> {
  return cancelExecutionById(ctx, executionId);
}
