import { useRef } from "react";

interface ConstellationProps {
  active: boolean;
  progress: number;
}

const DEVICES = [
  { id: "laptop", label: "Desktop", emoji: "\uD83D\uDCBB", angle: 270 },
  { id: "phone", label: "Mobile", emoji: "\uD83D\uDCF1", angle: 342 },
  { id: "tablet", label: "Tablet", emoji: "\uD83D\uDCBB", angle: 54 },
  { id: "openclaw", label: "OpenClaw", emoji: "\uD83D\uDCAC", angle: 126 },
  { id: "tmux", label: "tmux", emoji: "\u2328\uFE0F", angle: 198 },
];

const CENTER = { x: 300, y: 300 };
const ORBIT_RADIUS = 200;
const DEVICE_RADIUS = 32;

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

export default function ConstellationView({ active, progress }: ConstellationProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  const getLineProgress = (index: number): number => {
    const lineStart = index / DEVICES.length;
    const lineEnd = (index + 1) / DEVICES.length;
    if (progress <= lineStart) return 0;
    if (progress >= lineEnd) return 1;
    return (progress - lineStart) / (lineEnd - lineStart);
  };

  const getNodeOpacity = (index: number): number => {
    const threshold = (index + 0.7) / DEVICES.length;
    if (progress < threshold) return 0;
    return Math.min(1, (progress - threshold) / 0.1);
  };

  const daemonPulse = progress > 0.8;

  return (
    <div
      style={{
        opacity: active ? 1 : 0,
        transform: active ? "scale(1)" : "scale(0.9)",
        transition: "opacity 0.5s ease-out, transform 0.5s ease-out",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 24,
      }}
    >
      <svg
        ref={svgRef}
        viewBox="0 0 600 600"
        width="100%"
        style={{ maxWidth: 500, height: "auto" }}
        role="img"
        aria-label="Constellation diagram showing CodePiper daemon connected to Desktop, Mobile, Tablet, OpenClaw, and tmux devices"
      >
        <defs>
          <linearGradient id="line-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.8" />
          </linearGradient>

          <filter id="daemon-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="0 0 0 0 0.024
                      0 0 0 0 0.714
                      0 0 0 0 0.831
                      0 0 0 0.4 0"
            />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id="device-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0.024
                      0 0 0 0 0.714
                      0 0 0 0 0.831
                      0 0 0 0.15 0"
            />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {DEVICES.map((device, i) => {
          const pos = polarToCartesian(CENTER.x, CENTER.y, ORBIT_RADIUS, device.angle);
          const lineProgress = getLineProgress(i);

          return (
            <line
              key={`line-${device.id}`}
              x1={CENTER.x}
              y1={CENTER.y}
              x2={CENTER.x + (pos.x - CENTER.x) * lineProgress}
              y2={CENTER.y + (pos.y - CENTER.y) * lineProgress}
              stroke="url(#line-gradient)"
              strokeWidth="1.5"
              strokeLinecap="round"
              opacity={lineProgress > 0 ? 0.6 + lineProgress * 0.4 : 0}
            />
          );
        })}

        {DEVICES.map((device, i) => {
          const pos = polarToCartesian(CENTER.x, CENTER.y, ORBIT_RADIUS, device.angle);
          const opacity = getNodeOpacity(i);

          return (
            <g
              key={`node-${device.id}`}
              opacity={opacity}
              transform={`translate(${pos.x}, ${pos.y})`}
              filter="url(#device-glow)"
            >
              <circle
                r={DEVICE_RADIUS}
                fill="rgba(22, 27, 34, 0.9)"
                stroke="rgba(6, 182, 212, 0.2)"
                strokeWidth="1"
              />
              <text textAnchor="middle" dominantBaseline="central" fontSize="20" dy="-2">
                {device.emoji}
              </text>
              <text
                textAnchor="middle"
                y={DEVICE_RADIUS + 16}
                fill="#9ca3af"
                fontSize="11"
                fontFamily='"DM Sans", system-ui, sans-serif'
                fontWeight="500"
              >
                {device.label}
              </text>
            </g>
          );
        })}

        {/* Central daemon icon */}
        <g filter={daemonPulse ? "url(#daemon-glow)" : undefined}>
          <circle
            cx={CENTER.x}
            cy={CENTER.y}
            r={44}
            fill="rgba(14, 16, 22, 0.95)"
            stroke="rgba(6, 182, 212, 0.4)"
            strokeWidth="2"
          />
          <circle
            cx={CENTER.x}
            cy={CENTER.y}
            r={36}
            fill="none"
            stroke="rgba(6, 182, 212, 0.15)"
            strokeWidth="1"
            strokeDasharray="4 4"
          >
            {daemonPulse && (
              <animateTransform
                attributeName="transform"
                type="rotate"
                from={`0 ${CENTER.x} ${CENTER.y}`}
                to={`360 ${CENTER.x} ${CENTER.y}`}
                dur="20s"
                repeatCount="indefinite"
              />
            )}
          </circle>
          <text
            x={CENTER.x}
            y={CENTER.y - 6}
            textAnchor="middle"
            fill="#06b6d4"
            fontSize="11"
            fontFamily='"DM Sans", system-ui, sans-serif'
            fontWeight="700"
            letterSpacing="0.5"
          >
            CODE
          </text>
          <text
            x={CENTER.x}
            y={CENTER.y + 8}
            textAnchor="middle"
            fill="#06b6d4"
            fontSize="11"
            fontFamily='"DM Sans", system-ui, sans-serif'
            fontWeight="700"
            letterSpacing="0.5"
          >
            PIPER
          </text>
          {daemonPulse && (
            <circle
              cx={CENTER.x}
              cy={CENTER.y}
              r={44}
              fill="none"
              stroke="#06b6d4"
              strokeWidth="1"
              opacity="0"
            >
              <animate attributeName="r" values="44;60" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.4;0" dur="2s" repeatCount="indefinite" />
            </circle>
          )}
        </g>
      </svg>

      <p
        style={{
          textAlign: "center",
          color: "#9ca3af",
          fontSize: 16,
          lineHeight: 1.6,
          maxWidth: 480,
          opacity: progress > 0.9 ? 1 : 0,
          transform: progress > 0.9 ? "translateY(0)" : "translateY(10px)",
          transition: "opacity 0.5s ease-out, transform 0.5s ease-out",
          fontFamily: '"DM Sans", system-ui, sans-serif',
        }}
      >
        <strong style={{ color: "#f3f4f6", fontWeight: 600 }}>
          One daemon. Every surface. Zero context loss.
        </strong>
        <br />
        Your sessions live on the daemon. Access them from any device, any surface, at any time.
      </p>
    </div>
  );
}
