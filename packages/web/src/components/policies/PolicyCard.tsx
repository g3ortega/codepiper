import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/utils";
import type { Policy } from "@/types/api";
import { EditPolicyDialog } from "./EditPolicyDialog";

interface PolicyCardProps {
  policy: Policy;
  onUpdated: () => void;
}

export function PolicyCard({ policy, onUpdated }: PolicyCardProps) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Delete policy "${policy.name}"?`)) return;
    try {
      setDeleting(true);
      await api.deletePolicy(policy.id);
      toast.success("Policy deleted");
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete policy");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="rounded-xl border border-border bg-card/80 backdrop-blur-sm p-5 hover:bg-accent/30 transition-colors">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold">{policy.name}</h3>
            <Badge variant={policy.enabled ? "success" : "secondary"}>
              {policy.enabled ? "Active" : "Disabled"}
            </Badge>
            <span className="text-[10px] font-mono text-muted-foreground/50 bg-muted/50 px-1.5 py-0.5 rounded border border-border">
              Priority: {policy.priority}
            </span>
            {policy.sessionId && (
              <span className="text-[10px] font-mono text-cyan-400/60 bg-cyan-500/5 px-1.5 py-0.5 rounded border border-cyan-500/10">
                Session: {policy.sessionId.slice(0, 8)}
              </span>
            )}
            {!policy.sessionId && (
              <span className="text-[10px] font-mono text-amber-400/60 bg-amber-500/5 px-1.5 py-0.5 rounded border border-amber-500/10">
                Global
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400"
              onClick={handleDelete}
              disabled={deleting}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {policy.description && (
          <p className="text-sm text-muted-foreground mb-3">{policy.description}</p>
        )}
        <div className="space-y-1.5 mb-3">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Rules ({policy.rules.length})
          </p>
          {policy.rules.map((rule) => (
            <div key={rule.id} className="flex items-center gap-2 text-sm">
              <Badge
                variant={
                  rule.action === "allow"
                    ? "success"
                    : rule.action === "deny"
                      ? "destructive"
                      : "warning"
                }
              >
                {rule.action}
              </Badge>
              {rule.tool && (
                <code className="bg-muted/50 px-1.5 py-0.5 rounded text-[11px] font-mono border border-border">
                  {Array.isArray(rule.tool) ? rule.tool.join(", ") : rule.tool}
                </code>
              )}
              {rule.reason && (
                <span className="text-muted-foreground/60 text-xs">- {rule.reason}</span>
              )}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground/50">
          Updated {formatRelativeTime(policy.updatedAt)}
        </p>
      </div>

      {editing && (
        <EditPolicyDialog
          policy={policy}
          open={editing}
          onOpenChange={setEditing}
          onSaved={onUpdated}
        />
      )}
    </>
  );
}
