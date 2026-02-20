import { describe, expect, mock, test } from "bun:test";
import type { RouteContext } from "./routes";
import {
  handleGetTerminalInfo,
  handleTerminalMode,
  handleTerminalScroll,
  handleTerminalSearch,
  handleTerminalTranscribe,
} from "./terminalRoutes";

function createContext(overrides?: Partial<Record<string, unknown>>): RouteContext {
  const sessionManager = {
    getTerminalInfo: mock(async () => ({ mode: "interactive", scrollPosition: 0 })),
    enterScrollMode: mock(async () => {}),
    exitScrollMode: mock(async () => {}),
    scrollToEdge: mock(async () => {}),
    scrollTerminal: mock(async () => {}),
    searchNext: mock(async () => {}),
    searchPrevious: mock(async () => {}),
    searchTerminal: mock(async () => {}),
    ...(overrides ?? {}),
  };

  return {
    db: {} as any,
    eventBus: {} as any,
    policyEngine: {} as any,
    auditLogger: {} as any,
    sessionManager: sessionManager as any,
  };
}

describe("Terminal API Routes", () => {
  test("GET /sessions/:id/terminal/info returns session terminal metadata", async () => {
    const ctx = createContext();
    const response = await handleGetTerminalInfo(
      new Request("http://localhost/sessions/s1/terminal/info"),
      ctx,
      "s1"
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.mode).toBe("interactive");
    expect(body.scrollPosition).toBe(0);
  });

  test("POST /sessions/:id/terminal/mode rejects invalid mode value", async () => {
    const ctx = createContext();
    const response = await handleTerminalMode(
      new Request("http://localhost/sessions/s1/terminal/mode", {
        method: "POST",
        body: JSON.stringify({ mode: "bad" }),
      }),
      ctx,
      "s1"
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("mode must be");
  });

  test("POST /sessions/:id/terminal/mode enters scroll mode when requested", async () => {
    const ctx = createContext();
    const response = await handleTerminalMode(
      new Request("http://localhost/sessions/s1/terminal/mode", {
        method: "POST",
        body: JSON.stringify({ mode: "scroll" }),
      }),
      ctx,
      "s1"
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.mode).toBe("scroll");
    expect((ctx.sessionManager as any).enterScrollMode).toHaveBeenCalledWith("s1");
  });

  test("POST /sessions/:id/terminal/scroll validates edge and lines values", async () => {
    const ctx = createContext();

    const invalidEdge = await handleTerminalScroll(
      new Request("http://localhost/sessions/s1/terminal/scroll", {
        method: "POST",
        body: JSON.stringify({ edge: "left" }),
      }),
      ctx,
      "s1"
    );
    expect(invalidEdge.status).toBe(400);

    const invalidLines = await handleTerminalScroll(
      new Request("http://localhost/sessions/s1/terminal/scroll", {
        method: "POST",
        body: JSON.stringify({ direction: "up", lines: 0 }),
      }),
      ctx,
      "s1"
    );
    expect(invalidLines.status).toBe(400);
  });

  test("POST /sessions/:id/terminal/scroll supports edge and directional scroll requests", async () => {
    const ctx = createContext();

    const edgeResponse = await handleTerminalScroll(
      new Request("http://localhost/sessions/s1/terminal/scroll", {
        method: "POST",
        body: JSON.stringify({ edge: "top" }),
      }),
      ctx,
      "s1"
    );
    expect(edgeResponse.status).toBe(200);
    expect((ctx.sessionManager as any).scrollToEdge).toHaveBeenCalledWith("s1", "top");

    const directionResponse = await handleTerminalScroll(
      new Request("http://localhost/sessions/s1/terminal/scroll", {
        method: "POST",
        body: JSON.stringify({ direction: "down", lines: 25, page: true }),
      }),
      ctx,
      "s1"
    );
    expect(directionResponse.status).toBe(200);
    expect((ctx.sessionManager as any).scrollTerminal).toHaveBeenCalledWith("s1", "down", {
      lines: 25,
      page: true,
    });
  });

  test("POST /sessions/:id/terminal/search validates action and query inputs", async () => {
    const ctx = createContext();

    const invalidAction = await handleTerminalSearch(
      new Request("http://localhost/sessions/s1/terminal/search", {
        method: "POST",
        body: JSON.stringify({ action: "jump" }),
      }),
      ctx,
      "s1"
    );
    expect(invalidAction.status).toBe(400);

    const missingQuery = await handleTerminalSearch(
      new Request("http://localhost/sessions/s1/terminal/search", {
        method: "POST",
        body: JSON.stringify({}),
      }),
      ctx,
      "s1"
    );
    expect(missingQuery.status).toBe(400);

    const longQuery = await handleTerminalSearch(
      new Request("http://localhost/sessions/s1/terminal/search", {
        method: "POST",
        body: JSON.stringify({ query: "x".repeat(1001) }),
      }),
      ctx,
      "s1"
    );
    expect(longQuery.status).toBe(400);
  });

  test("POST /sessions/:id/terminal/search supports action and query workflows", async () => {
    const ctx = createContext();

    const cancelResponse = await handleTerminalSearch(
      new Request("http://localhost/sessions/s1/terminal/search", {
        method: "POST",
        body: JSON.stringify({ action: "cancel" }),
      }),
      ctx,
      "s1"
    );
    expect(cancelResponse.status).toBe(200);
    expect((ctx.sessionManager as any).exitScrollMode).toHaveBeenCalledWith("s1");

    const queryResponse = await handleTerminalSearch(
      new Request("http://localhost/sessions/s1/terminal/search", {
        method: "POST",
        body: JSON.stringify({ query: "TODO" }),
      }),
      ctx,
      "s1"
    );
    expect(queryResponse.status).toBe(200);
    expect((ctx.sessionManager as any).searchTerminal).toHaveBeenCalledWith("s1", "TODO");
  });

  test("POST /sessions/:id/terminal/transcribe validates audio upload field", async () => {
    const noAudioForm = new FormData();
    const missingAudioResponse = await handleTerminalTranscribe(
      new Request("http://localhost/sessions/s1/terminal/transcribe", {
        method: "POST",
        body: noAudioForm,
      }),
      createContext(),
      "s1"
    );
    expect(missingAudioResponse.status).toBe(400);

    const textForm = new FormData();
    textForm.set("audio", new File(["hello"], "note.txt", { type: "text/plain" }));
    const wrongTypeResponse = await handleTerminalTranscribe(
      new Request("http://localhost/sessions/s1/terminal/transcribe", {
        method: "POST",
        body: textForm,
      }),
      createContext(),
      "s1"
    );
    expect(wrongTypeResponse.status).toBe(400);

    const emptyAudioForm = new FormData();
    emptyAudioForm.set("audio", new File([], "empty.wav", { type: "audio/wav" }));
    const emptyAudioResponse = await handleTerminalTranscribe(
      new Request("http://localhost/sessions/s1/terminal/transcribe", {
        method: "POST",
        body: emptyAudioForm,
      }),
      createContext(),
      "s1"
    );
    expect(emptyAudioResponse.status).toBe(400);

    const oversizedAudioForm = new FormData();
    oversizedAudioForm.set(
      "audio",
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.wav", { type: "audio/wav" })
    );
    const oversizedResponse = await handleTerminalTranscribe(
      new Request("http://localhost/sessions/s1/terminal/transcribe", {
        method: "POST",
        body: oversizedAudioForm,
      }),
      createContext(),
      "s1"
    );
    expect(oversizedResponse.status).toBe(413);
  });
});
