import type { ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { LoginPage } from "./LoginPage";
import { SetupPage } from "./SetupPage";

export function AuthGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, setupRequired, mfaSetupRequired } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background noise">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    );
  }

  if (setupRequired || mfaSetupRequired) {
    return <SetupPage />;
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <>{children}</>;
}
