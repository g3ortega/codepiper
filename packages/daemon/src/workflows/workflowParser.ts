/**
 * Workflow Parser
 *
 * Parses workflow definitions from YAML/JSON and provides variable substitution
 */

import * as yaml from "js-yaml";
import type { WorkflowContext, WorkflowDefinition } from "./workflowTypes";

/**
 * Parse a workflow definition from JSON string
 *
 * @param json - JSON string containing workflow definition
 * @returns Parsed workflow or null if invalid
 */
export function parseWorkflow(json: string): WorkflowDefinition | null {
  try {
    const data = JSON.parse(json);
    return validateAndNormalizeWorkflow(data);
  } catch {
    return null;
  }
}

/**
 * Parse a workflow definition from YAML string
 *
 * @param yamlString - YAML string containing workflow definition
 * @returns Parsed workflow or null if invalid
 */
export function parseWorkflowFromYaml(yamlString: string): WorkflowDefinition | null {
  try {
    const data = yaml.load(yamlString);
    return validateAndNormalizeWorkflow(data);
  } catch {
    return null;
  }
}

/**
 * Validate and normalize workflow data
 *
 * Ensures the parsed data conforms to WorkflowDefinition interface
 */
function validateAndNormalizeWorkflow(data: unknown): WorkflowDefinition | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const obj = data as Record<string, unknown>;

  // Required fields
  if (typeof obj.name !== "string" || !obj.name) {
    return null;
  }

  if (!Array.isArray(obj.steps)) {
    return null;
  }

  // Build workflow definition
  const workflow: WorkflowDefinition = {
    name: obj.name,
    steps: normalizeWorkflowSteps(obj.steps),
  };

  // Optional fields
  if (typeof obj.description === "string") {
    workflow.description = obj.description;
  }

  if (obj.env && typeof obj.env === "object") {
    workflow.env = obj.env as Record<string, string>;
  }

  if (typeof obj.cwd === "string") {
    workflow.cwd = obj.cwd;
  }

  return workflow;
}

function normalizeWorkflowSteps(steps: unknown[]): any[] {
  return steps.map((step) => normalizeWorkflowStep(step));
}

function normalizeWorkflowStep(step: unknown): any {
  if (!step || typeof step !== "object" || Array.isArray(step)) {
    return step;
  }

  const normalized: Record<string, any> = { ...(step as Record<string, unknown>) };

  // Accept snake_case alias used by built-in YAML examples.
  if (normalized.waitFor === undefined && normalized.wait_for !== undefined) {
    normalized.waitFor = normalized.wait_for;
  }

  if (normalized.type === "parallel" && Array.isArray(normalized.steps)) {
    normalized.steps = normalizeWorkflowSteps(normalized.steps);
  }

  if (normalized.type === "if") {
    if (Array.isArray(normalized.then)) {
      // biome-ignore lint/suspicious/noThenProperty: Workflow DSL uses "then" for conditional branches.
      normalized.then = normalizeWorkflowSteps(normalized.then);
    }

    if (Array.isArray(normalized.else)) {
      normalized.else = normalizeWorkflowSteps(normalized.else);
    }
  }

  if (normalized.type === "foreach" && normalized.step) {
    normalized.step = normalizeWorkflowStep(normalized.step);
  }

  return normalized;
}

/**
 * Substitute variables in a string using workflow context
 *
 * Supports ${variable} and ${steps.stepName.field} syntax
 *
 * @param template - String containing variable placeholders
 * @param context - Workflow context with variables and step results
 * @returns String with variables substituted
 */
export function substituteVariables(template: string, context: WorkflowContext): string {
  // Match ${...} patterns (but not \${...})
  const variablePattern = /(?<!\\)\$\{([^}]+)\}/g;

  return template.replace(variablePattern, (match, path) => {
    const value = resolveVariablePath(path.trim(), context);

    if (value === undefined) {
      // Keep original if not found
      return match;
    }

    return valueToString(value);
  });
}

/**
 * Resolve a variable path in the context
 *
 * Supports:
 * - Direct variables: "name" -> context.variables.name
 * - Step results: "steps.stepName.field" -> context.steps.stepName.field
 * - Nested paths: "steps.stepName.extractedData.key"
 *
 * @param path - Dot-separated path to variable
 * @param context - Workflow context
 * @returns Resolved value or undefined
 */
function resolveVariablePath(path: string, context: WorkflowContext): unknown {
  const parts = path.split(".");

  // Check if it starts with "steps"
  if (parts[0] === "steps") {
    // Navigate through context.steps
    let current: unknown = context.steps;

    for (let i = 1; i < parts.length; i++) {
      if (!current || typeof current !== "object") {
        return undefined;
      }
      const part = parts[i];
      if (part === undefined) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  // Otherwise, look in variables
  let current: unknown = context.variables;

  for (const part of parts) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Convert a value to string for substitution
 *
 * - Primitives: toString()
 * - Objects/Arrays: JSON.stringify()
 *
 * @param value - Value to convert
 * @returns String representation
 */
function valueToString(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  // Objects and arrays -> JSON
  return JSON.stringify(value);
}
