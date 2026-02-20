import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/utils";
import type { PolicyDecision } from "@/types/api";

export function AuditLogTable() {
  const [decisions, setDecisions] = useState<PolicyDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "allow" | "deny" | "ask">("all");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await api.getPolicyDecisions({
          decision: filter === "all" ? undefined : filter,
          limit: 100,
        });
        setDecisions(res.decisions);
      } catch {
        toast.error("Failed to load audit log");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [filter]);

  const getDecisionVariant = (d: string) => {
    switch (d) {
      case "allow":
        return "success" as const;
      case "deny":
        return "destructive" as const;
      case "ask":
        return "warning" as const;
      default:
        return "secondary" as const;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Recent permission decisions across all sessions.
        </p>
        <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <SelectTrigger className="w-32 h-8 text-xs border-border bg-muted/30">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="allow">Allow</SelectItem>
            <SelectItem value="deny">Deny</SelectItem>
            <SelectItem value="ask">Ask</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
          <div className="w-3 h-3 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
          <span className="text-xs">Loading audit log...</span>
        </div>
      ) : decisions.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground/50 text-sm">
          No policy decisions recorded yet.
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden bg-card/80 backdrop-blur-sm">
          <div className="grid grid-cols-[80px_100px_1fr_80px_1fr_100px] gap-3 px-4 py-2.5 border-b border-border text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            <div>Decision</div>
            <div>Session</div>
            <div>Tool</div>
            <div>Policy</div>
            <div>Reason</div>
            <div>Time</div>
          </div>
          {decisions.map((d) => (
            <div
              key={d.id}
              className="grid grid-cols-[80px_100px_1fr_80px_1fr_100px] gap-3 px-4 py-2.5 border-b border-border/60 last:border-0 text-sm items-center"
            >
              <div>
                <Badge variant={getDecisionVariant(d.decision)} className="text-[10px]">
                  {d.decision}
                </Badge>
              </div>
              <div className="font-mono text-xs text-muted-foreground truncate">
                {d.sessionId.slice(0, 8)}
              </div>
              <div className="font-mono text-xs truncate">{d.toolName}</div>
              <div className="font-mono text-[10px] text-muted-foreground/50 truncate">
                {d.policyId ? d.policyId.slice(0, 8) : "-"}
              </div>
              <div className="text-xs text-muted-foreground truncate">{d.reason || "-"}</div>
              <div className="text-[11px] text-muted-foreground">
                {formatRelativeTime(d.timestamp)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
