import { useEffect, useState, useRef } from "react";

interface ChatMessage {
  from: "user" | "bot";
  text?: string;
  card?: {
    sessionId: string;
    status: string;
    statusColor: string;
    tokens: string;
    lastAction: string;
  };
  delay: number;
}

const CHAT_SEQUENCE: ChatMessage[] = [
  {
    from: "user",
    text: "check status of my auth session",
    delay: 800,
  },
  {
    from: "bot",
    card: {
      sessionId: "a1b2c3d4",
      status: "RUNNING",
      statusColor: "#10b981",
      tokens: "847K",
      lastAction: "Added TOTP MFA support",
    },
    delay: 1200,
  },
  {
    from: "user",
    text: "tell it to add rate limiting next",
    delay: 1000,
  },
  {
    from: "bot",
    text: "\u2713 Sent to session a1b2c3d4",
    delay: 800,
  },
];

const LOOP_PAUSE = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function OpenClawChatFrame({ active = true }: { active?: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [showTyping, setShowTyping] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;

    async function runSequence() {
      setMessages([]);
      setShowTyping(false);

      for (const msg of CHAT_SEQUENCE) {
        if (cancelled) return;

        if (msg.from === "bot") {
          setShowTyping(true);
          await sleep(msg.delay);
          if (cancelled) return;
          setShowTyping(false);
        } else {
          await sleep(msg.delay);
          if (cancelled) return;
        }

        setMessages((prev) => [...prev, msg]);

        requestAnimationFrame(() => {
          bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
        });
      }

      await sleep(LOOP_PAUSE);
      if (!cancelled) runSequence();
    }

    runSequence();
    return () => {
      cancelled = true;
    };
  }, [active]);

  return (
    <div className="frame-chat" style={{ fontFamily: '"DM Sans", system-ui, sans-serif' }}>
      {/* Header */}
      <div
        style={{
          height: 68,
          background: "#1f2c34",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "flex-end",
          padding: "0 12px 8px",
          gap: 8,
        }}
      >
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #06b6d4, #8b5cf6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 600,
            color: "white",
            flexShrink: 0,
          }}
        >
          OC
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#e9edef" }}>OpenClaw</div>
          <div
            style={{
              fontSize: 9,
              color: "#10b981",
              display: "flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "#10b981",
                display: "inline-block",
              }}
            />
            online
          </div>
        </div>
      </div>

      {/* Chat body */}
      <div
        ref={bodyRef}
        style={{
          flex: 1,
          padding: 10,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          overflowY: "auto",
          background: "linear-gradient(180deg, #0b141a 0%, #0d1418 100%)",
        }}
      >
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              alignSelf: msg.from === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              animation: "bubble-in 0.25s ease-out",
            }}
          >
            {msg.text && (
              <div
                style={{
                  padding: "6px 10px",
                  borderRadius:
                    msg.from === "user" ? "10px 10px 3px 10px" : "10px 10px 10px 3px",
                  background: msg.from === "user" ? "rgba(6, 182, 212, 0.85)" : "#1f2c34",
                  color: msg.from === "user" ? "white" : "#e9edef",
                  fontSize: 11,
                  lineHeight: 1.4,
                  border: msg.from === "bot" ? "1px solid rgba(255,255,255,0.06)" : "none",
                }}
              >
                {msg.text}
              </div>
            )}

            {msg.card && (
              <div
                style={{
                  padding: "6px 10px",
                  borderRadius: "10px 10px 10px 3px",
                  background: "#1f2c34",
                  color: "#e9edef",
                  fontSize: 11,
                  lineHeight: 1.4,
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div style={{ fontWeight: 500, marginBottom: 4, fontSize: 11 }}>
                  Session {msg.card.sessionId}
                </div>
                <div
                  style={{
                    padding: 6,
                    borderRadius: 6,
                    background: "rgba(255,255,255,0.05)",
                    fontFamily: '"DM Mono", monospace',
                    fontSize: 9,
                    lineHeight: 1.5,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#8696a0" }}>Status</span>
                    <span style={{ color: msg.card.statusColor, fontWeight: 500 }}>
                      {msg.card.status}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginTop: 4,
                    }}
                  >
                    <span style={{ color: "#8696a0" }}>Tokens</span>
                    <span style={{ color: "#e9edef" }}>{msg.card.tokens}</span>
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      paddingTop: 6,
                      borderTop: "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    <span style={{ color: "#8696a0", fontSize: 10 }}>Last action:</span>
                    <div style={{ color: "#06b6d4", marginTop: 2 }}>
                      &ldquo;{msg.card.lastAction}&rdquo;
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div
              style={{
                fontSize: 10,
                color: "#8696a0",
                marginTop: 2,
                textAlign: msg.from === "user" ? "right" : "left",
                paddingLeft: msg.from === "bot" ? 4 : 0,
                paddingRight: msg.from === "user" ? 4 : 0,
              }}
            >
              {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        ))}

        {showTyping && (
          <div
            style={{
              alignSelf: "flex-start",
              padding: "10px 16px",
              borderRadius: "12px 12px 12px 4px",
              background: "#1f2c34",
              border: "1px solid rgba(255,255,255,0.06)",
              display: "flex",
              gap: 4,
              animation: "bubble-in 0.2s ease-out",
            }}
          >
            <TypingDot delay={0} />
            <TypingDot delay={150} />
            <TypingDot delay={300} />
          </div>
        )}
      </div>

      {/* Input bar */}
      <div
        style={{
          height: 40,
          background: "#1f2c34",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          padding: "0 10px",
          gap: 6,
        }}
      >
        <div
          style={{
            flex: 1,
            height: 28,
            borderRadius: 14,
            background: "rgba(255,255,255,0.06)",
            display: "flex",
            alignItems: "center",
            padding: "0 10px",
            fontSize: 11,
            color: "#8696a0",
          }}
        >
          Message...
        </div>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "rgba(6, 182, 212, 0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#06b6d4"
            strokeWidth="2"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </div>
      </div>

      <style>{`
        @keyframes bubble-in {
          from { opacity: 0; transform: translateY(8px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes typing-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function TypingDot({ delay }: { delay: number }) {
  return (
    <div
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "#8696a0",
        animation: "typing-bounce 1.2s ease-in-out infinite",
        animationDelay: `${delay}ms`,
      }}
    />
  );
}
