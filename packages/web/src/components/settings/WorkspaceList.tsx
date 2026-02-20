import { Edit2, FolderOpen, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { Workspace } from "@/types/api";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { EditWorkspaceDialog } from "./EditWorkspaceDialog";

export function WorkspaceList() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);

  const loadWorkspaces = useCallback(async () => {
    try {
      const res = await api.getWorkspaces();
      setWorkspaces(res.workspaces);
    } catch {
      toast.error("Failed to load workspaces");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);

  const handleDelete = async (workspace: Workspace) => {
    try {
      await api.deleteWorkspace(workspace.id);
      toast.success(`Deleted workspace "${workspace.name}"`);
      loadWorkspaces();
    } catch {
      toast.error("Failed to delete workspace");
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-48">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-4 h-4 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
          <span className="text-sm">Loading workspaces...</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Save frequently-used directories for quick session creation.
          </p>
        </div>
        <CreateWorkspaceDialog onCreated={loadWorkspaces} />
      </div>

      {workspaces.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl p-12 text-center">
          <FolderOpen className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-1">No workspaces yet</p>
          <p className="text-xs text-muted-foreground/60">
            Create a workspace to bookmark a directory for faster session creation.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {workspaces.map((ws) => (
            <div
              key={ws.id}
              className="group border border-border rounded-xl p-4 bg-card/50 hover:bg-card/80 transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-cyan-500/[0.08] flex items-center justify-center shrink-0">
                    <FolderOpen className="h-4 w-4 text-cyan-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{ws.name}</p>
                    <p className="text-xs text-muted-foreground font-mono truncate">{ws.path}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => setEditingWorkspace(ws)}
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-red-400"
                    onClick={() => handleDelete(ws)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editingWorkspace && (
        <EditWorkspaceDialog
          workspace={editingWorkspace}
          open={true}
          onOpenChange={(open) => {
            if (!open) setEditingWorkspace(null);
          }}
          onUpdated={() => {
            setEditingWorkspace(null);
            loadWorkspaces();
          }}
        />
      )}
    </div>
  );
}
