import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readErrorJson, readJson, responseErrorMessage } from "../lib/api";
import { getRequiredValue } from "../lib/args";

export interface SendOptions {
  sessionId: string;
  text: string;
  socket: string;
  newline: boolean;
  image?: string;
}

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

export function parseSendOptions(args: string[]): SendOptions {
  let sessionId: string | undefined;
  let socket = "/tmp/codepiper.sock";
  let newline = true;
  let image: string | undefined;
  const textParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--socket" || arg === "-s") {
      socket = getRequiredValue(args, i, arg);
      i++;
    } else if (arg === "--newline" || arg === "-n") {
      newline = true;
    } else if (arg === "--no-newline") {
      newline = false;
    } else if (arg === "--image" || arg === "-i") {
      image = getRequiredValue(args, i, arg);
      i++;
    } else if (!arg.startsWith("-")) {
      if (!sessionId) {
        sessionId = arg;
      } else {
        textParts.push(arg);
      }
    }
  }

  if (!sessionId) {
    throw new Error("session-id is required");
  }

  const text = textParts.join(" ");
  if (!(text || image)) {
    throw new Error("text or --image is required");
  }

  const options: SendOptions = {
    sessionId,
    text,
    socket,
    newline,
  };
  if (image !== undefined) {
    options.image = image;
  }

  return options;
}

export async function uploadImage(
  sessionId: string,
  filePath: string,
  socket: string
): Promise<string> {
  const resolved = path.resolve(filePath);
  const stat = fs.statSync(resolved);
  if (stat.size > MAX_IMAGE_SIZE) {
    throw new Error(`Image too large (${(stat.size / 1024 / 1024).toFixed(1)}MB, max 10MB)`);
  }

  const file = Bun.file(resolved);
  const formData = new FormData();
  const blob = new Blob([await file.arrayBuffer()], {
    type: file.type || "application/octet-stream",
  });
  formData.append("image", blob, path.basename(resolved));

  const response = await fetch(`http://localhost/sessions/${sessionId}/upload-image`, {
    unix: socket,
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorData = await readErrorJson(response);
    throw new Error(responseErrorMessage(response, errorData));
  }

  const result = await readJson<{ path: string }>(response);
  return result.path;
}

export async function downloadUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  let ext = path.extname(new URL(url).pathname) || ".png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) ext = ".jpg";
  else if (contentType.includes("png")) ext = ".png";
  else if (contentType.includes("gif")) ext = ".gif";
  else if (contentType.includes("webp")) ext = ".webp";

  const tmpPath = path.join(os.tmpdir(), `codepiper-dl-${Date.now()}${ext}`);
  await Bun.write(tmpPath, response);
  return tmpPath;
}

export async function sendText(options: SendOptions): Promise<void> {
  const payload = {
    text: options.text,
    newline: options.newline,
  };

  try {
    const response = await fetch(`http://localhost/sessions/${options.sessionId}/send`, {
      unix: options.socket,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await readErrorJson(response);
      throw new Error(responseErrorMessage(response, errorData));
    }
  } catch (error: any) {
    if (error.code === "ENOENT" || error.message?.includes("ENOENT")) {
      throw new Error(`Failed to connect to daemon at ${options.socket}. Is the daemon running?`);
    }
    throw error;
  }
}

export async function runSendCommand(args: string[]): Promise<void> {
  const options = parseSendOptions(args);
  let tmpFile: string | undefined;

  try {
    if (options.image) {
      let localPath: string;
      const isUrl = options.image.startsWith("http://") || options.image.startsWith("https://");

      if (isUrl) {
        localPath = await downloadUrl(options.image);
        tmpFile = localPath;
      } else {
        localPath = path.resolve(options.image);
        if (!fs.existsSync(localPath)) {
          throw new Error(`Image file not found: ${localPath}`);
        }
      }

      const uploadedPath = await uploadImage(options.sessionId, localPath, options.socket);
      options.text = options.text ? `${options.text}\n\n${uploadedPath}` : uploadedPath;
    }

    await sendText(options);
    console.log(`Sent to session ${options.sessionId}`);
  } finally {
    if (tmpFile) {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
