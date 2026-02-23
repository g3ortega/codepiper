import { useEffect, useRef, useState, type CSSProperties } from "react";
import OpenClawChatFrame from "./OpenClawChatFrame";
import ConstellationView from "./ConstellationView";

type DeviceId = "laptop" | "phone" | "tablet" | "chat" | "terminal" | "constellation";

interface FrameConfig {
  id: DeviceId;
  start: number;
  end: number;
  annotation: string;
  subtitle: string;
}

const FRAMES: FrameConfig[] = [
  {
    id: "laptop",
    start: 0,
    end: 0.18,
    annotation: "Start on your workstation",
    subtitle:
      "Three parallel sessions: implement, review, test. Full dashboard with terminal, analytics, and policy controls.",
  },
  {
    id: "phone",
    start: 0.18,
    end: 0.35,
    annotation: "Approve from your phone",
    subtitle:
      "Push notification. Tap. Approve permission. The session continues without you needing to be at your desk.",
  },
  {
    id: "tablet",
    start: 0.35,
    end: 0.52,
    annotation: "Full terminal on your tablet",
    subtitle:
      "Split view: terminal output alongside event stream. Touch-friendly input for sending prompts.",
  },
  {
    id: "chat",
    start: 0.52,
    end: 0.68,
    annotation: "Instruct from any messaging client",
    subtitle:
      "OpenClaw bridges chat platforms to CodePiper. Check status. Send prompts. Follow up \u2014 from any chat interface.",
  },
  {
    id: "terminal",
    start: 0.68,
    end: 0.84,
    annotation: "SSH in. Attach directly.",
    subtitle:
      "Same session, same context, zero web UI. tmux attach-session \u2014 that\u2019s all it takes.",
  },
  {
    id: "constellation",
    start: 0.84,
    end: 1.0,
    annotation: "One daemon. Every surface. Zero context loss.",
    subtitle:
      "Your sessions live on the daemon. Access them from any device, any surface, at any time.",
  },
];

function getActiveFrame(progress: number): { frame: FrameConfig; localProgress: number } {
  for (const frame of FRAMES) {
    if (progress >= frame.start && progress < frame.end) {
      const localProgress = (progress - frame.start) / (frame.end - frame.start);
      return { frame, localProgress };
    }
  }
  const last = FRAMES[FRAMES.length - 1];
  return { frame: last, localProgress: 1 };
}

function frameTransitionStyle(
  frameId: DeviceId,
  activeId: DeviceId,
  localProgress: number
): CSSProperties {
  const isActive = frameId === activeId;
  const isConstellation = frameId === "constellation";

  if (isConstellation) {
    return {
      opacity: isActive ? 1 : 0,
      transform: isActive ? "scale(1)" : "scale(0.85)",
      transition: "opacity 0.5s ease-out, transform 0.5s ease-out",
      position: "absolute",
      pointerEvents: isActive ? "auto" : "none",
    };
  }

  if (isActive) {
    const enterProgress = Math.min(localProgress / 0.15, 1);
    return {
      opacity: enterProgress,
      transform: `translateY(${(1 - enterProgress) * 40}px) scale(${0.92 + enterProgress * 0.08})`,
      transition: "none",
      position: "absolute",
      pointerEvents: "auto",
    };
  }

  return {
    opacity: 0,
    transform: "translateY(-20px) scale(0.92)",
    transition: "opacity 0.3s ease-out, transform 0.3s ease-out",
    position: "absolute",
    pointerEvents: "none",
  };
}

export default function PortabilityShowcase() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    let ticking = false;

    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        if (!section) return;
        const rect = section.getBoundingClientRect();
        const sectionHeight = section.offsetHeight;
        const viewportHeight = window.innerHeight;
        const scrolled = -rect.top;
        const scrollable = sectionHeight - viewportHeight;
        const progress = Math.max(0, Math.min(1, scrolled / scrollable));
        setScrollProgress(progress);
        ticking = false;
      });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const { frame: activeFrame, localProgress } = getActiveFrame(scrollProgress);

  return (
    <div ref={sectionRef} style={{ height: "500vh", position: "relative" }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          padding: "0 16px",
        }}
      >
        {/* Progress dots */}
        <div
          style={{
            position: "absolute",
            right: 24,
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            zIndex: 20,
          }}
        >
          {FRAMES.map((f) => {
            const isActive = f.id === activeFrame.id;
            return (
              <div
                key={f.id}
                style={{
                  width: isActive ? 10 : 6,
                  height: isActive ? 10 : 6,
                  borderRadius: "50%",
                  background: isActive ? "#06b6d4" : "rgba(156, 163, 175, 0.3)",
                  transition: "all 0.3s ease-out",
                  boxShadow: isActive ? "0 0 8px rgba(6, 182, 212, 0.4)" : "none",
                }}
              />
            );
          })}
        </div>

        {/* Device frames */}
        <div
          style={{
            position: "relative",
            width: "100%",
            maxWidth: 800,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 560,
          }}
        >
          <div style={frameTransitionStyle("laptop", activeFrame.id, localProgress)}>
            <LaptopFrame />
          </div>
          <div style={frameTransitionStyle("phone", activeFrame.id, localProgress)}>
            <PhoneFrame />
          </div>
          <div style={frameTransitionStyle("tablet", activeFrame.id, localProgress)}>
            <TabletFrame />
          </div>
          <div style={frameTransitionStyle("chat", activeFrame.id, localProgress)}>
            <OpenClawChatFrame active={activeFrame.id === "chat"} />
          </div>
          <div style={frameTransitionStyle("terminal", activeFrame.id, localProgress)}>
            <TerminalFrame />
          </div>
          <ConstellationView
            active={activeFrame.id === "constellation"}
            progress={activeFrame.id === "constellation" ? localProgress : 0}
          />
        </div>

        {/* Text annotation */}
        <div
          style={{
            marginTop: 20,
            textAlign: "center",
            maxWidth: 560,
            transition: "opacity 0.4s ease-out",
            opacity: localProgress > 0.1 ? 1 : 0,
          }}
        >
          <h3
            style={{
              fontSize: 24,
              fontWeight: 600,
              color: "#f3f4f6",
              fontFamily: '"DM Sans", system-ui, sans-serif',
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            {activeFrame.annotation}
          </h3>
          <p
            style={{
              marginTop: 8,
              fontSize: 15,
              lineHeight: 1.6,
              color: "#9ca3af",
              fontFamily: '"DM Sans", system-ui, sans-serif',
            }}
          >
            {activeFrame.subtitle}
          </p>
        </div>

        {/* Scroll hint */}
        {scrollProgress < 0.05 && (
          <div
            style={{
              position: "absolute",
              bottom: 32,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              opacity: 0.5,
              animation: "bounce-subtle 2s ease-in-out infinite",
            }}
          >
            <span
              style={{
                fontSize: 12,
                color: "#9ca3af",
                fontFamily: '"DM Sans", system-ui, sans-serif',
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              Scroll to explore
            </span>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#9ca3af"
              strokeWidth="2"
            >
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </div>
        )}
      </div>

      <style>{`
        @keyframes bounce-subtle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(6px); }
        }
      `}</style>
    </div>
  );
}

// --- Device Frame Components ---

function LaptopFrame() {
  return (
    <div className="frame-laptop" style={{ fontFamily: '"DM Sans", system-ui, sans-serif' }}>
      <div
        style={{
          height: 32,
          background: "#1c2333",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", gap: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff5f57" }} />
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#febc2e" }} />
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#28c840" }} />
        </div>
        <span
          style={{
            fontSize: 11,
            color: "rgba(156,163,175,0.6)",
            fontFamily: '"DM Mono", monospace',
          }}
        >
          CodePiper · Dashboard
        </span>
      </div>

      <div style={{ display: "flex", height: "calc(100% - 32px)" }}>
        <div
          style={{
            width: 48,
            background: "#0e1016",
            borderRight: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "12px 0",
            gap: 16,
          }}
        >
          {["#06b6d4", "#9ca3af", "#9ca3af", "#9ca3af"].map((color, i) => (
            <div
              key={i}
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                background: i === 0 ? "rgba(6,182,212,0.12)" : "transparent",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: color,
                  opacity: i === 0 ? 1 : 0.3,
                }}
              />
            </div>
          ))}
        </div>

        <div style={{ flex: 1, padding: 16, background: "#0e1016" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {[
              { label: "Active", value: "3", color: "#10b981" },
              { label: "Tokens", value: "1.2M", color: "#06b6d4" },
              { label: "Cached", value: "67%", color: "#8b5cf6" },
            ].map((stat) => (
              <div
                key={stat.label}
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "#161b22",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div style={{ fontSize: 9, color: "#6b7280", marginBottom: 2 }}>{stat.label}</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: stat.color }}>{stat.value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { name: "implement", status: "RUNNING", color: "#10b981", tokens: "412K" },
              { name: "review", status: "RUNNING", color: "#10b981", tokens: "287K" },
              { name: "test", status: "WAITING", color: "#f59e0b", tokens: "156K" },
            ].map((s) => (
              <div
                key={s.name}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "#161b22",
                  border: "1px solid rgba(255,255,255,0.06)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: s.color,
                      boxShadow: `0 0 6px ${s.color}40`,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 12,
                      color: "#f3f4f6",
                      fontFamily: '"DM Mono", monospace',
                    }}
                  >
                    {s.name}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <span style={{ fontSize: 10, color: s.color }}>{s.status}</span>
                  <span style={{ fontSize: 10, color: "#6b7280" }}>{s.tokens}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PhoneFrame() {
  return (
    <div className="frame-phone" style={{ fontFamily: '"DM Sans", system-ui, sans-serif' }}>
      <div
        style={{
          height: 36,
          padding: "0 14px",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 9, fontWeight: 600, color: "#f3f4f6" }}>9:41</span>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <div
            style={{
              width: 12,
              height: 7,
              border: "1px solid #f3f4f6",
              borderRadius: 2,
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 1,
                background: "#10b981",
                borderRadius: 1,
              }}
            />
          </div>
        </div>
      </div>

      {/* Notification banner: session complete */}
      <div
        style={{
          margin: "4px 10px",
          padding: "8px 10px",
          borderRadius: 12,
          background: "rgba(16, 185, 129, 0.1)",
          border: "1px solid rgba(16, 185, 129, 0.2)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            background: "rgba(16, 185, 129, 0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#10b981"
            strokeWidth="3"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#f3f4f6" }}>
            Session &lsquo;review&rsquo; completed
          </div>
          <div style={{ fontSize: 9, color: "#9ca3af" }}>
            12 files &middot; 287K tokens &middot; 4m
          </div>
        </div>
      </div>

      <div
        style={{
          padding: "6px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: "#f3f4f6" }}>CodePiper</div>
      </div>

      <div
        style={{
          padding: "10px 12px",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: 12,
            borderRadius: 14,
            background: "rgba(245, 158, 11, 0.08)",
            border: "1px solid rgba(245, 158, 11, 0.2)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 6,
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: 5,
                background: "rgba(245, 158, 11, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
              }}
            >
              !
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#f3f4f6" }}>
                Permission Request
              </div>
              <div style={{ fontSize: 9, color: "#9ca3af" }}>implement · a1b2c3d4</div>
            </div>
          </div>

          <div
            style={{
              padding: 8,
              borderRadius: 6,
              background: "rgba(0,0,0,0.2)",
              fontFamily: '"DM Mono", monospace',
              fontSize: 9,
              lineHeight: 1.4,
              color: "#d1d5db",
            }}
          >
            <div style={{ color: "#9ca3af", marginBottom: 2 }}>Tool: Bash</div>
            <div>rm -rf node_modules && npm install</div>
          </div>

          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button
              type="button"
              style={{
                flex: 1,
                padding: "7px 0",
                borderRadius: 8,
                background: "#10b981",
                border: "none",
                fontSize: 11,
                fontWeight: 600,
                color: "white",
                cursor: "pointer",
              }}
            >
              Allow
            </button>
            <button
              type="button"
              style={{
                flex: 1,
                padding: "7px 0",
                borderRadius: 8,
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                fontSize: 11,
                fontWeight: 600,
                color: "#ef4444",
                cursor: "pointer",
              }}
            >
              Deny
            </button>
          </div>
        </div>

        <div
          style={{
            fontSize: 9,
            color: "#6b7280",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Active Sessions
        </div>
        {["implement", "review"].map((name) => (
          <div
            key={name}
            style={{
              padding: "7px 10px",
              borderRadius: 8,
              background: "#161b22",
              border: "1px solid rgba(255,255,255,0.06)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: "#10b981",
                }}
              />
              <span style={{ fontSize: 11, color: "#f3f4f6" }}>{name}</span>
            </div>
            <span style={{ fontSize: 9, color: "#10b981" }}>RUNNING</span>
          </div>
        ))}
      </div>

      <div
        style={{
          height: 44,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-around",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          padding: "0 6px",
        }}
      >
        {["Sessions", "Terminal", "Events", "Settings"].map((label, i) => (
          <div
            key={label}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              opacity: i === 0 ? 1 : 0.4,
            }}
          >
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: 3,
                background: i === 0 ? "rgba(6,182,212,0.12)" : "transparent",
              }}
            />
            <span style={{ fontSize: 8, color: i === 0 ? "#06b6d4" : "#6b7280" }}>{label}</span>
          </div>
        ))}
      </div>

      <div
        style={{
          height: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ width: 80, height: 3, borderRadius: 2, background: "#333" }} />
      </div>
    </div>
  );
}

function TabletFrame() {
  return (
    <div className="frame-tablet" style={{ fontFamily: '"DM Sans", system-ui, sans-serif' }}>
      <div
        style={{
          height: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "#0e1016",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: 4,
              background: "rgba(6,182,212,0.12)",
            }}
          />
          <span style={{ fontSize: 14, fontWeight: 600, color: "#f3f4f6" }}>implement</span>
          <span
            style={{
              fontSize: 11,
              color: "#10b981",
              padding: "1px 6px",
              borderRadius: 4,
              background: "rgba(16,185,129,0.1)",
            }}
          >
            RUNNING
          </span>
        </div>
        <span
          style={{
            fontSize: 11,
            color: "#6b7280",
            fontFamily: '"DM Mono", monospace',
          }}
        >
          a1b2c3d4
        </span>
      </div>

      <div style={{ display: "flex", height: "calc(100% - 40px)" }}>
        <div
          style={{
            flex: 1,
            padding: 12,
            fontFamily: '"DM Mono", monospace',
            fontSize: 11,
            lineHeight: 1.6,
            background: "#0e1016",
            color: "#d1d5db",
            borderRight: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div>
            <span style={{ color: "#10b981" }}>$</span> claude-code
          </div>
          <div style={{ color: "#9ca3af", marginTop: 8 }}>
            {">"} Implementing the new auth module...
          </div>
          <div style={{ marginTop: 4 }}>&nbsp;</div>
          <div style={{ color: "#06b6d4" }}>Created: src/auth/service.ts</div>
          <div style={{ color: "#06b6d4" }}>Created: src/auth/middleware.ts</div>
          <div style={{ color: "#06b6d4" }}>Modified: src/routes/index.ts</div>
          <div style={{ marginTop: 8 }}>
            <span style={{ color: "#9ca3af" }}>{">"} Adding Argon2 password hashing...</span>
          </div>
          <div
            style={{
              marginTop: 4,
              display: "flex",
              gap: 4,
              alignItems: "center",
            }}
          >
            <div
              style={{
                height: 3,
                flex: 1,
                borderRadius: 2,
                background: "#1c2333",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: "72%",
                  height: "100%",
                  background: "linear-gradient(90deg, #06b6d4, #8b5cf6)",
                  borderRadius: 2,
                }}
              />
            </div>
            <span style={{ fontSize: 10, color: "#6b7280" }}>72%</span>
          </div>
        </div>

        <div
          style={{
            width: 200,
            padding: 12,
            background: "#161b22",
            fontSize: 10,
            lineHeight: 1.5,
          }}
        >
          <div
            style={{
              color: "#6b7280",
              fontSize: 9,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: 8,
            }}
          >
            Events
          </div>
          {[
            { tool: "Read", file: "package.json", color: "#06b6d4" },
            { tool: "Edit", file: "service.ts", color: "#8b5cf6" },
            { tool: "Write", file: "middleware.ts", color: "#10b981" },
            { tool: "Bash", file: "npm install", color: "#f59e0b" },
            { tool: "Edit", file: "routes/index.ts", color: "#8b5cf6" },
          ].map((e, i) => (
            <div
              key={i}
              style={{
                padding: "4px 6px",
                borderRadius: 4,
                marginBottom: 4,
                background: "rgba(255,255,255,0.03)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                style={{
                  color: e.color,
                  fontWeight: 500,
                  fontFamily: '"DM Mono", monospace',
                }}
              >
                {e.tool}
              </span>
              <span
                style={{
                  color: "#6b7280",
                  fontFamily: '"DM Mono", monospace',
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {e.file}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TerminalFrame() {
  return (
    <div className="frame-terminal" style={{ fontFamily: '"DM Mono", monospace' }}>
      <div
        style={{
          height: 28,
          background: "#1a1a1a",
          borderBottom: "1px solid rgba(0, 255, 0, 0.1)",
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          fontSize: 11,
          color: "rgba(0, 255, 0, 0.6)",
        }}
      >
        user@server:~
      </div>

      <div style={{ padding: 14, fontSize: 12, lineHeight: 1.7, color: "#00ff00" }}>
        <div>
          <span style={{ opacity: 0.6 }}>user@server:~$ </span>
          <span>tmux attach-session \</span>
        </div>
        <div style={{ paddingLeft: 24 }}>-t codepiper-a1b2c3d4</div>
        <div style={{ marginTop: 12 }} />

        <div
          style={{
            border: "1px solid rgba(0, 255, 0, 0.15)",
            borderRadius: 4,
            padding: 10,
            margin: "0 0 8px 0",
          }}
        >
          <div style={{ color: "rgba(0, 255, 0, 0.5)", fontSize: 10, marginBottom: 6 }}>
            {"\u2500\u2500 Claude Code (codepiper-a1b2c3d4) \u2500\u2500"}
          </div>
          <div style={{ color: "#e0e0e0" }}>
            I&apos;ve implemented the auth module. Here&apos;s what I did:
          </div>
          <div style={{ marginTop: 8, color: "#b0b0b0" }}>
            <div>1. Created AuthService with Argon2 hashing</div>
            <div>2. Added TOTP MFA support</div>
            <div>3. Wired rate limiting middleware</div>
          </div>
          <div style={{ marginTop: 8, color: "#e0e0e0" }}>
            {">"} What would you like me to do next?
          </div>
        </div>

        <div>
          <span style={{ opacity: 0.6 }}>user@server:~$ </span>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 14,
              background: "#00ff00",
              animation: "terminal-blink 1s step-end infinite",
            }}
          />
        </div>
      </div>

      <style>{`
        @keyframes terminal-blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
