import { useCallback, useEffect, useState } from "react";
import { authApi } from "@/lib/auth";

interface MfaSetupDialogProps {
  onClose: () => void;
  onEnabled: () => void;
}

type Step = "qr" | "verify" | "recovery";

export function MfaSetupDialog({ onClose, onEnabled }: MfaSetupDialogProps) {
  const [step, setStep] = useState<Step>("qr");
  const [qrData, setQrData] = useState<{ qrDataUrl: string | null; secret: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const startSetup = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await authApi.mfaSetup();
      setQrData({ qrDataUrl: result.qrDataUrl, secret: result.secret });
    } catch (err: any) {
      setError(err.message || "Failed to start MFA setup");
    } finally {
      setLoading(false);
    }
  }, []);

  const verifyCode = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await authApi.mfaVerify(totpCode);
      setRecoveryCodes(result.recoveryCodes);
      setStep("recovery");
      onEnabled();
    } catch (err: any) {
      setError(err.message || "Invalid code");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (step === "qr" && !(qrData || loading || error)) {
      void startSetup();
    }
  }, [step, qrData, loading, error, startSetup]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-lg shadow-lg w-full max-w-md mx-4 p-6">
        {step === "qr" && (
          <>
            <h2 className="text-lg font-semibold mb-4">Set Up Two-Factor Authentication</h2>

            {qrData ? (
              <>
                <p className="text-sm text-muted-foreground mb-4">
                  Scan this QR code with your authenticator app (Google Authenticator, Authy,
                  1Password, etc.)
                </p>

                {qrData.qrDataUrl ? (
                  <div className="flex justify-center mb-4">
                    <img src={qrData.qrDataUrl} alt="TOTP QR Code" className="w-48 h-48" />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground mb-4 text-center">
                    QR rendering is unavailable here. Use the manual setup key below.
                  </p>
                )}

                <details className="mb-4">
                  <summary className="text-xs text-muted-foreground cursor-pointer">
                    Can't scan? Enter this key manually
                  </summary>
                  <code className="block mt-2 p-2 bg-muted rounded text-xs font-mono break-all">
                    {qrData.secret}
                  </code>
                </details>

                <div className="space-y-3">
                  <div>
                    <label htmlFor="mfa-code" className="block text-sm font-medium mb-1">
                      Enter the 6-digit code from your app
                    </label>
                    <input
                      id="mfa-code"
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

                  {error && (
                    <div className="p-2 rounded bg-destructive/10 text-destructive text-sm">
                      {error}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={onClose}
                      className="flex-1 py-2 px-4 rounded-md border border-border text-foreground hover:bg-muted transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={verifyCode}
                      disabled={loading || totpCode.length !== 6}
                      className="flex-1 py-2 px-4 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {loading ? "Verifying..." : "Verify"}
                    </button>
                  </div>
                </div>
              </>
            ) : loading ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Generating QR code...
              </p>
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-destructive mb-2">{error}</p>
                <button
                  type="button"
                  onClick={startSetup}
                  className="text-sm text-primary hover:underline"
                >
                  Try again
                </button>
              </div>
            )}
          </>
        )}

        {step === "recovery" && (
          <>
            <h2 className="text-lg font-semibold mb-2">Save Your Recovery Codes</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Store these codes in a safe place. Each code can only be used once to sign in if you
              lose access to your authenticator app.
            </p>

            <div className="grid grid-cols-2 gap-2 mb-4 p-3 bg-muted rounded-md">
              {recoveryCodes.map((code) => (
                <code key={code} className="text-sm font-mono text-center py-1">
                  {code}
                </code>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(recoveryCodes.join("\n"));
              }}
              className="w-full mb-3 py-2 px-4 rounded-md border border-border text-foreground hover:bg-muted transition-colors text-sm"
            >
              Copy to clipboard
            </button>

            <button
              type="button"
              onClick={onClose}
              className="w-full py-2 px-4 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
            >
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
