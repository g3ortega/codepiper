import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { authApi } from "@/lib/auth";

type SetupPhase = "password" | "mfa" | "recovery";

export function SetupPage() {
  const { setup, mfaSetupRequired, checkAuth } = useAuth();
  const [phase, setPhase] = useState<SetupPhase>(mfaSetupRequired ? "mfa" : "password");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [qrData, setQrData] = useState<{ qrDataUrl: string | null; secret: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [mfaError, setMfaError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mfaLoading, setMfaLoading] = useState(false);

  const retryMfaSetup = () => {
    setMfaError("");
    setQrData(null);
  };

  useEffect(() => {
    if (mfaSetupRequired && phase === "password") {
      setPhase("mfa");
    }
  }, [mfaSetupRequired, phase]);

  useEffect(() => {
    if (phase !== "mfa" || qrData || mfaLoading || mfaError) {
      return;
    }

    let cancelled = false;
    const startMfaSetup = async () => {
      setMfaLoading(true);
      setMfaError("");
      try {
        const result = await authApi.mfaSetup();
        if (!cancelled) {
          setQrData({ qrDataUrl: result.qrDataUrl, secret: result.secret });
        }
      } catch (err: any) {
        if (!cancelled) {
          setMfaError(err.message || "Failed to start MFA setup");
        }
      } finally {
        if (!cancelled) {
          setMfaLoading(false);
        }
      }
    };

    void startMfaSetup();
    return () => {
      cancelled = true;
    };
  }, [phase, qrData, mfaLoading, mfaError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const result = await setup(password);
      if (result.mfaSetupRequired) {
        setPhase("mfa");
        return;
      }
    } catch (err: any) {
      setError(err.message || "Setup failed");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyMfa = async () => {
    setMfaError("");
    setMfaLoading(true);
    try {
      const result = await authApi.mfaVerify(totpCode);
      setRecoveryCodes(result.recoveryCodes);
      setPhase("recovery");
    } catch (err: any) {
      setMfaError(err.message || "Failed to verify MFA code");
    } finally {
      setMfaLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background noise">
      <div className="w-full max-w-md mx-auto p-8">
        <div className="text-center mb-8">
          <img src="/icon.svg" alt="CodePiper" className="h-20 mx-auto mb-4" />
          <h1 className="text-2xl font-semibold text-foreground">CodePiper Setup</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {phase === "password" && "Step 1 of 2: Create your admin password"}
            {phase === "mfa" && "Step 2 of 2: MFA is required before first sign-in"}
            {phase === "recovery" && "Save your recovery codes, then continue"}
          </p>
        </div>

        {phase === "password" && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="Minimum 8 characters"
                // biome-ignore lint/a11y/noAutofocus: setup form primary input
                autoFocus
                required
                minLength={8}
              />
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-foreground mb-1"
              >
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="Re-enter your password"
                required
                minLength={8}
              />
            </div>

            {error && (
              <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || password.length < 8}
              className="w-full py-2 px-4 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Saving password..." : "Continue to MFA setup"}
            </button>
          </form>
        )}

        {phase === "mfa" && (
          <div className="space-y-4">
            {mfaLoading && !qrData && (
              <p className="text-sm text-muted-foreground text-center py-8">
                Generating authenticator QR code...
              </p>
            )}

            {!(mfaLoading || qrData) && mfaError && (
              <div className="space-y-3">
                <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  {mfaError}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={retryMfaSetup}
                    className="w-full py-2 px-4 rounded-md border border-border text-foreground hover:bg-muted transition-colors"
                  >
                    Retry setup
                  </button>
                  <button
                    type="button"
                    onClick={() => void checkAuth()}
                    className="w-full py-2 px-4 rounded-md border border-border text-foreground hover:bg-muted transition-colors"
                  >
                    Back to sign-in
                  </button>
                </div>
              </div>
            )}

            {qrData && (
              <>
                <p className="text-sm text-muted-foreground">
                  Scan this QR code with your authenticator app (Google Authenticator, Authy,
                  1Password, etc.), then enter the 6-digit code.
                </p>
                {qrData.qrDataUrl ? (
                  <div className="flex justify-center">
                    <img src={qrData.qrDataUrl} alt="MFA setup QR code" className="w-52 h-52" />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-2">
                    QR rendering is unavailable in this environment. Use the setup key below.
                  </p>
                )}
                <details>
                  <summary className="text-xs text-muted-foreground cursor-pointer">
                    Can't scan? Enter setup key manually
                  </summary>
                  <code className="block mt-2 p-2 bg-muted rounded text-xs font-mono break-all">
                    {qrData.secret}
                  </code>
                </details>
                <div>
                  <label
                    htmlFor="totpCode"
                    className="block text-sm font-medium text-foreground mb-1"
                  >
                    Authenticator code
                  </label>
                  <input
                    id="totpCode"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                    className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground tracking-widest text-center text-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
                    placeholder="000000"
                    // biome-ignore lint/a11y/noAutofocus: MFA verification input
                    autoFocus
                  />
                </div>

                {mfaError && (
                  <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                    {mfaError}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleVerifyMfa}
                  disabled={mfaLoading || totpCode.length !== 6}
                  className="w-full py-2 px-4 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {mfaLoading ? "Verifying..." : "Verify MFA and continue"}
                </button>
              </>
            )}
          </div>
        )}

        {phase === "recovery" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Save these recovery codes in a secure place. Each code can be used once if you lose
              access to your authenticator.
            </p>
            <div className="grid grid-cols-2 gap-2 p-3 bg-muted rounded-md">
              {recoveryCodes.map((code) => (
                <code key={code} className="text-sm font-mono text-center py-1">
                  {code}
                </code>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(recoveryCodes.join("\n"))}
              className="w-full py-2 px-4 rounded-md border border-border text-foreground hover:bg-muted transition-colors text-sm"
            >
              Copy recovery codes
            </button>
            <button
              type="button"
              onClick={() => void checkAuth()}
              className="w-full py-2 px-4 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
            >
              Enter dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
