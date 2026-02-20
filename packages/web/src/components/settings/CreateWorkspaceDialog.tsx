import { Plus } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

interface CreateWorkspaceDialogProps {
  onCreated: () => void;
}

export function CreateWorkspaceDialog({ onCreated }: CreateWorkspaceDialogProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error("Workspace name is required");
      return;
    }
    if (!path.trim()) {
      toast.error("Path is required");
      return;
    }

    try {
      setCreating(true);
      await api.createWorkspace({ name: name.trim(), path: path.trim() });
      toast.success(`Workspace "${name}" created`);
      setOpen(false);
      setName("");
      setPath("");
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create workspace");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-cyan-600 hover:bg-cyan-700 text-white border-0">
          <Plus className="h-4 w-4 mr-1.5" />
          New Workspace
        </Button>
      </DialogTrigger>
      <DialogContent className="border-border bg-popover max-w-md">
        <DialogHeader>
          <DialogTitle>Create Workspace</DialogTitle>
          <DialogDescription className="text-muted-foreground/60">
            Bookmark a directory for quick access when creating sessions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <span className="text-xs font-medium text-muted-foreground mb-1.5 block">Name</span>
            <Input
              placeholder="my-project"
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
              placeholder="/home/user/projects/my-project"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="bg-background border-border font-mono text-sm"
            />
            <p className="text-[11px] text-muted-foreground/50 mt-1">Must be an absolute path</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={creating}
            className="bg-cyan-600 hover:bg-cyan-700 text-white border-0"
          >
            {creating ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
