import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { Workspace } from "@/types/api";

interface EditWorkspaceDialogProps {
  workspace: Workspace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}

export function EditWorkspaceDialog({
  workspace,
  open,
  onOpenChange,
  onUpdated,
}: EditWorkspaceDialogProps) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(workspace.name);
  const [path, setPath] = useState(workspace.path);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Workspace name is required");
      return;
    }
    if (!path.trim()) {
      toast.error("Path is required");
      return;
    }

    try {
      setSaving(true);
      await api.updateWorkspace(workspace.id, {
        name: name.trim(),
        path: path.trim(),
      });
      toast.success("Workspace updated");
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update workspace");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Workspace</DialogTitle>
          <DialogDescription className="text-muted-foreground/60">
            Update workspace name or directory path.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <span className="text-xs font-medium text-muted-foreground mb-1.5 block">Name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-background border-border"
            />
          </div>
          <div>
            <span className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Directory Path
            </span>
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="bg-background border-border font-mono text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-cyan-600 hover:bg-cyan-700 text-white border-0"
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
