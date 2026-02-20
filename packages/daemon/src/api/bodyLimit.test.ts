import { describe, expect, test } from "bun:test";
import { MAX_BODY_SIZE, MAX_IMAGE_BODY_SIZE } from "../auth/authMiddleware";
import { enforceRequestBodyLimit } from "./bodyLimit";

function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

describe("enforceRequestBodyLimit", () => {
  test("returns 413 when content-length exceeds limit", async () => {
    const req = new Request("http://localhost/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(MAX_BODY_SIZE + 1),
      },
      body: JSON.stringify({ ok: true }),
    });

    const result = await enforceRequestBodyLimit(req, "/sessions");
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(413);
  });

  test("returns 413 for chunked body over limit without content-length", async () => {
    const chunk = new TextEncoder().encode("x".repeat(600 * 1024));
    const req = new Request("http://localhost/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: streamFromChunks([chunk, chunk]),
    });

    const result = await enforceRequestBodyLimit(req, "/sessions");
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(413);
  });

  test("rebuilds request for chunked body under limit", async () => {
    const payload = JSON.stringify({ hello: "world" });
    const req = new Request("http://localhost/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: streamFromChunks([new TextEncoder().encode(payload)]),
    });

    const result = await enforceRequestBodyLimit(req, "/sessions");
    expect(result).toBeInstanceOf(Request);
    const rebuilt = result as Request;
    const data = await rebuilt.json();
    expect(data).toEqual({ hello: "world" });
  });

  test("keeps image upload route on image-size rules", async () => {
    const req = new Request("http://localhost/sessions/abc/upload-image", {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data",
        "Content-Length": String(12 * 1024 * 1024),
      },
      body: "fake",
    });

    const result = await enforceRequestBodyLimit(req, "/sessions/abc/upload-image");
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(413);
  });

  test("keeps terminal transcribe route on upload-size rules", async () => {
    const req = new Request("http://localhost/sessions/abc/terminal/transcribe", {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data",
        "Content-Length": String(12 * 1024 * 1024),
      },
      body: "fake",
    });

    const result = await enforceRequestBodyLimit(req, "/sessions/abc/terminal/transcribe");
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(413);
  });

  test("returns 413 for chunked transcribe upload over 10MB without content-length", async () => {
    const chunk = new Uint8Array(6 * 1024 * 1024);
    const req = new Request("http://localhost/sessions/abc/terminal/transcribe", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data" },
      body: streamFromChunks([chunk, chunk]),
    });

    const result = await enforceRequestBodyLimit(req, "/sessions/abc/terminal/transcribe");
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(413);
  });

  test("rebuilds chunked transcribe upload under 10MB for downstream form parsing", async () => {
    const payload = new Uint8Array(Math.floor(MAX_IMAGE_BODY_SIZE / 4));
    payload.fill(1);
    const req = new Request("http://localhost/sessions/abc/terminal/transcribe", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data" },
      body: streamFromChunks([payload]),
    });

    const result = await enforceRequestBodyLimit(req, "/sessions/abc/terminal/transcribe");
    expect(result).toBeInstanceOf(Request);
    const rebuilt = result as Request;
    const rebuiltBytes = new Uint8Array(await rebuilt.arrayBuffer());
    expect(rebuiltBytes.byteLength).toBe(payload.byteLength);
  });
});
