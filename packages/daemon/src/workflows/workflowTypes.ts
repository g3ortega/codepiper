/**
 * Workflow types and definitions
 */

import type { ProviderId } from "@codepiper/core";

/**
 * Wait condition types
 */
export type WaitConditionType = "idle_prompt" | "permission_prompt" | "stop" | "event" | "timeout";

/**
 * Wait condition definition
 */
export interface WaitCondition {
  type: WaitConditionType;
  eventType?: string; // For type=event
  timeout?: number; // Max wait time in ms
}

/**
 * Result extraction types
 */
export type ExtractType = "regex" | "jsonpath" | "xpath";

/**
 * Result extraction configuration
 */
export interface ExtractConfig {
  type: ExtractType;
  pattern?: string; // For regex
  path?: string; // For jsonpath/xpath
}

/**
 * Step types
 */
export type StepType = "session" | "if" | "parallel" | "foreach" | "log";

/**
 * Error handling strategy
 */
export type ErrorStrategy = "continue" | "fail" | "retry";

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxAttempts: number;
  delay: number; // ms
}

/**
 * Base step definition
 */
export interface BaseStep {
  name: string;
  type: StepType;
}

/**
 * Session step - spawns a new session
 */
export interface SessionStep extends BaseStep {
  type: "session";
  provider: ProviderId;
  cwd: string;
  args?: string[];
  env?: Record<string, string>;
  prompt?: string;
  wait?: WaitCondition[];
  extract?: Record<string, ExtractConfig>;
  onError?: ErrorStrategy;
  retry?: RetryConfig;
}

/**
 * Conditional step
 */
export interface ConditionalStep extends BaseStep {
  type: "if";
  condition: string;
  then: WorkflowStep[];
  else?: WorkflowStep[];
}

/**
 * Parallel step
 */
export interface ParallelStep extends BaseStep {
  type: "parallel";
  steps: WorkflowStep[];
  waitFor: "all" | "any" | "none";
}

/**
 * Loop step
 */
export interface LoopStep extends BaseStep {
  type: "foreach";
  items: string; // Variable reference like "${files}"
  step: WorkflowStep;
}

/**
 * Log step - outputs a message
 */
export interface LogStep extends BaseStep {
  type: "log";
  message: string;
}

/**
 * Union of all step types
 */
export type WorkflowStep = SessionStep | ConditionalStep | ParallelStep | LoopStep | LogStep;

/**
 * Workflow definition
 */
export interface WorkflowDefinition {
  name: string;
  description?: string;
  steps: WorkflowStep[];
  env?: Record<string, string>;
  cwd?: string;
}

/**
 * Step execution status
 */
export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

/**
 * Step execution result
 */
export interface StepResult {
  status: StepStatus;
  sessionId?: string;
  extractedData?: Record<string, any>;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * Workflow execution status
 */
export type WorkflowStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/**
 * Workflow execution state
 */
export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: WorkflowStatus;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  context: Record<string, any>;
  stepResults: Map<string, StepResult>;
}

/**
 * Workflow context - variables passed between steps
 */
export interface WorkflowContext {
  /** Step results indexed by step name */
  steps: Record<string, StepResult>;

  /** Global variables */
  variables: Record<string, unknown>;
}

/**
 * Workflow validation error
 */
export interface WorkflowValidationError {
  /** Error message */
  message: string;

  /** Path to the error in the workflow definition */
  path?: string;

  /** Step name where error occurred */
  stepName?: string;
}
