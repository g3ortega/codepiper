/**
 * Input validation utilities
 */

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate working directory path
 */
export function validateCwd(cwd: string): ValidationResult {
  // Check type
  if (typeof cwd !== "string") {
    return { valid: false, error: "cwd must be a string" };
  }

  // Check length (4KB max for path)
  if (cwd.length > 4096) {
    return {
      valid: false,
      error: `cwd path too long (${cwd.length} chars, max 4096)`,
    };
  }

  // Check if absolute path
  if (!cwd.startsWith("/")) {
    return {
      valid: false,
      error: "cwd must be an absolute path (start with /)",
    };
  }

  // Check for null bytes (security)
  if (cwd.includes("\0")) {
    return {
      valid: false,
      error: "cwd contains invalid null byte",
    };
  }

  // Reject ".." path traversal components
  if (cwd.split("/").includes("..")) {
    return {
      valid: false,
      error: "cwd must not contain '..' path traversal",
    };
  }

  return { valid: true };
}

/**
 * Validate text input
 */
export function validateText(text: string): ValidationResult {
  // Check type
  if (typeof text !== "string") {
    return { valid: false, error: "text must be a string" };
  }

  // Check length (1MB max to prevent memory issues)
  if (text.length > 1024 * 1024) {
    return {
      valid: false,
      error: `text too long (${text.length} chars, max 1MB)`,
    };
  }

  return { valid: true };
}

/**
 * Validate keys array
 */
export function validateKeys(keys: any): ValidationResult {
  if (!Array.isArray(keys)) {
    return { valid: false, error: "keys must be an array" };
  }

  if (keys.length === 0) {
    return { valid: false, error: "keys array cannot be empty" };
  }

  if (keys.length > 100) {
    return {
      valid: false,
      error: `too many keys (${keys.length}, max 100)`,
    };
  }

  for (const key of keys) {
    if (typeof key !== "string") {
      return { valid: false, error: "all keys must be strings" };
    }
  }

  return { valid: true };
}

/**
 * Validate model name
 */
export function validateModel(model: string): ValidationResult {
  if (typeof model !== "string") {
    return { valid: false, error: "model must be a string" };
  }

  if (model.length === 0) {
    return { valid: false, error: "model cannot be empty" };
  }

  if (model.length > 100) {
    return {
      valid: false,
      error: `model name too long (${model.length} chars, max 100)`,
    };
  }

  return { valid: true };
}

/**
 * Validate environment variables
 */
export function validateEnv(env: any): ValidationResult {
  if (env === undefined || env === null) {
    return { valid: true }; // Optional field
  }

  if (typeof env !== "object" || Array.isArray(env)) {
    return { valid: false, error: "env must be an object" };
  }

  // Check number of env vars
  const keys = Object.keys(env);
  if (keys.length > 1000) {
    return {
      valid: false,
      error: `too many environment variables (${keys.length}, max 1000)`,
    };
  }

  // Valid env var key pattern: starts with letter or underscore, contains only
  // alphanumeric and underscores. Prevents injection via malformed key names.
  const VALID_ENV_KEY = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

  // Check each key-value pair
  for (const [key, value] of Object.entries(env)) {
    if (typeof key !== "string") {
      return { valid: false, error: "all env keys must be strings" };
    }

    if (typeof value !== "string") {
      return {
        valid: false,
        error: `env value for key "${key}" must be a string`,
      };
    }

    if (key.length > 256) {
      return {
        valid: false,
        error: `env key too long: "${key.substring(0, 50)}..." (max 256 chars)`,
      };
    }

    if (!VALID_ENV_KEY.test(key)) {
      return {
        valid: false,
        error: `env key "${key.substring(0, 50)}" contains invalid characters (must match [a-zA-Z_][a-zA-Z0-9_]*)`,
      };
    }

    if (value.length > 65536) {
      return {
        valid: false,
        error: `env value for key "${key}" too long (max 64KB)`,
      };
    }
  }

  return { valid: true };
}

// Allowed image MIME types
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

// Max image size: 10MB
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

export interface ImageValidationResult {
  valid: boolean;
  error?: string;
  file?: File;
  sanitizedName?: string;
}

interface ImageFormDataLike {
  get(name: string): unknown;
}

/**
 * Validate an image upload from multipart FormData
 */
export function validateImageUpload(formData: ImageFormDataLike): ImageValidationResult {
  const file = formData.get("image");

  if (!(file && file instanceof File)) {
    return { valid: false, error: "Missing required field: image" };
  }

  // Check file size
  if (file.size > MAX_IMAGE_SIZE) {
    return {
      valid: false,
      error: `Image too large (${(file.size / 1024 / 1024).toFixed(1)}MB, max 10MB)`,
    };
  }

  if (file.size === 0) {
    return { valid: false, error: "Image file is empty" };
  }

  // Check MIME type
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return {
      valid: false,
      error: `Invalid image type: ${file.type}. Allowed: PNG, JPEG, GIF, WebP`,
    };
  }

  // Sanitize filename: strip path components, replace special chars
  const rawName = file.name || "image";
  const baseName = rawName.split(/[/\\]/).pop() || "image";
  const sanitized = baseName
    .replace(/[^a-zA-Z0-9._-]/g, "_") // Replace special chars with underscore
    .replace(/\.{2,}/g, ".") // Collapse multiple dots
    .replace(/^\.+/, ""); // Strip leading dots

  const sanitizedName = sanitized || "image";

  return { valid: true, file, sanitizedName };
}

export function validateArgs(args: any): ValidationResult {
  if (args === undefined || args === null) {
    return { valid: true }; // Optional field
  }

  if (!Array.isArray(args)) {
    return { valid: false, error: "args must be an array" };
  }

  if (args.length > 100) {
    return {
      valid: false,
      error: `too many arguments (${args.length}, max 100)`,
    };
  }

  for (let i = 0; i < args.length; i++) {
    if (typeof args[i] !== "string") {
      return {
        valid: false,
        error: `args[${i}] must be a string`,
      };
    }

    if (args[i].length > 10240) {
      return {
        valid: false,
        error: `args[${i}] too long (max 10KB)`,
      };
    }
  }

  return { valid: true };
}
