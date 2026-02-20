/**
 * Core types for the CodePiper system
 */

export const SUPPORTED_PROVIDERS = ["claude-code", "codex"] as const;
export type KnownProviderId = (typeof SUPPORTED_PROVIDERS)[number];
export type ProviderId = KnownProviderId | (string & {});

export type SessionStatus =
  | "STARTING"
  | "RUNNING"
  | "NEEDS_PERMISSION"
  | "NEEDS_INPUT"
  | "STOPPED"
  | "CRASHED";

export type BillingMode = "subscription" | "api";

export interface SessionHandle {
  id: string;
  provider: ProviderId;
  cwd: string;
  status: SessionStatus;
  createdAt: Date;
  updatedAt: Date;
  pid?: number;
  ptyRows?: number;
  ptyCols?: number;
  transcriptPath?: string;
  metadata?: Record<string, unknown>;
}

export interface StartSessionOptions {
  id: string;
  cwd: string;
  env: Record<string, string>;
  args?: string[];
  model?: string;
  billingMode?: BillingMode;
  dangerousMode?: boolean;
}

export interface Provider {
  id: ProviderId;

  startSession(opts: StartSessionOptions): Promise<SessionHandle>;
  sendText(sessionId: string, text: string): Promise<void>;
  sendKeys(sessionId: string, keys: string[]): Promise<void>;
  stopSession(sessionId: string): Promise<void>;

  onEvent(cb: (evt: ProviderEvent) => void): void;

  // Optional: Model selection (supported by claude-code)
  switchModel?(sessionId: string, model: string): Promise<void>;
  getCurrentModel?(sessionId: string): string | undefined;
}

export interface ProviderEvent {
  sessionId: string;
  type: string;
  timestamp: Date;
  payload: unknown;
}
