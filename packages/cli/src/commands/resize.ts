import { daemonPost } from "../lib/api";
import { getSocket } from "../lib/args";
import { colors, success } from "../lib/format";

export async function runResizeCommand(args: string[]): Promise<void> {
  const positionals = args.filter((a) => !a.startsWith("-"));

  if (positionals.length < 3) {
    throw new Error("Usage: codepiper resize <session-id> <cols> <rows>");
  }

  const sessionId = positionals[0];
  const colsStr = positionals[1];
  const rowsStr = positionals[2];

  if (sessionId === undefined || colsStr === undefined || rowsStr === undefined) {
    throw new Error("Usage: codepiper resize <session-id> <cols> <rows>");
  }

  const cols = Number.parseInt(colsStr, 10);
  const rows = Number.parseInt(rowsStr, 10);

  if (Number.isNaN(cols) || Number.isNaN(rows) || cols < 1 || rows < 1) {
    throw new Error("cols and rows must be positive integers");
  }

  const socket = getSocket(args);

  await daemonPost(`/sessions/${sessionId}/resize`, { cols, rows }, { socket });

  success(
    `Session ${colors.cyan}${sessionId.slice(0, 8)}...${colors.reset} resized to ${cols}x${rows}`
  );
}
