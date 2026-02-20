/**
 * Shared helpers for consistent API route validation and error responses.
 */

export function jsonError(
  status: number,
  message: string,
  extra?: Record<string, unknown>
): Response {
  return Response.json(extra ? { error: message, ...extra } : { error: message }, { status });
}

export type ParsedJsonBody<T> = { ok: true; body: T } | { ok: false; response: Response };

export async function parseJsonBody<T = any>(req: Request): Promise<ParsedJsonBody<T>> {
  try {
    return { ok: true, body: (await req.json()) as T };
  } catch {
    return { ok: false, response: jsonError(400, "Invalid JSON in request body") };
  }
}

export function hasAnyDefinedField(
  body: Record<string, unknown>,
  fields: readonly string[]
): boolean {
  return fields.some((field) => body[field] !== undefined);
}
