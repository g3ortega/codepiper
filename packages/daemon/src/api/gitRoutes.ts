/**
 * Git API route handlers
 *
 * Provides git status, log, diff, file content, and staging operations
 * scoped to a session's working directory.
 */

import { GitUtils, validateFilePath, validateGitRef } from "../git/gitUtils";
import type { RouteContext } from "./routes";

const IMAGE_MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  bmp: "image/bmp",
  avif: "image/avif",
  // SVG intentionally excluded — serving as image/svg+xml enables XSS via inline scripts
};

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function getSessionCwd(
  ctx: RouteContext,
  sessionId: string
): Promise<{ cwd: string } | Response> {
  const session = ctx.sessionManager.getSession(sessionId) ?? ctx.db.getSession(sessionId);
  if (!session) {
    return Response.json({ error: `Session not found: ${sessionId}` }, { status: 404 });
  }
  return { cwd: session.cwd };
}

async function requireGitRepo(cwd: string): Promise<Response | null> {
  const isRepo = await GitUtils.isGitRepo(cwd);
  if (!isRepo) {
    return Response.json({ error: "Session directory is not a git repository" }, { status: 400 });
  }
  return null;
}

/**
 * Shared setup for git file endpoints: resolves session cwd, checks git repo,
 * and extracts/validates ref + path query params.
 */
async function resolveGitFileParams(
  req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<{ cwd: string; ref: string; filePath: string } | Response> {
  const result = await getSessionCwd(ctx, sessionId);
  if (result instanceof Response) return result;

  const repoCheck = await requireGitRepo(result.cwd);
  if (repoCheck) return repoCheck;

  const url = new URL(req.url);
  const ref = url.searchParams.get("ref");
  const filePath = url.searchParams.get("path");

  if (!(ref && filePath)) {
    return Response.json({ error: "Missing required query params: ref and path" }, { status: 400 });
  }

  try {
    validateGitRef(ref);
    validateFilePath(filePath);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Invalid input";
    return Response.json({ error: msg }, { status: 400 });
  }

  return { cwd: result.cwd, ref, filePath };
}

/**
 * GET /sessions/:id/git/status
 */
export async function handleGitStatus(
  _req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  const result = await getSessionCwd(ctx, sessionId);
  if (result instanceof Response) return result;

  const repoCheck = await requireGitRepo(result.cwd);
  if (repoCheck) return repoCheck;

  try {
    const [status, branch] = await Promise.all([
      GitUtils.getStatus(result.cwd),
      GitUtils.getCurrentBranch(result.cwd),
    ]);
    return Response.json({ status, branch });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /sessions/:id/git/branches
 */
export async function handleGitBranches(
  _req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  const result = await getSessionCwd(ctx, sessionId);
  if (result instanceof Response) return result;

  const repoCheck = await requireGitRepo(result.cwd);
  if (repoCheck) return repoCheck;

  try {
    const [branches, currentBranch] = await Promise.all([
      GitUtils.listBranches(result.cwd),
      GitUtils.getCurrentBranch(result.cwd),
    ]);
    return Response.json({ branches, currentBranch });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /sessions/:id/git/log?limit=50
 */
export async function handleGitLog(
  req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  const result = await getSessionCwd(ctx, sessionId);
  if (result instanceof Response) return result;

  const repoCheck = await requireGitRepo(result.cwd);
  if (repoCheck) return repoCheck;

  const url = new URL(req.url);
  const limit = Number.parseInt(url.searchParams.get("limit") || "50", 10);

  try {
    const log = await GitUtils.getLog(result.cwd, { limit });
    return Response.json({ log });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /sessions/:id/git/diff?staged=true&commit=abc&commitA=x&commitB=y&path=file.ts
 */
export async function handleGitDiff(
  req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  const result = await getSessionCwd(ctx, sessionId);
  if (result instanceof Response) return result;

  const repoCheck = await requireGitRepo(result.cwd);
  if (repoCheck) return repoCheck;

  const url = new URL(req.url);
  const staged = url.searchParams.get("staged") === "true";
  const commit = url.searchParams.get("commit");
  const commitA = url.searchParams.get("commitA");
  const commitB = url.searchParams.get("commitB");
  const filePath = url.searchParams.get("path") || undefined;

  try {
    // Validate refs and paths
    if (commit) validateGitRef(commit);
    if (commitA) validateGitRef(commitA);
    if (commitB) validateGitRef(commitB);
    if (filePath) validateFilePath(filePath);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Invalid input";
    return Response.json({ error: msg }, { status: 400 });
  }

  try {
    let diff: string;

    if (commit) {
      diff = await GitUtils.getCommitDiff(result.cwd, commit, filePath);
    } else {
      diff = await GitUtils.getDiff(result.cwd, {
        staged,
        commitA: commitA || undefined,
        commitB: commitB || undefined,
        path: filePath,
      });
    }

    return Response.json({ diff });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /sessions/:id/git/file?ref=HEAD&path=src/foo.ts
 * Use ref=WORKING_TREE to read the file from the on-disk working tree.
 */
export async function handleGitFile(
  req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  const params = await resolveGitFileParams(req, ctx, sessionId);
  if (params instanceof Response) return params;

  try {
    const content =
      params.ref === "WORKING_TREE"
        ? await GitUtils.getFileFromWorkingTree(params.cwd, params.filePath)
        : await GitUtils.getFileAtRef(params.cwd, params.ref, params.filePath);
    return Response.json({ content });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /sessions/:id/git/diff-stat?ref=abc123[&base=main]
 */
export async function handleGitDiffStat(
  req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  const result = await getSessionCwd(ctx, sessionId);
  if (result instanceof Response) return result;

  const repoCheck = await requireGitRepo(result.cwd);
  if (repoCheck) return repoCheck;

  const url = new URL(req.url);
  const ref = url.searchParams.get("ref");
  const base = url.searchParams.get("base");

  // Branch comparison mode: base...ref
  if (base) {
    try {
      validateGitRef(base);
      if (ref) validateGitRef(ref);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Invalid input";
      return Response.json({ error: msg }, { status: 400 });
    }
    try {
      const files = await GitUtils.getDiffStatBetweenRefs(result.cwd, base, ref || "HEAD");
      return Response.json({ files });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return Response.json({ error: msg }, { status: 500 });
    }
  }

  // Single-ref mode (commit vs parent)
  if (!ref) {
    return Response.json({ error: "Missing required query param: ref" }, { status: 400 });
  }

  try {
    validateGitRef(ref);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Invalid input";
    return Response.json({ error: msg }, { status: 400 });
  }

  try {
    const files = await GitUtils.getDiffStat(result.cwd, ref);
    return Response.json({ files });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /sessions/:id/git/file-raw?ref=HEAD&path=src/image.png
 * Returns raw file bytes with appropriate Content-Type.
 */
export async function handleGitFileRaw(
  req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  const params = await resolveGitFileParams(req, ctx, sessionId);
  if (params instanceof Response) return params;

  try {
    const data = await GitUtils.getFileAtRefRaw(params.cwd, params.ref, params.filePath);
    const ext = params.filePath.split(".").pop()?.toLowerCase() || "";
    const contentType = IMAGE_MIME_TYPES[ext] || "application/octet-stream";
    return new Response(toArrayBuffer(data), {
      headers: { "Content-Type": contentType, "Cache-Control": "no-cache" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /sessions/:id/git/stage — body: { paths: string[] }
 */
export async function handleGitStage(
  req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  const result = await getSessionCwd(ctx, sessionId);
  if (result instanceof Response) return result;

  const repoCheck = await requireGitRepo(result.cwd);
  if (repoCheck) return repoCheck;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  if (!Array.isArray(body.paths) || body.paths.length === 0) {
    return Response.json(
      { error: "Missing required field: paths (non-empty array)" },
      { status: 400 }
    );
  }

  try {
    for (const p of body.paths) {
      if (typeof p !== "string") throw new Error("Each path must be a string");
      validateFilePath(p);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Invalid input";
    return Response.json({ error: msg }, { status: 400 });
  }

  try {
    await GitUtils.stageFiles(result.cwd, body.paths);
    return Response.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /sessions/:id/git/unstage — body: { paths: string[] }
 */
export async function handleGitUnstage(
  req: Request,
  ctx: RouteContext,
  sessionId: string
): Promise<Response> {
  const result = await getSessionCwd(ctx, sessionId);
  if (result instanceof Response) return result;

  const repoCheck = await requireGitRepo(result.cwd);
  if (repoCheck) return repoCheck;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  if (!Array.isArray(body.paths) || body.paths.length === 0) {
    return Response.json(
      { error: "Missing required field: paths (non-empty array)" },
      { status: 400 }
    );
  }

  try {
    for (const p of body.paths) {
      if (typeof p !== "string") throw new Error("Each path must be a string");
      validateFilePath(p);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Invalid input";
    return Response.json({ error: msg }, { status: 400 });
  }

  try {
    await GitUtils.unstageFiles(result.cwd, body.paths);
    return Response.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
