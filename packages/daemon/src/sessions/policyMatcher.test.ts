/**
 * PolicyMatcher Tests - Pattern matching utilities
 */

import { describe, expect, test } from "bun:test";
import { matchPattern, normalizePath, valueToString } from "./policyMatcher";

describe("matchPattern", () => {
  describe("Exact Matching", () => {
    test("should match exact strings", () => {
      expect(matchPattern("Read", "Read")).toBe(true);
      expect(matchPattern("Write", "Write")).toBe(true);
    });

    test("should not match different strings", () => {
      expect(matchPattern("Read", "Write")).toBe(false);
      expect(matchPattern("abc", "xyz")).toBe(false);
    });

    test("should be case sensitive", () => {
      expect(matchPattern("Read", "read")).toBe(false);
      expect(matchPattern("READ", "Read")).toBe(false);
    });
  });

  describe("Glob Patterns", () => {
    test("should match wildcards", () => {
      expect(matchPattern("Read", "R*")).toBe(true);
      expect(matchPattern("ReadFile", "Read*")).toBe(true);
      expect(matchPattern("FileRead", "*Read")).toBe(true);
      expect(matchPattern("FileReadWrite", "*Read*")).toBe(true);
    });

    test("should match ? for single character", () => {
      expect(matchPattern("Read", "R?ad")).toBe(true);
      expect(matchPattern("Read", "R??d")).toBe(true);
    });

    test("should match character sets", () => {
      expect(matchPattern("Read", "R[aeiou]ad")).toBe(true);
      expect(matchPattern("Road", "R[aeiou]ad")).toBe(true);
      expect(matchPattern("Ryad", "R[aeiou]ad")).toBe(false);
    });

    test("should match brace expansion", () => {
      expect(matchPattern("Read", "{Read,Write}")).toBe(true);
      expect(matchPattern("Write", "{Read,Write}")).toBe(true);
      expect(matchPattern("Edit", "{Read,Write}")).toBe(false);
    });

    test("should match complex file patterns", () => {
      expect(matchPattern("/path/to/.env", "**/.env")).toBe(true);
      expect(matchPattern("/workspace/project/.env.local", "**/.env.*")).toBe(true);
      expect(matchPattern("/secrets.json", "**/secrets.*")).toBe(true);
    });

    test("should match bash command patterns", () => {
      expect(matchPattern("rm -rf /tmp", "rm *")).toBe(true);
      expect(matchPattern("rm -rf /tmp", "*rm*")).toBe(true);
      expect(matchPattern("git reset --hard HEAD", "*git reset*")).toBe(true);
      expect(matchPattern("ls -la", "rm *")).toBe(false);
    });
  });

  describe("Array Patterns", () => {
    test("should match if any pattern in array matches", () => {
      expect(matchPattern("Read", ["Read", "Write", "Edit"])).toBe(true);
      expect(matchPattern("Write", ["Read", "Write", "Edit"])).toBe(true);
      expect(matchPattern("Bash", ["Read", "Write", "Edit"])).toBe(false);
    });

    test("should match with glob patterns in array", () => {
      expect(matchPattern("ReadFile", ["Read*", "Write*"])).toBe(true);
      expect(matchPattern("WriteFile", ["Read*", "Write*"])).toBe(true);
      expect(matchPattern("EditFile", ["Read*", "Write*"])).toBe(false);
    });
  });

  describe("Negation Patterns", () => {
    test("should exclude matches with ! prefix in combination", () => {
      // Single negative pattern alone returns false (no positive match)
      expect(matchPattern("secrets.txt", "!secrets.txt")).toBe(false);
      expect(matchPattern("normal.txt", "!secrets.txt")).toBe(false);
    });

    test("should combine positive and negative patterns", () => {
      expect(matchPattern("file.txt", ["*.txt", "!secrets.txt"])).toBe(true);
      expect(matchPattern("secrets.txt", ["*.txt", "!secrets.txt"])).toBe(false);
    });

    test("should handle negative-only patterns", () => {
      // Negative-only patterns fail (no positive pattern to match)
      expect(matchPattern("file.txt", ["!*.env"])).toBe(false);
      expect(matchPattern(".env", ["!*.env"])).toBe(false);
    });

    test("should handle multiple negations", () => {
      // Negative-only patterns fail (no positive pattern to match)
      expect(matchPattern("file.txt", ["!*.env", "!*.secret"])).toBe(false);
      expect(matchPattern(".env", ["!*.env", "!*.secret"])).toBe(false);
      expect(matchPattern("pass.secret", ["!*.env", "!*.secret"])).toBe(false);
    });

    test("should fail if any negation matches", () => {
      expect(matchPattern("file.txt", ["*.txt", "!file.txt", "!*.env"])).toBe(false);
    });

    test("should handle negation with wildcards in combination", () => {
      // Need a positive pattern to make negation work as filter
      expect(matchPattern("/workspace/file.txt", ["**", "!(/tmp/**)"])).toBe(true);
      expect(matchPattern("/tmp/file.txt", ["**", "!(/tmp/**)"])).toBe(false);
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty string value", () => {
      expect(matchPattern("", "")).toBe(true);
      expect(matchPattern("", "something")).toBe(false);
    });

    test("should handle empty string pattern", () => {
      expect(matchPattern("", "")).toBe(true);
      expect(matchPattern("something", "")).toBe(false);
    });

    test("should handle empty array", () => {
      expect(matchPattern("anything", [])).toBe(false);
    });

    test("should skip empty strings in array", () => {
      expect(matchPattern("Read", ["", "Read", ""])).toBe(true);
      expect(matchPattern("Write", ["", "", ""])).toBe(false);
    });

    test("should handle special regex characters", () => {
      expect(matchPattern("file.txt", "file.txt")).toBe(true);
      expect(matchPattern("file[1].txt", "file[1].txt")).toBe(true);
      expect(matchPattern("file(1).txt", "file(1).txt")).toBe(true);
    });

    test("should handle unicode", () => {
      expect(matchPattern("fichier.txt", "fichier.txt")).toBe(true);
      expect(matchPattern("文件.txt", "文件.txt")).toBe(true);
    });

    test("should handle very long strings", () => {
      const longString = "a".repeat(10000);
      expect(matchPattern(longString, "a*")).toBe(true);
    });

    test("should handle negation of empty pattern", () => {
      // Negation of empty is skipped, so no patterns remain -> false
      expect(matchPattern("something", ["!"])).toBe(false);
    });
  });

  describe("Path Patterns", () => {
    test("should match file paths", () => {
      expect(matchPattern("/workspace/file.txt", "/workspace/*")).toBe(true);
      expect(matchPattern("/workspace/sub/file.txt", "/workspace/**/*")).toBe(true);
    });

    test("should match with ** for any depth", () => {
      expect(matchPattern("/a/b/c/file.txt", "**/*.txt")).toBe(true);
      expect(matchPattern("/file.txt", "**/*.txt")).toBe(true);
    });

    test("should match with bash glob behavior", () => {
      // In bash mode, * matches across slashes
      expect(matchPattern("/workspace/file.txt", "/workspace/*")).toBe(true);
      expect(matchPattern("/workspace/sub/file.txt", "/workspace/*")).toBe(true);
      expect(matchPattern("/workspace/sub/file.txt", "/workspace/**")).toBe(true);
    });
  });
});

describe("normalizePath", () => {
  test("should remove trailing slashes", () => {
    expect(normalizePath("/path/to/dir/")).toBe("/path/to/dir");
    expect(normalizePath("/path/to/dir///")).toBe("/path/to/dir");
  });

  test("should preserve root path", () => {
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("///")).toBe("/");
  });

  test("should not modify paths without trailing slash", () => {
    expect(normalizePath("/path/to/file")).toBe("/path/to/file");
    expect(normalizePath("/path")).toBe("/path");
  });

  test("should handle empty string", () => {
    expect(normalizePath("")).toBe("/");
  });
});

describe("valueToString", () => {
  test("should return string as-is", () => {
    expect(valueToString("hello")).toBe("hello");
    expect(valueToString("")).toBe("");
  });

  test("should convert numbers", () => {
    expect(valueToString(123)).toBe("123");
    expect(valueToString(0)).toBe("0");
    expect(valueToString(-456)).toBe("-456");
    expect(valueToString(3.14)).toBe("3.14");
  });

  test("should convert booleans", () => {
    expect(valueToString(true)).toBe("true");
    expect(valueToString(false)).toBe("false");
  });

  test("should handle null and undefined", () => {
    expect(valueToString(null)).toBe("");
    expect(valueToString(undefined)).toBe("");
  });

  test("should stringify objects", () => {
    expect(valueToString({ key: "value" })).toBe('{"key":"value"}');
    expect(valueToString([1, 2, 3])).toBe("[1,2,3]");
  });

  test("should handle special values", () => {
    expect(valueToString(Number.NaN)).toBe("NaN");
    expect(valueToString(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });
});
