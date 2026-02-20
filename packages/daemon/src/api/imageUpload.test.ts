/**
 * Tests for image upload validation and endpoint
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleUploadImage } from "./routes";
import { validateImageUpload } from "./validation";

describe("validateImageUpload", () => {
  function makeFormData(file: File): FormData {
    const fd = new FormData();
    fd.append("image", file);
    return fd;
  }

  test("accepts valid PNG image", () => {
    const file = new File([new Uint8Array(100)], "test.png", { type: "image/png" });
    const result = validateImageUpload(makeFormData(file));
    expect(result.valid).toBe(true);
    expect(result.file).toBeDefined();
    expect(result.sanitizedName).toBe("test.png");
  });

  test("accepts valid JPEG image", () => {
    const file = new File([new Uint8Array(100)], "photo.jpg", { type: "image/jpeg" });
    const result = validateImageUpload(makeFormData(file));
    expect(result.valid).toBe(true);
    expect(result.sanitizedName).toBe("photo.jpg");
  });

  test("accepts valid GIF image", () => {
    const file = new File([new Uint8Array(100)], "animation.gif", { type: "image/gif" });
    const result = validateImageUpload(makeFormData(file));
    expect(result.valid).toBe(true);
  });

  test("accepts valid WebP image", () => {
    const file = new File([new Uint8Array(100)], "image.webp", { type: "image/webp" });
    const result = validateImageUpload(makeFormData(file));
    expect(result.valid).toBe(true);
  });

  test("rejects missing image field", () => {
    const fd = new FormData();
    const result = validateImageUpload(fd);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Missing required field: image");
  });

  test("rejects non-file image field", () => {
    const fd = new FormData();
    fd.append("image", "not-a-file");
    const result = validateImageUpload(fd);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Missing required field: image");
  });

  test("rejects empty file", () => {
    const file = new File([], "empty.png", { type: "image/png" });
    const result = validateImageUpload(makeFormData(file));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("empty");
  });

  test("rejects oversized file (>10MB)", () => {
    const bigData = new Uint8Array(11 * 1024 * 1024); // 11MB
    const file = new File([bigData], "huge.png", { type: "image/png" });
    const result = validateImageUpload(makeFormData(file));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("too large");
    expect(result.error).toContain("10MB");
  });

  test("rejects non-image MIME types", () => {
    const file = new File([new Uint8Array(100)], "doc.pdf", { type: "application/pdf" });
    const result = validateImageUpload(makeFormData(file));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid image type");
  });

  test("rejects text/plain MIME type", () => {
    const file = new File(["hello"], "text.txt", { type: "text/plain" });
    const result = validateImageUpload(makeFormData(file));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid image type");
  });

  test("sanitizes filename with path traversal", () => {
    const file = new File([new Uint8Array(100)], "../../etc/passwd.png", { type: "image/png" });
    const result = validateImageUpload(makeFormData(file));
    expect(result.valid).toBe(true);
    expect(result.sanitizedName).toBe("passwd.png");
    expect(result.sanitizedName).not.toContain("..");
    expect(result.sanitizedName).not.toContain("/");
  });

  test("sanitizes filename with special characters", () => {
    const file = new File([new Uint8Array(100)], "my file (1)!@#$.png", { type: "image/png" });
    const result = validateImageUpload(makeFormData(file));
    expect(result.valid).toBe(true);
    expect(result.sanitizedName).not.toContain(" ");
    expect(result.sanitizedName).not.toContain("!");
    expect(result.sanitizedName).not.toContain("@");
    expect(result.sanitizedName).toContain(".png");
  });

  test("sanitizes filename with leading dots", () => {
    const file = new File([new Uint8Array(100)], "..hidden.png", { type: "image/png" });
    const result = validateImageUpload(makeFormData(file));
    expect(result.valid).toBe(true);
    expect(result.sanitizedName).not.toMatch(/^\./);
  });

  test("handles filename with backslash paths (Windows-style)", () => {
    const file = new File([new Uint8Array(100)], "C:\\Users\\test\\image.png", {
      type: "image/png",
    });
    const result = validateImageUpload(makeFormData(file));
    expect(result.valid).toBe(true);
    expect(result.sanitizedName).toBe("image.png");
  });
});

describe("handleUploadImage", () => {
  let tempDir: string;
  let imageDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "codepiper-image-upload-"));
    imageDir = join(tempDir, "images");
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("creates image dir and uploaded file with owner-only permissions", async () => {
    const sessionId = "session-perm-test";
    await fs.promises.mkdir(tempDir, { recursive: true, mode: 0o755 });
    await chmod(tempDir, 0o755);

    const fd = new FormData();
    fd.append("image", new File([new Uint8Array(32)], "test.png", { type: "image/png" }));

    const req = new Request("http://localhost/sessions/session-perm-test/upload-image", {
      method: "POST",
      body: fd,
    });

    const response = await handleUploadImage(
      req,
      {
        sessionManager: {
          getSession: () => ({ id: sessionId }),
          getImageDir: () => imageDir,
        },
        db: {
          getSession: () => null,
        },
      } as any,
      sessionId
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.path).toBeDefined();
    expect(fs.existsSync(body.path)).toBe(true);

    const dirMode = (await stat(imageDir)).mode & 0o777;
    const fileMode = (await stat(body.path)).mode & 0o777;

    expect(dirMode & 0o077).toBe(0);
    expect(fileMode & 0o077).toBe(0);
  });
});
