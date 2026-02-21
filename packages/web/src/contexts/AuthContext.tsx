import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { type AuthStatus, authApi } from "@/lib/auth";

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  setupRequired: boolean;
  mfaEnabled: boolean;
  mfaSetupRequired: boolean;
  onboardingPending: boolean;
  login: (
    password: string,
    totpCode?: string
  ) => Promise<{ mfaRequired?: boolean; mfaSetupRequired?: boolean }>;
  setup: (password: string) => Promise<{ mfaSetupRequired?: boolean }>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const DEFAULT_STATUS: AuthStatus = {
  setupRequired: false,
  mfaEnabled: false,
  mfaSetupRequired: false,
  onboardingPending: false,
  authenticated: false,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<AuthStatus>(DEFAULT_STATUS);

  const checkAuth = useCallback(async () => {
    try {
      const s = await authApi.getStatus();
      setStatus(s);
    } catch {
      // If we can't reach the API, assume not authenticated
      setStatus(DEFAULT_STATUS);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = useCallback(
    async (password: string, totpCode?: string) => {
      try {
        await authApi.login(password, totpCode);
        await checkAuth();
        return {};
      } catch (error: any) {
        if (error.mfaSetupRequired) {
          setStatus((current) => ({
            ...current,
            setupRequired: false,
            mfaSetupRequired: true,
            onboardingPending: true,
            authenticated: false,
          }));
          return { mfaSetupRequired: true };
        }
        if (error.mfaRequired) {
          return { mfaRequired: true };
        }
        throw error;
      }
    },
    [checkAuth]
  );

  const setup = useCallback(
    async (password: string) => {
      const result = await authApi.setup(password);
      if (result.mfaSetupRequired) {
        setStatus({
          setupRequired: false,
          mfaEnabled: false,
          mfaSetupRequired: true,
          onboardingPending: true,
          authenticated: false,
        });
        return { mfaSetupRequired: true };
      }
      await checkAuth();
      return {};
    },
    [checkAuth]
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch (error) {
      console.warn("[auth] Server-side logout failed — session may remain active:", error);
    }
    await checkAuth();
  }, [checkAuth]);

  const value = useMemo<AuthState>(
    () => ({
      isAuthenticated: status.authenticated,
      isLoading,
      setupRequired: status.setupRequired,
      mfaEnabled: status.mfaEnabled,
      mfaSetupRequired: status.mfaSetupRequired ?? false,
      onboardingPending: status.onboardingPending ?? false,
      login,
      setup,
      logout,
      checkAuth,
    }),
    [status, isLoading, login, setup, logout, checkAuth]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
