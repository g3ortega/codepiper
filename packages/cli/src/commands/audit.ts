import { daemonJson } from "../lib/api";
import { getOption, getSocket } from "../lib/args";
import { colors, formatDate, table } from "../lib/format";

interface PolicyDecision {
  id: number;
  sessionId: string;
  policyId?: number;
  toolName: string;
  decision: string;
  reason?: string;
  timestamp: string;
}

export async function runAuditCommand(args: string[]): Promise<void> {
  const socket = getSocket(args);
  const sessionId = getOption(args, "session");
  const limit = getOption(args, "limit") || "50";

  const params = new URLSearchParams();
  if (sessionId) params.set("sessionId", sessionId);
  params.set("limit", limit);

  const query = params.toString();
  const data = await daemonJson<{ decisions: PolicyDecision[] }>(`/policy-decisions?${query}`, {
    socket,
  });

  if (data.decisions.length === 0) {
    console.log("No policy decisions found.");
    return;
  }

  const rows = data.decisions.map((d) => {
    const decisionColor =
      d.decision === "allow" ? colors.green : d.decision === "deny" ? colors.red : colors.yellow;

    return [
      formatDate(d.timestamp),
      d.sessionId.slice(0, 8),
      d.toolName,
      `${decisionColor}${d.decision}${colors.reset}`,
      d.policyId ? `#${d.policyId}` : `${colors.dim}-${colors.reset}`,
      d.reason || `${colors.dim}-${colors.reset}`,
    ];
  });

  console.log(table(["TIMESTAMP", "SESSION", "TOOL", "DECISION", "POLICY", "REASON"], rows));
  console.log(`\n${colors.bold}Total:${colors.reset} ${data.decisions.length} decision(s)`);
}
