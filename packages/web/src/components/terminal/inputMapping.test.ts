import { describe, expect, it } from "bun:test";
import { isTextEditingTarget, resolveKeyboardInput } from "./inputMapping";

function keyEvent(
  key: string,
  options: Partial<
    Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "isComposing">
  > = {}
): Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "isComposing" | "getModifierState"
> {
  return {
    key,
    ctrlKey: options.ctrlKey ?? false,
    altKey: options.altKey ?? false,
    shiftKey: options.shiftKey ?? false,
    metaKey: options.metaKey ?? false,
    isComposing: options.isComposing ?? false,
    getModifierState: (_state: string) => false,
  };
}

describe("resolveKeyboardInput", () => {
  it("maps printable input to text", () => {
    expect(resolveKeyboardInput(keyEvent("a"))).toEqual({ kind: "text", text: "a" });
    expect(resolveKeyboardInput(keyEvent("A", { shiftKey: true }))).toEqual({
      kind: "text",
      text: "A",
    });
    expect(resolveKeyboardInput(keyEvent(" "))).toEqual({ kind: "text", text: " " });
  });

  it("maps navigation and editing keys", () => {
    expect(resolveKeyboardInput(keyEvent("Enter"))).toEqual({ kind: "key", key: "enter" });
    expect(resolveKeyboardInput(keyEvent("Backspace"))).toEqual({
      kind: "key",
      key: "backspace",
    });
    expect(resolveKeyboardInput(keyEvent("PageDown"))).toEqual({
      kind: "key",
      key: "pagedown",
    });
    expect(resolveKeyboardInput(keyEvent("Tab", { shiftKey: true }))).toEqual({
      kind: "key",
      key: "shift+tab",
    });
  });

  it("maps ctrl/alt chords", () => {
    expect(resolveKeyboardInput(keyEvent("c", { ctrlKey: true }))).toEqual({
      kind: "key",
      key: "ctrl+c",
    });
    expect(resolveKeyboardInput(keyEvent("[", { ctrlKey: true }))).toEqual({
      kind: "key",
      key: "ctrl+[",
    });
    expect(resolveKeyboardInput(keyEvent("x", { altKey: true }))).toEqual({
      kind: "key",
      key: "alt+x",
    });
  });

  it("maps printable ASCII corpus as text", () => {
    for (let code = 32; code <= 126; code += 1) {
      const char = String.fromCharCode(code);
      const resolved = resolveKeyboardInput(keyEvent(char));
      expect(resolved).toEqual({ kind: "text", text: char });
    }
  });

  it("maps ctrl chord corpus deterministically", () => {
    const tokens = [
      "a",
      "z",
      "0",
      "9",
      "[",
      "\\",
      "]",
      "^",
      "_",
      "?",
      "-",
      "/",
      "=",
      ",",
      ".",
      "`",
      " ",
    ];

    for (const token of tokens) {
      const expectedToken = token === " " ? "space" : token.toLowerCase();
      const resolved = resolveKeyboardInput(keyEvent(token, { ctrlKey: true }));
      expect(resolved).toEqual({ kind: "key", key: `ctrl+${expectedToken}` });
    }
  });

  it("maps alt chord corpus deterministically", () => {
    const tokens = ["a", "z", "0", "9", "[", "\\", "]", "-", "/", "=", ",", ".", "`", " "];
    for (const token of tokens) {
      const expectedToken = token === " " ? "space" : token.toLowerCase();
      const resolved = resolveKeyboardInput(keyEvent(token, { altKey: true }));
      expect(resolved).toEqual({ kind: "key", key: `alt+${expectedToken}` });
    }
  });

  it("allows AltGraph printable input as text", () => {
    const resolved = resolveKeyboardInput({
      ...keyEvent("€", { ctrlKey: true, altKey: true }),
      getModifierState: (state: string) => state === "AltGraph",
    });
    expect(resolved).toEqual({ kind: "text", text: "€" });
  });

  it("ignores composing/meta shortcuts", () => {
    expect(resolveKeyboardInput(keyEvent("a", { isComposing: true }))).toBeNull();
    expect(resolveKeyboardInput(keyEvent("a", { metaKey: true }))).toBeNull();
  });
});

describe("isTextEditingTarget", () => {
  it("skips native form targets but not xterm helper textarea", () => {
    expect(isTextEditingTarget(null)).toBe(false);

    if (typeof document === "undefined") {
      return;
    }

    const input = document.createElement("input");
    const textArea = document.createElement("textarea");
    const xtermTextArea = document.createElement("textarea");
    xtermTextArea.className = "xterm-helper-textarea";

    expect(isTextEditingTarget(input)).toBe(true);
    expect(isTextEditingTarget(textArea)).toBe(true);
    expect(isTextEditingTarget(xtermTextArea)).toBe(false);
  });
});
