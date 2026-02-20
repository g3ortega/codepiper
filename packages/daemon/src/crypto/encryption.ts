import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Encrypted data blob with IV, auth tag, and ciphertext (all hex-encoded)
 */
export interface EncryptedBlob {
  iv: string; // hex
  tag: string; // hex
  ciphertext: string; // hex
}

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const HOOK_SECRET_BYTES = 32;

interface SecretsFile {
  encryptionKey?: string;
  hookSecret?: string;
  [key: string]: string | undefined;
}

function getCodepiperDir(): string {
  return path.join(os.homedir(), ".codepiper");
}

function getSecretsPath(): string {
  return path.join(getCodepiperDir(), "secrets.json");
}

function ensureCodepiperDir(): void {
  const dir = getCodepiperDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // best-effort on non-POSIX filesystems
  }
}

function hardenSecretsFilePermissions(): void {
  const secretsPath = getSecretsPath();
  if (!fs.existsSync(secretsPath)) {
    return;
  }
  try {
    fs.chmodSync(secretsPath, 0o600);
  } catch {
    // best-effort on non-POSIX filesystems
  }
}

function readSecretsFile(): SecretsFile {
  ensureCodepiperDir();
  const secretsPath = getSecretsPath();
  if (!fs.existsSync(secretsPath)) {
    return {};
  }
  hardenSecretsFilePermissions();

  const raw = fs.readFileSync(secretsPath, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid secrets file format: ${secretsPath}`);
  }
  return parsed as SecretsFile;
}

function writeSecretsFile(secrets: SecretsFile): void {
  ensureCodepiperDir();
  const secretsPath = getSecretsPath();

  // Write via temp file + rename to avoid partial writes.
  const tempPath = `${secretsPath}.tmp-${process.pid}-${Date.now()}`;
  const fd = fs.openSync(tempPath, "w", 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(secrets, null, 2));
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(tempPath, secretsPath);
  try {
    fs.chmodSync(secretsPath, 0o600);
  } catch {
    // best-effort on filesystems that do not honor POSIX permissions
  }
}

/**
 * Get or create the encryption key from ~/.codepiper/secrets.json.
 * If the file or key doesn't exist, generates a new 32-byte random key,
 * writes it back, and sets file permissions to 600.
 */
export function getOrCreateEncryptionKey(): Buffer {
  const secrets = readSecretsFile();

  if (secrets.encryptionKey) {
    return Buffer.from(secrets.encryptionKey, "hex");
  }

  // Generate a new key
  const key = crypto.randomBytes(KEY_BYTES);
  secrets.encryptionKey = key.toString("hex");
  writeSecretsFile(secrets);

  return key;
}

/**
 * Get or create a persistent hook authentication secret.
 * The secret is shared across daemon restarts so preserved sessions keep working.
 */
export function getOrCreateHookSecret(): string {
  const secrets = readSecretsFile();
  const existing = secrets.hookSecret;
  if (existing && /^[a-f0-9]{64}$/.test(existing)) {
    return existing;
  }

  const secret = crypto.randomBytes(HOOK_SECRET_BYTES).toString("hex");
  secrets.hookSecret = secret;
  writeSecretsFile(secrets);
  return secret;
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Returns an EncryptedBlob with hex-encoded iv, tag, and ciphertext.
 */
export function encrypt(plaintext: string, key: Buffer): EncryptedBlob {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);

  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ciphertext: encrypted.toString("hex"),
  };
}

/**
 * Decrypt an EncryptedBlob back to plaintext using AES-256-GCM.
 * Throws if the ciphertext or auth tag has been tampered with.
 */
export function decrypt(blob: EncryptedBlob, key: Buffer): string {
  const iv = Buffer.from(blob.iv, "hex");
  const tag = Buffer.from(blob.tag, "hex");
  const ciphertext = Buffer.from(blob.ciphertext, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return decrypted.toString("utf-8");
}

/**
 * Mask a value for display: shows "****" + last 4 chars.
 * For values shorter than 5 chars, returns "****".
 */
export function maskValue(value: string): string {
  if (value.length < 5) {
    return "****";
  }
  return `****${value.slice(-4)}`;
}

/**
 * Encrypt a vars object (Record<string, string>) as a single JSON blob.
 * Returns the encrypted JSON as a string (JSON-serialized EncryptedBlob).
 */
export function encryptVars(vars: Record<string, string>, key: Buffer): string {
  const plaintext = JSON.stringify(vars);
  const blob = encrypt(plaintext, key);
  return JSON.stringify(blob);
}

/**
 * Decrypt an encrypted vars JSON string back to a Record<string, string>.
 */
export function decryptVars(encryptedJson: string, key: Buffer): Record<string, string> {
  const blob: EncryptedBlob = JSON.parse(encryptedJson);
  const plaintext = decrypt(blob, key);
  return JSON.parse(plaintext);
}
