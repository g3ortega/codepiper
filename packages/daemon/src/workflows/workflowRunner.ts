/**
 * WorkflowRunner - executes workflow definitions
 */

import type { EventBus } from "@codepiper/core";
import type { Database } from "../db/db";
import { createWorkflowDb } from "../db/workflowDb";
import type { SessionManager } from "../sessions/sessionManager";
import { ContextManager } from "./contextManager";
import { ResultExtractor } from "./resultExtractor";
import { WaitConditionPoller } from "./waitConditionPoller";
import type {
  ConditionalStep,
  LogStep,
  LoopStep,
  ParallelStep,
  SessionStep,
  StepResult,
  WorkflowDefinition,
  WorkflowExecution,
  WorkflowStep,
} from "./workflowTypes";

export interface WorkflowRunnerOptions {
  sessionManager: SessionManager;
  database: Database;
  eventBus: EventBus;
}

export class WorkflowRunner {
  private sessionManager: SessionManager;
  private database: Database;
  private eventBus: EventBus;
  private executions: Map<string, WorkflowExecution>;
  private poller: WaitConditionPoller;
  private extractor: ResultExtractor;

  constructor(options: WorkflowRunnerOptions) {
    this.sessionManager = options.sessionManager;
    this.database = options.database;
    this.eventBus = options.eventBus;
    this.executions = new Map();
    this.poller = new WaitConditionPoller(this.database);
    this.extractor = new ResultExtractor(this.database);
  }

  /**
   * Start workflow execution
   * @param workflow - Workflow definition
   * @param executionId - Optional execution ID (if not provided, generates new one)
   * @param variables - Initial variables for context
   * @returns Execution ID
   */
  async start(
    workflow: WorkflowDefinition,
    executionId?: string,
    variables: Record<string, any> = {}
  ): Promise<string> {
    const execId = executionId || crypto.randomUUID();
    const isNewExecution = !executionId;

    const execution: WorkflowExecution = {
      id: execId,
      workflowId: workflow.name,
      status: "running",
      startedAt: new Date(),
      context: { ...variables },
      stepResults: new Map(),
    };

    this.executions.set(execId, execution);

    // Create execution in database if this is a new execution (not passed from API)
    if (isNewExecution) {
      const workflowDb = createWorkflowDb(this.database);
      workflowDb.createExecution({
        id: execId,
        workflowId: workflow.name,
        status: "running",
        context: variables,
      });
    }

    // Execute workflow asynchronously
    this.executeWorkflow(execId, workflow).catch((error) => {
      const exec = this.executions.get(execId);
      if (exec && exec.status === "running") {
        exec.status = "failed";
        exec.error = error instanceof Error ? error.message : String(error);
        exec.completedAt = new Date();

        // Update database
        const workflowDb = createWorkflowDb(this.database);
        workflowDb.updateExecution(execId, {
          status: "failed",
          errorMessage: exec.error,
          completedAt: exec.completedAt,
        });
      }
    });

    return execId;
  }

  /**
   * Get execution by ID
   */
  getExecution(executionId: string): WorkflowExecution | undefined {
    return this.executions.get(executionId);
  }

  /**
   * List all executions
   */
  listExecutions(): WorkflowExecution[] {
    return Array.from(this.executions.values());
  }

  /**
   * Cancel running execution
   */
  async cancel(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    if (execution.status !== "running") {
      throw new Error(`Execution ${executionId} is not running`);
    }

    execution.status = "cancelled";
    execution.completedAt = new Date();

    // Update database
    const workflowDb = createWorkflowDb(this.database);
    workflowDb.updateExecution(executionId, {
      status: "cancelled",
      completedAt: execution.completedAt,
    });

    // Stop any running sessions
    for (const [_stepName, stepResult] of execution.stepResults) {
      if (stepResult.sessionId && stepResult.status === "running") {
        try {
          await this.sessionManager.stopSession(stepResult.sessionId);
        } catch {
          // Ignore errors during cleanup
        }
      }
    }
  }

  /**
   * Wait for execution to complete
   * @param executionId - Execution ID
   * @param timeout - Max wait time in ms
   */
  async waitForCompletion(executionId: string, timeout: number): Promise<void> {
    const startTime = Date.now();

    while (true) {
      const execution = this.executions.get(executionId);
      if (!execution) {
        throw new Error(`Execution ${executionId} not found`);
      }

      if (execution.status !== "running") {
        return;
      }

      if (Date.now() - startTime > timeout) {
        throw new Error(`Workflow execution timeout after ${timeout}ms`);
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Execute workflow steps
   */
  private async executeWorkflow(executionId: string, workflow: WorkflowDefinition): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    const workflowDb = createWorkflowDb(this.database);
    const contextManager = new ContextManager();

    // Initialize context with variables
    for (const [key, value] of Object.entries(execution.context)) {
      contextManager.set(key, value);
    }

    // Update execution status to running in database
    workflowDb.updateExecution(executionId, {
      status: "running",
    });

    try {
      // Execute steps sequentially
      for (const step of workflow.steps) {
        // Check if execution was cancelled
        if (execution.status === "cancelled") {
          return;
        }

        await this.executeStepWithErrorHandling(executionId, step, contextManager);
      }

      // Workflow completed successfully
      execution.status = "completed";
      execution.completedAt = new Date();

      // Update database
      workflowDb.updateExecution(executionId, {
        status: "completed",
        completedAt: execution.completedAt,
      });
    } catch (error) {
      if (execution.status !== "cancelled") {
        execution.status = "failed";
        execution.error = error instanceof Error ? error.message : String(error);
        execution.completedAt = new Date();

        // Update database
        workflowDb.updateExecution(executionId, {
          status: "failed",
          errorMessage: execution.error,
          completedAt: execution.completedAt,
        });
      }
    }
  }

  /**
   * Execute a workflow step and apply session error strategy when configured.
   */
  private async executeStepWithErrorHandling(
    executionId: string,
    step: WorkflowStep,
    contextManager: ContextManager
  ): Promise<StepResult> {
    if (step.type !== "session") {
      const result = await this.executeStep(executionId, step, contextManager);
      if (result.status === "failed") {
        throw new Error(`Step ${step.name} failed: ${result.error}`);
      }
      return result;
    }

    const maxAttempts = step.onError === "retry" ? Math.max(1, step.retry?.maxAttempts ?? 1) : 1;
    const retryDelayMs = Math.max(0, step.retry?.delay ?? 0);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const execution = this.executions.get(executionId);
      if (!execution || execution.status === "cancelled") {
        return {
          status: "skipped",
          startedAt: new Date(),
          completedAt: new Date(),
        };
      }

      const stepResult = await this.executeSessionStep(executionId, step, contextManager);
      if (stepResult.status !== "failed") {
        return stepResult;
      }

      if (step.onError === "continue") {
        return stepResult;
      }

      if (step.onError === "retry" && attempt < maxAttempts) {
        if (retryDelayMs > 0) {
          await this.sleep(retryDelayMs);
        }
        continue;
      }

      if (step.onError === "retry") {
        throw new Error(
          `Step ${step.name} failed after ${maxAttempts} attempt(s): ${stepResult.error}`
        );
      }

      throw new Error(`Step ${step.name} failed: ${stepResult.error}`);
    }

    throw new Error(`Step ${step.name} failed unexpectedly`);
  }

  /**
   * Execute a workflow step by type.
   */
  private async executeStep(
    executionId: string,
    step: WorkflowStep,
    contextManager: ContextManager
  ): Promise<StepResult> {
    switch (step.type) {
      case "session":
        return this.executeSessionStep(executionId, step, contextManager);
      case "if":
        return this.executeConditionalStep(executionId, step, contextManager);
      case "parallel":
        return this.executeParallelStep(executionId, step, contextManager);
      case "foreach":
        return this.executeLoopStep(executionId, step, contextManager);
      case "log":
        return this.executeLogStep(executionId, step, contextManager);
      default:
        return {
          status: "failed",
          error: `Unsupported step type: ${(step as { type: string }).type}`,
          startedAt: new Date(),
          completedAt: new Date(),
        };
    }
  }

  /**
   * Execute a session step.
   */
  private async executeSessionStep(
    executionId: string,
    step: SessionStep,
    contextManager: ContextManager
  ): Promise<StepResult> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    const workflowDb = createWorkflowDb(this.database);

    // Initialize step result
    const stepResult: StepResult = {
      status: "running",
      startedAt: new Date(),
    };
    execution.stepResults.set(step.name, stepResult);

    // Create step record in database
    const stepId = workflowDb.createStep({
      executionId,
      stepName: step.name,
      status: "running",
    });

    try {
      // Substitute variables in cwd and prompt
      const cwd = contextManager.substitute(step.cwd);
      const prompt = step.prompt ? contextManager.substitute(step.prompt) : undefined;

      // Create session
      const session = await this.sessionManager.createSession({
        provider: step.provider,
        cwd,
        env: step.env,
        args: step.args,
      });

      stepResult.sessionId = session.id;

      // Update step with sessionId
      workflowDb.updateStep(stepId, {
        sessionId: session.id,
        startedAt: stepResult.startedAt,
      });

      // Send prompt if provided
      if (prompt) {
        await this.sessionManager.sendText(session.id, prompt);
        await this.sessionManager.sendKeys(session.id, ["enter"]);
      }

      // Wait for conditions if provided
      if (step.wait && step.wait.length > 0) {
        await this.poller.wait(session.id, step.wait);
      }

      // Extract results if configured
      if (step.extract) {
        const extractedData: Record<string, any> = {};

        for (const [key, config] of Object.entries(step.extract)) {
          const value = await this.extractor.extract(session.id, config);
          extractedData[key] = value;

          this.setStepContextValue(contextManager, execution, step.name, key, value);
        }

        stepResult.extractedData = extractedData;
      }

      // Mark step as completed
      stepResult.status = "completed";
      stepResult.completedAt = new Date();

      // Update step in database
      workflowDb.updateStep(stepId, {
        status: "completed",
        completedAt: stepResult.completedAt,
        result: stepResult.extractedData ? JSON.stringify(stepResult.extractedData) : undefined,
      });
      return stepResult;
    } catch (error) {
      stepResult.status = "failed";
      stepResult.error = error instanceof Error ? error.message : String(error);
      stepResult.completedAt = new Date();

      // Update step in database
      workflowDb.updateStep(stepId, {
        status: "failed",
        errorMessage: stepResult.error,
        completedAt: stepResult.completedAt,
      });
      return stepResult;
    }
  }

  private async executeConditionalStep(
    executionId: string,
    step: ConditionalStep,
    contextManager: ContextManager
  ): Promise<StepResult> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    const workflowDb = createWorkflowDb(this.database);
    const stepResult: StepResult = {
      status: "running",
      startedAt: new Date(),
    };
    execution.stepResults.set(step.name, stepResult);

    const stepId = workflowDb.createStep({
      executionId,
      stepName: step.name,
      status: "running",
    });

    try {
      const conditionMatched = this.evaluateCondition(step.condition, contextManager);
      const selectedBranch = conditionMatched ? step.then : (step.else ?? []);
      const branchName = conditionMatched ? "then" : "else";

      for (const childStep of selectedBranch) {
        await this.executeStepWithErrorHandling(executionId, childStep, contextManager);
      }

      stepResult.status = "completed";
      stepResult.completedAt = new Date();
      stepResult.extractedData = {
        branch: branchName,
        matched: conditionMatched,
      };

      workflowDb.updateStep(stepId, {
        status: "completed",
        completedAt: stepResult.completedAt,
        result: JSON.stringify(stepResult.extractedData),
      });

      return stepResult;
    } catch (error) {
      stepResult.status = "failed";
      stepResult.error = error instanceof Error ? error.message : String(error);
      stepResult.completedAt = new Date();

      workflowDb.updateStep(stepId, {
        status: "failed",
        errorMessage: stepResult.error,
        completedAt: stepResult.completedAt,
      });

      return stepResult;
    }
  }

  private async executeParallelStep(
    executionId: string,
    step: ParallelStep,
    contextManager: ContextManager
  ): Promise<StepResult> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    const workflowDb = createWorkflowDb(this.database);
    const stepResult: StepResult = {
      status: "running",
      startedAt: new Date(),
    };
    execution.stepResults.set(step.name, stepResult);

    const stepId = workflowDb.createStep({
      executionId,
      stepName: step.name,
      status: "running",
    });

    try {
      const waitFor = step.waitFor ?? "all";
      const branchPromises = step.steps.map((childStep) =>
        this.executeParallelBranch(executionId, childStep, contextManager)
      );

      if (waitFor === "none") {
        // Fire-and-forget branch execution: workflow continues immediately.
        for (const promise of branchPromises) {
          void promise.catch(() => {
            // Branch errors are intentionally decoupled from parent step completion.
          });
        }

        stepResult.status = "completed";
        stepResult.completedAt = new Date();
        stepResult.extractedData = {
          waitFor,
          launched: step.steps.length,
        };

        workflowDb.updateStep(stepId, {
          status: "completed",
          completedAt: stepResult.completedAt,
          result: JSON.stringify(stepResult.extractedData),
        });

        return stepResult;
      }

      if (waitFor === "any") {
        try {
          const winner = await Promise.any(
            branchPromises.map(async (promise) => {
              const result = await promise;
              if (result.status === "completed") {
                return result;
              }
              throw new Error(result.error ?? `${result.stepName} failed`);
            })
          );

          stepResult.status = "completed";
          stepResult.completedAt = new Date();
          stepResult.extractedData = {
            waitFor,
            winner: winner.stepName,
            launched: step.steps.length,
          };

          workflowDb.updateStep(stepId, {
            status: "completed",
            completedAt: stepResult.completedAt,
            result: JSON.stringify(stepResult.extractedData),
          });

          return stepResult;
        } catch {
          const settled = await Promise.all(branchPromises);
          const failed = settled.filter((result) => result.status === "failed");
          throw new Error(
            `Parallel step ${step.name} failed: no branch completed successfully (${failed
              .map((branch) => branch.stepName)
              .join(", ")})`
          );
        }
      }

      // waitFor === "all" (default)
      const childResults = await Promise.all(branchPromises);
      const completedCount = childResults.filter((result) => result.status === "completed").length;
      const failed = childResults.filter((result) => result.status === "failed");

      if (failed.length > 0) {
        throw new Error(
          `Parallel branches failed: ${failed
            .map((branch) => `${branch.stepName} (${branch.error ?? "unknown error"})`)
            .join(", ")}`
        );
      }

      stepResult.status = "completed";
      stepResult.completedAt = new Date();
      stepResult.extractedData = {
        waitFor,
        completed: completedCount,
        failed: failed.length,
      };

      workflowDb.updateStep(stepId, {
        status: "completed",
        completedAt: stepResult.completedAt,
        result: JSON.stringify(stepResult.extractedData),
      });

      return stepResult;
    } catch (error) {
      stepResult.status = "failed";
      stepResult.error = error instanceof Error ? error.message : String(error);
      stepResult.completedAt = new Date();

      workflowDb.updateStep(stepId, {
        status: "failed",
        errorMessage: stepResult.error,
        completedAt: stepResult.completedAt,
      });

      return stepResult;
    }
  }

  private async executeParallelBranch(
    executionId: string,
    childStep: WorkflowStep,
    contextManager: ContextManager
  ): Promise<{ stepName: string; status: "completed" | "failed"; error?: string }> {
    try {
      await this.executeStepWithErrorHandling(executionId, childStep, contextManager);
      return { stepName: childStep.name, status: "completed" };
    } catch (error) {
      return {
        stepName: childStep.name,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeLoopStep(
    executionId: string,
    step: LoopStep,
    contextManager: ContextManager
  ): Promise<StepResult> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    const workflowDb = createWorkflowDb(this.database);
    const stepResult: StepResult = {
      status: "running",
      startedAt: new Date(),
    };
    execution.stepResults.set(step.name, stepResult);

    const stepId = workflowDb.createStep({
      executionId,
      stepName: step.name,
      status: "running",
    });

    const previousContext = contextManager.getAllContext();

    try {
      const items = this.resolveLoopItems(step.items, contextManager);
      const iterationStepNames: string[] = [];

      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        contextManager.set("item", item);
        contextManager.set("index", index);

        const iterationStep: WorkflowStep = {
          ...step.step,
          name: `${step.step.name}[${index}]`,
        };
        iterationStepNames.push(iterationStep.name);

        await this.executeStepWithErrorHandling(executionId, iterationStep, contextManager);
      }

      this.setStepContextValue(contextManager, execution, step.name, "results", items);

      stepResult.status = "completed";
      stepResult.completedAt = new Date();
      stepResult.extractedData = {
        iterations: items.length,
        stepNames: iterationStepNames,
      };

      workflowDb.updateStep(stepId, {
        status: "completed",
        completedAt: stepResult.completedAt,
        result: JSON.stringify(stepResult.extractedData),
      });

      return stepResult;
    } catch (error) {
      stepResult.status = "failed";
      stepResult.error = error instanceof Error ? error.message : String(error);
      stepResult.completedAt = new Date();

      workflowDb.updateStep(stepId, {
        status: "failed",
        errorMessage: stepResult.error,
        completedAt: stepResult.completedAt,
      });

      return stepResult;
    } finally {
      if ("item" in previousContext) {
        contextManager.set("item", previousContext.item);
      } else {
        contextManager.set("item", undefined);
      }

      if ("index" in previousContext) {
        contextManager.set("index", previousContext.index);
      } else {
        contextManager.set("index", undefined);
      }
    }
  }

  private async executeLogStep(
    executionId: string,
    step: LogStep,
    contextManager: ContextManager
  ): Promise<StepResult> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    const workflowDb = createWorkflowDb(this.database);
    const stepResult: StepResult = {
      status: "running",
      startedAt: new Date(),
    };
    execution.stepResults.set(step.name, stepResult);

    const stepId = workflowDb.createStep({
      executionId,
      stepName: step.name,
      status: "running",
    });

    try {
      const message = contextManager.substitute(step.message);

      stepResult.status = "completed";
      stepResult.completedAt = new Date();
      stepResult.extractedData = { message };

      workflowDb.updateStep(stepId, {
        status: "completed",
        completedAt: stepResult.completedAt,
        result: JSON.stringify(stepResult.extractedData),
      });

      return stepResult;
    } catch (error) {
      stepResult.status = "failed";
      stepResult.error = error instanceof Error ? error.message : String(error);
      stepResult.completedAt = new Date();

      workflowDb.updateStep(stepId, {
        status: "failed",
        errorMessage: stepResult.error,
        completedAt: stepResult.completedAt,
      });

      return stepResult;
    }
  }

  private evaluateCondition(condition: string, contextManager: ContextManager): boolean {
    const substituted = contextManager.substitute(condition).trim();
    if (!substituted) {
      return false;
    }

    if (substituted.includes("${")) {
      throw new Error(`Unresolved variable in condition: ${condition}`);
    }

    const match = substituted.match(/^(.*?)(===|!==|==|!=|>=|<=|>|<)(.*)$/);
    if (!match) {
      return this.toBoolean(this.parseConditionValue(substituted));
    }

    const leftRaw = match[1];
    const operator = match[2];
    const rightRaw = match[3];
    if (leftRaw === undefined || operator === undefined || rightRaw === undefined) {
      return false;
    }
    const left = this.parseConditionValue(leftRaw);
    const right = this.parseConditionValue(rightRaw);

    switch (operator) {
      case "===":
        return left === right;
      case "!==":
        return left !== right;
      case "==":
        return this.areConditionValuesEqual(left, right);
      case "!=":
        return !this.areConditionValuesEqual(left, right);
      case ">":
        return this.compareValues(left, right) > 0;
      case "<":
        return this.compareValues(left, right) < 0;
      case ">=":
        return this.compareValues(left, right) >= 0;
      case "<=":
        return this.compareValues(left, right) <= 0;
      default:
        return false;
    }
  }

  private parseConditionValue(raw: string): unknown {
    const value = raw.trim();
    if (value === "") {
      return "";
    }

    const quotedMatch = value.match(/^(['"])(.*)\1$/);
    if (quotedMatch) {
      return quotedMatch[2];
    }

    if (value === "true") return true;
    if (value === "false") return false;
    if (value === "null") return null;
    if (value === "undefined") return undefined;

    const num = Number(value);
    if (!Number.isNaN(num)) {
      return num;
    }

    return value;
  }

  private compareValues(left: unknown, right: unknown): number {
    if (typeof left === "number" && typeof right === "number") {
      return left - right;
    }

    return String(left).localeCompare(String(right));
  }

  private areConditionValuesEqual(left: unknown, right: unknown): boolean {
    if (left === right) {
      return true;
    }

    if (typeof left === "number" && typeof right === "string") {
      const parsed = Number(right);
      return !Number.isNaN(parsed) && left === parsed;
    }

    if (typeof left === "string" && typeof right === "number") {
      const parsed = Number(left);
      return !Number.isNaN(parsed) && parsed === right;
    }

    return String(left) === String(right);
  }

  private toBoolean(value: unknown): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      return normalized !== "" && normalized !== "false" && normalized !== "0";
    }
    return Boolean(value);
  }

  private resolveLoopItems(itemsExpr: string, contextManager: ContextManager): unknown[] {
    const exactVariableMatch = itemsExpr.trim().match(/^\$\{([^}]+)\}$/);
    let resolved: unknown;

    if (exactVariableMatch) {
      const variablePath = exactVariableMatch[1];
      resolved = variablePath ? contextManager.get(variablePath.trim()) : undefined;
    } else {
      resolved = contextManager.substitute(itemsExpr);
    }

    if (Array.isArray(resolved)) {
      return resolved;
    }

    if (typeof resolved === "string") {
      const trimmed = resolved.trim();
      if (!trimmed) {
        return [];
      }

      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        // Fall through to comma-delimited values.
      }

      if (trimmed.includes(",")) {
        return trimmed
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
      }

      return [trimmed];
    }

    throw new Error(`Foreach step expected array-like items, got ${typeof resolved}`);
  }

  private setStepContextValue(
    contextManager: ContextManager,
    execution: WorkflowExecution,
    stepName: string,
    key: string,
    value: unknown
  ): void {
    const steps = contextManager.get("steps");
    const stepsObj: Record<string, any> =
      steps && typeof steps === "object" && !Array.isArray(steps) ? steps : {};
    const stepObj: Record<string, any> =
      stepsObj[stepName] &&
      typeof stepsObj[stepName] === "object" &&
      !Array.isArray(stepsObj[stepName])
        ? stepsObj[stepName]
        : {};

    stepObj[key] = value;
    stepsObj[stepName] = stepObj;
    contextManager.set("steps", stepsObj);

    const executionSteps: Record<string, any> =
      execution.context.steps &&
      typeof execution.context.steps === "object" &&
      !Array.isArray(execution.context.steps)
        ? execution.context.steps
        : {};
    const executionStepObj: Record<string, any> =
      executionSteps[stepName] &&
      typeof executionSteps[stepName] === "object" &&
      !Array.isArray(executionSteps[stepName])
        ? executionSteps[stepName]
        : {};

    executionStepObj[key] = value;
    executionSteps[stepName] = executionStepObj;
    execution.context.steps = executionSteps;

    // Keep dotted-path compatibility for older callers.
    execution.context[`steps.${stepName}.${key}`] = value;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
