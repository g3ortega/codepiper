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
import type { Policy } from "@/types/api";

interface CreatePolicySetDialogProps {
  policies: Policy[];
  onCreated: () => void;
}

export function CreatePolicySetDialog({ policies, onCreated }: CreatePolicySetDialogProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    isDefault: false,
    selectedPolicyIds: [] as string[],
  });

  const togglePolicy = (id: string) => {
    setForm((f) => ({
      ...f,
      selectedPolicyIds: f.selectedPolicyIds.includes(id)
        ? f.selectedPolicyIds.filter((pid) => pid !== id)
        : [...f.selectedPolicyIds, id],
    }));
  };

  const handleCreate = async () => {
    if (!form.name.trim()) {
      toast.error("Set name is required");
      return;
    }

    try {
      setCreating(true);
      await api.createPolicySet({
        id: crypto.randomUUID(),
        name: form.name,
        description: form.description || undefined,
        isDefault: form.isDefault,
        policyIds: form.selectedPolicyIds.length > 0 ? form.selectedPolicyIds : undefined,
      });
      toast.success("Policy set created");
      setOpen(false);
      setForm({ name: "", description: "", isDefault: false, selectedPolicyIds: [] });
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create policy set");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="border-border">
          <Plus className="h-4 w-4 mr-1.5" />
          New Set
        </Button>
      </DialogTrigger>
      <DialogContent className="border-border bg-popover max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Policy Set</DialogTitle>
          <DialogDescription className="text-muted-foreground/60">
            Group policies together for easy application to sessions.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <label
              htmlFor="create-set-name"
              className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
            >
              Name *
            </label>
            <Input
              id="create-set-name"
              placeholder="Production Rules"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="border-border bg-muted/30 text-sm placeholder:text-muted-foreground/30"
            />
          </div>

          <div className="grid gap-2">
            <label
              htmlFor="create-set-desc"
              className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
            >
              Description
            </label>
            <Input
              id="create-set-desc"
              placeholder="Optional description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="border-border bg-muted/30 text-sm placeholder:text-muted-foreground/30"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="set-default"
              checked={form.isDefault}
              onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
              className="rounded border-border"
            />
            <label htmlFor="set-default" className="text-sm text-muted-foreground">
              Set as default (auto-apply to new sessions)
            </label>
          </div>

          {policies.length > 0 && (
            <div className="grid gap-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Include Policies
              </p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto rounded-lg border border-border p-2">
                {policies.map((p) => (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/30 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={form.selectedPolicyIds.includes(p.id)}
                      onChange={() => togglePolicy(p.id)}
                      className="rounded border-border"
                    />
                    <span className="text-sm">{p.name}</span>
                    <span className="text-[10px] font-mono text-muted-foreground/50 ml-auto">
                      P:{p.priority}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={creating}
            className="border-border"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={creating}
            className="bg-cyan-600 hover:bg-cyan-700 text-white border-0"
          >
            {creating ? "Creating..." : "Create Set"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
