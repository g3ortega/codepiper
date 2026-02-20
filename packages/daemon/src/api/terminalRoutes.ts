/**
 * Terminal mode API route handlers
 *
 * Provides scroll, search, and mode control for tmux-based sessions.
 */

import type { RouteContext } from "./routes";
import { SttNotConfiguredError, transcribeAudioFile } from "./stt";

const MAX_AUDIO_UPLOAD_BYTES = 10 * 1024 * 1024;

function errorResponse(error: unknown): Response {
  const msg = error instanceof Error ? error.message : String(error);
  return Response.json({ error: msg }, { status: 400 });
}

async function parseBody(req: Request): Promise<any | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function handleGetTerminalInfo(
  _req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  try {
    const info = await ctx.sessionManager.getTerminalInfo(sessionId);
    return Response.json(info);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleTerminalMode(
  req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  const body = await parseBody(req);
  if (!body) {
    return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  const { mode } = body;
  if (mode !== "interactive" && mode !== "scroll") {
    return Response.json({ error: 'mode must be "interactive" or "scroll"' }, { status: 400 });
  }

  try {
    if (mode === "scroll") {
      await ctx.sessionManager.enterScrollMode(sessionId);
    } else {
      await ctx.sessionManager.exitScrollMode(sessionId);
    }
    return Response.json({ success: true, mode });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleTerminalScroll(
  req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  const body = await parseBody(req);
  if (!body) {
    return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  const { direction, lines, page, edge } = body;

  // Validate: either edge or direction must be specified
  if (edge) {
    if (edge !== "top" && edge !== "bottom") {
      return Response.json({ error: 'edge must be "top" or "bottom"' }, { status: 400 });
    }
    try {
      await ctx.sessionManager.scrollToEdge(sessionId, edge);
      return Response.json({ success: true });
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (direction !== "up" && direction !== "down") {
    return Response.json({ error: 'direction must be "up" or "down"' }, { status: 400 });
  }

  if (lines !== undefined) {
    if (!Number.isInteger(lines) || lines < 1 || lines > 1000) {
      return Response.json(
        { error: "lines must be an integer between 1 and 1000" },
        { status: 400 }
      );
    }
  }

  try {
    await ctx.sessionManager.scrollTerminal(sessionId, direction, { lines, page: !!page });
    return Response.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleTerminalSearch(
  req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  const body = await parseBody(req);
  if (!body) {
    return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  const { query, action } = body;

  // action-based: next, previous, cancel
  if (action) {
    if (action !== "next" && action !== "previous" && action !== "cancel") {
      return Response.json(
        { error: 'action must be "next", "previous", or "cancel"' },
        { status: 400 }
      );
    }
    try {
      if (action === "cancel") {
        await ctx.sessionManager.exitScrollMode(sessionId);
      } else if (action === "next") {
        await ctx.sessionManager.searchNext(sessionId);
      } else {
        await ctx.sessionManager.searchPrevious(sessionId);
      }
      return Response.json({ success: true });
    } catch (error) {
      return errorResponse(error);
    }
  }

  // query-based: start a new search
  if (!query || typeof query !== "string") {
    return Response.json({ error: "query (string) or action is required" }, { status: 400 });
  }

  if (query.length > 1000) {
    return Response.json({ error: "query must be at most 1000 characters" }, { status: 400 });
  }

  try {
    await ctx.sessionManager.searchTerminal(sessionId, query);
    return Response.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleTerminalTranscribe(
  req: Request,
  _ctx: RouteContext,
  _sessionId: string
): Promise<Response> {
  let formData: Awaited<ReturnType<Request["formData"]>>;
  try {
    formData = await req.formData();
  } catch {
    return Response.json(
      { error: "Invalid multipart form data. Send audio as 'audio' field." },
      { status: 400 }
    );
  }

  const audio = formData.get("audio");
  if (!(audio instanceof File)) {
    return Response.json({ error: "Missing 'audio' file field" }, { status: 400 });
  }
  if (!audio.type.startsWith("audio/")) {
    return Response.json({ error: "Uploaded file must be audio/*" }, { status: 400 });
  }
  if (audio.size <= 0) {
    return Response.json({ error: "Audio file is empty" }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_UPLOAD_BYTES) {
    return Response.json({ error: "Audio too large (max 10MB)" }, { status: 413 });
  }

  try {
    const result = await transcribeAudioFile(audio);
    return Response.json(result);
  } catch (error) {
    if (error instanceof SttNotConfiguredError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    return errorResponse(error);
  }
}
