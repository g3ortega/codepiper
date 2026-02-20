/**
 * Shared helpers for classifying SQLite constraint errors in API routes.
 */

function getSqliteErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return undefined;
  }

  const maybeCode = (error as { code?: unknown }).code;
  if (typeof maybeCode === "string" && maybeCode.length > 0) {
    return maybeCode;
  }

  return undefined;
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export function isSqliteUniqueConstraintError(error: unknown): boolean {
  const code = getSqliteErrorCode(error);
  if (code === "SQLITE_CONSTRAINT_UNIQUE") {
    return true;
  }

  const message = getErrorMessage(error);
  return (
    message.includes("SQLITE_CONSTRAINT_UNIQUE") ||
    message.includes("UNIQUE constraint") ||
    message.includes("UNIQUE constraint failed")
  );
}

export function isSqliteForeignKeyConstraintError(error: unknown): boolean {
  const code = getSqliteErrorCode(error);
  if (code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
    return true;
  }

  const message = getErrorMessage(error);
  return (
    message.includes("SQLITE_CONSTRAINT_FOREIGNKEY") ||
    message.includes("FOREIGN KEY constraint failed")
  );
}
