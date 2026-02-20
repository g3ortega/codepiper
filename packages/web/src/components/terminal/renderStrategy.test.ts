import { describe, expect, it } from "bun:test";
import {
  buildCursorRestoreSequence,
  buildTerminalRenderPlan,
  type TerminalRenderState,
} from "./renderStrategy";

function state(input: {
  content: string;
  rows: number;
  cols: number;
  renderedLines: string[];
}): TerminalRenderState {
  return {
    content: input.content,
    rows: input.rows,
    cols: input.cols,
    renderedLines: input.renderedLines,
  };
}

describe("buildTerminalRenderPlan", () => {
  it("builds full frame for initial render", () => {
    const plan = buildTerminalRenderPlan(null, {
      content: "hello\nworld\n",
      rows: 4,
      cols: 80,
    });

    expect(plan.kind).toBe("full");
    if (plan.kind === "full") {
      expect(plan.buffer.startsWith("\x1b[0m\x1b[H\x1b[2J")).toBe(true);
      expect(plan.nextState.renderedLines).toEqual(["", "", "hello", "world"]);
    }
  });

  it("returns noop for identical content and dimensions", () => {
    const previous = state({
      content: "hello\n",
      rows: 3,
      cols: 80,
      renderedLines: ["", "", "hello"],
    });

    const plan = buildTerminalRenderPlan(previous, {
      content: "hello\n",
      rows: 3,
      cols: 80,
    });

    expect(plan.kind).toBe("noop");
  });

  it("uses incremental render when only a few lines change", () => {
    const previous = state({
      content: "a\nb\nc\n",
      rows: 3,
      cols: 80,
      renderedLines: ["a", "b", "c"],
    });

    const plan = buildTerminalRenderPlan(previous, {
      content: "a\nb2\nc\n",
      rows: 3,
      cols: 80,
    });

    expect(plan.kind).toBe("incremental");
    if (plan.kind === "incremental") {
      expect(plan.buffer).toContain("\x1b[2;1H");
      expect(plan.nextState.renderedLines).toEqual(["a", "b2", "c"]);
    }
  });

  it("falls back to full render for unsafe control sequences", () => {
    const previous = state({
      content: "a\nb\n",
      rows: 2,
      cols: 80,
      renderedLines: ["a", "b"],
    });

    const plan = buildTerminalRenderPlan(previous, {
      content: "a\n\x1b[2Jb\n",
      rows: 2,
      cols: 80,
    });

    expect(plan.kind).toBe("full");
  });

  it("falls back to full render when too many lines change", () => {
    const previous = state({
      content: "1\n2\n3\n4\n5\n6\n7\n8\n9\n",
      rows: 9,
      cols: 80,
      renderedLines: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
    });

    const plan = buildTerminalRenderPlan(previous, {
      content: "a\nb\nc\nd\ne\nf\ng\nh\ni\n",
      rows: 9,
      cols: 80,
    });

    expect(plan.kind).toBe("full");
  });
});

describe("buildCursorRestoreSequence", () => {
  it("anchors cursor at the end of the last line on the bottom row", () => {
    const sequence = buildCursorRestoreSequence({
      content: "hello\nworld\n",
      rows: 4,
      cols: 80,
    });

    expect(sequence).toBe("\x1b[?25h\x1b[4;6H");
  });

  it("ignores ansi escapes when calculating cursor column", () => {
    const sequence = buildCursorRestoreSequence({
      content: "\x1b[31mred\x1b[0m text",
      rows: 10,
      cols: 80,
    });

    expect(sequence).toBe("\x1b[?25h\x1b[10;9H");
  });

  it("clamps cursor column to terminal width", () => {
    const sequence = buildCursorRestoreSequence({
      content: "1234567890",
      rows: 3,
      cols: 5,
    });

    expect(sequence).toBe("\x1b[?25h\x1b[3;5H");
  });
});
