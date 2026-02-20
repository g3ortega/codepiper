import { describe, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import type { EncryptedBlob } from "./encryption";
import { decrypt, decryptVars, encrypt, encryptVars, maskValue } from "./encryption";

function generateTestKey(): Buffer {
  return crypto.randomBytes(32);
}

describe("encryption", () => {
  describe("encrypt/decrypt roundtrip", () => {
    test("should roundtrip a simple string", () => {
      const key = generateTestKey();
      const plaintext = "hello world";
      const blob = encrypt(plaintext, key);
      const result = decrypt(blob, key);
      expect(result).toBe(plaintext);
    });

    test("should roundtrip an empty string", () => {
      const key = generateTestKey();
      const blob = encrypt("", key);
      const result = decrypt(blob, key);
      expect(result).toBe("");
    });

    test("should roundtrip a long string with special characters", () => {
      const key = generateTestKey();
      const plaintext = "sk-ant-abc123!@#$%^&*()_+-=[]{}|;':\",./<>?\nline2\ttab";
      const blob = encrypt(plaintext, key);
      const result = decrypt(blob, key);
      expect(result).toBe(plaintext);
    });

    test("should roundtrip unicode content", () => {
      const key = generateTestKey();
      const plaintext = "API_KEY=secret-value-with-unicode-chars";
      const blob = encrypt(plaintext, key);
      const result = decrypt(blob, key);
      expect(result).toBe(plaintext);
    });

    test("should produce hex-encoded fields", () => {
      const key = generateTestKey();
      const blob = encrypt("test", key);
      expect(blob.iv).toMatch(/^[0-9a-f]+$/);
      expect(blob.tag).toMatch(/^[0-9a-f]+$/);
      expect(blob.ciphertext).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe("different encryptions produce different ciphertexts", () => {
    test("same plaintext encrypted twice should differ (random IV)", () => {
      const key = generateTestKey();
      const plaintext = "same input";
      const blob1 = encrypt(plaintext, key);
      const blob2 = encrypt(plaintext, key);

      // IVs must differ
      expect(blob1.iv).not.toBe(blob2.iv);
      // Ciphertexts must differ
      expect(blob1.ciphertext).not.toBe(blob2.ciphertext);

      // But both should decrypt to the same value
      expect(decrypt(blob1, key)).toBe(plaintext);
      expect(decrypt(blob2, key)).toBe(plaintext);
    });
  });

  describe("tamper detection", () => {
    test("tampered ciphertext should throw on decrypt", () => {
      const key = generateTestKey();
      const blob = encrypt("secret data", key);

      // Flip a byte in the ciphertext
      const tamperedCiphertext = `${blob.ciphertext.slice(0, -2)}ff`;
      const tampered: EncryptedBlob = {
        ...blob,
        ciphertext: tamperedCiphertext,
      };

      expect(() => decrypt(tampered, key)).toThrow();
    });

    test("tampered auth tag should throw on decrypt", () => {
      const key = generateTestKey();
      const blob = encrypt("secret data", key);

      // Replace the auth tag entirely
      const tamperedTag = "00".repeat(16);
      const tampered: EncryptedBlob = {
        ...blob,
        tag: tamperedTag,
      };

      expect(() => decrypt(tampered, key)).toThrow();
    });

    test("wrong key should throw on decrypt", () => {
      const key1 = generateTestKey();
      const key2 = generateTestKey();
      const blob = encrypt("secret data", key1);

      expect(() => decrypt(blob, key2)).toThrow();
    });
  });

  describe("maskValue", () => {
    test("short values (< 5 chars) return ****", () => {
      expect(maskValue("")).toBe("****");
      expect(maskValue("a")).toBe("****");
      expect(maskValue("ab")).toBe("****");
      expect(maskValue("abc")).toBe("****");
      expect(maskValue("abcd")).toBe("****");
    });

    test("values with 5+ chars show **** + last 4", () => {
      expect(maskValue("abcde")).toBe("****bcde");
      expect(maskValue("sk-ant-api03-abc123")).toBe("****c123");
      expect(maskValue("12345678")).toBe("****5678");
    });

    test("exactly 5 chars shows **** + last 4", () => {
      expect(maskValue("12345")).toBe("****2345");
    });
  });

  describe("encryptVars/decryptVars roundtrip", () => {
    test("should roundtrip a multi-key vars object", () => {
      const key = generateTestKey();
      const vars = {
        ANTHROPIC_API_KEY: "sk-ant-api03-abc123",
        OPENAI_API_KEY: "sk-proj-xyz789",
        DATABASE_URL: "postgres://user:pass@localhost:5432/db",
      };

      const encrypted = encryptVars(vars, key);
      const decrypted = decryptVars(encrypted, key);

      expect(decrypted).toEqual(vars);
    });

    test("should roundtrip an empty vars object", () => {
      const key = generateTestKey();
      const vars: Record<string, string> = {};

      const encrypted = encryptVars(vars, key);
      const decrypted = decryptVars(encrypted, key);

      expect(decrypted).toEqual({});
    });

    test("encrypted output should be a valid JSON string", () => {
      const key = generateTestKey();
      const vars = { KEY: "value" };

      const encrypted = encryptVars(vars, key);
      const parsed = JSON.parse(encrypted);

      expect(parsed).toHaveProperty("iv");
      expect(parsed).toHaveProperty("tag");
      expect(parsed).toHaveProperty("ciphertext");
    });

    test("should not expose plaintext in encrypted output", () => {
      const key = generateTestKey();
      const vars = { SECRET: "super-secret-value-12345" };

      const encrypted = encryptVars(vars, key);

      expect(encrypted).not.toContain("super-secret-value-12345");
      expect(encrypted).not.toContain("SECRET");
    });
  });
});
