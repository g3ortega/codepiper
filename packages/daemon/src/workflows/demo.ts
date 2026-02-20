/**
 * Workflow DSL & Parser Demo
 *
 * Demonstrates parsing, validation, and variable substitution
 */

import { parseWorkflowFromYaml, substituteVariables, validateWorkflow } from "./index";

// Demo 1: Parse and validate a YAML workflow
console.log("=== Demo 1: Parse and Validate ===\n");

const yamlWorkflow = `
name: "Code Review Workflow"
description: "Sequential code review process"

steps:
  - name: developer
    type: session
    provider: claude-code
    cwd: /tmp/repo
    prompt: "Implement the login feature"
    wait:
      - type: idle_prompt
        timeout: 300000
    extract:
      files:
        type: regex
        pattern: "Created file: (.*)"

  - name: reviewer
    type: session
    provider: claude-code
    cwd: /tmp/repo
    prompt: "Review: \${steps.developer.files}"
    wait:
      - type: stop
`;

const workflow = parseWorkflowFromYaml(yamlWorkflow);

if (workflow) {
  console.log("✅ Workflow parsed successfully!");
  console.log(`   Name: ${workflow.name}`);
  console.log(`   Steps: ${workflow.steps.length}`);
  console.log(`   Step names: ${workflow.steps.map((s) => s.name).join(", ")}`);

  const errors = validateWorkflow(workflow);
  if (errors.length === 0) {
    console.log("✅ Workflow validation passed!\n");
  } else {
    console.log("❌ Validation errors:");
    for (const error of errors) {
      console.log(`   - ${error.message}`);
    }
  }
}

// Demo 2: Variable substitution
console.log("=== Demo 2: Variable Substitution ===\n");

const context = {
  steps: {
    developer: {
      status: "completed",
      extractedData: {
        files: "src/login.ts, src/auth.ts",
      },
    },
    reviewer: {
      status: "completed",
      extractedData: {
        issues: "3 minor issues found",
      },
    },
  },
  variables: {
    environment: "production",
    version: "1.2.3",
  },
};

// These are intentional string literals (not TS templates) demonstrating workflow DSL template syntax
const templates = [
  // biome-ignore lint/suspicious/noTemplateCurlyInString: workflow DSL template example
  "Status: ${steps.developer.status}",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: workflow DSL template example
  "Files created: ${steps.developer.extractedData.files}",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: workflow DSL template example
  "Review result: ${steps.reviewer.extractedData.issues}",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: workflow DSL template example
  "Deploy version ${version} to ${environment}",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: workflow DSL template example
  "Step count: ${steps.developer.status} and ${steps.reviewer.status}",
];

for (const template of templates) {
  const result = substituteVariables(template, context);
  console.log(`Template: ${template}`);
  console.log(`Result:   ${result}\n`);
}

// Demo 3: Validation failure
console.log("=== Demo 3: Validation Failure ===\n");

const invalidWorkflow = {
  name: "Invalid Workflow",
  steps: [
    {
      name: "broken",
      type: "session",
      provider: "invalid-provider",
      // Missing cwd
    },
  ],
};

const validationErrors = validateWorkflow(invalidWorkflow as any);

if (validationErrors.length > 0) {
  console.log("✅ Validator correctly detected errors:");
  for (const error of validationErrors) {
    console.log(`   - ${error.message}`);
    if (error.path) {
      console.log(`     Path: ${error.path}`);
    }
  }
}

console.log("\n=== Demo Complete ===");
