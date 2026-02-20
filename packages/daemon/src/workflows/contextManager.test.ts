/**
 * Tests for ContextManager
 */

import { describe, expect, test } from "bun:test";
import { ContextManager } from "./contextManager.ts";

describe("ContextManager", () => {
  describe("set and get", () => {
    test("should store and retrieve simple values", () => {
      const manager = new ContextManager();
      manager.set("key1", "value1");
      manager.set("key2", 42);

      expect(manager.get("key1")).toBe("value1");
      expect(manager.get("key2")).toBe(42);
    });

    test("should return undefined for non-existent keys", () => {
      const manager = new ContextManager();
      expect(manager.get("nonexistent")).toBeUndefined();
    });

    test("should overwrite existing values", () => {
      const manager = new ContextManager();
      manager.set("key", "old");
      manager.set("key", "new");

      expect(manager.get("key")).toBe("new");
    });

    test("should store complex objects", () => {
      const manager = new ContextManager();
      const obj = { nested: { value: [1, 2, 3] } };
      manager.set("complex", obj);

      expect(manager.get("complex")).toEqual(obj);
    });
  });

  describe("nested paths", () => {
    test("should get nested values using dot notation", () => {
      const manager = new ContextManager();
      manager.set("user", { name: "Alice", age: 30 });

      expect(manager.get("user.name")).toBe("Alice");
      expect(manager.get("user.age")).toBe(30);
    });

    test("should get deeply nested values", () => {
      const manager = new ContextManager();
      manager.set("data", {
        level1: {
          level2: {
            level3: "deep value",
          },
        },
      });

      expect(manager.get("data.level1.level2.level3")).toBe("deep value");
    });

    test("should return undefined for invalid nested paths", () => {
      const manager = new ContextManager();
      manager.set("user", { name: "Alice" });

      expect(manager.get("user.nonexistent")).toBeUndefined();
      expect(manager.get("user.name.invalid")).toBeUndefined();
    });

    test("should handle array access in nested paths", () => {
      const manager = new ContextManager();
      manager.set("items", { list: ["a", "b", "c"] });

      expect(manager.get("items.list.0")).toBe("a");
      expect(manager.get("items.list.1")).toBe("b");
      expect(manager.get("items.list.2")).toBe("c");
    });
  });

  describe("variable substitution", () => {
    test("should substitute simple variables", () => {
      const manager = new ContextManager();
      manager.set("name", "World");

      const result = manager.substitute("Hello ${name}!");
      expect(result).toBe("Hello World!");
    });

    test("should substitute multiple variables", () => {
      const manager = new ContextManager();
      manager.set("first", "John");
      manager.set("last", "Doe");

      const result = manager.substitute("Name: ${first} ${last}");
      expect(result).toBe("Name: John Doe");
    });

    test("should substitute nested variables", () => {
      const manager = new ContextManager();
      manager.set("steps", {
        step1: { result: "success" },
        step2: { result: "pending" },
      });

      const result = manager.substitute(
        "Step 1: ${steps.step1.result}, Step 2: ${steps.step2.result}"
      );
      expect(result).toBe("Step 1: success, Step 2: pending");
    });

    test("should leave unresolved variables as-is", () => {
      const manager = new ContextManager();
      manager.set("known", "value");

      const result = manager.substitute("Known: ${known}, Unknown: ${unknown}");
      expect(result).toBe("Known: value, Unknown: ${unknown}");
    });

    test("should handle text without variables", () => {
      const manager = new ContextManager();
      const result = manager.substitute("No variables here");
      expect(result).toBe("No variables here");
    });

    test("should handle empty string", () => {
      const manager = new ContextManager();
      const result = manager.substitute("");
      expect(result).toBe("");
    });

    test("should substitute object values as JSON", () => {
      const manager = new ContextManager();
      manager.set("data", { key: "value" });

      const result = manager.substitute("Data: ${data}");
      expect(result).toBe('Data: {"key":"value"}');
    });

    test("should substitute array values as JSON", () => {
      const manager = new ContextManager();
      manager.set("items", ["a", "b", "c"]);

      const result = manager.substitute("Items: ${items}");
      expect(result).toBe('Items: ["a","b","c"]');
    });
  });

  describe("getAllContext", () => {
    test("should return all stored context", () => {
      const manager = new ContextManager();
      manager.set("key1", "value1");
      manager.set("key2", 42);

      const context = manager.getAllContext();
      expect(context).toEqual({
        key1: "value1",
        key2: 42,
      });
    });

    test("should return empty object for empty context", () => {
      const manager = new ContextManager();
      expect(manager.getAllContext()).toEqual({});
    });

    test("should return copy of context (not reference)", () => {
      const manager = new ContextManager();
      manager.set("key", "value");

      const context = manager.getAllContext();
      context.key = "modified";

      expect(manager.get("key")).toBe("value");
    });
  });

  describe("clear", () => {
    test("should clear all context", () => {
      const manager = new ContextManager();
      manager.set("key1", "value1");
      manager.set("key2", "value2");

      manager.clear();

      expect(manager.get("key1")).toBeUndefined();
      expect(manager.get("key2")).toBeUndefined();
      expect(manager.getAllContext()).toEqual({});
    });
  });

  describe("edge cases", () => {
    test("should handle null values", () => {
      const manager = new ContextManager();
      manager.set("key", null);

      expect(manager.get("key")).toBeNull();
    });

    test("should handle undefined values", () => {
      const manager = new ContextManager();
      manager.set("key", undefined);

      expect(manager.get("key")).toBeUndefined();
    });

    test("should handle numeric keys", () => {
      const manager = new ContextManager();
      manager.set("123", "numeric key");

      expect(manager.get("123")).toBe("numeric key");
    });

    test("should handle special characters in keys", () => {
      const manager = new ContextManager();
      manager.set("key-with-dash", "value1");
      manager.set("key_with_underscore", "value2");

      expect(manager.get("key-with-dash")).toBe("value1");
      expect(manager.get("key_with_underscore")).toBe("value2");
    });

    test("should handle variable substitution with special regex characters", () => {
      const manager = new ContextManager();
      manager.set("special", "$^.*+?[]{}()");

      const result = manager.substitute("Value: ${special}");
      expect(result).toBe("Value: $^.*+?[]{}()");
    });

    test("should handle multiple occurrences of same variable", () => {
      const manager = new ContextManager();
      manager.set("word", "hello");

      const result = manager.substitute("${word} ${word} ${word}");
      expect(result).toBe("hello hello hello");
    });
  });
});
