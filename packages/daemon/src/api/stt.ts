import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_STT_TIMEOUT_MS = 45_000;
const MAX_STDERR_SNIPPET_CHARS = 300;

export class SttNotConfiguredError extends Error {
  constructor(message = "Speech-to-text backend is not configured") {
    super(message);
    this.name = "SttNotConfiguredError";
  }
}

export interface SttTranscriptionResult {
  transcript: string;
  backend: string;
  durationMs: number;
}

function parseSttCommandTokens(): string[] | null {
  const commandJson = process.env.CODEPIPER_STT_COMMAND_JSON?.trim();
  if (commandJson) {
    try {
      const parsed = JSON.parse(commandJson) as unknown;
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string" && item)) {
        return parsed;
      }
    } catch {
      // Fall through to CODEPIPER_STT_COMMAND parsing.
    }
  }

  const command = process.env.CODEPIPER_STT_COMMAND?.trim();
  if (!command) {
    return null;
  }

  const tokens = command.split(/\s+/).filter(Boolean);
  return tokens.length > 0 ? tokens : null;
}

function parseSttTimeoutMs(): number {
  const raw = process.env.CODEPIPER_STT_TIMEOUT_MS;
  if (!raw) {
    return DEFAULT_STT_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_STT_TIMEOUT_MS;
  }
  return parsed;
}

function resolveAudioFileExtension(mimeType: string): string {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

function materializeCommandTokens(
  tokens: string[],
  inputPath: string,
  mimeType: string
): { argv: string[]; backend: string } {
  let containsInputPlaceholder = false;
  const argv = tokens.map((token) => {
    const hasInput = token.includes("{input}");
    if (hasInput) {
      containsInputPlaceholder = true;
    }
    return token.replaceAll("{input}", inputPath).replaceAll("{mime}", mimeType);
  });

  if (!containsInputPlaceholder) {
    argv.push(inputPath);
  }

  return {
    argv,
    backend: argv[0] ?? "unknown",
  };
}

export async function transcribeAudioFile(file: File): Promise<SttTranscriptionResult> {
  const commandTokens = parseSttCommandTokens();
  if (!commandTokens) {
    throw new SttNotConfiguredError(
      "Set CODEPIPER_STT_COMMAND (or CODEPIPER_STT_COMMAND_JSON) to enable audio transcription"
    );
  }

  const mimeType = file.type || "audio/webm";
  const ext = resolveAudioFileExtension(mimeType);
  const tempPath = join(tmpdir(), `codepiper-stt-${randomUUID()}.${ext}`);
  const startedAt = performance.now();

  try {
    await Bun.write(tempPath, await file.arrayBuffer());
    const { argv, backend } = materializeCommandTokens(commandTokens, tempPath, mimeType);
    const timeoutMs = parseSttTimeoutMs();

    const proc = Bun.spawn(argv, {
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(timeoutMs),
    });

    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    if (exitCode !== 0) {
      const stderrSnippet = stderr.trim().slice(0, MAX_STDERR_SNIPPET_CHARS);
      throw new Error(
        stderrSnippet
          ? `STT backend failed (exit ${exitCode}): ${stderrSnippet}`
          : `STT backend failed (exit ${exitCode})`
      );
    }

    const transcript = stdout.trim();
    if (!transcript) {
      throw new Error("STT backend returned empty transcript");
    }

    return {
      transcript,
      backend,
      durationMs: Math.max(0, performance.now() - startedAt),
    };
  } finally {
    try {
      await unlink(tempPath);
    } catch {
      // best-effort cleanup
    }
  }
}
