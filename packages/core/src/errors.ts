/**
 * Custom error types for the CodePiper system
 */

export class CodePiperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodePiperError";
  }
}

export class SessionNotFoundError extends CodePiperError {
  constructor(public sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = "SessionNotFoundError";
  }
}

export class ProviderError extends CodePiperError {
  constructor(
    public provider: string,
    message: string
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
  }
}

export class InvalidSessionStateError extends CodePiperError {
  constructor(
    public sessionId: string,
    public expectedState: string,
    public actualState: string
  ) {
    super(`Invalid session state for ${sessionId}: expected ${expectedState}, got ${actualState}`);
    this.name = "InvalidSessionStateError";
  }
}
