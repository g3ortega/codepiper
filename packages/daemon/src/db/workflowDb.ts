/**
 * Workflow database operations
 */

import type { Database } from "./db";

/**
 * Workflow execution status
 */
export type WorkflowExecutionStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/**
 * Workflow step status
 */
export type WorkflowStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

/**
 * Workflow record
 */
export interface Workflow {
  id: string;
  name: string;
  description?: string;
  definition: any;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Workflow execution record
 */
export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: WorkflowExecutionStatus;
  startedAt: Date;
  completedAt?: Date;
  errorMessage?: string;
  context?: any;
}

/**
 * Workflow step record
 */
export interface WorkflowStep {
  id: number;
  executionId: string;
  stepName: string;
  sessionId?: string;
  status: WorkflowStepStatus;
  startedAt?: Date;
  completedAt?: Date;
  result?: any;
  errorMessage?: string;
}

/**
 * Workflow creation parameters
 */
export interface CreateWorkflowParams {
  id: string;
  name: string;
  description?: string;
  definition: any;
}

/**
 * Workflow update parameters
 */
export interface UpdateWorkflowParams {
  name?: string;
  description?: string;
  definition?: any;
}

/**
 * Workflow execution creation parameters
 */
export interface CreateExecutionParams {
  id: string;
  workflowId: string;
  status: WorkflowExecutionStatus;
  context?: any;
}

/**
 * Workflow execution update parameters
 */
export interface UpdateExecutionParams {
  status?: WorkflowExecutionStatus;
  completedAt?: Date;
  errorMessage?: string;
  context?: any;
}

/**
 * Workflow execution query options
 */
export interface ListExecutionsOptions {
  status?: WorkflowExecutionStatus;
  limit?: number;
}

/**
 * Workflow step creation parameters
 */
export interface CreateStepParams {
  executionId: string;
  stepName: string;
  sessionId?: string;
  status: WorkflowStepStatus;
}

/**
 * Workflow step update parameters
 */
export interface UpdateStepParams {
  sessionId?: string;
  status?: WorkflowStepStatus;
  startedAt?: Date;
  completedAt?: Date;
  result?: any;
  errorMessage?: string;
}

/**
 * Workflow step query options
 */
export interface GetStepsOptions {
  status?: WorkflowStepStatus;
}

/**
 * Workflow database interface
 */
export interface WorkflowDb {
  // Workflow operations
  createWorkflow(params: CreateWorkflowParams): void;
  getWorkflow(id: string): Workflow | undefined;
  updateWorkflow(id: string, params: UpdateWorkflowParams): void;
  deleteWorkflow(id: string): void;
  listWorkflows(): Workflow[];

  // Execution operations
  createExecution(params: CreateExecutionParams): void;
  getExecution(id: string): WorkflowExecution | undefined;
  updateExecution(id: string, params: UpdateExecutionParams): void;
  listExecutions(workflowId: string, options?: ListExecutionsOptions): WorkflowExecution[];

  // Step operations
  createStep(params: CreateStepParams): number;
  updateStep(id: number, params: UpdateStepParams): void;
  getSteps(executionId: string, options?: GetStepsOptions): WorkflowStep[];
}

/**
 * Create workflow database operations
 */
export function createWorkflowDb(db: Database): WorkflowDb {
  // Get access to underlying Bun database for raw queries
  const bunDb = (db as any).db;

  return {
    /**
     * Create a new workflow
     */
    createWorkflow(params: CreateWorkflowParams): void {
      const now = Date.now();
      const stmt = bunDb.prepare(`
        INSERT INTO workflows (
          id, name, description, definition_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        params.id,
        params.name,
        params.description ?? null,
        JSON.stringify(params.definition),
        now,
        now
      );
    },

    /**
     * Get workflow by ID
     */
    getWorkflow(id: string): Workflow | undefined {
      const stmt = bunDb.prepare("SELECT * FROM workflows WHERE id = ?");
      const row = stmt.get(id) as any;

      if (!row) return undefined;

      return mapRowToWorkflow(row);
    },

    /**
     * Update workflow fields
     */
    updateWorkflow(id: string, params: UpdateWorkflowParams): void {
      const updates: string[] = [];
      const values: unknown[] = [];

      if (params.name !== undefined) {
        updates.push("name = ?");
        values.push(params.name);
      }
      if (params.description !== undefined) {
        updates.push("description = ?");
        values.push(params.description);
      }
      if (params.definition !== undefined) {
        updates.push("definition_json = ?");
        values.push(JSON.stringify(params.definition));
      }

      // Always update updated_at
      updates.push("updated_at = ?");
      values.push(Date.now());

      values.push(id);

      const sql = `UPDATE workflows SET ${updates.join(", ")} WHERE id = ?`;
      const stmt = bunDb.prepare(sql);
      stmt.run(...values);
    },

    /**
     * Delete workflow
     */
    deleteWorkflow(id: string): void {
      const stmt = bunDb.prepare("DELETE FROM workflows WHERE id = ?");
      stmt.run(id);
    },

    /**
     * List all workflows
     */
    listWorkflows(): Workflow[] {
      const stmt = bunDb.prepare("SELECT * FROM workflows ORDER BY created_at DESC");
      const rows = stmt.all() as any[];

      return rows.map((row) => mapRowToWorkflow(row));
    },

    /**
     * Create a new execution
     */
    createExecution(params: CreateExecutionParams): void {
      const now = Date.now();
      const stmt = bunDb.prepare(`
        INSERT INTO workflow_executions (
          id, workflow_id, status, started_at, context_json
        ) VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run(
        params.id,
        params.workflowId,
        params.status,
        now,
        params.context ? JSON.stringify(params.context) : null
      );
    },

    /**
     * Get execution by ID
     */
    getExecution(id: string): WorkflowExecution | undefined {
      const stmt = bunDb.prepare("SELECT * FROM workflow_executions WHERE id = ?");
      const row = stmt.get(id) as any;

      if (!row) return undefined;

      return mapRowToExecution(row);
    },

    /**
     * Update execution fields
     */
    updateExecution(id: string, params: UpdateExecutionParams): void {
      const updates: string[] = [];
      const values: unknown[] = [];

      if (params.status !== undefined) {
        updates.push("status = ?");
        values.push(params.status);
      }
      if (params.completedAt !== undefined) {
        updates.push("completed_at = ?");
        values.push(params.completedAt.getTime());
      }
      if (params.errorMessage !== undefined) {
        updates.push("error_message = ?");
        values.push(params.errorMessage);
      }
      if (params.context !== undefined) {
        updates.push("context_json = ?");
        values.push(JSON.stringify(params.context));
      }

      if (updates.length === 0) {
        return;
      }

      values.push(id);

      const sql = `UPDATE workflow_executions SET ${updates.join(", ")} WHERE id = ?`;
      const stmt = bunDb.prepare(sql);
      stmt.run(...values);
    },

    /**
     * List executions for a workflow
     */
    listExecutions(workflowId: string, options: ListExecutionsOptions = {}): WorkflowExecution[] {
      let sql = "SELECT * FROM workflow_executions WHERE workflow_id = ?";
      const values: unknown[] = [workflowId];

      if (options.status) {
        sql += " AND status = ?";
        values.push(options.status);
      }

      sql += " ORDER BY started_at DESC";

      if (options.limit) {
        sql += " LIMIT ?";
        values.push(options.limit);
      }

      const stmt = bunDb.prepare(sql);
      const rows = stmt.all(...values) as any[];

      return rows.map((row) => mapRowToExecution(row));
    },

    /**
     * Create a new step
     */
    createStep(params: CreateStepParams): number {
      const stmt = bunDb.prepare(`
        INSERT INTO workflow_steps (
          execution_id, step_name, session_id, status
        ) VALUES (?, ?, ?, ?)
      `);

      stmt.run(params.executionId, params.stepName, params.sessionId ?? null, params.status);

      // Get last inserted row id
      const result = bunDb.query("SELECT last_insert_rowid() as id").get() as { id: number };
      return result.id;
    },

    /**
     * Update step fields
     */
    updateStep(id: number, params: UpdateStepParams): void {
      const updates: string[] = [];
      const values: unknown[] = [];

      if (params.sessionId !== undefined) {
        updates.push("session_id = ?");
        values.push(params.sessionId);
      }
      if (params.status !== undefined) {
        updates.push("status = ?");
        values.push(params.status);
      }
      if (params.startedAt !== undefined) {
        updates.push("started_at = ?");
        values.push(params.startedAt.getTime());
      }
      if (params.completedAt !== undefined) {
        updates.push("completed_at = ?");
        values.push(params.completedAt.getTime());
      }
      if (params.result !== undefined) {
        updates.push("result_json = ?");
        values.push(JSON.stringify(params.result));
      }
      if (params.errorMessage !== undefined) {
        updates.push("error_message = ?");
        values.push(params.errorMessage);
      }

      if (updates.length === 0) {
        return;
      }

      values.push(id);

      const sql = `UPDATE workflow_steps SET ${updates.join(", ")} WHERE id = ?`;
      const stmt = bunDb.prepare(sql);
      stmt.run(...values);
    },

    /**
     * Get steps for an execution
     */
    getSteps(executionId: string, options: GetStepsOptions = {}): WorkflowStep[] {
      let sql = "SELECT * FROM workflow_steps WHERE execution_id = ?";
      const values: unknown[] = [executionId];

      if (options.status) {
        sql += " AND status = ?";
        values.push(options.status);
      }

      sql += " ORDER BY id ASC";

      const stmt = bunDb.prepare(sql);
      const rows = stmt.all(...values) as any[];

      return rows.map((row) => mapRowToStep(row));
    },
  };
}

/**
 * Map database row to Workflow
 */
function mapRowToWorkflow(row: any): Workflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    definition: JSON.parse(row.definition_json),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Map database row to WorkflowExecution
 */
function mapRowToExecution(row: any): WorkflowExecution {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    status: row.status as WorkflowExecutionStatus,
    startedAt: new Date(row.started_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    errorMessage: row.error_message ?? undefined,
    context: row.context_json ? JSON.parse(row.context_json) : undefined,
  };
}

/**
 * Map database row to WorkflowStep
 */
function mapRowToStep(row: any): WorkflowStep {
  return {
    id: row.id,
    executionId: row.execution_id,
    stepName: row.step_name,
    sessionId: row.session_id ?? undefined,
    status: row.status as WorkflowStepStatus,
    startedAt: row.started_at ? new Date(row.started_at) : undefined,
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    result: row.result_json ? JSON.parse(row.result_json) : undefined,
    errorMessage: row.error_message ?? undefined,
  };
}
