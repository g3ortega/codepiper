/**
 * Auth API client for the web dashboard.
 */

export interface AuthStatus {
  setupRequired: boolean;
  mfaEnabled: boolean;
  mfaSetupRequired?: boolean;
  authenticated: boolean;
}

export interface LoginResponse {
  ok: boolean;
  token: string;
}

export interface MfaRequiredResponse {
  mfaRequired: true;
}

export interface MfaSetupRequiredResponse {
  mfaSetupRequired: true;
}

export interface SetupResponse {
  ok: boolean;
  mfaSetupRequired?: boolean;
}

export interface TotpSetupResponse {
  secret: string;
  otpauthUri: string;
  qrDataUrl: string;
}

export interface TotpVerifyResponse {
  recoveryCodes: string[];
  token?: string;
}

export interface AuthSession {
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number;
  ipAddress: string | null;
  userAgent: string | null;
}

async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data.error || `HTTP ${response.status}`);
    (error as any).status = response.status;
    (error as any).code = data.code;
    (error as any).mfaRequired = data.mfaRequired;
    (error as any).mfaSetupRequired = data.mfaSetupRequired;
    (error as any).setupRequired = data.setupRequired;
    (error as any).retryAfter = data.retryAfter;
    throw error;
  }

  return response.json();
}

export const authApi = {
  getStatus: () => authRequest<AuthStatus>("/auth/status"),

  setup: (password: string) =>
    authRequest<SetupResponse>("/auth/setup", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  login: (password: string, totpCode?: string) =>
    authRequest<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ password, totpCode }),
    }),

  logout: () =>
    authRequest<{ ok: boolean }>("/auth/logout", {
      method: "POST",
    }),

  changePassword: (currentPassword: string, newPassword: string) =>
    authRequest<{ ok: boolean }>("/auth/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  mfaSetup: () =>
    authRequest<TotpSetupResponse>("/auth/mfa/setup", {
      method: "POST",
    }),

  mfaVerify: (totpCode: string) =>
    authRequest<TotpVerifyResponse>("/auth/mfa/verify", {
      method: "POST",
      body: JSON.stringify({ totpCode }),
    }),

  listSessions: () => authRequest<{ sessions: AuthSession[] }>("/auth/sessions"),

  revokeAllSessions: () =>
    authRequest<{ ok: boolean }>("/auth/sessions/revoke-all", {
      method: "POST",
    }),
};
