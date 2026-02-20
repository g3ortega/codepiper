import { Minus, Plus } from "lucide-react";
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
import type { EnvSet } from "@/types/api";

interface EditEnvSetDialogProps {
  envSet: EnvSet;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}

interface EnvVarRow {
  id: string;
  key: string;
  value: string;
}

let editRowIdCounter = 0;
function newEditRow(key = "", value = ""): EnvVarRow {
  return { id: `erow-${++editRowIdCounter}`, key, value };
}

export function EditEnvSetDialog({ envSet, open, onOpenChange, onUpdated }: EditEnvSetDialogProps) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(envSet.name);
  const [description, setDescription] = useState(envSet.description || "");
  const [rows, setRows] = useState<EnvVarRow[]>(() => {
    const entries = Object.entries(envSet.maskedVars ?? {});
    return entries.length > 0 ? entries.map(([key]) => newEditRow(key, "")) : [newEditRow()];
  });

  const addRow = () => setRows([...rows, newEditRow()]);

  const removeRow = (index: number) => {
    if (rows.length <= 1) return;
    setRows(rows.filter((_, i) => i !== index));
  };

  const updateRow = (index: number, field: "key" | "value", val: string) => {
    setRows(rows.map((row, i) => (i === index ? { ...row, [field]: val } : row)));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }

    const vars: Record<string, string> = {};
    for (const row of rows) {
      if (row.key.trim()) {
        vars[row.key.trim()] = row.value;
      }
    }

    try {
      setSaving(true);
      await api.updateEnvSet(envSet.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        vars,
      });
      toast.success("Env set updated");
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update env set");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Env Set</DialogTitle>
          <DialogDescription className="text-muted-foreground/60">
            Update variables. Re-enter any values you want to change (shown masked).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
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
              Description
            </span>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="bg-background border-border"
            />
          </div>

          <div>
            <span className="text-xs font-medium text-muted-foreground mb-2 block">Variables</span>
            <div className="space-y-2">
              {rows.map((row, i) => (
                <div key={row.id} className="flex items-center gap-2">
                  <Input
                    placeholder="KEY"
                    value={row.key}
                    onChange={(e) => updateRow(i, "key", e.target.value)}
                    className="bg-background border-border font-mono text-xs flex-[2]"
                  />
                  <span className="text-muted-foreground/40 text-xs">=</span>
                  <Input
                    type="password"
                    placeholder="value"
                    value={row.value}
                    onChange={(e) => updateRow(i, "value", e.target.value)}
                    className="bg-background border-border font-mono text-xs flex-[3]"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-red-400"
                    onClick={() => removeRow(i)}
                    disabled={rows.length <= 1}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={addRow}
              className="mt-2 text-xs h-8 border-dashed"
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Variable
            </Button>
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
