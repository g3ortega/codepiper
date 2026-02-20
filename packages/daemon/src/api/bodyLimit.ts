import {
  isBodyTooLarge,
  isImageBodyTooLarge,
  MAX_BODY_SIZE,
  MAX_IMAGE_BODY_SIZE,
} from "../auth/authMiddleware";

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);
const IMAGE_UPLOAD_PATH = /^\/(?:api\/)?sessions\/[a-zA-Z0-9-]+\/upload-image$/;
const AUDIO_TRANSCRIBE_PATH = /^\/(?:api\/)?sessions\/[a-zA-Z0-9-]+\/terminal\/transcribe$/;

class BodyTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BodyTooLargeError";
  }
}

function isImageUploadPath(pathname: string): boolean {
  return IMAGE_UPLOAD_PATH.test(pathname);
}

function isAudioTranscribePath(pathname: string): boolean {
  return AUDIO_TRANSCRIBE_PATH.test(pathname);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function readBodyWithLimit(req: Request, maxBytes: number): Promise<Uint8Array | null> {
  if (!req.body) {
    return null;
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }

      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // best-effort cancellation
        }
        throw new BodyTooLargeError(`Request body exceeds ${maxBytes} bytes`);
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * Enforce request body limits:
 * - image/audio upload routes: 10MB limit
 * - all other write routes: 1MB limit, including chunked bodies without Content-Length.
 *
 * Returns either the original/rebuilt Request, or a 413 Response.
 */
export async function enforceRequestBodyLimit(
  req: Request,
  pathname: string
): Promise<Request | Response> {
  if (!BODY_METHODS.has(req.method.toUpperCase())) {
    return req;
  }

  if (isImageUploadPath(pathname) || isAudioTranscribePath(pathname)) {
    if (isImageBodyTooLarge(req)) {
      return Response.json({ error: "Upload too large (max 10MB)" }, { status: 413 });
    }
    if (!req.headers.has("content-length")) {
      try {
        const body = await readBodyWithLimit(req, MAX_IMAGE_BODY_SIZE);
        if (!body) {
          return req;
        }
        return new Request(req, { body: toArrayBuffer(body) });
      } catch (error) {
        if (error instanceof BodyTooLargeError) {
          return Response.json({ error: "Upload too large (max 10MB)" }, { status: 413 });
        }
        throw error;
      }
    }
    return req;
  }

  if (isBodyTooLarge(req)) {
    return Response.json({ error: "Request too large" }, { status: 413 });
  }

  // If Content-Length is present and already validated, no additional read is needed.
  if (req.headers.has("content-length")) {
    return req;
  }

  // No Content-Length (e.g. chunked): stream and enforce the same limit.
  try {
    const body = await readBodyWithLimit(req, MAX_BODY_SIZE);
    if (!body) {
      return req;
    }
    return new Request(req, { body: toArrayBuffer(body) });
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return Response.json({ error: "Request too large" }, { status: 413 });
    }
    throw error;
  }
}
