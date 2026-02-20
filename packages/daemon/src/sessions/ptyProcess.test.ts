import { afterEach, describe, expect, it } from "bun:test";
import { PTYProcess } from "./ptyProcess";

describe("PTYProcess", () => {
  let pty: PTYProcess | null = null;

  afterEach(async () => {
    if (pty && !pty.closed) {
      try {
        await Promise.race([pty.kill(), new Promise((resolve) => setTimeout(resolve, 2000))]);
      } catch (_error) {
        // Ignore cleanup errors
      }
      pty = null;
    }
  });

  describe("constructor", () => {
    it("should create a PTY process with bash", async () => {
      pty = new PTYProcess({
        command: ["bash"],
        cwd: process.cwd(),
        cols: 80,
        rows: 24,
      });

      expect(pty).toBeDefined();
      expect(pty.pid).toBeGreaterThan(0);
      expect(pty.closed).toBe(false);
    });

    it("should set custom dimensions", async () => {
      pty = new PTYProcess({
        command: ["bash"],
        cwd: process.cwd(),
        cols: 120,
        rows: 40,
      });

      expect(pty.cols).toBe(120);
      expect(pty.rows).toBe(40);
    });
  });

  describe("write", () => {
    it("should write text to PTY", async () => {
      let output = "";

      pty = new PTYProcess({
        command: ["bash"],
        cwd: process.cwd(),
        cols: 80,
        rows: 24,
        onData: (data) => {
          output += data;
        },
      });

      // Wait a bit for bash to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      pty.write("echo hello\n");

      // Wait for output
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(output).toContain("hello");
    });

    it("should handle multiple writes", async () => {
      let output = "";

      pty = new PTYProcess({
        command: ["bash"],
        cwd: process.cwd(),
        cols: 80,
        rows: 24,
        onData: (data) => {
          output += data;
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      pty.write("echo first\n");
      await new Promise((resolve) => setTimeout(resolve, 100));

      pty.write("echo second\n");
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(output).toContain("first");
      expect(output).toContain("second");
    });
  });

  describe("resize", () => {
    it("should resize the PTY", async () => {
      pty = new PTYProcess({
        command: ["bash"],
        cwd: process.cwd(),
        cols: 80,
        rows: 24,
      });

      pty.resize(120, 40);

      expect(pty.cols).toBe(120);
      expect(pty.rows).toBe(40);
    });
  });

  describe("setRawMode", () => {
    it("should set raw mode", async () => {
      pty = new PTYProcess({
        command: ["bash"],
        cwd: process.cwd(),
        cols: 80,
        rows: 24,
      });

      // Should not throw
      expect(() => pty?.setRawMode(true)).not.toThrow();
      expect(() => pty?.setRawMode(false)).not.toThrow();
    });
  });

  describe("kill", () => {
    it("should kill the process", async () => {
      pty = new PTYProcess({
        command: ["bash"],
        cwd: process.cwd(),
        cols: 80,
        rows: 24,
      });

      const _pid = pty.pid;

      await pty.kill();

      expect(pty.closed).toBe(true);
    });

    it("should handle exit callback", async () => {
      let exitCalled = false;

      pty = new PTYProcess({
        command: ["bash", "-c", "exit 0"],
        cwd: process.cwd(),
        cols: 80,
        rows: 24,
        onExit: (code, signal) => {
          exitCalled = true;
        },
      });

      // Wait for process to exit
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Just verify the callback was called
      // Note: PTY exit codes represent PTY lifecycle (0=EOF, 1=error), not subprocess exit codes
      expect(exitCalled).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should throw error for invalid command", () => {
      expect(() => {
        new PTYProcess({
          command: ["nonexistent-command-xyz"],
          cwd: process.cwd(),
          cols: 80,
          rows: 24,
        });
      }).toThrow();
    });

    it("should handle write to closed PTY", async () => {
      pty = new PTYProcess({
        command: ["bash"],
        cwd: process.cwd(),
        cols: 80,
        rows: 24,
      });

      await pty.kill();

      expect(() => pty?.write("test\n")).toThrow();
    });
  });
});
