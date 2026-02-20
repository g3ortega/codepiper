import { daemonFetch } from "../lib/api";
import { getSocket } from "../lib/args";
import { colors, success } from "../lib/format";

export async function runStopCommand(args: string[]): Promise<void> {
  const sessionId = args.find((a) => !a.startsWith("-"));
  if (!sessionId) {
    throw new Error("session-id is required");
  }

  const socket = getSocket(args);

  await daemonFetch(`/sessions/${sessionId}/stop`, {
    method: "POST",
    socket,
  });

  success(`Session ${colors.cyan}${sessionId.slice(0, 8)}...${colors.reset} stopped`);
}
