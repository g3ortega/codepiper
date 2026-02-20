import { beforeEach, describe, expect, it, mock } from "bun:test";
import { EventBus } from "@codepiper/core";
import { Database } from "../db/db";
import type { PTYProcess } from "./ptyProcess";
import { SessionManager } from "./sessionManager";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("SessionManager input queue", () => {
  let db: Database;
  let eventBus: EventBus;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    db = new Database(":memory:");
    await db.init();
    eventBus = new EventBus();
    sessionManager = new SessionManager(db, eventBus);
  });

  it("serializes concurrent sendKeys calls per session", async () => {
    const sessionId = "queue-keys";
    const sentKeys: string[] = [];

    const mockPty = {
      pid: 32100,
      closed: false,
      write: mock(() => {}),
      sendKey: mock(async (key: string) => {
        sentKeys.push(key);
        await sleep(key === "1" ? 20 : 1);
      }),
      resize: mock(() => {}),
      kill: mock(() => Promise.resolve()),
      waitExit: mock(() => Promise.resolve({ exitCode: 0, signal: null })),
    } as unknown as PTYProcess;

    sessionManager.registerSession(
      {
        id: sessionId,
        provider: "claude-code",
        cwd: "/tmp",
        status: "RUNNING",
        createdAt: new Date(),
        updatedAt: new Date(),
        pid: 32100,
      },
      mockPty
    );

    const first = sessionManager.sendKeys(sessionId, ["1", "enter"]);
    const second = sessionManager.sendKeys(sessionId, ["2", "enter"]);

    await Promise.all([first, second]);

    expect(sentKeys).toEqual(["1", "Enter", "2", "Enter"]);
  });

  it("serializes mixed sendKeys and sendText operations", async () => {
    const sessionId = "queue-mixed";
    const operations: string[] = [];

    const mockPty = {
      pid: 32101,
      closed: false,
      write: mock((text: string) => {
        operations.push(`text:${text}`);
      }),
      sendKey: mock(async (key: string) => {
        operations.push(`key:${key}`);
        await sleep(20);
      }),
      resize: mock(() => {}),
      kill: mock(() => Promise.resolve()),
      waitExit: mock(() => Promise.resolve({ exitCode: 0, signal: null })),
    } as unknown as PTYProcess;

    sessionManager.registerSession(
      {
        id: sessionId,
        provider: "claude-code",
        cwd: "/tmp",
        status: "RUNNING",
        createdAt: new Date(),
        updatedAt: new Date(),
        pid: 32101,
      },
      mockPty
    );

    const first = sessionManager.sendKeys(sessionId, ["enter"]);
    const second = sessionManager.sendText(sessionId, "hello");

    await Promise.all([first, second]);

    expect(operations).toEqual(["key:Enter", "text:hello"]);
  });

  it("maps extended key names and modifier chords for tmux sessions", async () => {
    const sessionId = "queue-keymap-tmux";
    const sentKeys: string[] = [];

    const mockTmux = {
      pid: 32102,
      closed: false,
      write: mock(() => {}),
      sendKey: mock(async (key: string) => {
        sentKeys.push(key);
      }),
      resize: mock(() => {}),
      kill: mock(() => Promise.resolve()),
      waitExit: mock(() => Promise.resolve({ exitCode: 0, signal: null })),
    } as unknown as PTYProcess;

    sessionManager.registerSession(
      {
        id: sessionId,
        provider: "claude-code",
        cwd: "/tmp",
        status: "RUNNING",
        createdAt: new Date(),
        updatedAt: new Date(),
        pid: 32102,
      },
      mockTmux
    );

    await sessionManager.sendKeys(sessionId, [
      "backspace",
      "home",
      "end",
      "pageup",
      "pagedown",
      "insert",
      "f5",
      "ctrl+l",
      "ctrl+[",
      "alt+x",
    ]);

    expect(sentKeys).toEqual([
      "BSpace",
      "Home",
      "End",
      "PageUp",
      "PageDown",
      "IC",
      "F5",
      "C-l",
      "C-[",
      "M-x",
    ]);
  });

  it("maps modifier chords to PTY control sequences without tmux sendKey", async () => {
    const sessionId = "queue-keymap-pty";
    const writes: string[] = [];

    const mockPtyNoSendKey = {
      pid: 32103,
      closed: false,
      write: mock((chunk: string) => {
        writes.push(chunk);
      }),
      resize: mock(() => {}),
      kill: mock(() => Promise.resolve()),
      waitExit: mock(() => Promise.resolve({ exitCode: 0, signal: null })),
    } as unknown as PTYProcess;

    sessionManager.registerSession(
      {
        id: sessionId,
        provider: "claude-code",
        cwd: "/tmp",
        status: "RUNNING",
        createdAt: new Date(),
        updatedAt: new Date(),
        pid: 32103,
      },
      mockPtyNoSendKey
    );

    await sessionManager.sendKeys(sessionId, [
      "backspace",
      "home",
      "end",
      "pageup",
      "pagedown",
      "insert",
      "ctrl+l",
      "ctrl+[",
      "alt+x",
    ]);

    expect(writes).toEqual([
      "\x7f",
      "\x1b[H",
      "\x1b[F",
      "\x1b[5~",
      "\x1b[6~",
      "\x1b[2~",
      "\x0c",
      "\x1b",
      "\x1bx",
    ]);
  });

  it("keeps modifier chord corpus stable across tmux and pty mapping paths", async () => {
    const sessionTmux = "queue-corpus-tmux";
    const sessionPty = "queue-corpus-pty";
    const sentTmuxKeys: string[] = [];
    const sentPtyChunks: string[] = [];

    const mockTmux = {
      pid: 32104,
      closed: false,
      write: mock(() => {}),
      sendKey: mock(async (key: string) => {
        sentTmuxKeys.push(key);
      }),
      resize: mock(() => {}),
      kill: mock(() => Promise.resolve()),
      waitExit: mock(() => Promise.resolve({ exitCode: 0, signal: null })),
    } as unknown as PTYProcess;

    const mockPtyNoSendKey = {
      pid: 32105,
      closed: false,
      write: mock((chunk: string) => {
        sentPtyChunks.push(chunk);
      }),
      resize: mock(() => {}),
      kill: mock(() => Promise.resolve()),
      waitExit: mock(() => Promise.resolve({ exitCode: 0, signal: null })),
    } as unknown as PTYProcess;

    sessionManager.registerSession(
      {
        id: sessionTmux,
        provider: "claude-code",
        cwd: "/tmp",
        status: "RUNNING",
        createdAt: new Date(),
        updatedAt: new Date(),
        pid: 32104,
      },
      mockTmux
    );

    sessionManager.registerSession(
      {
        id: sessionPty,
        provider: "claude-code",
        cwd: "/tmp",
        status: "RUNNING",
        createdAt: new Date(),
        updatedAt: new Date(),
        pid: 32105,
      },
      mockPtyNoSendKey
    );

    const keyCorpus = [
      "ctrl+a",
      "ctrl+z",
      "ctrl+[",
      "ctrl+\\",
      "ctrl+]",
      "ctrl+^",
      "ctrl+_",
      "ctrl+?",
      "ctrl+space",
      "ctrl+2",
      "ctrl+7",
      "ctrl+8",
      "ctrl+9",
      "alt+a",
      "alt+z",
      "alt+[",
      "alt+space",
      "alt+/",
      "alt+enter",
    ];

    await sessionManager.sendKeys(sessionTmux, keyCorpus);
    await sessionManager.sendKeys(sessionPty, keyCorpus);

    const expectedTmux = keyCorpus.map((key) => {
      if (key.startsWith("ctrl+")) {
        const token = key.slice(5);
        if (token === "space") {
          return "C-Space";
        }
        return `C-${token}`;
      }
      if (key.startsWith("alt+")) {
        const token = key.slice(4);
        if (token === "space") {
          return "M-Space";
        }
        if (token === "enter") {
          return "M-Enter";
        }
        if (token.length === 1) {
          return `M-${token}`;
        }
        return `M-${token}`;
      }
      return key;
    });

    const ctrlMap: Record<string, string> = {
      a: "\x01",
      z: "\x1a",
      "[": "\x1b",
      "\\": "\x1c",
      "]": "\x1d",
      "^": "\x1e",
      _: "\x1f",
      "?": "\x7f",
      space: "\x00",
      "2": "\x00",
      "7": "\x1f",
      "8": "\x7f",
    };

    const expectedPty = keyCorpus.map((key) => {
      if (key.startsWith("ctrl+")) {
        const token = key.slice(5);
        return ctrlMap[token] ?? key;
      }
      if (key.startsWith("alt+")) {
        const token = key.slice(4);
        if (token === "space") {
          return "\x1b ";
        }
        if (token.length === 1) {
          return `\x1b${token}`;
        }
        return key;
      }
      return key;
    });

    expect(sentTmuxKeys).toEqual(expectedTmux);
    expect(sentPtyChunks).toEqual(expectedPty);
  });
});
