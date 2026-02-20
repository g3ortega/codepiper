export const IMAGE_ATTACHMENT_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";
export const MAX_IMAGE_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_ATTACHMENTS_PER_BATCH = 5;
export const MAX_PENDING_IMAGE_ATTACHMENTS = 12;

const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export interface ImageAttachmentQueuePlan {
  accepted: File[];
  droppedByBatchLimit: number;
  droppedByQueueLimit: number;
}

export function validateImageAttachment(file: File): string | null {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    return "Invalid image type. Allowed: PNG, JPEG, GIF, WebP";
  }

  if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
    return `Image too large (${(file.size / 1024 / 1024).toFixed(1)}MB, max 10MB)`;
  }

  return null;
}

export function planImageAttachmentQueue(
  files: File[],
  pendingCount: number
): ImageAttachmentQueuePlan {
  const safePendingCount =
    Number.isFinite(pendingCount) && pendingCount > 0 ? Math.floor(pendingCount) : 0;
  const remainingQueueCapacity = Math.max(0, MAX_PENDING_IMAGE_ATTACHMENTS - safePendingCount);
  const withinQueueCapacity = files.slice(0, remainingQueueCapacity);
  const accepted = withinQueueCapacity.slice(0, MAX_IMAGE_ATTACHMENTS_PER_BATCH);

  return {
    accepted,
    droppedByQueueLimit: Math.max(0, files.length - remainingQueueCapacity),
    droppedByBatchLimit: Math.max(0, withinQueueCapacity.length - accepted.length),
  };
}

export function hasFilePayload(transfer: DataTransfer | null): boolean {
  if (!transfer) {
    return false;
  }
  if (Array.from(transfer.items ?? []).some((item) => item.kind === "file")) {
    return true;
  }
  return Array.from(transfer.types ?? []).includes("Files");
}

export function extractImageFileFromDataTransfer(transfer: DataTransfer | null): File | null {
  const files = extractImageFilesFromDataTransfer(transfer);
  return files[0] ?? null;
}

export function extractImageFilesFromDataTransfer(transfer: DataTransfer | null): File[] {
  if (!transfer) {
    return [];
  }

  const unique = new Map<string, File>();
  const pushUnique = (file: File) => {
    const key = `${file.name}:${file.type}:${file.size}:${file.lastModified}`;
    if (!unique.has(key)) {
      unique.set(key, file);
    }
  };

  for (const file of Array.from(transfer.files ?? [])) {
    if (file.type.startsWith("image/")) {
      pushUnique(file);
    }
  }

  for (const item of Array.from(transfer.items ?? [])) {
    if (!item.type.startsWith("image/")) {
      continue;
    }
    const file = item.getAsFile();
    if (file) {
      pushUnique(file);
    }
  }

  return Array.from(unique.values());
}

export function supportsClipboardImageRead(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.clipboard && typeof navigator.clipboard.read === "function")
  );
}

export async function readImageFileFromClipboard(): Promise<File | null> {
  if (!supportsClipboardImageRead()) {
    return null;
  }

  const items = await navigator.clipboard.read();
  for (const item of items) {
    const imageType = item.types.find((type) => type.startsWith("image/"));
    if (!imageType) {
      continue;
    }

    const blob = await item.getType(imageType);
    const extension = imageType.split("/")[1] || "png";
    return new File([blob], `clipboard-${Date.now()}.${extension}`, {
      type: imageType,
      lastModified: Date.now(),
    });
  }

  return null;
}

function extractErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return null;
  }
  const candidate = (error as { status?: unknown }).status;
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim();
  }
  if (typeof error === "string") {
    return error.trim();
  }
  return "";
}

export function describeAttachmentUploadError(error: unknown): string {
  const status = extractErrorStatus(error);
  const message = extractErrorMessage(error).slice(0, 140);
  const lower = message.toLowerCase();

  if (
    status === 413 ||
    lower.includes("too large") ||
    lower.includes("payload too large") ||
    lower.includes("max 10mb")
  ) {
    return "Image rejected: file is too large (max 10MB).";
  }

  if (
    status === 415 ||
    lower.includes("invalid image type") ||
    lower.includes("unsupported image")
  ) {
    return "Image rejected: unsupported format (PNG, JPEG, GIF, WebP only).";
  }

  if (status === 401 || status === 403) {
    return "Upload blocked by daemon auth. Refresh and try again.";
  }

  if (status !== null && status >= 500) {
    return `Daemon upload failed (HTTP ${status}).`;
  }

  if (status !== null && status > 0) {
    return message || `Upload failed (HTTP ${status}).`;
  }

  return message || "Unknown upload error.";
}
