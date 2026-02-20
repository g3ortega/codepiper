import { KeyRound, LogOut, Monitor, Shield, ShieldCheck, ShieldOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { MfaSetupDialog } from "@/components/auth/MfaSetupDialog";
import { useAuth } from "@/contexts/AuthContext";
import { type AuthSession, authApi } from "@/lib/auth";

export function SecuritySettings() {
  return (
    <div className="space-y-8">
      <ChangePasswordSection />
      <MfaSection />
      <ActiveSessionsSection />
    </div>
  );
}

function ChangePasswordSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      toast.success("Password changed successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setError(err.message || "Failed to change password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-border rounded-lg p-5">
      <div className="flex items-center gap-2 mb-4">
        <KeyRound className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold">Change Password</h3>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3 max-w-sm">
        <div>
          <label
            htmlFor="current-password"
            className="block text-xs font-medium text-muted-foreground mb-1"
          >
            Current Password
          </label>
          <input
            id="current-password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            required
          />
        </div>
        <div>
          <label
            htmlFor="new-password"
            className="block text-xs font-medium text-muted-foreground mb-1"
          >
            New Password
          </label>
          <input
            id="new-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            placeholder="Minimum 8 characters"
            required
            minLength={8}
          />
        </div>
        <div>
          <label
            htmlFor="confirm-new-password"
            className="block text-xs font-medium text-muted-foreground mb-1"
          >
            Confirm New Password
          </label>
          <input
            id="confirm-new-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            required
            minLength={8}
          />
        </div>

        {error && (
          <div className="p-2 rounded-md bg-destructive/10 text-destructive text-xs">{error}</div>
        )}

        <button
          type="submit"
          disabled={loading || !currentPassword || newPassword.length < 8}
          className="py-2 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Changing..." : "Change Password"}
        </button>
      </form>
    </div>
  );
}

function MfaSection() {
  const { mfaEnabled, checkAuth } = useAuth();
  const [showSetup, setShowSetup] = useState(false);

  return (
    <div className="border border-border rounded-lg p-5">
      <div className="flex items-center gap-2 mb-1">
        <Shield className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold">Two-Factor Authentication</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4 ml-6">
        Add an extra layer of security using an authenticator app.
      </p>

      <div className="flex items-center gap-3 ml-6">
        {mfaEnabled ? (
          <>
            <div className="flex items-center gap-1.5 text-xs text-emerald-500">
              <ShieldCheck className="h-3.5 w-3.5" />
              Enabled
            </div>
            <button
              type="button"
              onClick={() => {
                if (typeof navigator.clipboard?.writeText !== "function") {
                  toast.error("Clipboard access is unavailable in this browser context");
                  return;
                }

                void navigator.clipboard
                  .writeText("codepiper auth reset-mfa")
                  .then(() => {
                    toast.success("CLI command copied: codepiper auth reset-mfa");
                  })
                  .catch(() => {
                    toast.error("Failed to copy command");
                  });
              }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Copy disable command
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldOff className="h-3.5 w-3.5" />
              Not enabled
            </div>
            <button
              type="button"
              onClick={() => setShowSetup(true)}
              className="py-1.5 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              Enable 2FA
            </button>
          </>
        )}
      </div>

      {mfaEnabled && (
        <div className="mt-4 ml-6 p-3 rounded-md border border-border bg-muted/40">
          <p className="text-xs text-muted-foreground leading-relaxed">
            For security hardening, MFA disable is CLI-only. Run{" "}
            <code className="font-mono text-foreground">codepiper auth reset-mfa</code> from a
            trusted terminal on this machine.
          </p>
        </div>
      )}

      {showSetup && (
        <MfaSetupDialog
          onClose={() => setShowSetup(false)}
          onEnabled={() => {
            checkAuth();
          }}
        />
      )}
    </div>
  );
}

function ActiveSessionsSection() {
  const [sessions, setSessions] = useState<AuthSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      const res = await authApi.listSessions();
      setSessions(res.sessions);
    } catch {
      toast.error("Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleRevokeAll = async () => {
    setRevoking(true);
    try {
      await authApi.revokeAllSessions();
      toast.success("All other sessions revoked");
      loadSessions();
    } catch {
      toast.error("Failed to revoke sessions");
    } finally {
      setRevoking(false);
    }
  };

  const formatDate = (ts: number) => {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const parseUserAgent = (ua: string | null): string => {
    if (!ua) return "Unknown device";
    if (ua.includes("Firefox")) return "Firefox";
    if (ua.includes("Edg/")) return "Edge";
    if (ua.includes("Chrome")) return "Chrome";
    if (ua.includes("Safari")) return "Safari";
    if (ua.includes("curl")) return "curl";
    return "Browser";
  };

  return (
    <div className="border border-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Monitor className="h-4 w-4 text-cyan-400" />
          <h3 className="text-sm font-semibold">Active Sessions</h3>
        </div>
        {sessions.length > 1 && (
          <button
            type="button"
            onClick={handleRevokeAll}
            disabled={revoking}
            className="flex items-center gap-1.5 text-xs text-destructive hover:underline disabled:opacity-50"
          >
            <LogOut className="h-3 w-3" />
            {revoking ? "Revoking..." : "Revoke all other sessions"}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-24">
          <div className="flex items-center gap-3 text-muted-foreground">
            <div className="w-4 h-4 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
            <span className="text-sm">Loading sessions...</span>
          </div>
        </div>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No active sessions</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((session, i) => (
            <div
              key={`${session.createdAt}-${session.ipAddress}`}
              className="flex items-center justify-between p-3 rounded-md bg-muted/30 border border-border/50"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Monitor className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {parseUserAgent(session.userAgent)}
                    {i === 0 && (
                      <span className="ml-2 text-xs text-emerald-500 font-normal">(current)</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {session.ipAddress || "Unknown IP"} &middot; Last active{" "}
                    {formatDate(session.lastUsedAt)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
