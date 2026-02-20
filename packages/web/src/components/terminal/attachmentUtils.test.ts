import { describe, expect, it } from "bun:test";
import {
  describeAttachmentUploadError,
  extractImageFileFromDataTransfer,
  extractImageFilesFromDataTransfer,
  MAX_IMAGE_ATTACHMENT_BYTES,
  MAX_IMAGE_ATTACHMENTS_PER_BATCH,
  MAX_PENDING_IMAGE_ATTACHMENTS,
  planImageAttachmentQueue,
  validateImageAttachment,
} from "./attachmentUtils";

function createTransfer(payload: {
  files?: File[];
  items?: Array<{ kind?: string; type: string; file?: File | null }>;
  types?: string[];
}): DataTransfer {
  return {
    files: payload.files ?? [],
    items:
      payload.items?.map((item) => ({
        kind: item.kind ?? "file",
        type: item.type,
        getAsFile: () => item.file ?? null,
      })) ?? [],
    types: payload.types ?? [],
  } as unknown as DataTransfer;
}

describe("attachmentUtils", () => {
  it("validates supported image type and max size", () => {
    const ok = new File(["ok"], "ok.png", { type: "image/png" });
    const large = new File([new Uint8Array(MAX_IMAGE_ATTACHMENT_BYTES + 1)], "large.png", {
      type: "image/png",
    });
    const badType = new File(["bad"], "bad.svg", { type: "image/svg+xml" });

    expect(validateImageAttachment(ok)).toBeNull();
    expect(validateImageAttachment(large)).toContain("Image too large");
    expect(validateImageAttachment(badType)).toContain("Invalid image type");
  });

  it("extracts multiple unique image files from data transfer", () => {
    const png = new File(["png"], "one.png", { type: "image/png", lastModified: 1 });
    const jpg = new File(["jpg"], "two.jpg", { type: "image/jpeg", lastModified: 2 });
    const duplicatePng = new File(["png"], "one.png", { type: "image/png", lastModified: 1 });

    const transfer = createTransfer({
      files: [png, new File(["txt"], "note.txt", { type: "text/plain" })],
      items: [
        { type: "image/jpeg", file: jpg },
        { type: "image/png", file: duplicatePng },
        { type: "text/plain", file: null },
      ],
      types: ["Files"],
    });

    const files = extractImageFilesFromDataTransfer(transfer);
    expect(files).toHaveLength(2);
    expect(files.map((file) => file.name)).toEqual(["one.png", "two.jpg"]);
  });

  it("keeps single-file helper behavior", () => {
    const png = new File(["png"], "one.png", { type: "image/png" });
    const transfer = createTransfer({ files: [png] });

    expect(extractImageFileFromDataTransfer(transfer)?.name).toBe("one.png");
    expect(extractImageFileFromDataTransfer(null)).toBeNull();
  });

  it("plans attachment queue with batch and pending limits", () => {
    const files = Array.from(
      { length: MAX_IMAGE_ATTACHMENTS_PER_BATCH + 4 },
      (_, idx) =>
        new File([`f-${idx}`], `image-${idx}.png`, { type: "image/png", lastModified: idx })
    );

    const plan = planImageAttachmentQueue(files, 0);
    expect(plan.accepted).toHaveLength(MAX_IMAGE_ATTACHMENTS_PER_BATCH);
    expect(plan.droppedByBatchLimit).toBe(4);
    expect(plan.droppedByQueueLimit).toBe(0);

    const nearFullPlan = planImageAttachmentQueue(files, MAX_PENDING_IMAGE_ATTACHMENTS - 2);
    expect(nearFullPlan.accepted).toHaveLength(2);
    expect(nearFullPlan.droppedByQueueLimit).toBe(files.length - 2);
  });

  it("normalizes upload error diagnostics", () => {
    expect(
      describeAttachmentUploadError({
        status: 413,
        message: "payload too large",
      })
    ).toContain("max 10MB");
    expect(
      describeAttachmentUploadError({
        status: 415,
        message: "invalid image type",
      })
    ).toContain("unsupported format");
    expect(
      describeAttachmentUploadError({
        status: 403,
        message: "forbidden",
      })
    ).toContain("daemon auth");
    expect(describeAttachmentUploadError(new Error("Network timeout"))).toContain(
      "Network timeout"
    );
  });
});
