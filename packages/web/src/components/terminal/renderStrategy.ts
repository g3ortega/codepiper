export interface TerminalRenderState {
  content: string;
  rows: number;
  cols: number;
  renderedLines: string[];
}

export type TerminalRenderPlan =
  | { kind: "noop"; nextState: TerminalRenderState }
  | { kind: "full" | "incremental"; buffer: string; nextState: TerminalRenderState };

const FULL_FRAME_PREFIX = "\x1b[0m\x1b[H\x1b[2J";
const MAX_INCREMENTAL_LINE_PATCHES = 8;
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const CSI_COMMAND_PATTERN = new RegExp(`${ESC}\\[[0-9;?]*([A-Za-z])`, "g");
const ANSI_CURSOR_WIDTH_STRIP_PATTERN = new RegExp(
  `${ESC}(?:\\[[0-9;?]*[ -/]*[@-~]|\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\))`,
  "g"
);

function normalizeContentLines(content: string): string[] {
  const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
  return trimmed.split("\n");
}

function composeRenderedLines(lines: string[], rows: number): string[] {
  const pad = Math.max(0, rows - lines.length);
  if (pad === 0) {
    return lines;
  }
  return [...new Array<string>(pad).fill(""), ...lines];
}

function hasUnsafeControlSequence(line: string): boolean {
  if (!line.includes(ESC)) {
    return false;
  }

  if (line.includes(`${ESC}]`)) {
    // OSC / window-title / clipboard-like sequences are not line-local safe.
    return true;
  }

  const csiMatches = line.matchAll(CSI_COMMAND_PATTERN);
  for (const match of csiMatches) {
    const command = match[1];
    if (command && command !== "m") {
      return true;
    }
  }

  return false;
}

function stripAnsiForCursorWidth(line: string): string {
  return line.replace(ANSI_CURSOR_WIDTH_STRIP_PATTERN, "").replace(/\r/g, "");
}

function tryBuildIncrementalBuffer(
  previousLines: string[],
  nextLines: string[],
  rows: number
): string | null {
  if (previousLines.length !== rows || nextLines.length !== rows) {
    return null;
  }

  const changedIndices: number[] = [];
  for (let i = 0; i < rows; i += 1) {
    if ((previousLines[i] ?? "") !== (nextLines[i] ?? "")) {
      changedIndices.push(i);
    }
  }

  if (changedIndices.length === 0) {
    return "";
  }

  if (changedIndices.length > MAX_INCREMENTAL_LINE_PATCHES) {
    return null;
  }

  let buffer = "\x1b[0m";
  for (const rowIndex of changedIndices) {
    const line = nextLines[rowIndex] ?? "";
    if (hasUnsafeControlSequence(line)) {
      return null;
    }

    const row = rowIndex + 1;
    buffer += `\x1b[${row};1H\x1b[0m\x1b[2K${line}`;
  }

  return buffer;
}

export function buildTerminalRenderPlan(
  previousState: TerminalRenderState | null,
  nextInput: { content: string; rows: number; cols: number }
): TerminalRenderPlan {
  const lines = normalizeContentLines(nextInput.content);
  const renderedLines = composeRenderedLines(lines, nextInput.rows);
  const nextState: TerminalRenderState = {
    content: nextInput.content,
    rows: nextInput.rows,
    cols: nextInput.cols,
    renderedLines,
  };

  if (
    previousState &&
    previousState.content === nextState.content &&
    previousState.rows === nextState.rows &&
    previousState.cols === nextState.cols
  ) {
    return { kind: "noop", nextState };
  }

  if (
    previousState &&
    previousState.rows === nextState.rows &&
    previousState.cols === nextState.cols
  ) {
    const incremental = tryBuildIncrementalBuffer(
      previousState.renderedLines,
      nextState.renderedLines,
      nextInput.rows
    );
    if (incremental !== null) {
      if (incremental.length === 0) {
        return { kind: "noop", nextState };
      }
      return { kind: "incremental", buffer: incremental, nextState };
    }
  }

  return {
    kind: "full",
    buffer: `${FULL_FRAME_PREFIX}${nextState.renderedLines.join("\r\n")}`,
    nextState,
  };
}

/**
 * The tmux snapshot stream does not include an explicit cursor position.
 * Re-anchor xterm's cursor to the bottom input row after each repaint to
 * avoid stale/ghost cursor positions after incremental updates.
 */
export function buildCursorRestoreSequence(input: {
  content: string;
  rows: number;
  cols: number;
}): string {
  const rows = Math.max(1, input.rows);
  const cols = Math.max(1, input.cols);
  const lines = normalizeContentLines(input.content);
  const lastLine = lines[lines.length - 1] ?? "";
  const visibleLength = Array.from(stripAnsiForCursorWidth(lastLine)).length;
  const col = Math.max(1, Math.min(cols, visibleLength + 1));
  return `\x1b[?25h\x1b[${rows};${col}H`;
}
