import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../lib/api";
import type { Session } from "../../types/api";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

interface SessionRowActionsProps {
  session: Session;
  onStatusChange?: (sessionId: string, status: Session["status"]) => void;
}

export function SessionRowActions({ session, onStatusChange }: SessionRowActionsProps) {
  const [loading, setLoading] = useState(false);

  const handleStop = async () => {
    try {
      setLoading(true);
      await api.stopSession(session.id);
      onStatusChange?.(session.id, "STOPPED");
      toast.success(`Session ${session.id.slice(0, 8)} stopped`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to stop session");
    } finally {
      setLoading(false);
    }
  };

  const handleKill = async () => {
    try {
      setLoading(true);
      await api.killSession(session.id);
      onStatusChange?.(session.id, "STOPPED");
      toast.success(`Session ${session.id.slice(0, 8)} killed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to kill session");
    } finally {
      setLoading(false);
    }
  };

  const handleResume = async () => {
    try {
      setLoading(true);
      await api.resumeSession(session.id);
      onStatusChange?.(session.id, "RUNNING");
      toast.success(`Session ${session.id.slice(0, 8)} resumed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to resume session");
    } finally {
      setLoading(false);
    }
  };

  const handleRecover = async () => {
    try {
      setLoading(true);
      await api.recoverSession(session.id);
      onStatusChange?.(session.id, "RUNNING");
      toast.success(`Session ${session.id.slice(0, 8)} recovered`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to recover session");
    } finally {
      setLoading(false);
    }
  };

  const canStop = session.status === "RUNNING" || session.status === "STARTING";
  const canKill = session.status !== "STOPPED" && session.status !== "CRASHED";
  const canResume = session.status === "STOPPED" || session.status === "CRASHED";
  const canRecover = session.status === "STOPPED" || session.status === "CRASHED";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={loading}
          className="h-7 w-7 p-0 hover:bg-accent"
        >
          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border-border bg-popover">
        {canResume && (
          <DropdownMenuItem
            onClick={handleResume}
            className="text-cyan-400 text-sm focus:text-cyan-400"
          >
            Resume (Provider)
          </DropdownMenuItem>
        )}
        {canRecover && (
          <DropdownMenuItem
            onClick={handleRecover}
            className="text-blue-400 text-sm focus:text-blue-400"
          >
            Recover (Tmux)
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={handleStop} disabled={!canStop} className="text-sm">
          Stop
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-accent" />
        <DropdownMenuItem
          onClick={handleKill}
          disabled={!canKill}
          className="text-red-400 text-sm focus:text-red-400"
        >
          Kill
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
