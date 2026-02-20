const DEFAULT_SOCKET = "/tmp/codepiper.sock";

export interface DaemonErrorBody {
  error?: string;
  [key: string]: unknown;
}

export async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function readErrorJson(response: Response): Promise<DaemonErrorBody> {
  return (await response.json().catch(() => ({}))) as DaemonErrorBody;
}

export function responseErrorMessage(response: Response, data?: DaemonErrorBody): string {
  return typeof data?.error === "string" && data.error.length > 0
    ? data.error
    : `HTTP ${response.status}: ${response.statusText}`;
}

export function getSocketPath(): string {
  return process.env.CODEPIPER_SOCKET || DEFAULT_SOCKET;
}

export async function daemonFetch(
  path: string,
  opts?: RequestInit & { socket?: string }
): Promise<Response> {
  const socket = opts?.socket || getSocketPath();
  const { socket: _, ...fetchOpts } = opts || {};

  try {
    const response = await fetch(`http://localhost${path}`, {
      unix: socket,
      ...fetchOpts,
    });

    if (!response.ok) {
      const errorData = await readErrorJson(response);
      throw new Error(responseErrorMessage(response, errorData));
    }

    return response;
  } catch (error: any) {
    if (error.code === "ENOENT" || error.message?.includes("ENOENT")) {
      throw new Error(`Failed to connect to daemon at ${socket}. Is the daemon running?`);
    }
    throw error;
  }
}

export async function daemonJson<T>(
  path: string,
  opts?: RequestInit & { socket?: string }
): Promise<T> {
  const response = await daemonFetch(path, opts);
  return readJson<T>(response);
}

export async function daemonPost<T>(
  path: string,
  body?: unknown,
  opts?: { socket?: string }
): Promise<T> {
  const request: RequestInit & { socket?: string } = {
    method: "POST",
  };
  if (body !== undefined) {
    request.headers = { "Content-Type": "application/json" };
    request.body = JSON.stringify(body);
  }
  if (opts?.socket !== undefined) {
    request.socket = opts.socket;
  }

  return daemonJson<T>(path, request);
}
