import { ChevronDown, ChevronRight, Edit2, KeyRound, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { EnvSet } from "@/types/api";
import { CreateEnvSetDialog } from "./CreateEnvSetDialog";
import { EditEnvSetDialog } from "./EditEnvSetDialog";

export function EnvSetList() {
  const [envSets, setEnvSets] = useState<EnvSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingEnvSet, setEditingEnvSet] = useState<EnvSet | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const loadEnvSets = useCallback(async () => {
    try {
      const res = await api.getEnvSets();
      setEnvSets(res.envSets);
    } catch {
      toast.error("Failed to load env sets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEnvSets();
  }, [loadEnvSets]);

  const handleDelete = async (envSet: EnvSet) => {
    try {
      await api.deleteEnvSet(envSet.id);
      toast.success(`Deleted env set "${envSet.name}"`);
      loadEnvSets();
    } catch {
      toast.error("Failed to delete env set");
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-48">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-4 h-4 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
          <span className="text-sm">Loading env sets...</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Named collections of environment variables to inject into sessions.
          </p>
        </div>
        <CreateEnvSetDialog onCreated={loadEnvSets} />
      </div>

      {/* Disclaimer */}
      <div className="border border-amber-500/20 bg-amber-500/[0.04] rounded-lg px-4 py-3 mb-4">
        <p className="text-xs text-amber-300/80 leading-relaxed">
          Environment variables are encrypted at rest but this is not intended for critical secrets
          like production API keys or database passwords. Use a dedicated secrets manager for
          production credentials.
        </p>
      </div>

      {envSets.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl p-12 text-center">
          <KeyRound className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-1">No env sets yet</p>
          <p className="text-xs text-muted-foreground/60">
            Create an env set to inject environment variables into sessions.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {envSets.map((es) => {
            const varCount = es.varCount;
            const isExpanded = expandedIds.has(es.id);

            return (
              <div
                key={es.id}
                className="group border border-border rounded-xl bg-card/50 hover:bg-card/80 transition-all"
              >
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={() => toggleExpand(es.id)}
                      className="w-9 h-9 rounded-lg bg-violet-500/[0.08] flex items-center justify-center shrink-0 hover:bg-violet-500/[0.15] transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-violet-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-violet-400" />
                      )}
                    </button>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{es.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {es.description || `${varCount} variable${varCount !== 1 ? "s" : ""}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-muted-foreground/60 tabular-nums">
                      {varCount} var{varCount !== 1 ? "s" : ""}
                    </span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                        onClick={() => setEditingEnvSet(es)}
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-red-400"
                        onClick={() => handleDelete(es)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Expanded variable list */}
                {isExpanded && (
                  <div className="border-t border-border px-4 py-3">
                    <div className="space-y-1.5">
                      {Object.entries(es.maskedVars).map(([key, value]) => (
                        <div key={key} className="flex items-center gap-2 font-mono text-xs">
                          <span className="text-cyan-400 shrink-0">{key}</span>
                          <span className="text-muted-foreground/40">=</span>
                          <span className="text-muted-foreground truncate">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editingEnvSet && (
        <EditEnvSetDialog
          envSet={editingEnvSet}
          open={true}
          onOpenChange={(open) => {
            if (!open) setEditingEnvSet(null);
          }}
          onUpdated={() => {
            setEditingEnvSet(null);
            loadEnvSets();
          }}
        />
      )}
    </div>
  );
}
