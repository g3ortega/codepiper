import { useEffect, useRef, useState } from "react";

/* ─── Node definitions ─── */

interface NodeDef {
  x: number;
  y: number;
  label: string;
  icon: string;
  group: "user" | "interface" | "core" | "runtime" | "provider" | "storage";
}

const NODES: Record<string, NodeDef> = {
  you: { x: 60, y: 220, label: "You", icon: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", group: "user" },
  cli: { x: 250, y: 80, label: "CLI", icon: "M4 17l6-6-6-6M12 19h8", group: "interface" },
  web: { x: 250, y: 360, label: "Web UI", icon: "M3 3h18v14H3zM3 17h18M8 21h8", group: "interface" },
  daemon: { x: 478, y: 220, label: "Daemon", icon: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5", group: "core" },
  tmux: { x: 670, y: 220, label: "tmux", icon: "M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3", group: "runtime" },
  claude: { x: 860, y: 100, label: "Claude Code", icon: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2", group: "provider" },
  codex: { x: 860, y: 340, label: "Codex CLI", icon: "M16 18l2-2-2-2M8 18l-2-2 2-2M13.5 6l-3 12", group: "provider" },
  sqlite: { x: 478, y: 408, label: "SQLite", icon: "M12 2a8 4 0 1 0 0 8 8 4 0 0 0 0-8zM4 6v6a8 4 0 0 0 16 0V6M4 12v6a8 4 0 0 0 16 0v-6", group: "storage" },
};

/* ─── Edge definitions ─── */

interface EdgeDef {
  from: string;
  to: string;
  label?: string;
  labelDx?: number;
  labelDy?: number;
}

const EDGES: EdgeDef[] = [
  { from: "you", to: "cli", label: "commands", labelDy: -12 },
  { from: "you", to: "web", label: "browser", labelDy: 12 },
  { from: "cli", to: "daemon", label: "unix socket", labelDy: -12 },
  { from: "web", to: "daemon", label: "HTTP / WS", labelDy: 12 },
  { from: "daemon", to: "tmux", label: "sessions", labelDy: -22 },
  { from: "tmux", to: "claude" },
  { from: "tmux", to: "codex" },
  { from: "daemon", to: "sqlite", label: "persist", labelDx: 32 },
];

/* ─── Group colors ─── */

const GROUP_COLORS: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  user: { bg: "rgba(243,244,246,0.06)", border: "rgba(243,244,246,0.18)", text: "#e5e7eb", glow: "rgba(243,244,246,0.06)" },
  interface: { bg: "rgba(6,182,212,0.06)", border: "rgba(6,182,212,0.25)", text: "#22d3ee", glow: "rgba(6,182,212,0.08)" },
  core: { bg: "rgba(6,182,212,0.10)", border: "rgba(6,182,212,0.4)", text: "#67e8f9", glow: "rgba(6,182,212,0.15)" },
  runtime: { bg: "rgba(16,185,129,0.06)", border: "rgba(16,185,129,0.25)", text: "#34d399", glow: "rgba(16,185,129,0.08)" },
  provider: { bg: "rgba(139,92,246,0.06)", border: "rgba(139,92,246,0.25)", text: "#a78bfa", glow: "rgba(139,92,246,0.08)" },
  storage: { bg: "rgba(245,158,11,0.06)", border: "rgba(245,158,11,0.25)", text: "#fbbf24", glow: "rgba(245,158,11,0.08)" },
};

/* ─── Node sizes ─── */

const NODE_W = 110;
const NODE_H = 48;
const PROVIDER_W = 128;
const DAEMON_W = 120;
const DAEMON_H = 54;

function getNodeHalfSize(id: string): { hw: number; hh: number } {
  if (id === "daemon") return { hw: DAEMON_W / 2, hh: DAEMON_H / 2 };
  if (id === "claude" || id === "codex") return { hw: PROVIDER_W / 2, hh: NODE_H / 2 };
  return { hw: NODE_W / 2, hh: NODE_H / 2 };
}

/* ─── Rectangle edge intersection ─── */

function rectEdgePoint(
  cx: number, cy: number, hw: number, hh: number,
  tx: number, ty: number,
): { x: number; y: number } {
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const scaleX = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);

  return { x: cx + dx * scale, y: cy + dy * scale };
}

/* ─── Bezier path (edge-to-edge) ─── */

function computeEdgePath(
  fromId: string, toId: string,
  from: NodeDef, to: NodeDef,
): string {
  const fromSize = getNodeHalfSize(fromId);
  const toSize = getNodeHalfSize(toId);

  const start = rectEdgePoint(from.x, from.y, fromSize.hw, fromSize.hh, to.x, to.y);
  const end = rectEdgePoint(to.x, to.y, toSize.hw, toSize.hh, from.x, from.y);

  const edgeDx = end.x - start.x;
  const absDy = Math.abs(end.y - start.y);
  const ratio = absDy > 80 ? 0.28 : absDy > 30 ? 0.36 : 0.45;
  const cx = Math.abs(edgeDx) * ratio;
  const signX = edgeDx >= 0 ? 1 : -1;

  return `M${start.x},${start.y} C${start.x + signX * cx},${start.y} ${end.x - signX * cx},${end.y} ${end.x},${end.y}`;
}

function edgeMidpoint(from: NodeDef, to: NodeDef): { x: number; y: number } {
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

/* ─── Component ─── */

export default function ArchitectureDiagram() {
  const [visibleEdges, setVisibleEdges] = useState(0);
  const [flowingEdge, setFlowingEdge] = useState(-1);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let step = 0;
    const total = EDGES.length;

    const revealTimer = setInterval(() => {
      step++;
      if (step <= total) {
        setVisibleEdges(step);
      } else {
        clearInterval(revealTimer);
        // Start cycling data flow
        let idx = 0;
        const flowTimer = setInterval(() => {
          setFlowingEdge(idx % total);
          idx++;
        }, 1200);
        return () => clearInterval(flowTimer);
      }
    }, 280);

    return () => clearInterval(revealTimer);
  }, []);

  const nodeW = NODE_W;
  const nodeH = NODE_H;
  const providerW = PROVIDER_W;
  const daemonW = DAEMON_W;
  const daemonH = DAEMON_H;

  return (
    <div style={{ width: "100%", maxWidth: 940, margin: "0 auto" }}>
      <svg
        ref={svgRef}
        viewBox="0 0 940 475"
        width="100%"
        style={{ overflow: "visible" }}
        role="img"
        aria-label="CodePiper architecture diagram showing data flow from user through CLI/Web to Daemon, tmux, and AI providers"
      >
        <defs>
          {/* Gradient for core connections */}
          <linearGradient id="edge-grad-cyan" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(6,182,212,0.1)" />
            <stop offset="50%" stopColor="rgba(6,182,212,0.35)" />
            <stop offset="100%" stopColor="rgba(6,182,212,0.1)" />
          </linearGradient>

          {/* Glow filter for daemon */}
          <filter id="daemon-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="blur" />
            <feFlood floodColor="rgba(6,182,212,0.2)" result="color" />
            <feComposite in="color" in2="blur" operator="in" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Particle glow filter */}
          <filter id="particle-glow">
            <feGaussianBlur stdDeviation="3" />
          </filter>

          {/* Arrow markers per group */}
          <marker id="arrow-interface" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="rgba(6,182,212,0.5)" />
          </marker>
          <marker id="arrow-core" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="rgba(6,182,212,0.6)" />
          </marker>
          <marker id="arrow-runtime" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="rgba(16,185,129,0.5)" />
          </marker>
          <marker id="arrow-provider" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="rgba(139,92,246,0.5)" />
          </marker>
          <marker id="arrow-storage" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="rgba(245,158,11,0.5)" />
          </marker>
        </defs>

        {/* Subtle dot grid */}
        {Array.from({ length: 19 }).map((_, col) =>
          Array.from({ length: 10 }).map((_, row) => (
            <circle
              key={`dot-${col}-${row}`}
              cx={col * 52 + 16}
              cy={row * 48 + 16}
              r="0.6"
              fill="rgba(255,255,255,0.04)"
            />
          ))
        )}

        {/* Edges */}
        {EDGES.map((edge, i) => {
          const from = NODES[edge.from];
          const to = NODES[edge.to];
          const toGroup = NODES[edge.to].group;
          const visible = i < visibleEdges;
          const isFlowing = i === flowingEdge;
          const path = computeEdgePath(edge.from, edge.to, from, to);
          const mid = edgeMidpoint(from, to);
          const labelX = mid.x + (edge.labelDx || 0);
          const labelY = mid.y + (edge.labelDy || 0);

          const arrowId =
            toGroup === "storage" ? "arrow-storage" :
            toGroup === "provider" ? "arrow-provider" :
            toGroup === "runtime" ? "arrow-runtime" :
            toGroup === "core" ? "arrow-core" :
            "arrow-interface";

          const edgeColor =
            toGroup === "storage" ? "rgba(245,158,11,0.2)" :
            toGroup === "provider" ? "rgba(139,92,246,0.2)" :
            toGroup === "runtime" ? "rgba(16,185,129,0.2)" :
            "rgba(6,182,212,0.2)";

          const particleColor =
            toGroup === "storage" ? "#fbbf24" :
            toGroup === "provider" ? "#a78bfa" :
            toGroup === "runtime" ? "#34d399" :
            "#22d3ee";

          return (
            <g key={`edge-${i}`}>
              {/* Shadow line for depth */}
              <path
                d={path}
                fill="none"
                stroke={edgeColor}
                strokeWidth="2.5"
                opacity={visible ? 0.6 : 0}
                style={{ transition: "opacity 0.5s ease-out" }}
              />

              {/* Main line */}
              <path
                d={path}
                fill="none"
                stroke={edgeColor}
                strokeWidth="1.5"
                strokeDasharray={visible ? "none" : "6 4"}
                opacity={visible ? 1 : 0.2}
                markerEnd={`url(#${arrowId})`}
                style={{ transition: "opacity 0.5s ease-out" }}
              />

              {/* Edge label */}
              {edge.label && visible && (
                <g>
                  <rect
                    x={labelX - edge.label.length * 3.2 - 6}
                    y={labelY - 8}
                    width={edge.label.length * 6.4 + 12}
                    height={16}
                    rx="4"
                    fill="rgba(14,16,22,0.85)"
                    stroke={edgeColor}
                    strokeWidth="0.5"
                  />
                  <text
                    x={labelX}
                    y={labelY + 3.5}
                    textAnchor="middle"
                    fill="rgba(156,163,175,0.7)"
                    fontSize="8.5"
                    fontFamily='"DM Mono", monospace'
                  >
                    {edge.label}
                  </text>
                </g>
              )}

              {/* Animated particle */}
              {isFlowing && (
                <>
                  {/* Glow behind particle */}
                  <circle r="8" fill={particleColor} opacity="0.15" filter="url(#particle-glow)">
                    <animateMotion dur="1s" fill="freeze" path={path} />
                    <animate attributeName="opacity" values="0;0.15;0.15;0" dur="1s" fill="freeze" />
                  </circle>
                  {/* Bright particle */}
                  <circle r="3.5" fill={particleColor} opacity="0.9">
                    <animateMotion dur="1s" fill="freeze" path={path} />
                    <animate attributeName="opacity" values="0;0.9;0.9;0" dur="1s" fill="freeze" />
                  </circle>
                  {/* Core of particle */}
                  <circle r="1.5" fill="white" opacity="0.8">
                    <animateMotion dur="1s" fill="freeze" path={path} />
                    <animate attributeName="opacity" values="0;0.8;0.8;0" dur="1s" fill="freeze" />
                  </circle>
                </>
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {Object.entries(NODES).map(([id, node]) => {
          const colors = GROUP_COLORS[node.group];
          const isDaemon = id === "daemon";
          const isProvider = id === "claude" || id === "codex";
          const w = isDaemon ? daemonW : isProvider ? providerW : nodeW;
          const h = isDaemon ? daemonH : nodeH;

          return (
            <g key={id}>
              {/* Outer glow for daemon */}
              {isDaemon && (
                <>
                  <ellipse
                    cx={node.x}
                    cy={node.y}
                    rx={w * 0.8}
                    ry={h * 0.9}
                    fill="rgba(6,182,212,0.04)"
                  />
                  <rect
                    x={node.x - w / 2 - 6}
                    y={node.y - h / 2 - 6}
                    width={w + 12}
                    height={h + 12}
                    rx={16}
                    fill="none"
                    stroke="rgba(6,182,212,0.12)"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                </>
              )}

              {/* Node background */}
              <rect
                x={node.x - w / 2}
                y={node.y - h / 2}
                width={w}
                height={h}
                rx={isDaemon ? 14 : 12}
                fill={colors.bg}
                stroke={colors.border}
                strokeWidth={isDaemon ? 1.5 : 1}
              />

              {/* Icon */}
              <g
                transform={`translate(${node.x - w / 2 + 12}, ${node.y - 7}) scale(0.58)`}
                fill="none"
                stroke={colors.text}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.7"
              >
                <path d={node.icon} />
              </g>

              {/* Label */}
              <text
                x={node.x + 10}
                y={node.y + 1}
                textAnchor="middle"
                dominantBaseline="central"
                fill={colors.text}
                fontSize={isDaemon ? 14 : 12.5}
                fontWeight={isDaemon ? 600 : 500}
                fontFamily={id === "sqlite" || id === "tmux" ? '"DM Mono", monospace' : '"DM Sans", system-ui, sans-serif'}
              >
                {node.label}
              </text>
            </g>
          );
        })}

        {/* Bottom annotation */}
        <text
          x={478}
          y={458}
          textAnchor="middle"
          fill="rgba(107,114,128,0.5)"
          fontSize="9.5"
          fontFamily='"DM Mono", monospace'
          letterSpacing="0.5"
        >
          sessions &middot; policies &middot; analytics &middot; workflows &middot; transcripts
        </text>
      </svg>
    </div>
  );
}
