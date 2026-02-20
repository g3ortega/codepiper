/**
 * Workflow Validator
 *
 * Validates workflow structure, dependencies, and configurations
 */

import { type KnownProviderId, SUPPORTED_PROVIDERS } from "@codepiper/core";
import { getProviderDefinition } from "../providers/registry";
import type {
  ConditionalStep,
  ExtractConfig,
  LoopStep,
  ParallelStep,
  SessionStep,
  WaitCondition,
  WorkflowDefinition,
  WorkflowStep,
  WorkflowValidationError,
} from "./workflowTypes";

const VALID_PROVIDERS: readonly KnownProviderId[] = [...SUPPORTED_PROVIDERS];
const VALID_WAIT_TYPES = ["idle_prompt", "permission_prompt", "stop", "event", "timeout"];
const VALID_EXTRACT_TYPES = ["regex", "jsonpath", "xpath"];
const VALID_ERROR_STRATEGIES = ["continue", "fail", "retry"];
const WAIT_TYPES_REQUIRING_HOOKS = new Set<WaitCondition["type"]>([
  "idle_prompt",
  "permission_prompt",
  "stop",
  "event",
]);

function isKnownProviderId(value: string): value is KnownProviderId {
  return VALID_PROVIDERS.includes(value as KnownProviderId);
}

/**
 * Validate a workflow definition
 *
 * Checks:
 * - Workflow structure
 * - Step configurations
 * - Variable references
 * - Circular dependencies
 * - Required fields
 *
 * @param workflow - Workflow to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateWorkflow(workflow: WorkflowDefinition): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = [];

  // Validate top-level structure
  if (!workflow.steps || workflow.steps.length === 0) {
    errors.push({
      message: "Workflow must have at least one step",
      path: "steps",
    });
    return errors;
  }

  // Check for duplicate step names
  const stepNames = new Set<string>();
  const duplicates = new Set<string>();

  for (const step of workflow.steps) {
    if (stepNames.has(step.name)) {
      duplicates.add(step.name);
    }
    stepNames.add(step.name);
  }

  for (const name of duplicates) {
    errors.push({
      message: `Duplicate step name: ${name}`,
      path: "steps",
      stepName: name,
    });
  }

  // Validate each step
  for (const step of workflow.steps) {
    errors.push(...validateStep(step, `steps.${step.name}`));
  }

  // Check for circular dependencies
  const circularErrors = detectCircularDependencies(workflow.steps);
  errors.push(...circularErrors);

  return errors;
}

/**
 * Validate a single step
 */
function validateStep(step: WorkflowStep, path: string): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = [];

  // Validate based on step type
  switch (step.type) {
    case "session":
      errors.push(...validateSessionStep(step, path));
      break;
    case "if":
      errors.push(...validateConditionalStep(step, path));
      break;
    case "parallel":
      errors.push(...validateParallelStep(step, path));
      break;
    case "foreach":
      errors.push(...validateLoopStep(step, path));
      break;
    case "log":
      errors.push(...validateLogStep(step, path));
      break;
    default: {
      // Keeps runtime safety if parser types drift in the future.
      // Compile-time exhaustiveness guard for WorkflowStep unions.
      const unknownStep = step as { type?: unknown };
      const _exhaustive: never = step;
      void _exhaustive;
      errors.push({
        message: `Unknown step type: ${String(unknownStep.type)}`,
        path,
      });
    }
  }

  return errors;
}

/**
 * Validate session step
 */
function validateSessionStep(step: SessionStep, path: string): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = [];
  const providerCapabilities =
    step.provider && isKnownProviderId(step.provider)
      ? getProviderDefinition(step.provider).capabilities
      : undefined;

  // Required fields
  if (!step.provider) {
    errors.push({
      message: "Session step requires 'provider' field",
      path: `${path}.provider`,
      stepName: step.name,
    });
  } else if (!isKnownProviderId(step.provider)) {
    errors.push({
      message: `Invalid provider: ${step.provider}. Must be one of: ${VALID_PROVIDERS.join(", ")}`,
      path: `${path}.provider`,
      stepName: step.name,
    });
  }

  if (!step.cwd) {
    errors.push({
      message: "Session step requires 'cwd' field",
      path: `${path}.cwd`,
      stepName: step.name,
    });
  }

  // Validate wait conditions
  if (step.wait) {
    for (let i = 0; i < step.wait.length; i++) {
      const waitCondition = step.wait[i];
      if (!waitCondition) {
        continue;
      }
      errors.push(...validateWaitCondition(waitCondition, `${path}.wait[${i}]`, step.name));
      if (
        providerCapabilities &&
        !providerCapabilities.nativeHooks &&
        WAIT_TYPES_REQUIRING_HOOKS.has(waitCondition.type)
      ) {
        errors.push({
          message: `Provider ${step.provider} does not support wait condition type '${waitCondition.type}' (requires native hooks)`,
          path: `${path}.wait[${i}].type`,
          stepName: step.name,
        });
      }
    }
  }

  // Validate extract config
  if (step.extract) {
    for (const [key, config] of Object.entries(step.extract)) {
      errors.push(...validateExtractConfig(config, `${path}.extract.${key}`, step.name));
      if (providerCapabilities && !providerCapabilities.supportsTranscriptTailing) {
        errors.push({
          message: `Provider ${step.provider} does not support extract config '${key}' (requires transcript tailing)`,
          path: `${path}.extract.${key}`,
          stepName: step.name,
        });
      }
    }
  }

  // Validate error handling
  if (step.onError && !VALID_ERROR_STRATEGIES.includes(step.onError)) {
    errors.push({
      message: `Invalid error strategy: ${step.onError}. Must be one of: ${VALID_ERROR_STRATEGIES.join(", ")}`,
      path: `${path}.onError`,
      stepName: step.name,
    });
  }

  // Validate retry config
  if (step.onError === "retry" && !step.retry) {
    errors.push({
      message: "Retry configuration required when onError is 'retry'",
      path: `${path}.retry`,
      stepName: step.name,
    });
  }

  if (step.retry) {
    if (!step.retry.maxAttempts || step.retry.maxAttempts < 1) {
      errors.push({
        message: "Retry maxAttempts must be at least 1",
        path: `${path}.retry.maxAttempts`,
        stepName: step.name,
      });
    }

    if (step.retry.delay === undefined || step.retry.delay < 0) {
      errors.push({
        message: "Retry delay must be >= 0",
        path: `${path}.retry.delay`,
        stepName: step.name,
      });
    }
  }

  return errors;
}

/**
 * Validate wait condition
 */
function validateWaitCondition(
  condition: WaitCondition,
  path: string,
  stepName: string
): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = [];

  if (!VALID_WAIT_TYPES.includes(condition.type)) {
    errors.push({
      message: `Invalid wait condition type: ${condition.type}. Must be one of: ${VALID_WAIT_TYPES.join(", ")}`,
      path: `${path}.type`,
      stepName,
    });
  }

  // Event type requires eventType field
  if (condition.type === "event" && !condition.eventType) {
    errors.push({
      message: "Wait condition type 'event' requires 'eventType' field",
      path: `${path}.eventType`,
      stepName,
    });
  }

  // Validate timeout
  if (condition.timeout !== undefined && condition.timeout < 0) {
    errors.push({
      message: "Wait condition timeout must be >= 0",
      path: `${path}.timeout`,
      stepName,
    });
  }

  return errors;
}

/**
 * Validate extract configuration
 */
function validateExtractConfig(
  config: ExtractConfig,
  path: string,
  stepName: string
): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = [];

  if (!VALID_EXTRACT_TYPES.includes(config.type)) {
    errors.push({
      message: `Invalid extract type: ${config.type}. Must be one of: ${VALID_EXTRACT_TYPES.join(", ")}`,
      path: `${path}.type`,
      stepName,
    });
  }

  // Regex requires pattern
  if (config.type === "regex" && !config.pattern) {
    errors.push({
      message: "Extract type 'regex' requires 'pattern' field",
      path: `${path}.pattern`,
      stepName,
    });
  }

  // JSONPath and XPath require path
  if ((config.type === "jsonpath" || config.type === "xpath") && !config.path) {
    errors.push({
      message: `Extract type '${config.type}' requires 'path' field`,
      path: `${path}.path`,
      stepName,
    });
  }

  return errors;
}

/**
 * Validate conditional step
 */
function validateConditionalStep(step: ConditionalStep, path: string): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = [];

  // Require condition
  if (!step.condition || step.condition.trim() === "") {
    errors.push({
      message: "Conditional step requires non-empty 'condition' field",
      path: `${path}.condition`,
      stepName: step.name,
    });
  }

  // Require then steps
  if (!step.then || step.then.length === 0) {
    errors.push({
      message: "Conditional step requires at least one step in 'then' branch",
      path: `${path}.then`,
      stepName: step.name,
    });
  }

  // Validate then steps
  if (step.then) {
    for (let i = 0; i < step.then.length; i++) {
      const thenStep = step.then[i];
      if (!thenStep) {
        continue;
      }
      errors.push(...validateStep(thenStep, `${path}.then[${i}]`));
    }
  }

  // Validate else steps
  if (step.else) {
    for (let i = 0; i < step.else.length; i++) {
      const elseStep = step.else[i];
      if (!elseStep) {
        continue;
      }
      errors.push(...validateStep(elseStep, `${path}.else[${i}]`));
    }
  }

  return errors;
}

/**
 * Validate parallel step
 */
function validateParallelStep(step: ParallelStep, path: string): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = [];

  // Require steps
  if (!step.steps || step.steps.length === 0) {
    errors.push({
      message: "Parallel step requires at least one step",
      path: `${path}.steps`,
      stepName: step.name,
    });
  }

  // Validate each parallel step
  if (step.steps) {
    for (let i = 0; i < step.steps.length; i++) {
      const parallelStep = step.steps[i];
      if (!parallelStep) {
        continue;
      }
      errors.push(...validateStep(parallelStep, `${path}.steps[${i}]`));
    }
  }

  // Validate waitFor
  if (step.waitFor && !["all", "any", "none"].includes(step.waitFor)) {
    errors.push({
      message: "Parallel step waitFor must be 'all', 'any', or 'none'",
      path: `${path}.waitFor`,
      stepName: step.name,
    });
  }

  return errors;
}

/**
 * Validate loop step
 */
function validateLoopStep(step: LoopStep, path: string): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = [];

  // Require items
  if (!step.items || step.items.trim() === "") {
    errors.push({
      message: "Foreach step requires non-empty 'items' field",
      path: `${path}.items`,
      stepName: step.name,
    });
  }

  // Validate step template
  if (!step.step) {
    errors.push({
      message: "Foreach step requires 'step' field",
      path: `${path}.step`,
      stepName: step.name,
    });
  } else {
    errors.push(...validateStep(step.step, `${path}.step`));
  }

  return errors;
}

/**
 * Validate log step
 */
function validateLogStep(
  step: { name: string; type: "log"; message: string },
  path: string
): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = [];

  if (!step.message || step.message.trim() === "") {
    errors.push({
      message: "Log step requires non-empty 'message' field",
      path: `${path}.message`,
      stepName: step.name,
    });
  }

  return errors;
}

/**
 * Detect circular dependencies in variable references
 *
 * Checks if step A references step B and step B references step A
 */
function detectCircularDependencies(steps: WorkflowStep[]): WorkflowValidationError[] {
  const errors: WorkflowValidationError[] = [];

  // Build dependency graph
  const dependencies = new Map<string, Set<string>>();

  for (const step of steps) {
    const deps = extractStepDependencies(step);
    dependencies.set(step.name, deps);
  }

  // Check for cycles using DFS
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function hasCycle(stepName: string): boolean {
    if (recursionStack.has(stepName)) {
      return true; // Found cycle
    }

    if (visited.has(stepName)) {
      return false; // Already checked
    }

    visited.add(stepName);
    recursionStack.add(stepName);

    const deps = dependencies.get(stepName) || new Set();
    for (const dep of deps) {
      if (hasCycle(dep)) {
        return true;
      }
    }

    recursionStack.delete(stepName);
    return false;
  }

  for (const step of steps) {
    visited.clear();
    recursionStack.clear();

    if (hasCycle(step.name)) {
      errors.push({
        message: `Circular dependency detected involving step: ${step.name}`,
        stepName: step.name,
      });
    }
  }

  return errors;
}

/**
 * Extract step dependencies from variable references
 *
 * Looks for ${steps.stepName.*} patterns
 */
function extractStepDependencies(step: WorkflowStep): Set<string> {
  const dependencies = new Set<string>();
  const variablePattern = /\$\{steps\.([^.}]+)/g;

  // Convert step to JSON to search all string fields
  const stepJson = JSON.stringify(step);
  let match: RegExpExecArray | null;

  // biome-ignore lint/suspicious/noAssignInExpressions: Standard regex pattern matching
  while ((match = variablePattern.exec(stepJson)) !== null) {
    const dependency = match[1];
    if (dependency) {
      dependencies.add(dependency);
    }
  }

  return dependencies;
}
