import { GitBranch } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/utils";
import type { Workflow } from "@/types/api";

export function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await api.getWorkflows();
        setWorkflows(response.workflows);
      } catch (_err) {
        toast.error("Failed to load workflows");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-4 md:mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Workflows</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Orchestrate multi-step session automations
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="flex items-center gap-3 text-muted-foreground">
            <div className="w-4 h-4 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
            <span className="text-sm">Loading workflows...</span>
          </div>
        </div>
      ) : workflows.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 rounded-xl border border-border bg-card/80">
          <GitBranch className="h-10 w-10 text-muted-foreground/20 mb-3" />
          <p className="text-sm text-muted-foreground mb-1">No workflows defined</p>
          <p className="text-xs text-muted-foreground/60">
            Create workflows via the CLI:{" "}
            <code className="bg-muted/50 px-1.5 py-0.5 rounded text-[11px] font-mono border border-border">
              codepiper workflow create
            </code>
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {workflows.map((wf) => (
            <div
              key={wf.id}
              className="rounded-xl border border-border bg-card/80 backdrop-blur-sm p-5 hover:bg-accent/50 transition-colors"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">{wf.name}</h3>
                <span className="text-[10px] font-mono text-muted-foreground/50 bg-muted/50 px-1.5 py-0.5 rounded border border-border">
                  {wf.id}
                </span>
              </div>
              {wf.description && (
                <p className="text-sm text-muted-foreground mb-3">{wf.description}</p>
              )}
              <p className="text-[11px] text-muted-foreground/50">
                Created {formatRelativeTime(wf.createdAt)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
