/**
 * Tests for workflow CLI commands
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  cancelWorkflow,
  createWorkflow,
  getWorkflowStatus,
  parseWorkflowCancelOptions,
  parseWorkflowCreateOptions,
  parseWorkflowListOptions,
  parseWorkflowLogsOptions,
  parseWorkflowRunOptions,
  parseWorkflowShowOptions,
  parseWorkflowStatusOptions,
  showWorkflowLogs,
} from "./workflow";

describe("Workflow CLI Options Parsing", () => {
  describe("parseWorkflowCreateOptions", () => {
    test("parses valid create command", () => {
      const args = ["workflow.yaml"];
      const options = parseWorkflowCreateOptions(args);

      expect(options.file).toBe("workflow.yaml");
      expect(options.socket).toBe("/tmp/codepiper.sock");
    });

    test("parses create command with custom socket", () => {
      const args = ["workflow.json", "--socket", "/custom/path.sock"];
      const options = parseWorkflowCreateOptions(args);

      expect(options.file).toBe("workflow.json");
      expect(options.socket).toBe("/custom/path.sock");
    });

    test("parses create command with -s flag", () => {
      const args = ["workflow.yaml", "-s", "/custom/path.sock"];
      const options = parseWorkflowCreateOptions(args);

      expect(options.socket).toBe("/custom/path.sock");
    });

    test("throws error if file is missing", () => {
      expect(() => parseWorkflowCreateOptions([])).toThrow("file path is required");
    });

    test("parses workflow ID from args", () => {
      const args = ["workflow.yaml", "--id", "custom-wf-id"];
      const options = parseWorkflowCreateOptions(args);

      expect(options.file).toBe("workflow.yaml");
      expect(options.id).toBe("custom-wf-id");
    });
  });

  describe("parseWorkflowListOptions", () => {
    test("parses valid list command", () => {
      const args: string[] = [];
      const options = parseWorkflowListOptions(args);

      expect(options.socket).toBe("/tmp/codepiper.sock");
    });

    test("parses list command with custom socket", () => {
      const args = ["--socket", "/custom/path.sock"];
      const options = parseWorkflowListOptions(args);

      expect(options.socket).toBe("/custom/path.sock");
    });
  });

  describe("parseWorkflowShowOptions", () => {
    test("parses valid show command", () => {
      const args = ["wf-123"];
      const options = parseWorkflowShowOptions(args);

      expect(options.workflowId).toBe("wf-123");
      expect(options.socket).toBe("/tmp/codepiper.sock");
    });

    test("parses show command with custom socket", () => {
      const args = ["wf-123", "--socket", "/custom/path.sock"];
      const options = parseWorkflowShowOptions(args);

      expect(options.workflowId).toBe("wf-123");
      expect(options.socket).toBe("/custom/path.sock");
    });

    test("throws error if workflow ID is missing", () => {
      expect(() => parseWorkflowShowOptions([])).toThrow("workflow ID is required");
    });
  });

  describe("parseWorkflowRunOptions", () => {
    test("parses valid run command", () => {
      const args = ["wf-123"];
      const options = parseWorkflowRunOptions(args);

      expect(options.workflowId).toBe("wf-123");
      expect(options.socket).toBe("/tmp/codepiper.sock");
      expect(options.variables).toEqual({});
    });

    test("parses run command with variables", () => {
      const args = ["wf-123", "--var", "CWD=/test", "--var", "FEATURE=login"];
      const options = parseWorkflowRunOptions(args);

      expect(options.workflowId).toBe("wf-123");
      expect(options.variables).toEqual({
        CWD: "/test",
        FEATURE: "login",
      });
    });

    test("parses run command with -v flag", () => {
      const args = ["wf-123", "-v", "KEY=VALUE"];
      const options = parseWorkflowRunOptions(args);

      expect(options.variables).toEqual({ KEY: "VALUE" });
    });

    test("throws error if workflow ID is missing", () => {
      expect(() => parseWorkflowRunOptions([])).toThrow("workflow ID is required");
    });

    test("throws error if variable is invalid", () => {
      const args = ["wf-123", "--var", "invalid"];
      expect(() => parseWorkflowRunOptions(args)).toThrow("Invalid variable format");
    });
  });

  describe("parseWorkflowStatusOptions", () => {
    test("parses valid status command", () => {
      const args = ["exec-123"];
      const options = parseWorkflowStatusOptions(args);

      expect(options.executionId).toBe("exec-123");
      expect(options.socket).toBe("/tmp/codepiper.sock");
    });

    test("parses status command with custom socket", () => {
      const args = ["exec-123", "--socket", "/custom/path.sock"];
      const options = parseWorkflowStatusOptions(args);

      expect(options.executionId).toBe("exec-123");
      expect(options.socket).toBe("/custom/path.sock");
    });

    test("throws error if execution ID is missing", () => {
      expect(() => parseWorkflowStatusOptions([])).toThrow("execution ID is required");
    });
  });

  describe("parseWorkflowCancelOptions", () => {
    test("parses valid cancel command", () => {
      const args = ["exec-123"];
      const options = parseWorkflowCancelOptions(args);

      expect(options.executionId).toBe("exec-123");
      expect(options.socket).toBe("/tmp/codepiper.sock");
    });

    test("parses cancel command with custom socket", () => {
      const args = ["exec-123", "--socket", "/custom/path.sock"];
      const options = parseWorkflowCancelOptions(args);

      expect(options.executionId).toBe("exec-123");
      expect(options.socket).toBe("/custom/path.sock");
    });

    test("throws error if execution ID is missing", () => {
      expect(() => parseWorkflowCancelOptions([])).toThrow("execution ID is required");
    });
  });

  describe("parseWorkflowLogsOptions", () => {
    test("parses valid logs command", () => {
      const args = ["exec-123"];
      const options = parseWorkflowLogsOptions(args);

      expect(options.executionId).toBe("exec-123");
      expect(options.socket).toBe("/tmp/codepiper.sock");
      expect(options.follow).toBe(false);
    });

    test("parses logs command with follow flag", () => {
      const args = ["exec-123", "--follow"];
      const options = parseWorkflowLogsOptions(args);

      expect(options.executionId).toBe("exec-123");
      expect(options.follow).toBe(true);
    });

    test("parses logs command with -f flag", () => {
      const args = ["exec-123", "-f"];
      const options = parseWorkflowLogsOptions(args);

      expect(options.follow).toBe(true);
    });

    test("throws error if execution ID is missing", () => {
      expect(() => parseWorkflowLogsOptions([])).toThrow("execution ID is required");
    });
  });
});

describe("Workflow Logs Command", () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleLog = console.log;

  beforeEach(() => {
    delete process.env.CODEPIPER_WORKFLOW_LOG_POLL_MS;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.log = originalConsoleLog;
    delete process.env.CODEPIPER_WORKFLOW_LOG_POLL_MS;
    mock.restore();
  });

  test("prints execution status and step details", async () => {
    const consoleMock = mock(() => {});
    console.log = consoleMock as any;

    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          execution: { id: "exec-123", status: "running" },
          steps: [
            {
              stepName: "step1",
              status: "running",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }) as any;

    await showWorkflowLogs({
      executionId: "exec-123",
      follow: false,
      socket: "/tmp/codepiper.sock",
    });

    expect(globalThis.fetch as any).toHaveBeenCalledTimes(1);
    const [[requestUrl]] = (globalThis.fetch as any).mock.calls;
    expect(requestUrl).toBe("http://localhost/workflows/executions/exec-123");
    const output = consoleMock.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(output).toContain("Execution: exec-123");
    expect(output).toContain("Status: running");
    expect(output).toContain("[step1] running");
  });

  test("follows logs until execution reaches terminal state", async () => {
    const consoleMock = mock(() => {});
    console.log = consoleMock as any;
    process.env.CODEPIPER_WORKFLOW_LOG_POLL_MS = "1";

    let fetchCount = 0;
    globalThis.fetch = mock(async () => {
      fetchCount++;
      if (fetchCount === 1) {
        return new Response(
          JSON.stringify({
            execution: { id: "exec-123", status: "running" },
            steps: [{ stepName: "step1", status: "running" }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({
          execution: { id: "exec-123", status: "completed" },
          steps: [{ stepName: "step1", status: "completed" }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }) as any;

    await showWorkflowLogs({
      executionId: "exec-123",
      follow: true,
      socket: "/tmp/codepiper.sock",
    });

    expect(fetchCount).toBeGreaterThanOrEqual(2);
    const output = consoleMock.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(output).toContain("Following execution updates... Press Ctrl+C to stop.");
    expect(output).toContain("Status: running");
    expect(output).toContain("Status: completed");
  });
});

describe("Workflow Status/Cancel Commands", () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleLog = console.log;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.log = originalConsoleLog;
    mock.restore();
  });

  test("status uses execution-centric endpoint", async () => {
    console.log = mock(() => {}) as any;
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          execution: {
            id: "exec-123",
            workflowId: "wf-123",
            status: "running",
            startedAt: new Date().toISOString(),
          },
          steps: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as any;

    await getWorkflowStatus({
      executionId: "exec-123",
      socket: "/tmp/codepiper.sock",
    });

    const [[requestUrl]] = (globalThis.fetch as any).mock.calls;
    expect(requestUrl).toBe("http://localhost/workflows/executions/exec-123");
  });

  test("cancel uses execution-centric endpoint", async () => {
    console.log = mock(() => {}) as any;
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;

    await cancelWorkflow({
      executionId: "exec-123",
      socket: "/tmp/codepiper.sock",
    });

    const [[requestUrl]] = (globalThis.fetch as any).mock.calls;
    expect(requestUrl).toBe("http://localhost/workflows/executions/exec-123/cancel");
  });
});

describe("Workflow Create Command", () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleLog = console.log;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.log = originalConsoleLog;
    mock.restore();
  });

  test("surfaces workflow validation errors from API with detailed paths", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "codepiper-workflow-test-"));
    const filePath = path.join(tempDir, "invalid.yaml");
    writeFileSync(
      filePath,
      `name: Invalid Workflow
steps:
  - name: broken-step
    type: session
`
    );

    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          error: "Workflow definition validation failed",
          validationErrors: [
            {
              path: "steps.broken-step.cwd",
              message: "Session step requires 'cwd' field",
            },
          ],
        }),
        {
          status: 422,
          headers: { "Content-Type": "application/json" },
        }
      );
    }) as any;

    try {
      await createWorkflow({
        file: filePath,
        socket: "/tmp/codepiper.sock",
      });
      throw new Error("Expected createWorkflow to throw");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("Workflow validation failed");
      expect(message).toContain("steps.broken-step.cwd");
      expect(message).toContain("Session step requires 'cwd' field");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
