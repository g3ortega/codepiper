/**
 * Tests for WorkflowRunner
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SessionHandle } from "@codepiper/core";
import { EventBus } from "@codepiper/core";
import { Database } from "../db/db";
import { createWorkflowDb } from "../db/workflowDb";
import type { CreateSessionOptions, SessionManager } from "../sessions/sessionManager";
import { WorkflowRunner } from "./workflowRunner";
import type { WorkflowDefinition } from "./workflowTypes";

// Mock SessionManager
class MockSessionManager {
  private sessions = new Map<string, SessionHandle>();
  private callbacks: Array<() => void> = [];
  private db: Database;
  readonly sentTexts: Array<{ sessionId: string; text: string }> = [];

  constructor(db: Database) {
    this.db = db;
  }

  async createSession(options: CreateSessionOptions): Promise<SessionHandle> {
    const sessionId = crypto.randomUUID();
    const handle: SessionHandle = {
      id: sessionId,
      provider: options.provider,
      cwd: options.cwd,
      status: "RUNNING",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.sessions.set(sessionId, handle);

    // Persist to database for tests
    this.db.createSession({
      id: sessionId,
      provider: options.provider,
      cwd: options.cwd,
      status: "RUNNING",
    });

    return handle;
  }

  getSession(sessionId: string): SessionHandle | undefined {
    return this.sessions.get(sessionId);
  }

  async sendText(sessionId: string, text: string): Promise<void> {
    this.sentTexts.push({ sessionId, text });
  }

  async sendKeys(sessionId: string, keys: string[]): Promise<void> {
    // Mock implementation
  }

  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = "STOPPED";
    }
  }

  // Test helper: simulate event completion
  simulateCompletion(sessionId: string, callback: () => void): void {
    this.callbacks.push(callback);
    setTimeout(callback, 100);
  }
}

describe("WorkflowRunner", () => {
  let db: Database;
  let eventBus: EventBus;
  let sessionManager: MockSessionManager;
  let runner: WorkflowRunner;

  // Helper to create workflow in database
  function createWorkflowInDb(workflow: WorkflowDefinition): void {
    const workflowDb = createWorkflowDb(db);
    workflowDb.createWorkflow({
      id: workflow.name,
      name: workflow.name,
      description: workflow.description,
      definition: workflow,
    });
  }

  beforeEach(async () => {
    db = new Database(":memory:");
    await db.init();
    eventBus = new EventBus();
    sessionManager = new MockSessionManager(db);
    runner = new WorkflowRunner({
      sessionManager: sessionManager as unknown as SessionManager,
      database: db,
      eventBus,
    });
  });

  afterEach(() => {
    db.close();
  });

  describe("workflow execution", () => {
    test("should execute simple sequential workflow", async () => {
      const workflow: WorkflowDefinition = {
        name: "test-workflow",
        steps: [
          {
            name: "step1",
            type: "session",
            provider: "claude-code",
            cwd: "/tmp",
            prompt: "test prompt",
            wait: [{ type: "stop" }],
          },
        ],
      };

      // Create workflow in database first
      createWorkflowInDb(workflow);

      const executionId = await runner.start(workflow);
      expect(executionId).toBeDefined();

      // Wait for async execution to start
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Simulate completion
      const sessions = db.listSessions();
      expect(sessions.length).toBeGreaterThan(0);

      const sessionId = sessions[0].id;

      // Insert stop event (wait longer for session creation)
      setTimeout(() => {
        db.insertEvent({
          sessionId,
          source: "hook",
          type: "Stop",
          payload: {},
        });
      }, 200);

      // Wait for execution
      await runner.waitForCompletion(executionId, 5000);

      const execution = runner.getExecution(executionId);
      expect(execution).toBeDefined();
      if (execution?.status !== "completed") {
        console.log("Execution error:", execution?.error);
      }
      expect(execution?.status).toBe("completed");
    });

    test("should handle workflow with no steps", async () => {
      const workflow: WorkflowDefinition = {
        name: "empty-workflow",
        steps: [],
      };

      // Create workflow in database first
      createWorkflowInDb(workflow);

      const executionId = await runner.start(workflow);
      await runner.waitForCompletion(executionId, 1000);

      const execution = runner.getExecution(executionId);
      expect(execution?.status).toBe("completed");
    });

    test("should track step status during execution", async () => {
      const workflow: WorkflowDefinition = {
        name: "test-workflow",
        steps: [
          {
            name: "step1",
            type: "session",
            provider: "claude-code",
            cwd: "/tmp",
            wait: [{ type: "stop", timeout: 500 }],
          },
        ],
      };

      // Create workflow in database first
      createWorkflowInDb(workflow);

      const executionId = await runner.start(workflow);

      // Check step is running
      const execution = runner.getExecution(executionId);
      const stepResult = execution?.stepResults.get("step1");
      expect(stepResult?.status).toBe("running");
    });
  });

  describe("wait conditions", () => {
    test("should wait for idle_prompt", async () => {
      const workflow: WorkflowDefinition = {
        name: "test-workflow",
        steps: [
          {
            name: "step1",
            type: "session",
            provider: "claude-code",
            cwd: "/tmp",
            wait: [{ type: "idle_prompt" }],
          },
        ],
      };

      // Create workflow in database first
      createWorkflowInDb(workflow);

      const executionId = await runner.start(workflow);

      // Wait for async execution to start
      await new Promise((resolve) => setTimeout(resolve, 50));

      const sessions = db.listSessions();
      const sessionId = sessions[0].id;

      // Simulate idle_prompt
      setTimeout(() => {
        db.insertEvent({
          sessionId,
          source: "hook",
          type: "Notification",
          payload: { type: "idle_prompt" },
        });
      }, 100);

      await runner.waitForCompletion(executionId, 5000);

      const execution = runner.getExecution(executionId);
      expect(execution?.status).toBe("completed");
    });

    test("should handle timeout", async () => {
      const workflow: WorkflowDefinition = {
        name: "test-workflow",
        steps: [
          {
            name: "step1",
            type: "session",
            provider: "claude-code",
            cwd: "/tmp",
            wait: [{ type: "stop", timeout: 200 }],
          },
        ],
      };

      // Create workflow in database first
      createWorkflowInDb(workflow);

      const executionId = await runner.start(workflow);
      await runner.waitForCompletion(executionId, 5000);

      const execution = runner.getExecution(executionId);
      expect(execution?.status).toBe("failed");
      expect(execution?.error).toMatch(/timeout/i);
    });
  });

  describe("result extraction", () => {
    test("should extract results using regex", async () => {
      const workflow: WorkflowDefinition = {
        name: "test-workflow",
        steps: [
          {
            name: "step1",
            type: "session",
            provider: "claude-code",
            cwd: "/tmp",
            wait: [{ type: "stop" }],
            extract: {
              filename: {
                type: "regex",
                pattern: "Created: (.+)",
              },
            },
          },
        ],
      };

      // Create workflow in database first
      createWorkflowInDb(workflow);

      const executionId = await runner.start(workflow);

      // Wait for async execution to start
      await new Promise((resolve) => setTimeout(resolve, 50));

      const sessions = db.listSessions();
      const sessionId = sessions[0].id;

      // Insert transcript with extractable content
      db.insertEvent({
        sessionId,
        source: "transcript",
        type: "AssistantMessage",
        payload: { content: "Created: test.ts" },
      });

      // Insert stop event (wait longer for session creation)
      setTimeout(() => {
        db.insertEvent({
          sessionId,
          source: "hook",
          type: "Stop",
          payload: {},
        });
      }, 200);

      await runner.waitForCompletion(executionId, 5000);

      const execution = runner.getExecution(executionId);
      const stepResult = execution?.stepResults.get("step1");
      expect(stepResult?.extractedData?.filename).toBe("test.ts");
    });
  });

  describe("context and variable substitution", () => {
    test("should substitute variables in prompts", async () => {
      const workflow: WorkflowDefinition = {
        name: "test-workflow",
        steps: [
          {
            name: "step1",
            type: "session",
            provider: "claude-code",
            cwd: "/tmp",
            prompt: "Process file: ${filename}",
            wait: [{ type: "stop", timeout: 500 }],
          },
        ],
      };

      const variables = { filename: "test.ts" };
      // Create workflow in database first
      createWorkflowInDb(workflow);

      const executionId = await runner.start(workflow, undefined, variables);

      // The prompt should be substituted (verify through context)
      const execution = runner.getExecution(executionId);
      expect(execution?.context.filename).toBe("test.ts");
    });

    test("should store extracted data in context", async () => {
      const workflow: WorkflowDefinition = {
        name: "test-workflow",
        steps: [
          {
            name: "step1",
            type: "session",
            provider: "claude-code",
            cwd: "/tmp",
            wait: [{ type: "stop" }],
            extract: {
              result: {
                type: "regex",
                pattern: "Result: (.+)",
              },
            },
          },
        ],
      };

      // Create workflow in database first
      createWorkflowInDb(workflow);

      const executionId = await runner.start(workflow);

      // Wait for async execution to start
      await new Promise((resolve) => setTimeout(resolve, 50));

      const sessions = db.listSessions();
      const sessionId = sessions[0].id;

      db.insertEvent({
        sessionId,
        source: "transcript",
        type: "AssistantMessage",
        payload: { content: "Result: success" },
      });

      setTimeout(() => {
        db.insertEvent({
          sessionId,
          source: "hook",
          type: "Stop",
          payload: {},
        });
      }, 100);

      await runner.waitForCompletion(executionId, 5000);

      const execution = runner.getExecution(executionId);
      expect(execution?.context["steps.step1.result"]).toBe("success");
    });

    test("should substitute extracted values into later step prompts", async () => {
      const workflow: WorkflowDefinition = {
        name: "test-workflow-substitution",
        steps: [
          {
            name: "step1",
            type: "session",
            provider: "claude-code",
            cwd: "/tmp",
            wait: [{ type: "stop" }],
            extract: {
              summary: {
                type: "regex",
                pattern: "Summary: (.+)",
              },
            },
          },
          {
            name: "step2",
            type: "session",
            provider: "claude-code",
            cwd: "/tmp",
            prompt: "Use summary: ${steps.step1.summary}",
          },
        ],
      };

      createWorkflowInDb(workflow);

      const executionId = await runner.start(workflow);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const sessions = db.listSessions();
      expect(sessions.length).toBeGreaterThan(0);

      const firstSessionId = sessions[0].id;
      db.insertEvent({
        sessionId: firstSessionId,
        source: "transcript",
        type: "AssistantMessage",
        payload: { content: "Summary: alpha" },
      });
      db.insertEvent({
        sessionId: firstSessionId,
        source: "hook",
        type: "Stop",
        payload: {},
      });

      await runner.waitForCompletion(executionId, 5000);

      const execution = runner.getExecution(executionId);
      expect(execution?.status).toBe("completed");
      expect(sessionManager.sentTexts.some((entry) => entry.text === "Use summary: alpha")).toBe(
        true
      );
    });
  });

  describe("advanced step types", () => {
    test("should execute conditional branches based on evaluated conditions", async () => {
      const workflow: WorkflowDefinition = {
        name: "test-workflow-conditional",
        steps: [
          {
            name: "run-tests",
            type: "session",
            provider: "claude-code",
            cwd: "/tmp",
            wait: [{ type: "stop" }],
            extract: {
              failures: {
                type: "regex",
                pattern: "Failures: (\\d+)",
              },
            },
          },
          {
            name: "check-results",
            type: "if",
            condition: "${steps.run-tests.failures} > 0",
            then: [
              {
                name: "needs-fixes",
                type: "log",
                message: "Fixes required",
              },
            ],
            else: [
              {
                name: "already-clean",
                type: "log",
                message: "No fixes needed",
              },
            ],
          },
        ],
      };

      createWorkflowInDb(workflow);

      const executionId = await runner.start(workflow);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const firstSessionId = db.listSessions()[0]?.id;
      expect(firstSessionId).toBeDefined();
      if (firstSessionId) {
        db.insertEvent({
          sessionId: firstSessionId,
          source: "transcript",
          type: "AssistantMessage",
          payload: { content: "Failures: 2" },
        });
        db.insertEvent({
          sessionId: firstSessionId,
          source: "hook",
          type: "Stop",
          payload: {},
        });
      }

      await runner.waitForCompletion(executionId, 5000);

      const execution = runner.getExecution(executionId);
      expect(execution?.status).toBe("completed");
      expect(execution?.stepResults.get("check-results")?.status).toBe("completed");
      expect(execution?.stepResults.get("needs-fixes")?.status).toBe("completed");
      expect(execution?.stepResults.get("already-clean")).toBeUndefined();
    });

    test("should execute parallel steps and expose branch context for later steps", async () => {
      const workflow: WorkflowDefinition = {
        name: "test-workflow-parallel",
        steps: [
          {
            name: "fanout",
            type: "parallel",
            waitFor: "all",
            steps: [
              {
                name: "child-a",
                type: "session",
                provider: "claude-code",
                cwd: "/tmp",
                wait: [{ type: "stop" }],
                extract: {
                  value: {
                    type: "regex",
                    pattern: "Value: (.+)",
                  },
                },
              },
              {
                name: "child-b",
                type: "session",
                provider: "claude-code",
                cwd: "/tmp",
                wait: [{ type: "stop" }],
                extract: {
                  value: {
                    type: "regex",
                    pattern: "Value: (.+)",
                  },
                },
              },
            ],
          },
          {
            name: "synthesize",
            type: "session",
            provider: "claude-code",
            cwd: "/tmp",
            prompt: "Combine ${steps.child-a.value} and ${steps.child-b.value}",
          },
        ],
      };

      createWorkflowInDb(workflow);

      const executionId = await runner.start(workflow);

      for (let i = 0; i < 20; i++) {
        const sessions = db.listSessions();
        if (sessions.length >= 2) {
          db.insertEvent({
            sessionId: sessions[0].id,
            source: "transcript",
            type: "AssistantMessage",
            payload: { content: "Value: alpha" },
          });
          db.insertEvent({
            sessionId: sessions[0].id,
            source: "hook",
            type: "Stop",
            payload: {},
          });

          db.insertEvent({
            sessionId: sessions[1].id,
            source: "transcript",
            type: "AssistantMessage",
            payload: { content: "Value: beta" },
          });
          db.insertEvent({
            sessionId: sessions[1].id,
            source: "hook",
            type: "Stop",
            payload: {},
          });
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      await runner.waitForCompletion(executionId, 5000);

      const execution = runner.getExecution(executionId);
      expect(execution?.status).toBe("completed");
      expect(execution?.stepResults.get("fanout")?.status).toBe("completed");
      expect(execution?.stepResults.get("child-a")?.status).toBe("completed");
      expect(execution?.stepResults.get("child-b")?.status).toBe("completed");

      const childA = execution?.context.steps?.["child-a"]?.value;
      const childB = execution?.context.steps?.["child-b"]?.value;
      expect(childA).toBeDefined();
      expect(childB).toBeDefined();
      expect(
        sessionManager.sentTexts.some((entry) => entry.text === `Combine ${childA} and ${childB}`)
      ).toBe(true);
    });

    test("waitFor=any should continue after first successful branch", async () => {
      const workflow: WorkflowDefinition = {
        name: "test-workflow-parallel-any",
        steps: [
          {
            name: "fanout-any",
            type: "parallel",
            waitFor: "any",
            steps: [
              {
                name: "fast-branch",
                type: "session",
                provider: "claude-code",
                cwd: "/tmp",
              },
              {
                name: "slow-branch",
                type: "session",
                provider: "claude-code",
                cwd: "/tmp",
                wait: [{ type: "timeout", timeout: 400 }],
              },
            ],
          },
          {
            name: "after-any",
            type: "log",
            message: "continued",
          },
        ],
      };

      createWorkflowInDb(workflow);

      const executionId = await runner.start(workflow);
      const startedAt = Date.now();
      await runner.waitForCompletion(executionId, 3000);
      const elapsedMs = Date.now() - startedAt;

      const execution = runner.getExecution(executionId);
      expect(execution?.status).toBe("completed");
      expect(execution?.stepResults.get("fanout-any")?.status).toBe("completed");
      expect(execution?.stepResults.get("after-any")?.status).toBe("completed");
      expect(elapsedMs).toBeLessThan(350);

      // Allow detached branches to settle before DB teardown.
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    test("waitFor=none should not block workflow progression", async () => {
      const workflow: WorkflowDefinition = {
        name: "test-workflow-parallel-none",
        steps: [
          {
            name: "fanout-none",
            type: "parallel",
            waitFor: "none",
            steps: [
              {
                name: "instant-branch",
                type: "log",
                message: "started",
              },
              {
                name: "background-branch",
                type: "session",
                provider: "claude-code",
                cwd: "/tmp",
                wait: [{ type: "timeout", timeout: 400 }],
              },
            ],
          },
          {
            name: "after-none",
            type: "log",
            message: "continued",
          },
        ],
      };

      createWorkflowInDb(workflow);

      const executionId = await runner.start(workflow);
      const startedAt = Date.now();
      await runner.waitForCompletion(executionId, 3000);
      const elapsedMs = Date.now() - startedAt;

      const execution = runner.getExecution(executionId);
      expect(execution?.status).toBe("completed");
      expect(execution?.stepResults.get("fanout-none")?.status).toBe("completed");
      expect(execution?.stepResults.get("after-none")?.status).toBe("completed");
      expect(elapsedMs).toBeLessThan(300);

      // Allow detached branches to settle before DB teardown.
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    test("should execute foreach step for each item", async () => {
      const workflow: WorkflowDefinition = {
        name: "test-workflow-foreach",
        steps: [
          {
            name: "process-files",
            type: "foreach",
            items: "${files}",
            step: {
              name: "process-file",
              type: "log",
              message: "Processing ${item}",
            },
          },
        ],
      };

      createWorkflowInDb(workflow);

      const executionId = await runner.start(workflow, undefined, {
        files: ["a.ts", "b.ts"],
      });
      await runner.waitForCompletion(executionId, 5000);

      const execution = runner.getExecution(executionId);
      expect(execution?.status).toBe("completed");
      expect(execution?.stepResults.get("process-files")?.status).toBe("completed");
      expect(execution?.stepResults.get("process-file[0]")?.status).toBe("completed");
      expect(execution?.stepResults.get("process-file[1]")?.status).toBe("completed");
      expect(execution?.context.steps?.["process-files"]?.results).toEqual(["a.ts", "b.ts"]);
    });
  });

  describe("error handling", () => {
    test("should mark workflow as failed on step error", async () => {
      const workflow: WorkflowDefinition = {
        name: "test-workflow",
        steps: [
          {
            name: "step1",
            type: "session",
            provider: "claude-code",
            cwd: "/tmp",
            wait: [{ type: "stop", timeout: 200 }], // Timeout quickly
            onError: "fail",
          },
        ],
      };

      // Create workflow in database first
      createWorkflowInDb(workflow);

      const executionId = await runner.start(workflow);
      await runner.waitForCompletion(executionId, 2000);

      const execution = runner.getExecution(executionId);
      expect(execution?.status).toBe("failed");
    });

    test("should continue on error when onError=continue", async () => {
      const workflow: WorkflowDefinition = {
        name: "test-workflow",
        steps: [
          {
            name: "step1",
            type: "session",
            provider: "claude-code",
            cwd: "/tmp",
            wait: [{ type: "stop", timeout: 100 }],
            onError: "continue",
          },
          {
            name: "step2",
            type: "session",
            provider: "claude-code",
            cwd: "/tmp",
            wait: [{ type: "stop", timeout: 100 }],
          },
        ],
      };

      // Create workflow in database first
      createWorkflowInDb(workflow);

      const executionId = await runner.start(workflow);
      await runner.waitForCompletion(executionId, 5000);

      const execution = runner.getExecution(executionId);
      const step1 = execution?.stepResults.get("step1");
      const step2 = execution?.stepResults.get("step2");

      expect(step1?.status).toBe("failed");
      expect(step2?.status).toBe("failed"); // Also failed due to timeout
    });

    test("should retry failed step and complete when a later attempt succeeds", async () => {
      const originalCreateSession = sessionManager.createSession.bind(sessionManager);
      let createAttempts = 0;

      sessionManager.createSession = async (options: CreateSessionOptions) => {
        createAttempts++;
        if (createAttempts === 1) {
          throw new Error("Transient session creation failure");
        }
        return await originalCreateSession(options);
      };

      const workflow: WorkflowDefinition = {
        name: "test-workflow-retry-success",
        steps: [
          {
            name: "step1",
            type: "session",
            provider: "claude-code",
            cwd: "/tmp",
            wait: [{ type: "stop" }],
            onError: "retry",
            retry: { maxAttempts: 2, delay: 10 },
          },
        ],
      };

      createWorkflowInDb(workflow);

      const executionId = await runner.start(workflow);

      // Wait until retry attempt creates a session, then emit Stop event.
      let sessionId: string | undefined;
      for (let i = 0; i < 20; i++) {
        const sessions = db.listSessions();
        if (sessions.length > 0) {
          sessionId = sessions[sessions.length - 1].id;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      expect(sessionId).toBeDefined();
      if (sessionId) {
        setTimeout(() => {
          db.insertEvent({
            sessionId,
            source: "hook",
            type: "Stop",
            payload: {},
          });
        }, 100);
      }

      await runner.waitForCompletion(executionId, 5000);

      const execution = runner.getExecution(executionId);
      expect(execution?.status).toBe("completed");
      expect(createAttempts).toBe(2);

      const steps = createWorkflowDb(db).getSteps(executionId);
      expect(steps).toHaveLength(2);
      expect(steps[0].status).toBe("failed");
      expect(steps[1].status).toBe("completed");
    });

    test("should fail after max retry attempts are exhausted", async () => {
      let createAttempts = 0;
      sessionManager.createSession = async (_options: CreateSessionOptions) => {
        createAttempts++;
        throw new Error("Permanent session creation failure");
      };

      const workflow: WorkflowDefinition = {
        name: "test-workflow-retry-fail",
        steps: [
          {
            name: "step1",
            type: "session",
            provider: "claude-code",
            cwd: "/tmp",
            onError: "retry",
            retry: { maxAttempts: 3, delay: 0 },
          },
        ],
      };

      createWorkflowInDb(workflow);

      const executionId = await runner.start(workflow);
      await runner.waitForCompletion(executionId, 5000);

      const execution = runner.getExecution(executionId);
      expect(execution?.status).toBe("failed");
      expect(execution?.error).toContain("failed after 3 attempt(s)");
      expect(createAttempts).toBe(3);

      const steps = createWorkflowDb(db).getSteps(executionId);
      expect(steps).toHaveLength(3);
      expect(steps.every((s) => s.status === "failed")).toBe(true);
    });
  });

  describe("execution management", () => {
    test("should list executions", async () => {
      const workflow: WorkflowDefinition = {
        name: "test-workflow",
        steps: [],
      };

      // Create workflow in database first
      createWorkflowInDb(workflow);

      await runner.start(workflow);
      await runner.start(workflow);

      const executions = runner.listExecutions();
      expect(executions.length).toBe(2);
    });

    test("should get execution by id", async () => {
      const workflow: WorkflowDefinition = {
        name: "test-workflow",
        steps: [],
      };

      // Create workflow in database first
      createWorkflowInDb(workflow);

      const executionId = await runner.start(workflow);
      const execution = runner.getExecution(executionId);

      expect(execution).toBeDefined();
      expect(execution?.id).toBe(executionId);
    });

    test("should return undefined for non-existent execution", () => {
      const execution = runner.getExecution("non-existent");
      expect(execution).toBeUndefined();
    });

    test("should cancel running workflow", async () => {
      const workflow: WorkflowDefinition = {
        name: "test-workflow",
        steps: [
          {
            name: "step1",
            type: "session",
            provider: "claude-code",
            cwd: "/tmp",
            wait: [{ type: "stop", timeout: 10000 }], // Long timeout
          },
        ],
      };

      // Create workflow in database first
      createWorkflowInDb(workflow);

      const executionId = await runner.start(workflow);

      // Cancel immediately
      await runner.cancel(executionId);

      const execution = runner.getExecution(executionId);
      expect(execution?.status).toBe("cancelled");
    });
  });

  describe("waitForCompletion", () => {
    test("should wait for workflow to complete", async () => {
      const workflow: WorkflowDefinition = {
        name: "test-workflow",
        steps: [],
      };

      // Create workflow in database first
      createWorkflowInDb(workflow);

      const executionId = await runner.start(workflow);
      await runner.waitForCompletion(executionId, 1000);

      const execution = runner.getExecution(executionId);
      expect(execution?.status).toBe("completed");
    });

    test("should timeout if workflow takes too long", async () => {
      const workflow: WorkflowDefinition = {
        name: "test-workflow",
        steps: [
          {
            name: "step1",
            type: "session",
            provider: "claude-code",
            cwd: "/tmp",
            wait: [{ type: "stop" }], // No timeout, will wait forever
          },
        ],
      };

      // Create workflow in database first
      createWorkflowInDb(workflow);

      const executionId = await runner.start(workflow);

      await expect(runner.waitForCompletion(executionId, 200)).rejects.toThrow(/timeout/i);
    });
  });

  describe("edge cases", () => {
    test("should handle workflow with multiple sequential steps", async () => {
      const workflow: WorkflowDefinition = {
        name: "test-workflow",
        steps: [
          {
            name: "step1",
            type: "session",
            provider: "claude-code",
            cwd: "/tmp",
            wait: [{ type: "stop", timeout: 500 }],
            onError: "continue", // Continue on error so step2 runs
          },
          {
            name: "step2",
            type: "session",
            provider: "claude-code",
            cwd: "/tmp",
            wait: [{ type: "stop", timeout: 500 }],
          },
        ],
      };

      // Create workflow in database first
      createWorkflowInDb(workflow);

      const executionId = await runner.start(workflow);
      await runner.waitForCompletion(executionId, 5000);

      const execution = runner.getExecution(executionId);
      expect(execution?.stepResults.size).toBe(2);

      // Both steps should have been attempted
      const step1 = execution?.stepResults.get("step1");
      const step2 = execution?.stepResults.get("step2");
      expect(step1).toBeDefined();
      expect(step2).toBeDefined();
    });

    test("should handle missing wait conditions", async () => {
      const workflow: WorkflowDefinition = {
        name: "test-workflow",
        steps: [
          {
            name: "step1",
            type: "session",
            provider: "claude-code",
            cwd: "/tmp",
            // No wait conditions - should complete immediately after spawn
          },
        ],
      };

      // Create workflow in database first
      createWorkflowInDb(workflow);

      const executionId = await runner.start(workflow);
      await runner.waitForCompletion(executionId, 1000);

      const execution = runner.getExecution(executionId);
      expect(execution?.status).toBe("completed");
    });
  });
});
