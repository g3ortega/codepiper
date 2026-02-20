/**
 * Workflow CLI commands
 */

import { readFileSync } from "node:fs";
import { load as parseYAML } from "js-yaml";
import { readErrorJson, readJson, responseErrorMessage } from "../lib/api";
import { getRequiredValue } from "../lib/args";

/**
 * Workflow create command options
 */
export interface WorkflowCreateOptions {
  file: string;
  id?: string;
  socket: string;
}

/**
 * Workflow list command options
 */
export interface WorkflowListOptions {
  socket: string;
}

/**
 * Workflow show command options
 */
export interface WorkflowShowOptions {
  workflowId: string;
  socket: string;
}

/**
 * Workflow run command options
 */
export interface WorkflowRunOptions {
  workflowId: string;
  variables: Record<string, string>;
  socket: string;
}

/**
 * Workflow status command options
 */
export interface WorkflowStatusOptions {
  executionId: string;
  socket: string;
}

/**
 * Workflow cancel command options
 */
export interface WorkflowCancelOptions {
  executionId: string;
  socket: string;
}

/**
 * Workflow logs command options
 */
export interface WorkflowLogsOptions {
  executionId: string;
  follow: boolean;
  socket: string;
}

interface WorkflowExecutionView {
  execution: {
    id: string;
    status: string;
  };
  steps?: Array<{
    stepName: string;
    status: string;
    startedAt?: string;
    completedAt?: string;
    result?: unknown;
    errorMessage?: string;
  }>;
}

interface WorkflowSummary {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  definition: {
    steps?: unknown[];
    [key: string]: unknown;
  };
}

interface WorkflowListResponse {
  workflows: WorkflowSummary[];
}

interface WorkflowShowResponse {
  workflow: WorkflowSummary;
}

interface WorkflowCreateResponse {
  workflow: {
    id: string;
    name: string;
    description?: string;
  };
}

interface WorkflowRunResponse {
  executionId: string;
  status: string;
}

interface WorkflowStatusResponse {
  execution: {
    id: string;
    workflowId: string;
    status: string;
    startedAt: string;
    completedAt?: string;
    errorMessage?: string;
  };
  steps?: Array<{
    stepName: string;
    status: string;
    sessionId?: string;
    errorMessage?: string;
  }>;
}

interface WorkflowValidationError {
  message?: string;
  path?: string;
}

/**
 * Parse workflow create command options
 */
export function parseWorkflowCreateOptions(args: string[]): WorkflowCreateOptions {
  let file: string | undefined;
  let id: string | undefined;
  let socket = "/tmp/codepiper.sock";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--socket" || arg === "-s") {
      socket = getRequiredValue(args, i, arg);
      i++;
    } else if (arg === "--id") {
      id = getRequiredValue(args, i, arg);
      i++;
    } else if (!arg.startsWith("-")) {
      if (!file) {
        file = arg;
      }
    }
  }

  if (!file) {
    throw new Error("file path is required");
  }

  const options: WorkflowCreateOptions = {
    file,
    socket,
  };
  if (id !== undefined) {
    options.id = id;
  }

  return options;
}

/**
 * Parse workflow list command options
 */
export function parseWorkflowListOptions(args: string[]): WorkflowListOptions {
  let socket = "/tmp/codepiper.sock";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--socket" || arg === "-s") {
      socket = getRequiredValue(args, i, arg);
      i++;
    }
  }

  return { socket };
}

/**
 * Parse workflow show command options
 */
export function parseWorkflowShowOptions(args: string[]): WorkflowShowOptions {
  let workflowId: string | undefined;
  let socket = "/tmp/codepiper.sock";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--socket" || arg === "-s") {
      socket = getRequiredValue(args, i, arg);
      i++;
    } else if (!arg.startsWith("-")) {
      if (!workflowId) {
        workflowId = arg;
      }
    }
  }

  if (!workflowId) {
    throw new Error("workflow ID is required");
  }

  return { workflowId, socket };
}

/**
 * Parse workflow run command options
 */
export function parseWorkflowRunOptions(args: string[]): WorkflowRunOptions {
  let workflowId: string | undefined;
  let socket = "/tmp/codepiper.sock";
  const variables: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--socket" || arg === "-s") {
      socket = getRequiredValue(args, i, arg);
      i++;
    } else if (arg === "--var" || arg === "-v") {
      const varArg = getRequiredValue(args, i, arg);
      i++;
      const match = varArg.match(/^([^=]+)=(.*)$/);
      if (!match) {
        throw new Error(`Invalid variable format: ${varArg}. Expected KEY=VALUE`);
      }
      const key = match[1];
      const value = match[2];
      if (key === undefined || value === undefined) {
        throw new Error(`Invalid variable format: ${varArg}. Expected KEY=VALUE`);
      }
      variables[key] = value;
    } else if (!arg.startsWith("-")) {
      if (!workflowId) {
        workflowId = arg;
      }
    }
  }

  if (!workflowId) {
    throw new Error("workflow ID is required");
  }

  return { workflowId, variables, socket };
}

/**
 * Parse workflow status command options
 */
export function parseWorkflowStatusOptions(args: string[]): WorkflowStatusOptions {
  let executionId: string | undefined;
  let socket = "/tmp/codepiper.sock";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--socket" || arg === "-s") {
      socket = getRequiredValue(args, i, arg);
      i++;
    } else if (!arg.startsWith("-")) {
      if (!executionId) {
        executionId = arg;
      }
    }
  }

  if (!executionId) {
    throw new Error("execution ID is required");
  }

  return { executionId, socket };
}

/**
 * Parse workflow cancel command options
 */
export function parseWorkflowCancelOptions(args: string[]): WorkflowCancelOptions {
  let executionId: string | undefined;
  let socket = "/tmp/codepiper.sock";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--socket" || arg === "-s") {
      socket = getRequiredValue(args, i, arg);
      i++;
    } else if (!arg.startsWith("-")) {
      if (!executionId) {
        executionId = arg;
      }
    }
  }

  if (!executionId) {
    throw new Error("execution ID is required");
  }

  return { executionId, socket };
}

/**
 * Parse workflow logs command options
 */
export function parseWorkflowLogsOptions(args: string[]): WorkflowLogsOptions {
  let executionId: string | undefined;
  let socket = "/tmp/codepiper.sock";
  let follow = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--socket" || arg === "-s") {
      socket = getRequiredValue(args, i, arg);
      i++;
    } else if (arg === "--follow" || arg === "-f") {
      follow = true;
    } else if (!arg.startsWith("-")) {
      if (!executionId) {
        executionId = arg;
      }
    }
  }

  if (!executionId) {
    throw new Error("execution ID is required");
  }

  return { executionId, follow, socket };
}

/**
 * Create workflow from file
 */
export async function createWorkflow(options: WorkflowCreateOptions): Promise<void> {
  // Read and parse file
  const content = readFileSync(options.file, "utf-8");
  let definition: any;

  if (options.file.endsWith(".yaml") || options.file.endsWith(".yml")) {
    definition = parseYAML(content);
  } else if (options.file.endsWith(".json")) {
    definition = JSON.parse(content);
  } else {
    throw new Error("File must be .yaml, .yml, or .json");
  }

  // Generate ID if not provided
  const id = options.id ?? crypto.randomUUID();

  // Extract name and description from definition
  const name = definition.name ?? "Unnamed Workflow";
  const description = definition.description;

  // Create workflow via API
  try {
    const response = await fetch("http://localhost/workflows", {
      unix: options.socket,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id,
        name,
        description,
        definition,
      }),
    });

    if (!response.ok) {
      const errorData = await readErrorJson(response);
      const validationErrors = Array.isArray(errorData.validationErrors)
        ? (errorData.validationErrors as WorkflowValidationError[])
        : [];

      if (response.status === 422 && validationErrors.length > 0) {
        const details = validationErrors
          .map((error) => {
            const prefix = error.path ? `${error.path}: ` : "";
            return `- ${prefix}${error.message ?? "Unknown validation error"}`;
          })
          .join("\n");
        throw new Error(`Workflow validation failed:\n${details}`);
      }

      throw new Error(responseErrorMessage(response, errorData));
    }

    const data = await readJson<WorkflowCreateResponse>(response);
    console.log(`Workflow created: ${data.workflow.id}`);
    console.log(`Name: ${data.workflow.name}`);
    if (data.workflow.description) {
      console.log(`Description: ${data.workflow.description}`);
    }
  } catch (error: any) {
    if (error.code === "ENOENT" || error.message?.includes("ENOENT")) {
      throw new Error(`Failed to connect to daemon at ${options.socket}. Is the daemon running?`);
    }
    throw error;
  }
}

/**
 * List all workflows
 */
export async function listWorkflows(options: WorkflowListOptions): Promise<void> {
  try {
    const response = await fetch("http://localhost/workflows", {
      unix: options.socket,
      method: "GET",
    });

    if (!response.ok) {
      const errorData = await readErrorJson(response);
      throw new Error(responseErrorMessage(response, errorData));
    }

    const data = await readJson<WorkflowListResponse>(response);

    if (data.workflows.length === 0) {
      console.log("No workflows found");
      return;
    }

    console.log(`Found ${data.workflows.length} workflow(s):\n`);

    for (const workflow of data.workflows) {
      console.log(`ID: ${workflow.id}`);
      console.log(`Name: ${workflow.name}`);
      if (workflow.description) {
        console.log(`Description: ${workflow.description}`);
      }
      console.log(`Created: ${new Date(workflow.createdAt).toLocaleString()}`);
      console.log(`Steps: ${workflow.definition.steps?.length ?? 0}`);
      console.log("");
    }
  } catch (error: any) {
    if (error.code === "ENOENT" || error.message?.includes("ENOENT")) {
      throw new Error(`Failed to connect to daemon at ${options.socket}. Is the daemon running?`);
    }
    throw error;
  }
}

/**
 * Show workflow definition
 */
export async function showWorkflow(options: WorkflowShowOptions): Promise<void> {
  try {
    const response = await fetch(`http://localhost/workflows/${options.workflowId}`, {
      unix: options.socket,
      method: "GET",
    });

    if (!response.ok) {
      const errorData = await readErrorJson(response);
      throw new Error(responseErrorMessage(response, errorData));
    }

    const data = await readJson<WorkflowShowResponse>(response);

    console.log(`ID: ${data.workflow.id}`);
    console.log(`Name: ${data.workflow.name}`);
    if (data.workflow.description) {
      console.log(`Description: ${data.workflow.description}`);
    }
    console.log(`Created: ${new Date(data.workflow.createdAt).toLocaleString()}`);
    console.log(`Updated: ${new Date(data.workflow.updatedAt).toLocaleString()}`);
    console.log("\nDefinition:");
    console.log(JSON.stringify(data.workflow.definition, null, 2));
  } catch (error: any) {
    if (error.code === "ENOENT" || error.message?.includes("ENOENT")) {
      throw new Error(`Failed to connect to daemon at ${options.socket}. Is the daemon running?`);
    }
    throw error;
  }
}

/**
 * Run workflow
 */
export async function runWorkflow(options: WorkflowRunOptions): Promise<void> {
  try {
    const response = await fetch(`http://localhost/workflows/${options.workflowId}/execute`, {
      unix: options.socket,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        variables: options.variables,
      }),
    });

    if (!response.ok) {
      const errorData = await readErrorJson(response);
      throw new Error(responseErrorMessage(response, errorData));
    }

    const data = await readJson<WorkflowRunResponse>(response);

    console.log(`Workflow execution started: ${data.executionId}`);
    console.log(`Status: ${data.status}`);
    console.log("\nUse 'codepiper workflow status <executionId>' to check progress");
  } catch (error: any) {
    if (error.code === "ENOENT" || error.message?.includes("ENOENT")) {
      throw new Error(`Failed to connect to daemon at ${options.socket}. Is the daemon running?`);
    }
    throw error;
  }
}

/**
 * Get workflow execution status
 */
export async function getWorkflowStatus(options: WorkflowStatusOptions): Promise<void> {
  try {
    const response = await fetch(`http://localhost/workflows/executions/${options.executionId}`, {
      unix: options.socket,
      method: "GET",
    });

    if (!response.ok) {
      const errorData = await readErrorJson(response);
      throw new Error(responseErrorMessage(response, errorData));
    }

    const data = await readJson<WorkflowStatusResponse>(response);

    console.log(`Execution ID: ${data.execution.id}`);
    console.log(`Workflow ID: ${data.execution.workflowId}`);
    console.log(`Status: ${data.execution.status}`);
    console.log(`Started: ${new Date(data.execution.startedAt).toLocaleString()}`);

    if (data.execution.completedAt) {
      console.log(`Completed: ${new Date(data.execution.completedAt).toLocaleString()}`);
    }

    if (data.execution.errorMessage) {
      console.log(`Error: ${data.execution.errorMessage}`);
    }

    if (data.steps && data.steps.length > 0) {
      console.log("\nSteps:");
      for (const step of data.steps) {
        console.log(`  - ${step.stepName}: ${step.status}`);
        if (step.sessionId) {
          console.log(`    Session: ${step.sessionId}`);
        }
        if (step.errorMessage) {
          console.log(`    Error: ${step.errorMessage}`);
        }
      }
    }
  } catch (error: any) {
    if (error.code === "ENOENT" || error.message?.includes("ENOENT")) {
      throw new Error(`Failed to connect to daemon at ${options.socket}. Is the daemon running?`);
    }
    throw error;
  }
}

/**
 * Cancel workflow execution
 */
export async function cancelWorkflow(options: WorkflowCancelOptions): Promise<void> {
  try {
    const response = await fetch(
      `http://localhost/workflows/executions/${options.executionId}/cancel`,
      {
        unix: options.socket,
        method: "POST",
      }
    );

    if (!response.ok) {
      const errorData = await readErrorJson(response);
      throw new Error(responseErrorMessage(response, errorData));
    }

    console.log(`Workflow execution cancelled: ${options.executionId}`);
  } catch (error: any) {
    if (error.code === "ENOENT" || error.message?.includes("ENOENT")) {
      throw new Error(`Failed to connect to daemon at ${options.socket}. Is the daemon running?`);
    }
    throw error;
  }
}

/**
 * Show workflow execution logs
 */
export async function showWorkflowLogs(options: WorkflowLogsOptions): Promise<void> {
  try {
    const data = await fetchWorkflowExecution(options.executionId, options.socket);
    printWorkflowExecution(data);

    if (options.follow && !isTerminalExecutionStatus(data.execution.status)) {
      console.log("Following execution updates... Press Ctrl+C to stop.\n");
      await followWorkflowLogs(options, data);
    }
  } catch (error: any) {
    if (error.code === "ENOENT" || error.message?.includes("ENOENT")) {
      throw new Error(`Failed to connect to daemon at ${options.socket}. Is the daemon running?`);
    }
    throw error;
  }
}

async function fetchWorkflowExecution(
  executionId: string,
  socket: string
): Promise<WorkflowExecutionView> {
  const response = await fetch(`http://localhost/workflows/executions/${executionId}`, {
    unix: socket,
    method: "GET",
  });

  if (!response.ok) {
    const errorData = await readErrorJson(response);
    throw new Error(responseErrorMessage(response, errorData));
  }

  return await readJson<WorkflowExecutionView>(response);
}

function printWorkflowExecution(data: WorkflowExecutionView): void {
  console.log(`Execution: ${data.execution.id}`);
  console.log(`Status: ${data.execution.status}`);
  console.log("");

  if (data.steps && data.steps.length > 0) {
    for (const step of data.steps) {
      console.log(`[${step.stepName}] ${step.status}`);
      if (step.startedAt) {
        console.log(`  Started: ${new Date(step.startedAt).toLocaleString()}`);
      }
      if (step.completedAt) {
        console.log(`  Completed: ${new Date(step.completedAt).toLocaleString()}`);
      }
      if (step.result !== undefined) {
        console.log(`  Result: ${JSON.stringify(step.result)}`);
      }
      if (step.errorMessage) {
        console.log(`  Error: ${step.errorMessage}`);
      }
      console.log("");
    }
  } else {
    console.log("No steps executed yet");
  }
}

function isTerminalExecutionStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function serializeExecutionView(data: WorkflowExecutionView): string {
  return JSON.stringify({
    status: data.execution.status,
    steps: (data.steps || []).map((step) => ({
      stepName: step.stepName,
      status: step.status,
      startedAt: step.startedAt,
      completedAt: step.completedAt,
      result: step.result,
      errorMessage: step.errorMessage,
    })),
  });
}

function getWorkflowFollowPollMs(): number {
  const raw = process.env.CODEPIPER_WORKFLOW_LOG_POLL_MS;
  if (!raw) return 1000;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;
}

async function followWorkflowLogs(
  options: WorkflowLogsOptions,
  initialData: WorkflowExecutionView
): Promise<void> {
  let stopping = false;
  let lastSnapshot = serializeExecutionView(initialData);
  const pollMs = getWorkflowFollowPollMs();

  const sigintHandler = () => {
    if (!stopping) {
      stopping = true;
      console.log("\nStopping...");
    }
  };

  process.on("SIGINT", sigintHandler);

  try {
    while (!stopping) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      if (stopping) {
        break;
      }

      const current = await fetchWorkflowExecution(options.executionId, options.socket);
      const snapshot = serializeExecutionView(current);
      if (snapshot !== lastSnapshot) {
        console.log("");
        printWorkflowExecution(current);
        lastSnapshot = snapshot;
      }

      if (isTerminalExecutionStatus(current.execution.status)) {
        break;
      }
    }
  } finally {
    process.off("SIGINT", sigintHandler);
  }
}

/**
 * Main workflow command dispatcher
 */
export async function runWorkflowCommand(args: string[]): Promise<void> {
  if (args.length === 0) {
    throw new Error("workflow subcommand required (create, list, show, run, status, cancel, logs)");
  }

  const subcommand = args[0];
  const subArgs = args.slice(1);

  switch (subcommand) {
    case "create":
      return createWorkflow(parseWorkflowCreateOptions(subArgs));
    case "list":
      return listWorkflows(parseWorkflowListOptions(subArgs));
    case "show":
      return showWorkflow(parseWorkflowShowOptions(subArgs));
    case "run":
      return runWorkflow(parseWorkflowRunOptions(subArgs));
    case "status":
      return getWorkflowStatus(parseWorkflowStatusOptions(subArgs));
    case "cancel":
      return cancelWorkflow(parseWorkflowCancelOptions(subArgs));
    case "logs":
      return showWorkflowLogs(parseWorkflowLogsOptions(subArgs));
    default:
      throw new Error(`Unknown workflow subcommand: ${subcommand}`);
  }
}
