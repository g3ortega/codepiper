import { useEffect, useRef, useState } from "react";

interface TerminalLine {
  type: "command" | "output" | "blank";
  text: string;
  delay?: number;
}

const SEQUENCE: TerminalLine[] = [
  { type: "command", text: "codepiper start -p claude-code -d ~/projects/my-api", delay: 500 },
  { type: "blank", text: "", delay: 200 },
  { type: "output", text: "\u2713 Session a1b2c3d4 started", delay: 400 },
  { type: "output", text: "\u2713 Claude Code hooks configured", delay: 200 },
  { type: "output", text: "\u2713 Transcript tailing active", delay: 200 },
  { type: "blank", text: "", delay: 600 },
  { type: "command", text: "codepiper sessions", delay: 800 },
  { type: "blank", text: "", delay: 200 },
  { type: "output", text: "ID        PROVIDER     STATUS   AGE", delay: 300 },
  { type: "output", text: "a1b2c3d4  claude-code  RUNNING  12s", delay: 100 },
  { type: "blank", text: "", delay: 600 },
  { type: "command", text: "codepiper daemon --web", delay: 800 },
  { type: "blank", text: "", delay: 200 },
  { type: "output", text: "\u2713 Web dashboard at http://localhost:3000", delay: 400 },
  { type: "output", text: "\u2713 WebSocket streaming on port 9999", delay: 200 },
];

const TYPING_SPEED = 60;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function HeroTerminal() {
  const [lines, setLines] = useState<{ type: string; text: string; typed: string }[]>([]);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [done, setDone] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when lines change
  useEffect(() => {
    const el = contentRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines]);

  useEffect(() => {
    const cursorInterval = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 530);

    let cancelled = false;
    const displayedLines: typeof lines = [];

    async function typeSequence() {
      for (const line of SEQUENCE) {
        if (cancelled) return;

        await sleep(line.delay || 0);
        if (cancelled) return;

        if (line.type === "command") {
          const newLine = { type: "command", text: line.text, typed: "" };
          displayedLines.push(newLine);
          setLines([...displayedLines]);

          for (let i = 0; i < line.text.length; i++) {
            if (cancelled) return;
            newLine.typed = line.text.slice(0, i + 1);
            setLines([...displayedLines]);
            await sleep(1000 / TYPING_SPEED + Math.random() * 15);
          }
        } else if (line.type === "blank") {
          displayedLines.push({ type: "blank", text: "", typed: "" });
          setLines([...displayedLines]);
        } else {
          displayedLines.push({ type: "output", text: line.text, typed: line.text });
          setLines([...displayedLines]);
        }
      }

      // Animation complete — stop, don't loop
      setDone(true);
    }

    typeSequence();

    return () => {
      cancelled = true;
      clearInterval(cursorInterval);
    };
  }, []);

  return (
    <div
      className="relative max-w-2xl mx-auto rounded-xl overflow-hidden"
      style={{
        background: "rgba(22, 27, 34, 0.8)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(6, 182, 212, 0.15)",
        boxShadow:
          "0 0 40px -10px rgba(6, 182, 212, 0.1), 0 25px 50px -12px rgba(0, 0, 0, 0.4)",
      }}
    >
      {/* Title bar */}
      <div
        className="flex items-center gap-2 px-4 py-3"
        style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}
      >
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full" style={{ background: "#ff5f57" }} />
          <div className="w-3 h-3 rounded-full" style={{ background: "#febc2e" }} />
          <div className="w-3 h-3 rounded-full" style={{ background: "#28c840" }} />
        </div>
        <span
          className="ml-2 text-xs"
          style={{ color: "rgba(156, 163, 175, 0.6)", fontFamily: '"DM Mono", monospace' }}
        >
          Terminal · codepiper
        </span>
      </div>

      {/* Terminal content: fixed height, auto-scrolls to latest */}
      <div
        ref={contentRef}
        className="p-5 hero-terminal-scroll"
        style={{
          fontFamily: '"DM Mono", monospace',
          fontSize: "13px",
          lineHeight: "1.7",
          height: 340,
          overflowY: "auto",
        }}
      >
        {lines.map((line, i) => {
          if (line.type === "blank") {
            return <div key={i} className="h-[1.7em]" />;
          }

          if (line.type === "command") {
            return (
              <div key={i}>
                <span style={{ color: "#10b981" }}>$ </span>
                <span style={{ color: "#f3f4f6" }}>{line.typed}</span>
                {i === lines.length - 1 && line.typed.length < line.text.length && (
                  <span
                    style={{
                      color: "#06b6d4",
                      opacity: cursorVisible ? 1 : 0,
                      transition: "opacity 0.1s",
                    }}
                  >
                    |
                  </span>
                )}
              </div>
            );
          }

          const isSuccess = line.text.startsWith("\u2713");
          return (
            <div key={i} style={{ color: isSuccess ? "#06b6d4" : "#9ca3af" }}>
              {line.typed}
            </div>
          );
        })}

        {lines.length > 0 &&
          (lines[lines.length - 1].type !== "command" ||
            lines[lines.length - 1].typed === lines[lines.length - 1].text) && (
            <div>
              <span style={{ color: "#10b981" }}>$ </span>
              <span
                style={{
                  color: "#06b6d4",
                  opacity: done ? (cursorVisible ? 0.6 : 0) : cursorVisible ? 1 : 0,
                  transition: "opacity 0.1s",
                }}
              >
                |
              </span>
            </div>
          )}
      </div>
    </div>
  );
}
