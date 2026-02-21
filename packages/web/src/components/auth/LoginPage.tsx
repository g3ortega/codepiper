import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

export function LoginPage() {
  const { login, mfaEnabled, onboardingPending } = useAuth();
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [showMfa, setShowMfa] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await login(password, totpCode || undefined);
      if (result.mfaRequired) {
        setShowMfa(true);
        setTotpCode("");
      }
      if (result.mfaSetupRequired) {
        setError("MFA setup is required before first sign-in. Continue in setup.");
      }
    } catch (err: any) {
      if (err.status === 429) {
        setError(`Too many attempts. Try again in ${err.retryAfter || 60} seconds.`);
      } else {
        setError(err.message || "Login failed");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background noise">
      <div className="w-full max-w-sm mx-auto p-8">
        <div className="text-center mb-8">
          <img src="/icon.svg" alt="CodePiper" className="h-20 mx-auto mb-4" />
          <h1 className="text-2xl font-semibold text-foreground">CodePiper</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in to continue</p>
          {onboardingPending && (
            <p className="text-xs text-muted-foreground mt-2">
              First-time setup: sign in with your daemon bootstrap password to continue to MFA.
            </p>
          )}
        </div>

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
              placeholder="Enter your password"
              // biome-ignore lint/a11y/noAutofocus: login form primary input
              autoFocus
              required
            />
          </div>

          {(showMfa || mfaEnabled) && (
            <div>
              <label htmlFor="totp" className="block text-sm font-medium text-foreground mb-1">
                Authenticator Code
              </label>
              <input
                id="totp"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 tracking-widest text-center text-lg"
                placeholder="000000"
                // biome-ignore lint/a11y/noAutofocus: focus MFA input when shown
                autoFocus={showMfa}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Enter the 6-digit code from your authenticator app or a recovery code
              </p>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-2 px-4 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
