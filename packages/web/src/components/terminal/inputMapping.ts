export type TerminalKeyboardDispatch =
  | { kind: "key"; key: string }
  | { kind: "text"; text: string };

const SPECIAL_KEY_MAP: Record<string, string> = {
  Enter: "enter",
  Escape: "escape",
  Tab: "tab",
  Backspace: "backspace",
  Delete: "delete",
  Insert: "insert",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Home: "home",
  End: "end",
  PageUp: "pageup",
  PageDown: "pagedown",
};

function normalizeModifierToken(raw: string): string | null {
  if (raw === " ") {
    return "space";
  }
  if (raw.length !== 1) {
    return null;
  }

  const token = raw.toLowerCase();
  if (/^[a-z0-9]$/.test(token)) {
    return token;
  }

  if (/[[\]\\/\-=`;',.]/.test(token)) {
    return token;
  }

  if (token === "^") {
    return "^";
  }
  if (token === "_") {
    return "_";
  }
  if (token === "?") {
    return "?";
  }

  return null;
}

function isFunctionKey(key: string): boolean {
  return /^F([1-9]|1[0-2])$/.test(key);
}

export function resolveKeyboardInput(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "isComposing" | "getModifierState"
  >
): TerminalKeyboardDispatch | null {
  if (event.isComposing || event.key === "Dead") {
    return null;
  }

  const special = SPECIAL_KEY_MAP[event.key];
  if (special) {
    // Preserve Shift+Tab explicitly for reverse focus/navigation semantics.
    if (special === "tab" && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
      return { kind: "key", key: "shift+tab" };
    }
    return { kind: "key", key: special };
  }

  if (isFunctionKey(event.key)) {
    return { kind: "key", key: event.key.toLowerCase() };
  }

  const isAltGraph =
    typeof event.getModifierState === "function" && event.getModifierState("AltGraph");

  // Printable characters (common path): send as direct text.
  if (!(event.metaKey || event.ctrlKey || event.altKey)) {
    if (event.key.length === 1) {
      return { kind: "text", text: event.key };
    }
    return null;
  }

  // AltGraph should still type printable characters.
  if (!event.metaKey && event.ctrlKey && event.altKey && isAltGraph && event.key.length === 1) {
    return { kind: "text", text: event.key };
  }

  // Ctrl+<char> chord.
  if (!event.metaKey && event.ctrlKey && !event.altKey && event.key.length === 1) {
    const token = normalizeModifierToken(event.key);
    return token ? { kind: "key", key: `ctrl+${token}` } : null;
  }

  // Alt+<char> chord.
  if (!(event.metaKey || event.ctrlKey) && event.altKey && event.key.length === 1) {
    const token = normalizeModifierToken(event.key);
    return token ? { kind: "key", key: `alt+${token}` } : null;
  }

  return null;
}

export function isTextEditingTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
    return false;
  }

  if (target.classList.contains("xterm-helper-textarea")) {
    return false;
  }

  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable ||
    target.closest("[contenteditable='true']") !== null
  );
}
