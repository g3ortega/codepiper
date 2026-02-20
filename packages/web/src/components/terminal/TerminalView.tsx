import {
  ArrowDown,
  ArrowUp,
  Bell,
  BellOff,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Clipboard,
  Copy,
  Keyboard,
  Loader2,
  MessageSquare,
  Monitor,
  Paperclip,
  Search,
  SquareTerminal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { type ITheme, Terminal } from "xterm";
import { WebLinksAddon } from "xterm-addon-web-links";
import "xterm/css/xterm.css";
import { MarkdownRenderer } from "@/components/markdown/MarkdownRenderer";
import { useTheme } from "@/contexts/ThemeContext";
import { useInfiniteEvents } from "@/hooks/useInfiniteEvents";
import { api } from "@/lib/api";
import { getTerminalFeatureFlags, type TerminalFeatureFlags } from "@/lib/terminalFeatureFlags";
import { type WebSocketTransportTelemetrySnapshot, websocketManager } from "@/lib/websocket";
import type { DaemonTerminalFeaturesSettings, TerminalMode } from "@/types/api";
import type {
  WsPtyFramePayload,
  WsSessionEventsPayload,
  WsTerminalCursor,
} from "@/types/websocket";
import {
  describeAttachmentUploadError,
  extractImageFilesFromDataTransfer,
  hasFilePayload,
  IMAGE_ATTACHMENT_ACCEPT,
  MAX_IMAGE_ATTACHMENTS_PER_BATCH,
  MAX_PENDING_IMAGE_ATTACHMENTS,
  planImageAttachmentQueue,
  readImageFileFromClipboard,
  supportsClipboardImageRead,
  validateImageAttachment,
} from "./attachmentUtils";
import { InputBar } from "./InputBar";
import {
  isTextEditingTarget,
  resolveKeyboardInput,
  type TerminalKeyboardDispatch,
} from "./inputMapping";
import { buildTerminalRenderPlan, type TerminalRenderState } from "./renderStrategy";

interface TerminalViewProps {
  sessionId: string;
  sessionStatus?: string;
  supportsConversationView?: boolean;
}

type ViewMode = "terminal" | "conversation" | "attach";
interface TerminalTransportTelemetrySnapshot {
  sessionId: string;
  startedAt: number;
  updatedAt: number;
  wsFramesReceived: number;
  staleFramesDropped: number;
  seqRegressionResets: number;
  seqGapEvents: number;
  reconnectEvents: number;
  reconnectRefreshFetches: number;
  initialFetchDrops: number;
  replayCursorSeq: number;
  inputDispatches: number;
  keyDispatches: number;
  textDispatches: number;
  pasteDispatches: number;
  keyToEchoLastMs: number | null;
  keyToEchoP50Ms: number | null;
  keyToEchoP95Ms: number | null;
  keyToEchoSamples: number;
  scrollToPaintLastMs: number | null;
  scrollToPaintP50Ms: number | null;
  scrollToPaintP95Ms: number | null;
  scrollToPaintSamples: number;
  reconnectResyncLastMs: number | null;
  reconnectResyncP50Ms: number | null;
  reconnectResyncP95Ms: number | null;
  reconnectResyncSamples: number;
  featureWsPtyPasteEnabled: boolean;
  featureLatencyProbesEnabled: boolean;
  featureDiagnosticsPanelEnabled: boolean;
  fullFrameRepaints: number;
  incrementalRepaints: number;
}

interface TerminalProbeSample {
  sentAt: number;
  kind: "key" | "text" | "paste";
}

interface TerminalDiagnosticsSnapshot {
  capturedAt: number;
  terminal: TerminalTransportTelemetrySnapshot;
  ws: WebSocketTransportTelemetrySnapshot;
  queueDepth: {
    pendingInputRequests: number;
    hasPendingPasteQueue: boolean;
  };
}

const TERMINAL_LATENCY_SAMPLE_LIMIT = 120;

function createTransportTelemetrySnapshot(
  sessionId: string,
  features: TerminalFeatureFlags
): TerminalTransportTelemetrySnapshot {
  return {
    sessionId,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    wsFramesReceived: 0,
    staleFramesDropped: 0,
    seqRegressionResets: 0,
    seqGapEvents: 0,
    reconnectEvents: 0,
    reconnectRefreshFetches: 0,
    initialFetchDrops: 0,
    replayCursorSeq: 0,
    inputDispatches: 0,
    keyDispatches: 0,
    textDispatches: 0,
    pasteDispatches: 0,
    keyToEchoLastMs: null,
    keyToEchoP50Ms: null,
    keyToEchoP95Ms: null,
    keyToEchoSamples: 0,
    scrollToPaintLastMs: null,
    scrollToPaintP50Ms: null,
    scrollToPaintP95Ms: null,
    scrollToPaintSamples: 0,
    reconnectResyncLastMs: null,
    reconnectResyncP50Ms: null,
    reconnectResyncP95Ms: null,
    reconnectResyncSamples: 0,
    featureWsPtyPasteEnabled: features.wsPtyPaste.enabled,
    featureLatencyProbesEnabled: features.latencyProbes.enabled,
    featureDiagnosticsPanelEnabled: features.diagnosticsPanel.enabled,
    fullFrameRepaints: 0,
    incrementalRepaints: 0,
  };
}

function percentile(samples: number[], p: number): number | null {
  if (samples.length === 0) {
    return null;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1)))
  );
  return sorted[index] ?? null;
}

function updateRollingLatency(
  samples: number[],
  value: number
): { lastMs: number; p50Ms: number | null; p95Ms: number | null; sampleCount: number } {
  samples.push(value);
  if (samples.length > TERMINAL_LATENCY_SAMPLE_LIMIT) {
    samples.shift();
  }
  return {
    lastMs: value,
    p50Ms: percentile(samples, 50),
    p95Ms: percentile(samples, 95),
    sampleCount: samples.length,
  };
}

function formatLatency(valueMs: number | null): string {
  if (valueMs === null) {
    return "--";
  }
  if (valueMs >= 100) {
    return `${Math.round(valueMs)}ms`;
  }
  return `${valueMs.toFixed(1)}ms`;
}

interface TerminalShortcutKey {
  label: string;
  key: string;
}

interface TerminalCursorState {
  x: number;
  y: number;
  visible: boolean;
}

const DESKTOP_SHORTCUT_KEYS: TerminalShortcutKey[] = [
  { label: "Ctrl+C", key: "ctrl+c" },
  { label: "Ctrl+D", key: "ctrl+d" },
  { label: "Ctrl+L", key: "ctrl+l" },
  { label: "Enter", key: "enter" },
  { label: "Esc", key: "escape" },
  { label: "Tab", key: "tab" },
  { label: "Shift+Tab", key: "shift+tab" },
  { label: "\u232b", key: "backspace" },
  { label: "Del", key: "delete" },
  { label: "\u2191", key: "up" },
  { label: "\u2193", key: "down" },
  { label: "\u2190", key: "left" },
  { label: "\u2192", key: "right" },
  { label: "PgUp", key: "pageup" },
  { label: "PgDn", key: "pagedown" },
  { label: "Home", key: "home" },
  { label: "End", key: "end" },
];

// Mobile-first ordering inspired by common terminal overlays:
// interrupt + control keys first, then navigation cluster.
const MOBILE_SHORTCUT_KEYS: TerminalShortcutKey[] = [
  { label: "Ctrl+C", key: "ctrl+c" },
  { label: "Ctrl+D", key: "ctrl+d" },
  { label: "Esc", key: "escape" },
  { label: "Tab", key: "tab" },
  { label: "Enter", key: "enter" },
  { label: "\u232b", key: "backspace" },
  { label: "\u2190", key: "left" },
  { label: "\u2191", key: "up" },
  { label: "\u2193", key: "down" },
  { label: "\u2192", key: "right" },
  { label: "PgUp", key: "pageup" },
  { label: "PgDn", key: "pagedown" },
  { label: "Home", key: "home" },
  { label: "End", key: "end" },
  { label: "Ctrl+L", key: "ctrl+l" },
  { label: "Del", key: "delete" },
  { label: "Shift+Tab", key: "shift+tab" },
];

const IS_TOUCH_DEVICE =
  typeof window !== "undefined" &&
  (window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window);

function isTransparentColor(value: string | undefined): boolean {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "transparent" ||
    normalized === "#0000" ||
    normalized === "#00000000" ||
    normalized === "rgba(0,0,0,0)" ||
    normalized === "rgba(0, 0, 0, 0)"
  );
}

function withVisibleTerminalCursor(theme: ITheme): ITheme {
  const cursor = isTransparentColor(theme.cursor) ? theme.foreground || "#d4d4e0" : theme.cursor;
  const cursorAccent = isTransparentColor(theme.cursorAccent)
    ? theme.background || "#0e1016"
    : theme.cursorAccent;
  return {
    ...theme,
    cursor,
    cursorAccent,
  };
}

function isTerminalMode(value: unknown): value is TerminalMode {
  return value === "interactive" || value === "scroll" || value === "search";
}

function applyPtyPatch(
  previous: string,
  patch: { start: number; deleteCount: number; data: string }
): string | null {
  if (patch.start < 0 || patch.deleteCount < 0 || patch.start > previous.length) {
    return null;
  }

  const deleteEnd = patch.start + patch.deleteCount;
  if (deleteEnd > previous.length) {
    return null;
  }

  return previous.slice(0, patch.start) + patch.data + previous.slice(deleteEnd);
}

function normalizeCursorState(
  cursor: TerminalCursorState | null | undefined,
  term: Terminal
): TerminalCursorState | null {
  if (!cursor) return null;
  const maxCol = Math.max(0, term.cols - 1);
  const maxRow = Math.max(0, term.rows - 1);
  return {
    x: Math.min(maxCol, Math.max(0, Math.floor(cursor.x))),
    y: Math.min(maxRow, Math.max(0, Math.floor(cursor.y))),
    visible: cursor.visible !== false,
  };
}

function mapCursorToRenderedFrame(
  cursor: TerminalCursorState | null | undefined,
  content: string,
  rows: number
): TerminalCursorState | null {
  if (!cursor) return null;
  const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
  const lineCount = trimmed.split("\n").length;
  const topPadding = Math.max(0, rows - lineCount);
  if (topPadding === 0) {
    return cursor;
  }
  return {
    ...cursor,
    y: cursor.y + topPadding,
  };
}

function isSameCursorState(
  a: TerminalCursorState | null | undefined,
  b: TerminalCursorState | null | undefined
): boolean {
  if (a === b) return true;
  if (!(a && b)) return false;
  return a.x === b.x && a.y === b.y && a.visible === b.visible;
}

function buildCursorSequence(cursor: TerminalCursorState | null): string {
  if (!cursor) {
    return "\x1b[?25h";
  }
  if (!cursor.visible) {
    return "\x1b[?25l";
  }
  return `\x1b[?25h\x1b[${cursor.y + 1};${cursor.x + 1}H`;
}

function parseWsCursor(cursor: WsTerminalCursor): TerminalCursorState | null {
  if (
    typeof cursor.x !== "number" ||
    typeof cursor.y !== "number" ||
    Number.isNaN(cursor.x) ||
    Number.isNaN(cursor.y)
  ) {
    return null;
  }
  return {
    x: cursor.x,
    y: cursor.y,
    visible: cursor.visible !== false,
  };
}

export function TerminalView({
  sessionId,
  sessionStatus,
  supportsConversationView = true,
}: TerminalViewProps) {
  const { theme } = useTheme();
  const [daemonTerminalFeatures, setDaemonTerminalFeatures] =
    useState<DaemonTerminalFeaturesSettings | null>(null);
  const terminalFeatures = useMemo(
    () => getTerminalFeatureFlags(sessionId, daemonTerminalFeatures ?? undefined),
    [sessionId, daemonTerminalFeatures]
  );
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("terminal");
  const [connected, setConnected] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [attachmentNotice, setAttachmentNotice] = useState<{
    tone: "info" | "success" | "error";
    text: string;
  } | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [attachmentUploadProgress, setAttachmentUploadProgress] = useState<number | null>(null);
  const [hasRetryAttachment, setHasRetryAttachment] = useState(false);
  const [dragImageActive, setDragImageActive] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnosticsRefreshTick, setDiagnosticsRefreshTick] = useState(0);
  const [sessionNotificationEnabled, setSessionNotificationEnabled] = useState<boolean | null>(
    null
  );
  const [sessionNotificationPrefLoading, setSessionNotificationPrefLoading] = useState(false);

  const [showActions, setShowActions] = useState(IS_TOUCH_DEVICE);

  // Terminal mode state (scroll/search)
  const [terminalMode, setTerminalMode] = useState<TerminalMode>("interactive");
  const terminalModeRef = useRef<TerminalMode>("interactive");
  const previousTerminalModeRef = useRef<TerminalMode>("interactive");
  const [searchQuery, setSearchQuery] = useState("");
  const [scrollInfo, setScrollInfo] = useState<{
    position: number;
    total: number;
  } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const isEnded = sessionStatus === "STOPPED" || sessionStatus === "CRASHED";
  const conversationViewEnabled = supportsConversationView;
  const shortcutKeys = IS_TOUCH_DEVICE ? MOBILE_SHORTCUT_KEYS : DESKTOP_SHORTCUT_KEYS;
  const writeRafRef = useRef<number | null>(null);
  const pendingWriteRef = useRef<string | null>(null);
  const pendingCursorRef = useRef<TerminalCursorState | null>(null);
  const syncSizeRef = useRef<(() => void) | null>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDimsRef = useRef<{ cols: number; rows: number } | null>(null);
  const lastWrittenRef = useRef<{ content: string; rows: number; cols: number } | null>(null);
  const lastRenderStateRef = useRef<TerminalRenderState | null>(null);
  const lastCursorRef = useRef<TerminalCursorState | null>(null);
  const lastPtySeqRef = useRef(0);
  const liveWriteVersionRef = useRef(0);
  const latestOutputRef = useRef<string | null>(null);
  const resyncInFlightRef = useRef(false);
  const terminalThemeRef = useRef<ITheme>(withVisibleTerminalCursor(theme.terminal));
  const suppressScrollModeUntilRef = useRef(0);
  const activeSearchQueryRef = useRef("");
  const knownScrollInfoRef = useRef<{ position: number; total: number } | null>(null);
  const pendingScrollDeltaRef = useRef(0);
  const scrollThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollInFlightRef = useRef(false);
  const touchStartYRef = useRef<number | null>(null);
  const attachmentNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attachmentUploadQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingAttachmentCountRef = useRef(0);
  const failedAttachmentRef = useRef<File | null>(null);
  const dragDepthRef = useRef(0);
  const wsConnectedRef = useRef(websocketManager.isConnected());
  const transportTelemetryRef = useRef<TerminalTransportTelemetrySnapshot>(
    createTransportTelemetrySnapshot(sessionId, terminalFeatures)
  );
  const pendingEchoProbeQueueRef = useRef<TerminalProbeSample[]>([]);
  const keyToEchoSamplesRef = useRef<number[]>([]);
  const scrollToPaintSamplesRef = useRef<number[]>([]);
  const reconnectResyncSamplesRef = useRef<number[]>([]);
  const reconnectResyncStartAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (conversationViewEnabled || viewMode !== "conversation") {
      return;
    }
    setViewMode("terminal");
  }, [conversationViewEnabled, viewMode]);

  useEffect(() => {
    let cancelled = false;
    void api
      .getDaemonSettings()
      .then(({ settings }) => {
        if (cancelled) {
          return;
        }
        setDaemonTerminalFeatures(settings.terminalFeatures);
      })
      .catch(() => {
        if (!cancelled) {
          setDaemonTerminalFeatures(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSessionNotificationPrefLoading(true);

    void api
      .getSessionNotificationPrefs(sessionId)
      .then(({ prefs }) => {
        if (!cancelled) {
          setSessionNotificationEnabled(prefs.enabled ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSessionNotificationEnabled(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSessionNotificationPrefLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const handleToggleSessionNotifications = useCallback(async () => {
    if (sessionNotificationPrefLoading) {
      return;
    }

    const nextEnabled = sessionNotificationEnabled === false ? null : false;
    setSessionNotificationPrefLoading(true);
    try {
      const { prefs } = await api.updateSessionNotificationPrefs(sessionId, nextEnabled);
      setSessionNotificationEnabled(prefs.enabled ?? null);
      toast.success(
        prefs.enabled === false
          ? "Notifications muted for this session"
          : "Session notifications now follow global settings"
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update notification preference"
      );
    } finally {
      setSessionNotificationPrefLoading(false);
    }
  }, [sessionId, sessionNotificationEnabled, sessionNotificationPrefLoading]);

  // Subscribe to terminal mode change events via WebSocket
  useEffect(() => {
    if (isEnded) return;
    const unsubscribe = websocketManager.subscribe(
      `session:${sessionId}:events`,
      (message: WsSessionEventsPayload) => {
        const eventData = message.data;
        if (!eventData || eventData.type !== "terminal_mode_change") return;

        const mode = isTerminalMode(eventData.mode) ? eventData.mode : "interactive";
        if (mode === "scroll" && Date.now() < suppressScrollModeUntilRef.current) {
          return;
        }
        setTerminalMode(mode);
        terminalModeRef.current = mode;
      }
    );
    return unsubscribe;
  }, [sessionId, isEnded]);

  // Poll scroll position while in scroll/search mode
  useEffect(() => {
    if (terminalMode === "interactive" || isEnded) {
      setScrollInfo(null);
      return;
    }
    const poll = async () => {
      try {
        const info = await api.getTerminalInfo(sessionId);
        if (info.scrollPosition !== undefined && info.historySize !== undefined) {
          const nextInfo = { position: info.scrollPosition, total: info.historySize };
          knownScrollInfoRef.current = nextInfo;
          setScrollInfo(nextInfo);
        }
      } catch {
        // ignore polling errors
      }
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [sessionId, terminalMode, isEnded]);

  // Prime known scroll/history bounds for edge guards, even while interactive.
  useEffect(() => {
    if (isEnded) {
      knownScrollInfoRef.current = null;
      return;
    }

    let cancelled = false;
    void api
      .getTerminalInfo(sessionId)
      .then((info) => {
        if (cancelled) {
          return;
        }
        if (isTerminalMode(info.mode)) {
          // Synchronize local mode with daemon reality on mount/switch.
          // This prevents stale local "interactive" state when another device
          // left tmux in copy-mode.
          if (!(info.mode === "scroll" && Date.now() < suppressScrollModeUntilRef.current)) {
            terminalModeRef.current = info.mode;
            setTerminalMode((current) => (current === info.mode ? current : info.mode));
          }
        }
        if (info.scrollPosition !== undefined && info.historySize !== undefined) {
          knownScrollInfoRef.current = {
            position: info.scrollPosition,
            total: info.historySize,
          };
        }
      })
      .catch(() => {
        // best-effort cache warmup
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, isEnded]);

  const markInputDispatch = useCallback(
    (kind: TerminalProbeSample["kind"]) => {
      const telemetry = transportTelemetryRef.current;
      telemetry.inputDispatches += 1;
      if (kind === "key") {
        telemetry.keyDispatches += 1;
      } else if (kind === "text") {
        telemetry.textDispatches += 1;
      } else {
        telemetry.pasteDispatches += 1;
      }
      telemetry.updatedAt = Date.now();

      if (!terminalFeatures.latencyProbes.enabled) {
        return;
      }

      pendingEchoProbeQueueRef.current.push({
        kind,
        sentAt: performance.now(),
      });
      if (pendingEchoProbeQueueRef.current.length > TERMINAL_LATENCY_SAMPLE_LIMIT) {
        pendingEchoProbeQueueRef.current.shift();
      }
    },
    [terminalFeatures.latencyProbes.enabled]
  );

  const completeInputEchoProbe = useCallback(() => {
    if (!terminalFeatures.latencyProbes.enabled) {
      return;
    }
    const pending = pendingEchoProbeQueueRef.current.shift();
    if (!pending) {
      return;
    }

    const elapsedMs = Math.max(0, performance.now() - pending.sentAt);
    const telemetry = transportTelemetryRef.current;
    const stats = updateRollingLatency(keyToEchoSamplesRef.current, elapsedMs);
    telemetry.keyToEchoLastMs = stats.lastMs;
    telemetry.keyToEchoP50Ms = stats.p50Ms;
    telemetry.keyToEchoP95Ms = stats.p95Ms;
    telemetry.keyToEchoSamples = stats.sampleCount;
    telemetry.updatedAt = Date.now();
  }, [terminalFeatures.latencyProbes.enabled]);

  const recordScrollToPaintLatency = useCallback(
    (startedAt: number) => {
      if (!terminalFeatures.latencyProbes.enabled) {
        return;
      }
      const elapsedMs = Math.max(0, performance.now() - startedAt);
      const telemetry = transportTelemetryRef.current;
      const stats = updateRollingLatency(scrollToPaintSamplesRef.current, elapsedMs);
      telemetry.scrollToPaintLastMs = stats.lastMs;
      telemetry.scrollToPaintP50Ms = stats.p50Ms;
      telemetry.scrollToPaintP95Ms = stats.p95Ms;
      telemetry.scrollToPaintSamples = stats.sampleCount;
      telemetry.updatedAt = Date.now();
    },
    [terminalFeatures.latencyProbes.enabled]
  );

  const startReconnectResyncProbe = useCallback(() => {
    if (!terminalFeatures.latencyProbes.enabled) {
      return;
    }
    reconnectResyncStartAtRef.current = performance.now();
  }, [terminalFeatures.latencyProbes.enabled]);

  const completeReconnectResyncProbe = useCallback(() => {
    const startedAt = reconnectResyncStartAtRef.current;
    if (startedAt === null || !terminalFeatures.latencyProbes.enabled) {
      return;
    }
    reconnectResyncStartAtRef.current = null;
    const elapsedMs = Math.max(0, performance.now() - startedAt);
    const telemetry = transportTelemetryRef.current;
    const stats = updateRollingLatency(reconnectResyncSamplesRef.current, elapsedMs);
    telemetry.reconnectResyncLastMs = stats.lastMs;
    telemetry.reconnectResyncP50Ms = stats.p50Ms;
    telemetry.reconnectResyncP95Ms = stats.p95Ms;
    telemetry.reconnectResyncSamples = stats.sampleCount;
    telemetry.updatedAt = Date.now();
  }, [terminalFeatures.latencyProbes.enabled]);

  useEffect(() => {
    if (!showDiagnostics) {
      return;
    }
    const interval = setInterval(() => {
      setDiagnosticsRefreshTick((current) => current + 1);
    }, 500);
    return () => clearInterval(interval);
  }, [showDiagnostics]);

  useEffect(() => {
    if (terminalFeatures.diagnosticsPanel.enabled || !showDiagnostics) {
      return;
    }
    setShowDiagnostics(false);
  }, [showDiagnostics, terminalFeatures.diagnosticsPanel.enabled]);

  const terminalDiagnostics = useMemo<TerminalDiagnosticsSnapshot | null>(() => {
    if (!showDiagnostics) {
      return null;
    }
    void diagnosticsRefreshTick;

    return {
      capturedAt: Date.now(),
      terminal: {
        ...transportTelemetryRef.current,
      },
      ws: websocketManager.getTelemetrySnapshot(),
      queueDepth: websocketManager.getSessionInputQueueDepth(sessionId),
    };
  }, [showDiagnostics, diagnosticsRefreshTick, sessionId]);

  // Focus search input when entering search mode
  useEffect(() => {
    if (terminalMode === "search") {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [terminalMode]);

  // Keep terminal focus sticky on desktop while in live mode so cursor
  // visibility stays consistent after view/tab switches.
  useEffect(() => {
    if (IS_TOUCH_DEVICE || isEnded || viewMode !== "terminal" || terminalMode !== "interactive") {
      return;
    }
    const term = terminalInstanceRef.current;
    if (!term) {
      return;
    }
    const timer = setTimeout(() => term.focus(), 0);
    return () => clearTimeout(timer);
  }, [viewMode, terminalMode, isEnded]);

  // Render terminal updates with an incremental-first strategy:
  // - small line-local updates => cursor-addressed partial repaint
  // - anything complex/unsafe  => full-frame ANSI repaint
  //
  // This reduces full-screen rewrites while preserving deterministic fallback.
  const writeToTerminal = useCallback(
    (term: Terminal, data: string, cursor?: TerminalCursorState | null) => {
      pendingWriteRef.current = data;
      pendingCursorRef.current = cursor ?? lastCursorRef.current;
      if (writeRafRef.current !== null) {
        cancelAnimationFrame(writeRafRef.current);
      }
      writeRafRef.current = requestAnimationFrame(() => {
        if (pendingWriteRef.current !== null) {
          const content = pendingWriteRef.current;
          const normalizedCursor = normalizeCursorState(
            mapCursorToRenderedFrame(pendingCursorRef.current, content, term.rows),
            term
          );
          const nextCursor = normalizedCursor;
          const plan = buildTerminalRenderPlan(lastRenderStateRef.current, {
            content,
            rows: term.rows,
            cols: term.cols,
          });

          if (plan.kind === "full" || plan.kind === "incremental") {
            term.write(`${plan.buffer}${buildCursorSequence(nextCursor)}`);
            lastRenderStateRef.current = plan.nextState;
            if (plan.kind === "full") {
              transportTelemetryRef.current.fullFrameRepaints += 1;
            } else {
              transportTelemetryRef.current.incrementalRepaints += 1;
            }
            transportTelemetryRef.current.updatedAt = Date.now();
          } else {
            lastRenderStateRef.current = plan.nextState;
            if (!isSameCursorState(nextCursor, lastCursorRef.current)) {
              term.write(buildCursorSequence(nextCursor));
            }
          }

          lastWrittenRef.current = { content, rows: term.rows, cols: term.cols };
          lastCursorRef.current = nextCursor;
          pendingWriteRef.current = null;
          pendingCursorRef.current = null;
        }
        writeRafRef.current = null;
      });
    },
    []
  );

  useEffect(() => {
    const normalizedTheme = withVisibleTerminalCursor(theme.terminal);
    terminalThemeRef.current = normalizedTheme;

    const term = terminalInstanceRef.current;
    if (!term) return;

    term.options.theme = normalizedTheme;

    const snapshot = lastWrittenRef.current?.content;
    if (snapshot) {
      lastWrittenRef.current = null;
      lastRenderStateRef.current = null;
      writeToTerminal(term, snapshot);
    }
  }, [theme, writeToTerminal]);

  // Terminal mode: dynamic cols and rows from container dimensions.
  // We measure the actual rendered cell width from xterm's DOM after opening,
  // then compute cols = containerWidth / cellWidth. This fills the full width.
  useEffect(() => {
    if (viewMode !== "terminal" || !terminalRef.current) return;

    const MIN_COLS = 20; // Low floor — let the container dictate width, even on mobile
    const MAX_COLS = 300;
    const FONT_SIZE = 14;
    const LINE_HEIGHT = 1.2;
    const CELL_HEIGHT = Math.ceil(FONT_SIZE * LINE_HEIGHT);
    const ESTIMATED_CELL_WIDTH = 8.4; // fallback for 14px monospace

    const term = new Terminal({
      disableStdin: true,
      cursorBlink: false,
      cursorInactiveStyle: "outline",
      fontSize: FONT_SIZE,
      fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Monaco, "Courier New", monospace',
      lineHeight: LINE_HEIGHT,
      letterSpacing: 0,
      cols: MIN_COLS, // initial, will be recalculated from container width
      rows: 24, // initial, will be recalculated from container height
      scrollback: 0, // No xterm scrollback — scroll via tmux copy-mode instead
      allowProposedApi: true,
      theme: terminalThemeRef.current,
    });

    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(webLinksAddon);

    term.open(terminalRef.current);
    terminalInstanceRef.current = term;
    lastWrittenRef.current = null; // Reset dedup cache for new terminal
    lastRenderStateRef.current = null;
    lastCursorRef.current = null;
    pendingCursorRef.current = null;
    lastDimsRef.current = null;
    lastPtySeqRef.current = 0;
    liveWriteVersionRef.current = 0;
    latestOutputRef.current = null;
    resyncInFlightRef.current = false;
    transportTelemetryRef.current = createTransportTelemetrySnapshot(sessionId, terminalFeatures);
    pendingEchoProbeQueueRef.current = [];
    keyToEchoSamplesRef.current = [];
    scrollToPaintSamplesRef.current = [];
    reconnectResyncSamplesRef.current = [];
    reconnectResyncStartAtRef.current = null;
    wsConnectedRef.current = websocketManager.isConnected();

    // Defer DOM manipulation to next frame so xterm's render service is
    // fully initialized — avoids "Cannot read properties of undefined
    // (reading 'dimensions')" from syncScrollArea firing too early.
    requestAnimationFrame(() => {
      if (!terminalRef.current) return;

      // Hide xterm scrollbar
      const vp = terminalRef.current.querySelector(".xterm-viewport");
      if (vp instanceof HTMLElement) {
        vp.style.overflow = "hidden";
      }

      // On touch devices, prevent xterm's internal textarea from receiving
      // focus on tap — stops the on-screen keyboard from appearing.
      if (IS_TOUCH_DEVICE) {
        const textarea = terminalRef.current.querySelector(".xterm-helper-textarea");
        if (textarea instanceof HTMLTextAreaElement) {
          textarea.setAttribute("readonly", "readonly");
          textarea.setAttribute("inputmode", "none");
          textarea.tabIndex = -1;
          textarea.style.pointerEvents = "none";
        }
      }
    });

    // Measure actual cell dimensions from rendered DOM (more accurate than estimates)
    const measureCellHeight = (): number => {
      const rowEl = terminalRef.current?.querySelector(".xterm-rows > div");
      if (rowEl) {
        const h = rowEl.getBoundingClientRect().height;
        if (h > 0) return h;
      }
      return CELL_HEIGHT;
    };

    const measureCellWidth = (): number => {
      // After term.open(), .xterm-screen has the rendered width for current cols.
      // cellWidth = screenWidth / cols gives the exact rendered character width.
      const screenEl = terminalRef.current?.querySelector(".xterm-screen");
      if (screenEl && term.cols > 0) {
        const w = screenEl.getBoundingClientRect().width;
        if (w > 0) return w / term.cols;
      }
      return ESTIMATED_CELL_WIDTH;
    };

    // Fetch output and write to terminal via writeToTerminal.
    // For initial load we can drop stale responses if live WS output arrived first.
    const fetchAndPaint = async (opts?: {
      dropIfLiveOutputAdvanced?: boolean;
      completeReconnectProbe?: boolean;
    }) => {
      const liveVersionAtFetchStart = liveWriteVersionRef.current;
      try {
        const { output } = await api.getSessionOutput(sessionId);
        if (!(output && terminalInstanceRef.current)) {
          if (opts?.completeReconnectProbe) {
            completeReconnectResyncProbe();
          }
          return;
        }
        if (
          opts?.dropIfLiveOutputAdvanced &&
          liveWriteVersionRef.current !== liveVersionAtFetchStart
        ) {
          transportTelemetryRef.current.initialFetchDrops += 1;
          transportTelemetryRef.current.updatedAt = Date.now();
          if (opts?.completeReconnectProbe) {
            completeReconnectResyncProbe();
          }
          return;
        }
        latestOutputRef.current = output;
        writeToTerminal(terminalInstanceRef.current, output);
        if (opts?.completeReconnectProbe) {
          completeReconnectResyncProbe();
        }
      } catch {
        if (opts?.completeReconnectProbe) {
          completeReconnectResyncProbe();
        }
        // Ignore fetch errors during transitions
      }
    };

    // Calculate dynamic cols and rows from container dimensions.
    // Both xterm and tmux are synced to the same values.
    // After resize, content arrives naturally via WebSocket.
    const syncSize = () => {
      try {
        const container = terminalRef.current;
        if (!container) return;
        const containerHeight = container.clientHeight - 4; // top padding
        const containerWidth = container.clientWidth;
        const cellH = measureCellHeight();
        const cellW = measureCellWidth();
        const rows = Math.max(1, Math.floor(containerHeight / cellH));
        const cols = Math.min(MAX_COLS, Math.max(MIN_COLS, Math.floor(containerWidth / cellW)));

        if (term.rows !== rows || term.cols !== cols) {
          term.resize(cols, rows);
        }

        const changed =
          !lastDimsRef.current ||
          lastDimsRef.current.cols !== cols ||
          lastDimsRef.current.rows !== rows;

        if (changed) {
          lastDimsRef.current = { cols, rows };

          // Re-render current content with new dimensions for correct padding
          if (lastWrittenRef.current) {
            lastRenderStateRef.current = null;
            writeToTerminal(term, lastWrittenRef.current.content);
          }

          // Sync desired tmux dimensions for active sessions.
          // Daemon-side tmux integration defers resize-window while in copy-mode
          // and applies the latest size when returning to interactive mode.
          if (!isEnded) {
            if (resizeTimerRef.current) {
              clearTimeout(resizeTimerRef.current);
            }
            resizeTimerRef.current = setTimeout(() => {
              api.resizeSession(sessionId, cols, rows).catch(() => {
                // Ignore resize errors
              });
            }, 200);
          }
        }
      } catch {
        // ignore errors during transitions
      }
    };
    syncSizeRef.current = syncSize;

    // Initial sizing
    requestAnimationFrame(() => syncSize());
    const settleSyncTimer = setTimeout(() => {
      requestAnimationFrame(() => syncSize());
    }, 180);

    // ResizeObserver: on container height change, resize tmux
    const container = terminalRef.current;
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => syncSize());
    });
    resizeObserver.observe(container);

    const scheduleWindowSync = () => {
      requestAnimationFrame(() => syncSize());
    };

    const handleVisibilityOrFocus = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      scheduleWindowSync();
    };

    if (typeof window !== "undefined") {
      window.addEventListener("resize", scheduleWindowSync);
      window.addEventListener("focus", handleVisibilityOrFocus);
      window.addEventListener("pageshow", handleVisibilityOrFocus);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    }

    // Initial output fetch
    setInitialLoaded(false);
    void fetchAndPaint({ dropIfLiveOutputAdvanced: true }).finally(() => {
      setInitialLoaded(true);
    });

    // Reconcile mode + dimensions against daemon state for cross-device handoff
    // (e.g., opening the same session on mobile and then desktop).
    void api
      .getTerminalInfo(sessionId)
      .then((info) => {
        if (terminalInstanceRef.current !== term) {
          return;
        }
        const dimsKnown = typeof info.cols === "number" && typeof info.rows === "number";
        const dimsMismatch = dimsKnown && (info.cols !== term.cols || info.rows !== term.rows);

        // Cross-device handoff safeguard:
        // if another client left tmux in copy-mode at a different geometry
        // (common: mobile -> desktop), exit copy-mode and re-sync size so the
        // desktop view doesn't remain "phone-wrapped" until manual typing.
        if (!isEnded && isTerminalMode(info.mode) && info.mode !== "interactive" && dimsMismatch) {
          suppressScrollModeUntilRef.current = Date.now() + 250;
          terminalModeRef.current = "interactive";
          setTerminalMode((current) => (current === "interactive" ? current : "interactive"));
          void api
            .setTerminalMode(sessionId, "interactive")
            .catch(() => {
              // best-effort handoff recovery
            })
            .finally(() => {
              void api.resizeSession(sessionId, term.cols, term.rows).catch(() => {
                // Ignore resize errors during initial reconciliation
              });
              void fetchAndPaint();
            });
          return;
        }
        if (isTerminalMode(info.mode)) {
          if (!(info.mode === "scroll" && Date.now() < suppressScrollModeUntilRef.current)) {
            terminalModeRef.current = info.mode;
            setTerminalMode((current) => (current === info.mode ? current : info.mode));
          }
        }
        if (!isEnded && dimsMismatch) {
          void api.resizeSession(sessionId, term.cols, term.rows).catch(() => {
            // Ignore resize errors during initial reconciliation
          });
        }
      })
      .catch(() => {
        // best-effort reconciliation
      });

    // Live WebSocket updates
    // IMPORTANT: Skip WS writes while in scroll/search mode — the only reliable
    // content source in those modes is the explicit HTTP fetch after each scroll
    // action (refreshTerminal). WS polling data may have been captured before
    // the scroll completed, causing a race that overwrites scrolled content.
    setConnected(websocketManager.isConnected());
    const unsubscribeConnection = websocketManager.onConnectionChange((isWsConnected) => {
      setConnected(isWsConnected);
      if (!wsConnectedRef.current && isWsConnected) {
        transportTelemetryRef.current.reconnectEvents += 1;
        transportTelemetryRef.current.updatedAt = Date.now();
      }
      if (wsConnectedRef.current && !isWsConnected) {
        startReconnectResyncProbe();
      }
      wsConnectedRef.current = isWsConnected;
      if (isWsConnected && terminalModeRef.current === "interactive") {
        transportTelemetryRef.current.reconnectRefreshFetches += 1;
        transportTelemetryRef.current.updatedAt = Date.now();
        void fetchAndPaint({
          dropIfLiveOutputAdvanced: true,
          completeReconnectProbe: true,
        });
      }
    });

    const triggerInteractiveResync = () => {
      if (terminalModeRef.current !== "interactive") {
        return;
      }
      if (resyncInFlightRef.current) {
        return;
      }
      resyncInFlightRef.current = true;
      void fetchAndPaint().finally(() => {
        resyncInFlightRef.current = false;
      });
    };

    const unsubscribe = websocketManager.subscribe(
      `session:${sessionId}:pty`,
      (message: WsPtyFramePayload) => {
        if (message.type !== "pty_output" && message.type !== "pty_patch") {
          return;
        }
        transportTelemetryRef.current.wsFramesReceived += 1;
        transportTelemetryRef.current.updatedAt = Date.now();

        const priorSeq = lastPtySeqRef.current;
        if (typeof message.seq === "number") {
          if (message.seq === priorSeq) {
            transportTelemetryRef.current.staleFramesDropped += 1;
            transportTelemetryRef.current.updatedAt = Date.now();
            return;
          }

          // Sequence can reset after daemon restart/reconnect. Accept the new
          // stream baseline instead of permanently dropping all future frames.
          if (message.seq < priorSeq) {
            transportTelemetryRef.current.seqRegressionResets += 1;
            lastPtySeqRef.current = 0;
          }
          if (priorSeq > 0 && message.seq > priorSeq + 1) {
            transportTelemetryRef.current.seqGapEvents += 1;
          }
        }

        let nextOutput: string | null = null;
        const nextCursor = message.cursor ? parseWsCursor(message.cursor) : undefined;
        if (message.type === "pty_output" && typeof message.data === "string") {
          nextOutput = message.data;
        } else if (message.type === "pty_patch") {
          if (
            typeof message.baseSeq !== "number" ||
            typeof message.start !== "number" ||
            typeof message.deleteCount !== "number" ||
            typeof message.data !== "string"
          ) {
            return;
          }

          if (priorSeq !== 0 && message.baseSeq !== priorSeq) {
            transportTelemetryRef.current.seqGapEvents += 1;
            transportTelemetryRef.current.updatedAt = Date.now();
            triggerInteractiveResync();
            return;
          }

          const base = latestOutputRef.current;
          if (base === null) {
            transportTelemetryRef.current.seqGapEvents += 1;
            transportTelemetryRef.current.updatedAt = Date.now();
            triggerInteractiveResync();
            return;
          }

          const patched = applyPtyPatch(base, {
            start: message.start,
            deleteCount: message.deleteCount,
            data: message.data,
          });
          if (patched === null) {
            transportTelemetryRef.current.seqGapEvents += 1;
            transportTelemetryRef.current.updatedAt = Date.now();
            triggerInteractiveResync();
            return;
          }
          nextOutput = patched;
        }

        if (typeof message.seq === "number") {
          lastPtySeqRef.current = message.seq;
          transportTelemetryRef.current.replayCursorSeq = message.seq;
        }
        if (nextOutput === null) {
          return;
        }

        latestOutputRef.current = nextOutput;
        if (terminalModeRef.current !== "interactive") return;
        completeReconnectResyncProbe();
        completeInputEchoProbe();
        liveWriteVersionRef.current += 1;
        writeToTerminal(term, nextOutput, nextCursor);
      },
      {
        getReplayCursor: () => (lastPtySeqRef.current > 0 ? lastPtySeqRef.current : undefined),
      }
    );

    return () => {
      resizeObserver.disconnect();
      clearTimeout(settleSyncTimer);
      if (writeRafRef.current !== null) {
        cancelAnimationFrame(writeRafRef.current);
      }
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", scheduleWindowSync);
        window.removeEventListener("focus", handleVisibilityOrFocus);
        window.removeEventListener("pageshow", handleVisibilityOrFocus);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      }
      syncSizeRef.current = null;
      unsubscribeConnection();
      unsubscribe();
      setConnected(false);
      if (typeof window !== "undefined") {
        const globalWindow = window as Window & {
          __codepiperTerminalTransportTelemetry?: Record<
            string,
            TerminalTransportTelemetrySnapshot
          >;
        };
        globalWindow.__codepiperTerminalTransportTelemetry = {
          ...(globalWindow.__codepiperTerminalTransportTelemetry ?? {}),
          [sessionId]: { ...transportTelemetryRef.current, updatedAt: Date.now() },
        };
      }
      term.dispose();
      terminalInstanceRef.current = null;
      lastDimsRef.current = null;
    };
  }, [
    sessionId,
    viewMode,
    writeToTerminal,
    isEnded,
    terminalFeatures,
    startReconnectResyncProbe,
    completeReconnectResyncProbe,
    completeInputEchoProbe,
  ]);

  const handleSendKey = useCallback(
    async (key: string) => {
      if (isEnded) return;
      try {
        markInputDispatch("key");
        const fallbackSend = async () => {
          await api.sendKeys(sessionId, { keys: [key] });
        };

        const deliveredViaWs = websocketManager.sendPtyKey(sessionId, key, {
          onDispatchError: async () => {
            try {
              await fallbackSend();
            } catch (fallbackError) {
              console.error("Failed to fallback PTY key to HTTP:", fallbackError);
            }
          },
        });
        if (!deliveredViaWs) {
          await fallbackSend();
        }
      } catch (err) {
        console.error("Failed to send key:", err);
      }
    },
    [sessionId, isEnded, markInputDispatch]
  );

  const handleSendTextFragment = useCallback(
    async (text: string) => {
      if (isEnded || !text) return;
      try {
        markInputDispatch("text");
        const fallbackSend = async () => {
          await api.sendText(sessionId, { text, newline: false });
        };

        const deliveredViaWs = websocketManager.sendPtyInput(sessionId, text, {
          onDispatchError: async () => {
            try {
              await fallbackSend();
            } catch (fallbackError) {
              console.error("Failed to fallback PTY input to HTTP:", fallbackError);
            }
          },
        });
        if (!deliveredViaWs) {
          await fallbackSend();
        }
      } catch (err) {
        console.error("Failed to send input text:", err);
      }
    },
    [sessionId, isEnded, markInputDispatch]
  );

  // Helper: update terminal mode state + ref together
  const updateMode = useCallback((mode: TerminalMode) => {
    setTerminalMode(mode);
    terminalModeRef.current = mode;
  }, []);

  const resetScrollInputPipeline = useCallback(() => {
    pendingScrollDeltaRef.current = 0;
    scrollInFlightRef.current = false;
    touchStartYRef.current = null;
    if (scrollThrottleRef.current) {
      clearTimeout(scrollThrottleRef.current);
      scrollThrottleRef.current = null;
    }
  }, []);

  // Make history/search feel implicit: typing exits history and resumes live input.
  const ensureInteractiveForLiveInput = useCallback(async () => {
    if (terminalModeRef.current === "interactive") {
      return;
    }

    updateMode("interactive");
    setSearchQuery("");
    setScrollInfo(null);
    activeSearchQueryRef.current = "";
    lastWrittenRef.current = null;
    lastRenderStateRef.current = null;
    resetScrollInputPipeline();

    await api.setTerminalMode(sessionId, "interactive").catch(() => {
      // Best-effort; daemon input paths also auto-exit copy-mode server-side.
    });
  }, [sessionId, updateMode, resetScrollInputPipeline]);

  const sendLiveDispatch = useCallback(
    async (dispatch: TerminalKeyboardDispatch) => {
      await ensureInteractiveForLiveInput();
      if (dispatch.kind === "key") {
        await handleSendKey(dispatch.key);
      } else {
        await handleSendTextFragment(dispatch.text);
      }
    },
    [ensureInteractiveForLiveInput, handleSendKey, handleSendTextFragment]
  );

  const handleShortcutKey = useCallback(
    (key: string) => {
      void sendLiveDispatch({ kind: "key", key });
    },
    [sendLiveDispatch]
  );

  // Fetch terminal output directly via HTTP after scroll/search actions.
  // WS polling may not fire promptly after tmux copy-mode scroll, so we
  // proactively fetch the updated pane content with a short delay.
  const refreshTerminal = useCallback(async () => {
    await new Promise((r) => setTimeout(r, 20));
    try {
      const { output } = await api.getSessionOutput(sessionId);
      if (output && terminalInstanceRef.current) {
        latestOutputRef.current = output;
        writeToTerminal(terminalInstanceRef.current, output);
      }
    } catch {
      // ignore — WebSocket updates will catch up
    }
  }, [sessionId, writeToTerminal]);

  // Shared cleanup when returning to interactive mode from scroll/search.
  // Clears dedup cache so live WS content comes through immediately.
  const returnToInteractive = useCallback(async () => {
    updateMode("interactive");
    setSearchQuery("");
    setScrollInfo(null);
    activeSearchQueryRef.current = "";
    lastWrittenRef.current = null;
    lastRenderStateRef.current = null;
    resetScrollInputPipeline();
    syncSizeRef.current?.();

    const term = terminalInstanceRef.current;
    if (term && !isEnded) {
      await api.resizeSession(sessionId, term.cols, term.rows).catch(() => {
        // Ignore resize errors during mode transitions
      });
    }

    await refreshTerminal();
  }, [updateMode, refreshTerminal, sessionId, isEnded, resetScrollInputPipeline]);

  // Re-sync tmux dimensions on every terminal mode transition (both directions).
  // This ensures cross-device handoff can recover by simply entering/leaving
  // interactive mode, without requiring a full view switch.
  useEffect(() => {
    const previousMode = previousTerminalModeRef.current;
    previousTerminalModeRef.current = terminalMode;

    if (previousMode === terminalMode || isEnded || viewMode !== "terminal") {
      return;
    }

    const resizeToCurrent = () => {
      const term = terminalInstanceRef.current;
      if (!term || isEnded) {
        return;
      }
      void api.resizeSession(sessionId, term.cols, term.rows).catch(() => {
        // Ignore resize errors during mode transitions
      });
    };

    syncSizeRef.current?.();
    resizeToCurrent();
    requestAnimationFrame(() => {
      syncSizeRef.current?.();
      resizeToCurrent();
    });

    const touchesInteractive = previousMode === "interactive" || terminalMode === "interactive";
    if (touchesInteractive) {
      const settleTimer = setTimeout(() => {
        syncSizeRef.current?.();
        resizeToCurrent();
        void refreshTerminal();
      }, 140);
      return () => clearTimeout(settleTimer);
    }

    return;
  }, [terminalMode, sessionId, isEnded, viewMode, refreshTerminal]);

  const handleExitMode = useCallback(async () => {
    try {
      await api.setTerminalMode(sessionId, "interactive");
      await returnToInteractive();
    } catch (err) {
      console.error("Failed to exit mode:", err);
    }
  }, [sessionId, returnToInteractive]);

  const handleScroll = useCallback(
    async (
      direction: "up" | "down",
      opts?: { page?: boolean; edge?: "top" | "bottom"; lines?: number }
    ) => {
      const startedAt = performance.now();
      try {
        let knownScrollInfo = knownScrollInfoRef.current;
        if (!opts?.edge && direction === "up" && terminalModeRef.current === "interactive") {
          if (!knownScrollInfo) {
            const info = await api.getTerminalInfo(sessionId).catch(() => null);
            if (info?.scrollPosition !== undefined && info.historySize !== undefined) {
              knownScrollInfo = {
                position: info.scrollPosition,
                total: info.historySize,
              };
              knownScrollInfoRef.current = knownScrollInfo;
            }
          }
        }

        if (!opts?.edge && direction === "up") {
          // If there's no history at all, ignore upward scroll attempts while live.
          // This avoids rapid interactive<->scroll mode churn/flicker.
          if (terminalModeRef.current === "interactive" && knownScrollInfo?.total === 0) {
            suppressScrollModeUntilRef.current = Date.now() + 250;
            resetScrollInputPipeline();
            return;
          }
          // If already at history top, additional upward scroll attempts are no-ops.
          if (
            terminalModeRef.current !== "interactive" &&
            knownScrollInfo &&
            knownScrollInfo.total > 0 &&
            knownScrollInfo.position >= knownScrollInfo.total
          ) {
            resetScrollInputPipeline();
            return;
          }
        }

        if (opts?.edge) {
          await api.scrollTerminal(sessionId, { edge: opts.edge });
          if (opts.edge === "bottom") {
            suppressScrollModeUntilRef.current = Date.now() + 250;
            await returnToInteractive();
            recordScrollToPaintLatency(startedAt);
            return;
          }
        } else {
          await api.scrollTerminal(sessionId, {
            direction,
            page: opts?.page,
            lines: opts?.lines,
          });
        }
        if (terminalModeRef.current === "interactive") {
          suppressScrollModeUntilRef.current = 0;
          updateMode("scroll");
        }

        // Auto-exit scroll mode when we naturally reach bottom.
        // This keeps wheel/touch scrolling behavior close to native terminals.
        const info = await api.getTerminalInfo(sessionId).catch(() => null);
        if (info?.scrollPosition !== undefined) {
          if (info.historySize !== undefined) {
            knownScrollInfoRef.current = {
              position: info.scrollPosition,
              total: info.historySize,
            };
          }
          if (info.scrollPosition <= 0) {
            suppressScrollModeUntilRef.current = Date.now() + 250;
            await returnToInteractive();
            recordScrollToPaintLatency(startedAt);
            return;
          }
          if (info.historySize !== undefined) {
            setScrollInfo({ position: info.scrollPosition, total: info.historySize });
          }
        }

        await refreshTerminal();
        recordScrollToPaintLatency(startedAt);
      } catch (err) {
        console.error("Failed to scroll:", err);
      }
    },
    [
      sessionId,
      updateMode,
      refreshTerminal,
      returnToInteractive,
      recordScrollToPaintLatency,
      resetScrollInputPipeline,
    ]
  );

  const handleSearch = useCallback(
    async (query: string) => {
      if (!query.trim()) return;
      try {
        const normalizedQuery = query.trim();
        await api.searchTerminal(sessionId, { query: normalizedQuery });
        activeSearchQueryRef.current = normalizedQuery;
        updateMode("search");
        await refreshTerminal();
      } catch (err) {
        console.error("Failed to search:", err);
      }
    },
    [sessionId, updateMode, refreshTerminal]
  );

  const handleSearchAction = useCallback(
    async (action: "next" | "previous" | "cancel") => {
      try {
        if (action !== "cancel" && !activeSearchQueryRef.current) {
          const draftQuery = searchQuery.trim();
          if (!draftQuery) {
            return;
          }
          await handleSearch(draftQuery);
          return;
        }

        await api.searchTerminal(sessionId, { action });
        if (action === "cancel") {
          activeSearchQueryRef.current = "";
          await returnToInteractive();
          return;
        }
        await refreshTerminal();
      } catch (err) {
        console.error("Failed to perform search action:", err);
      }
    },
    [sessionId, returnToInteractive, refreshTerminal, searchQuery, handleSearch]
  );

  const startSearchMode = useCallback(async () => {
    setSearchQuery("");
    updateMode("search");
    activeSearchQueryRef.current = "";
    suppressScrollModeUntilRef.current = 0;

    try {
      await api.setTerminalMode(sessionId, "scroll");
      await refreshTerminal();
    } catch (err) {
      console.error("Failed to enter search mode:", err);
      updateMode("interactive");
    }
  }, [sessionId, refreshTerminal, updateMode]);

  // --- Natural scroll: wheel + touch handlers ---
  // Accumulate pixel deltas and flush them as batched line-scroll API calls
  // to avoid flooding the daemon with per-pixel requests.

  const isScrollActive = useCallback(
    () => !isEnded && viewMode === "terminal",
    [isEnded, viewMode]
  );

  const flushScrollDelta = useCallback(async () => {
    scrollThrottleRef.current = null;
    if (scrollInFlightRef.current) {
      scrollThrottleRef.current = setTimeout(flushScrollDelta, 35);
      return;
    }

    const delta = pendingScrollDeltaRef.current;
    if (delta === 0) return;

    const container = terminalRef.current;
    const rows = terminalInstanceRef.current?.rows || 30;
    const lineHeight = Math.max(8, container ? container.clientHeight / rows : 18);
    const pixelsPerLine = Math.max(6, lineHeight * 0.35);
    const lineDelta = delta / pixelsPerLine;

    // At live bottom, downward gestures should be ignored entirely.
    // Keep only upward deltas that move into history.
    if (terminalModeRef.current === "interactive" && lineDelta > 0) {
      pendingScrollDeltaRef.current = 0;
      return;
    }

    const wholeLines = lineDelta < 0 ? Math.ceil(lineDelta) : Math.floor(lineDelta);
    if (wholeLines === 0) {
      return;
    }

    const maxBatchLines = 24;
    const batchedLines =
      wholeLines < 0 ? Math.max(wholeLines, -maxBatchLines) : Math.min(wholeLines, maxBatchLines);
    pendingScrollDeltaRef.current -= batchedLines * pixelsPerLine;

    const lines = Math.max(1, Math.abs(batchedLines));
    const direction = batchedLines < 0 ? "up" : "down";

    scrollInFlightRef.current = true;
    try {
      await handleScroll(direction, { lines });
    } finally {
      scrollInFlightRef.current = false;
      if (pendingScrollDeltaRef.current !== 0) {
        scrollThrottleRef.current = setTimeout(flushScrollDelta, 35);
      }
    }
  }, [handleScroll]);

  const scheduleFlush = useCallback(
    (delta: number) => {
      pendingScrollDeltaRef.current += delta;
      if (!scrollThrottleRef.current) {
        scrollThrottleRef.current = setTimeout(flushScrollDelta, 35);
      }
    },
    [flushScrollDelta]
  );

  const queueWheelDelta = useCallback(
    (deltaY: number, deltaMode: number, ctrlKey: boolean, preventDefault: () => void) => {
      if (!isScrollActive()) return;
      if (ctrlKey) return;
      preventDefault();

      const container = terminalRef.current;
      const rows = terminalInstanceRef.current?.rows || 30;
      const lineHeight = Math.max(8, container ? container.clientHeight / rows : 18);
      const pageHeight = Math.max(lineHeight * rows, container?.clientHeight ?? lineHeight * rows);

      let pixelDelta = deltaY;
      if (deltaMode === 1) {
        pixelDelta *= lineHeight;
      } else if (deltaMode === 2) {
        pixelDelta *= pageHeight;
      }

      if (terminalModeRef.current === "interactive" && pixelDelta > 0) {
        return;
      }

      scheduleFlush(pixelDelta);
    },
    [isScrollActive, scheduleFlush]
  );

  useEffect(() => {
    if (viewMode !== "terminal") {
      return;
    }
    const container = terminalRef.current;
    if (!container) {
      return;
    }

    const onNativeWheel = (event: WheelEvent) => {
      queueWheelDelta(event.deltaY, event.deltaMode, event.ctrlKey, () => {
        event.preventDefault();
      });
    };

    container.addEventListener("wheel", onNativeWheel, { capture: true, passive: false });
    return () => {
      container.removeEventListener("wheel", onNativeWheel, true);
    };
  }, [queueWheelDelta, viewMode]);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!isScrollActive()) return;
      if (e.touches.length === 1) {
        touchStartYRef.current = e.touches[0].clientY;
      }
    },
    [isScrollActive]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isScrollActive()) return;
      if (touchStartYRef.current === null || e.touches.length !== 1) return;

      e.preventDefault();
      const currentY = e.touches[0].clientY;
      const deltaY = touchStartYRef.current - currentY;
      if (Math.abs(deltaY) < 10) return;

      touchStartYRef.current = currentY;
      if (terminalModeRef.current === "interactive" && deltaY > 0) {
        return;
      }
      scheduleFlush(deltaY);
    },
    [isScrollActive, scheduleFlush]
  );

  const handleTouchEnd = useCallback(() => {
    touchStartYRef.current = null;
  }, []);

  // Cleanup throttle timer on unmount
  useEffect(() => {
    return () => {
      if (scrollThrottleRef.current) {
        clearTimeout(scrollThrottleRef.current);
      }
      if (attachmentNoticeTimerRef.current) {
        clearTimeout(attachmentNoticeTimerRef.current);
      }
    };
  }, []);

  const showAttachmentNotice = useCallback((tone: "info" | "success" | "error", text: string) => {
    if (attachmentNoticeTimerRef.current) {
      clearTimeout(attachmentNoticeTimerRef.current);
    }
    setAttachmentNotice({ tone, text });
    attachmentNoticeTimerRef.current = setTimeout(() => {
      setAttachmentNotice(null);
      attachmentNoticeTimerRef.current = null;
    }, 2600);
  }, []);

  const sendImageToSession = useCallback(
    async (file: File) => {
      if (isEnded) {
        return;
      }

      const validationError = validateImageAttachment(file);
      if (validationError) {
        showAttachmentNotice("error", validationError);
        return;
      }

      try {
        setUploadingAttachment(true);
        setAttachmentUploadProgress(0);
        setHasRetryAttachment(false);
        failedAttachmentRef.current = null;
        showAttachmentNotice("info", "Uploading image...");
        await ensureInteractiveForLiveInput();
        const { path } = await api.uploadImage(sessionId, file, {
          onProgress: (progressPercent) => setAttachmentUploadProgress(progressPercent),
        });
        await api.sendText(sessionId, { text: path, newline: true });
        setAttachmentUploadProgress(null);
        showAttachmentNotice("success", "Image attached");
      } catch (error) {
        console.error("Failed to attach image:", error);
        failedAttachmentRef.current = file;
        setHasRetryAttachment(true);
        setAttachmentUploadProgress(null);
        showAttachmentNotice("error", describeAttachmentUploadError(error));
      } finally {
        setUploadingAttachment(false);
      }
    },
    [ensureInteractiveForLiveInput, isEnded, sessionId, showAttachmentNotice]
  );

  const enqueueImageAttachment = useCallback(
    (file: File) => {
      pendingAttachmentCountRef.current += 1;
      attachmentUploadQueueRef.current = attachmentUploadQueueRef.current
        .catch(() => undefined)
        .then(() => sendImageToSession(file))
        .finally(() => {
          pendingAttachmentCountRef.current = Math.max(0, pendingAttachmentCountRef.current - 1);
        });
    },
    [sendImageToSession]
  );

  const enqueueImageAttachments = useCallback(
    (files: File[]) => {
      if (files.length === 0) {
        return;
      }

      const queuePlan = planImageAttachmentQueue(files, pendingAttachmentCountRef.current);
      if (queuePlan.accepted.length === 0) {
        showAttachmentNotice(
          "error",
          `Attachment queue is full (max ${MAX_PENDING_IMAGE_ATTACHMENTS} pending)`
        );
        return;
      }

      for (const file of queuePlan.accepted) {
        enqueueImageAttachment(file);
      }

      const skipped = queuePlan.droppedByBatchLimit + queuePlan.droppedByQueueLimit;
      if (skipped > 0) {
        showAttachmentNotice(
          "info",
          `Queued ${queuePlan.accepted.length} image(s), skipped ${skipped} (max ${MAX_IMAGE_ATTACHMENTS_PER_BATCH} per add, ${MAX_PENDING_IMAGE_ATTACHMENTS} pending)`
        );
        return;
      }

      if (queuePlan.accepted.length > 1) {
        showAttachmentNotice("info", `Queueing ${queuePlan.accepted.length} images...`);
      }
    },
    [enqueueImageAttachment, showAttachmentNotice]
  );

  const handleRetryAttachment = useCallback(() => {
    if (uploadingAttachment) {
      return;
    }
    const file = failedAttachmentRef.current;
    if (!file) {
      return;
    }
    enqueueImageAttachment(file);
  }, [enqueueImageAttachment, uploadingAttachment]);

  const canReadClipboardImages = supportsClipboardImageRead();

  const handlePasteImageFromClipboard = useCallback(async () => {
    if (!canReadClipboardImages) {
      showAttachmentNotice("error", "Clipboard image read is not supported on this browser");
      return;
    }

    try {
      const file = await readImageFileFromClipboard();
      if (!file) {
        showAttachmentNotice("error", "No image found in clipboard");
        return;
      }
      enqueueImageAttachments([file]);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        showAttachmentNotice("error", "Clipboard permission denied");
        return;
      }
      console.error("Failed to read image from clipboard:", error);
      showAttachmentNotice("error", "Failed to read image from clipboard");
    }
  }, [canReadClipboardImages, enqueueImageAttachments, showAttachmentNotice]);

  const handleTerminalDragEnter = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (IS_TOUCH_DEVICE || isEnded || viewMode !== "terminal") {
        return;
      }
      if (!hasFilePayload(e.dataTransfer)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current += 1;
      setDragImageActive(true);
    },
    [isEnded, viewMode]
  );

  const handleTerminalDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (IS_TOUCH_DEVICE || isEnded || viewMode !== "terminal") {
        return;
      }
      if (!hasFilePayload(e.dataTransfer)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      if (!dragImageActive) {
        setDragImageActive(true);
      }
    },
    [dragImageActive, isEnded, viewMode]
  );

  const handleTerminalDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (IS_TOUCH_DEVICE) {
      return;
    }
    if (!hasFilePayload(e.dataTransfer)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDragImageActive(false);
    }
  }, []);

  const handleTerminalDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (IS_TOUCH_DEVICE || isEnded || viewMode !== "terminal") {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = 0;
      setDragImageActive(false);

      const files = extractImageFilesFromDataTransfer(e.dataTransfer);
      if (files.length === 0) {
        showAttachmentNotice("error", "Drop PNG, JPEG, GIF, or WebP images");
        return;
      }
      enqueueImageAttachments(files);
    },
    [enqueueImageAttachments, isEnded, showAttachmentNotice, viewMode]
  );

  // Global keyboard shortcuts for terminal modes
  useEffect(() => {
    if (isEnded || viewMode !== "terminal") return;

    const sendPastedText = async (text: string) => {
      try {
        await ensureInteractiveForLiveInput();
        markInputDispatch("paste");

        const fallbackSend = async () => {
          await api.sendText(sessionId, { text, newline: false });
        };

        if (!terminalFeatures.wsPtyPaste.enabled) {
          await fallbackSend();
          return;
        }

        const deliveredViaWs = websocketManager.sendPtyPaste(sessionId, text, {
          onDispatchError: async () => {
            try {
              await fallbackSend();
            } catch (fallbackError) {
              console.error("Failed to fallback PTY paste to HTTP:", fallbackError);
            }
          },
        });
        if (!deliveredViaWs) {
          await fallbackSend();
        }
      } catch (error) {
        console.error("Failed to send pasted text:", error);
      }
    };

    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      // Preserve native editing behavior for regular form inputs.
      if (isTextEditingTarget(e.target)) {
        return;
      }

      if (
        terminalFeatures.diagnosticsPanel.enabled &&
        e.key.toLowerCase() === "d" &&
        e.shiftKey &&
        (e.ctrlKey || e.metaKey)
      ) {
        e.preventDefault();
        setShowDiagnostics((current) => !current);
        return;
      }

      if (terminalMode === "interactive") {
        if (e.key === "PageUp") {
          e.preventDefault();
          handleScroll("up", { page: true });
          return;
        }
        const dispatch = resolveKeyboardInput(e);
        if (!dispatch) {
          return;
        }

        e.preventDefault();
        void sendLiveDispatch(dispatch);
      } else if (terminalMode === "scroll") {
        switch (e.key) {
          case "PageUp":
            e.preventDefault();
            handleScroll("up", { page: true });
            return;
          case "PageDown":
            e.preventDefault();
            handleScroll("down", { page: true });
            return;
          case "ArrowUp":
            e.preventDefault();
            handleScroll("up");
            return;
          case "ArrowDown":
            e.preventDefault();
            handleScroll("down");
            return;
          case "Escape":
            e.preventDefault();
            handleExitMode();
            return;
          case "/":
            e.preventDefault();
            void startSearchMode();
            return;
        }

        const dispatch = resolveKeyboardInput(e);
        if (!dispatch) {
          return;
        }
        e.preventDefault();
        void sendLiveDispatch(dispatch);
      } else if (terminalMode === "search") {
        if (e.key === "Escape") {
          e.preventDefault();
          handleSearchAction("cancel");
          return;
        }

        const dispatch = resolveKeyboardInput(e);
        if (!dispatch) {
          return;
        }
        e.preventDefault();
        void sendLiveDispatch(dispatch);
      }
    };

    const handlePaste = (e: ClipboardEvent) => {
      if (isTextEditingTarget(e.target)) return;

      const imageFiles = extractImageFilesFromDataTransfer(e.clipboardData);
      if (imageFiles.length > 0) {
        e.preventDefault();
        enqueueImageAttachments(imageFiles);
        return;
      }

      const text = e.clipboardData?.getData("text");
      if (!text) return;

      e.preventDefault();
      void sendPastedText(text);
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("paste", handlePaste, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("paste", handlePaste, true);
    };
  }, [
    isEnded,
    viewMode,
    terminalMode,
    enqueueImageAttachments,
    handleScroll,
    sendLiveDispatch,
    ensureInteractiveForLiveInput,
    markInputDispatch,
    sessionId,
    handleExitMode,
    startSearchMode,
    handleSearchAction,
    terminalFeatures.wsPtyPaste.enabled,
    terminalFeatures.diagnosticsPanel.enabled,
  ]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border px-2 md:px-3 py-1 md:py-1.5 bg-card/80 backdrop-blur-sm gap-2">
        {/* Mode toggle */}
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <div className="flex gap-0.5 bg-muted/40 rounded-lg p-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setViewMode("terminal")}
              className={`flex items-center gap-1 md:gap-1.5 px-2 md:px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                viewMode === "terminal"
                  ? "bg-background text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Monitor className="h-3 w-3" />
              <span>Tmux</span>
            </button>
            {conversationViewEnabled && (
              <button
                type="button"
                onClick={() => setViewMode("conversation")}
                className={`flex items-center gap-1 md:gap-1.5 px-2 md:px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  viewMode === "conversation"
                    ? "bg-background text-primary shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <MessageSquare className="h-3 w-3" />
                <span className="hidden sm:inline">Conversation</span>
                <span className="sm:hidden">Chat</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setViewMode("attach")}
              className={`flex items-center gap-1 md:gap-1.5 px-2 md:px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                viewMode === "attach"
                  ? "bg-background text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <SquareTerminal className="h-3 w-3" />
              <span>Attach</span>
            </button>
          </div>

          {/* Connection status — hidden in attach mode */}
          <div
            className={`flex items-center gap-1.5 shrink-0 ${viewMode === "attach" ? "hidden" : ""}`}
          >
            {isEnded ? (
              <>
                <div
                  className={`h-1.5 w-1.5 rounded-full ${
                    sessionStatus === "CRASHED" ? "bg-red-400/50" : "bg-muted-foreground/30"
                  }`}
                />
                <span
                  className={`text-[10px] font-mono hidden sm:inline ${
                    sessionStatus === "CRASHED" ? "text-red-400/60" : "text-muted-foreground/50"
                  }`}
                >
                  {sessionStatus === "CRASHED" ? "crashed" : "ended"}
                </span>
              </>
            ) : viewMode === "terminal" ? (
              <>
                <div
                  className={`h-1.5 w-1.5 rounded-full ${
                    !connected
                      ? "bg-muted-foreground/30"
                      : terminalMode === "interactive"
                        ? "bg-emerald-400 shadow-sm shadow-emerald-400/50"
                        : "bg-amber-400/80 shadow-sm shadow-amber-400/40"
                  }`}
                />
                <span className="text-[10px] text-muted-foreground/50 font-mono hidden sm:inline">
                  {!connected
                    ? "disconnected"
                    : terminalMode === "interactive"
                      ? "live"
                      : "history"}
                </span>
                {!IS_TOUCH_DEVICE && terminalMode === "interactive" ? (
                  <span className="text-[10px] text-muted-foreground/35 font-mono hidden lg:inline">
                    type directly in tmux
                  </span>
                ) : null}
              </>
            ) : null}

            {/* Scroll/search mode controls */}
            {viewMode === "terminal" &&
              !isEnded &&
              (terminalMode === "interactive" ? (
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => handleScroll("up", { page: true })}
                    className="p-1 rounded text-muted-foreground/40 hover:text-foreground hover:bg-accent/60 transition-colors"
                    title="Scroll up (PageUp)"
                  >
                    <ChevronsUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void startSearchMode()}
                    className="p-1 rounded text-muted-foreground/40 hover:text-foreground hover:bg-accent/60 transition-colors"
                    title="Search history (/)"
                  >
                    <Search className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20">
                  <span className="text-[10px] font-mono text-amber-400 uppercase">
                    {terminalMode}
                  </span>
                  <button
                    type="button"
                    onClick={handleExitMode}
                    className="text-amber-400/60 hover:text-amber-400 transition-colors"
                    title="Exit mode (Esc)"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {viewMode === "terminal" && (
            <button
              type="button"
              onClick={() => void handleToggleSessionNotifications()}
              disabled={sessionNotificationPrefLoading}
              title={
                sessionNotificationEnabled === false
                  ? "Unmute notifications for this session"
                  : "Mute notifications for this session"
              }
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-colors ${
                sessionNotificationEnabled === false
                  ? "text-amber-300 bg-amber-500/10 hover:bg-amber-500/15"
                  : "text-muted-foreground/70 hover:text-foreground hover:bg-accent/60"
              } disabled:opacity-60`}
            >
              {sessionNotificationPrefLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : sessionNotificationEnabled === false ? (
                <BellOff className="h-3 w-3" />
              ) : (
                <Bell className="h-3 w-3" />
              )}
              <span className="hidden lg:inline">
                {sessionNotificationEnabled === false ? "Muted" : "Inherit"}
              </span>
            </button>
          )}

          {/* Actions toggle — only for active terminal sessions (not attach mode) */}
          {viewMode === "terminal" && !isEnded && (
            <button
              type="button"
              onClick={() => setShowActions((v) => !v)}
              title={showActions ? "Hide actions" : "Show actions"}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-colors ${
                showActions
                  ? "text-primary bg-primary/10 hover:bg-primary/15"
                  : "text-muted-foreground/60 hover:text-foreground hover:bg-accent/60"
              }`}
            >
              <Keyboard className="h-3 w-3" />
              <ChevronDown
                className={`h-3 w-3 transition-transform ${showActions ? "rotate-180" : ""}`}
              />
            </button>
          )}
        </div>
      </div>

      {/* Collapsible actions row */}
      {showActions && viewMode === "terminal" && !isEnded && (
        <div className="flex items-center gap-1 border-b border-border/60 px-2 md:px-3 py-1.5 bg-muted/20 overflow-x-auto scrollbar-none">
          {/* Key shortcuts */}
          <span className="text-[10px] text-muted-foreground/40 font-mono mr-1 shrink-0">Keys</span>
          {shortcutKeys.map((btn) => (
            <button
              type="button"
              key={btn.key}
              onClick={() => handleShortcutKey(btn.key)}
              title={btn.label}
              className="px-1.5 py-1 rounded text-[10px] font-mono text-muted-foreground/60 hover:text-foreground active:bg-accent/80 hover:bg-accent/60 transition-colors border border-transparent hover:border-border active:border-border shrink-0"
            >
              {btn.label}
            </button>
          ))}

          {/* Separator + disclaimer */}
          <div className="w-px h-4 bg-border/40 mx-1 shrink-0" />
          <span className="text-[10px] text-muted-foreground/30 font-mono shrink-0 hidden sm:inline">
            {conversationViewEnabled
              ? "Live only — use Chat for history"
              : "Live terminal controls"}
          </span>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 min-h-0 relative">
        {viewMode === "terminal" ? (
          isEnded ? (
            <SessionEndedSplash
              status={sessionStatus || "STOPPED"}
              sessionId={sessionId}
              onResume={() => window.location.reload()}
              onRecover={() => window.location.reload()}
              canReviewConversation={conversationViewEnabled}
            />
          ) : (
            <>
              {/* Loading overlay */}
              {!initialLoaded && (
                <div
                  className="absolute inset-0 z-10 flex items-center justify-center"
                  style={{ background: theme.terminal.background || "hsl(var(--background))" }}
                >
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                    <span className="text-sm font-mono">Connecting to session...</span>
                  </div>
                </div>
              )}
              {/* biome-ignore lint/a11y/noStaticElementInteractions: terminal drag-and-drop target */}
              <div
                className="relative h-full w-full px-1.5 pt-1.5 pb-2.5 md:p-2"
                onDragEnter={handleTerminalDragEnter}
                onDragOver={handleTerminalDragOver}
                onDragLeave={handleTerminalDragLeave}
                onDrop={handleTerminalDrop}
              >
                <div className="h-full w-full overflow-hidden rounded-lg border border-border/70 shadow-[0_0_0_1px_rgba(0,0,0,0.32),0_18px_38px_rgba(0,0,0,0.2)]">
                  <div
                    className="h-full w-full"
                    style={{ background: theme.terminal.background || "hsl(var(--background))" }}
                  >
                    <div
                      ref={terminalRef}
                      className="h-full w-full"
                      style={{ padding: "4px 0 0 0", touchAction: "none" }}
                      onTouchStart={handleTouchStart}
                      onTouchMove={handleTouchMove}
                      onTouchEnd={handleTouchEnd}
                    />
                  </div>
                </div>
                {dragImageActive && !IS_TOUCH_DEVICE && (
                  <div className="pointer-events-none absolute inset-3 md:inset-4 z-20 rounded-lg border border-cyan-400/60 bg-cyan-500/10 backdrop-blur-[1px] flex items-center justify-center">
                    <span className="text-xs md:text-sm font-mono text-cyan-200/90">
                      Drop image(s) to attach
                    </span>
                  </div>
                )}
              </div>
            </>
          )
        ) : viewMode === "attach" ? (
          <AttachView sessionId={sessionId} sessionStatus={sessionStatus} />
        ) : conversationViewEnabled ? (
          <ConversationView sessionId={sessionId} sessionStatus={sessionStatus} />
        ) : null}

        {viewMode === "terminal" && !isEnded && !IS_TOUCH_DEVICE && (
          <div className="pointer-events-none absolute bottom-4 right-4 z-20 flex flex-col items-end gap-2">
            {uploadingAttachment && attachmentUploadProgress !== null && (
              <div className="px-2 py-1 rounded-md text-[10px] font-mono border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 backdrop-blur-sm">
                uploading {attachmentUploadProgress}%
              </div>
            )}
            {attachmentNotice && (
              <div
                className={`px-2 py-1 rounded-md text-[10px] font-mono border backdrop-blur-sm ${
                  attachmentNotice.tone === "success"
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                    : attachmentNotice.tone === "error"
                      ? "bg-red-500/10 border-red-500/30 text-red-300"
                      : "bg-cyan-500/10 border-cyan-500/30 text-cyan-300"
                }`}
              >
                {attachmentNotice.text}
              </div>
            )}
            {hasRetryAttachment && !uploadingAttachment && (
              <button
                type="button"
                onClick={handleRetryAttachment}
                className="pointer-events-auto px-2 py-1 rounded-md text-[10px] font-mono border border-amber-500/35 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15 transition-colors"
              >
                Retry upload
              </button>
            )}
            <div className="pointer-events-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handlePasteImageFromClipboard()}
                disabled={uploadingAttachment || !canReadClipboardImages}
                title={
                  canReadClipboardImages
                    ? "Read image from clipboard"
                    : "Clipboard image read unsupported"
                }
                className="h-10 w-10 rounded-full border border-border/70 bg-card/85 text-muted-foreground/75 hover:text-foreground hover:bg-card shadow-lg shadow-black/20 backdrop-blur-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
              >
                <Clipboard className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => attachmentInputRef.current?.click()}
                disabled={uploadingAttachment}
                title={`Attach image(s) (max ${MAX_IMAGE_ATTACHMENTS_PER_BATCH} per add)`}
                className="h-10 w-10 rounded-full border border-border/70 bg-card/85 text-muted-foreground/75 hover:text-foreground hover:bg-card shadow-lg shadow-black/20 backdrop-blur-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                <Paperclip className="h-4 w-4" />
              </button>
            </div>
            <input
              ref={attachmentInputRef}
              type="file"
              multiple
              accept={IMAGE_ATTACHMENT_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length > 0) {
                  enqueueImageAttachments(files);
                }
                e.target.value = "";
              }}
            />
          </div>
        )}

        {viewMode === "terminal" && showDiagnostics && terminalDiagnostics && (
          <div className="absolute left-3 right-3 bottom-3 z-30 pointer-events-none md:left-auto md:right-3 md:w-[420px]">
            <div className="pointer-events-auto rounded-lg border border-border/70 bg-card/90 shadow-xl shadow-black/30 backdrop-blur-sm">
              <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
                <div className="text-[11px] font-mono text-foreground/90">terminal diagnostics</div>
                <button
                  type="button"
                  onClick={() => setShowDiagnostics(false)}
                  className="text-[10px] font-mono text-muted-foreground/70 hover:text-foreground transition-colors"
                  title="Hide diagnostics"
                >
                  close
                </button>
              </div>
              <div className="max-h-[40vh] overflow-auto px-3 py-2 text-[10px] font-mono text-muted-foreground/80">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  <span>captured</span>
                  <span className="text-right text-foreground/85">
                    {new Date(terminalDiagnostics.capturedAt).toLocaleTimeString()}
                  </span>
                  <span>flags</span>
                  <span className="text-right text-foreground/85">
                    paste:{terminalDiagnostics.terminal.featureWsPtyPasteEnabled ? "on" : "off"}{" "}
                    probes:{terminalDiagnostics.terminal.featureLatencyProbesEnabled ? "on" : "off"}
                  </span>
                  <span>ws state</span>
                  <span className="text-right text-foreground/85">
                    {terminalDiagnostics.ws.connected ? "connected" : "disconnected"}
                  </span>
                  <span>ws reconnect attempts</span>
                  <span className="text-right text-foreground/85">
                    {terminalDiagnostics.ws.reconnectAttempts}
                  </span>
                  <span>ws parse errors</span>
                  <span className="text-right text-foreground/85">
                    {terminalDiagnostics.ws.parseErrors}
                  </span>
                  <span>session queue</span>
                  <span className="text-right text-foreground/85">
                    {terminalDiagnostics.queueDepth.pendingInputRequests}
                  </span>
                  <span>paste queue active</span>
                  <span className="text-right text-foreground/85">
                    {terminalDiagnostics.queueDepth.hasPendingPasteQueue ? "yes" : "no"}
                  </span>
                </div>

                <div className="my-2 h-px bg-border/60" />

                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  <span>dispatch key/text/paste</span>
                  <span className="text-right text-foreground/85">
                    {terminalDiagnostics.terminal.keyDispatches}/
                    {terminalDiagnostics.terminal.textDispatches}/
                    {terminalDiagnostics.terminal.pasteDispatches}
                  </span>
                  <span>key→echo last/p95</span>
                  <span className="text-right text-foreground/85">
                    {formatLatency(terminalDiagnostics.terminal.keyToEchoLastMs)}/
                    {formatLatency(terminalDiagnostics.terminal.keyToEchoP95Ms)}
                  </span>
                  <span>scroll→paint last/p95</span>
                  <span className="text-right text-foreground/85">
                    {formatLatency(terminalDiagnostics.terminal.scrollToPaintLastMs)}/
                    {formatLatency(terminalDiagnostics.terminal.scrollToPaintP95Ms)}
                  </span>
                  <span>reconnect→resync last/p95</span>
                  <span className="text-right text-foreground/85">
                    {formatLatency(terminalDiagnostics.terminal.reconnectResyncLastMs)}/
                    {formatLatency(terminalDiagnostics.terminal.reconnectResyncP95Ms)}
                  </span>
                  <span>ws frames</span>
                  <span className="text-right text-foreground/85">
                    {terminalDiagnostics.terminal.wsFramesReceived}
                  </span>
                  <span>repaints full/inc</span>
                  <span className="text-right text-foreground/85">
                    {terminalDiagnostics.terminal.fullFrameRepaints}/
                    {terminalDiagnostics.terminal.incrementalRepaints}
                  </span>
                  <span>stale drops / seq gaps</span>
                  <span className="text-right text-foreground/85">
                    {terminalDiagnostics.terminal.staleFramesDropped}/
                    {terminalDiagnostics.terminal.seqGapEvents}
                  </span>
                  <span>replay cursor</span>
                  <span className="text-right text-foreground/85">
                    {terminalDiagnostics.terminal.replayCursorSeq}
                  </span>
                </div>

                <div className="my-2 h-px bg-border/60" />

                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  <span>pty sent in/keys/paste</span>
                  <span className="text-right text-foreground/85">
                    {terminalDiagnostics.ws.ptyInputSent}/{terminalDiagnostics.ws.ptyKeySent}/
                    {terminalDiagnostics.ws.ptyPasteSent}
                  </span>
                  <span>pty ack in/keys/paste</span>
                  <span className="text-right text-foreground/85">
                    {terminalDiagnostics.ws.ptyInputAcksReceived}/
                    {terminalDiagnostics.ws.ptyKeyAcksReceived}/
                    {terminalDiagnostics.ws.ptyPasteAcksReceived}
                  </span>
                  <span>pty err in/keys/paste</span>
                  <span className="text-right text-foreground/85">
                    {terminalDiagnostics.ws.ptyInputErrorsReceived}/
                    {terminalDiagnostics.ws.ptyKeyErrorsReceived}/
                    {terminalDiagnostics.ws.ptyPasteErrorsReceived}
                  </span>
                  <span>fallback in/keys/paste</span>
                  <span className="text-right text-foreground/85">
                    {terminalDiagnostics.ws.ptyInputFallbackTriggered}/
                    {terminalDiagnostics.ws.ptyKeyFallbackTriggered}/
                    {terminalDiagnostics.ws.ptyPasteFallbackTriggered}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input bar — hidden in attach mode */}
      {viewMode === "attach" ? null : isEnded ? (
        <div className="border-t border-border px-3 py-2.5 bg-card/80 backdrop-blur-sm">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground/50">
            <span className="font-mono text-xs">
              Session {sessionStatus === "CRASHED" ? "crashed" : "ended"}
            </span>
          </div>
        </div>
      ) : terminalMode === "scroll" ? (
        /* Scroll controls bar */
        <div className="border-t border-border px-2 md:px-4 py-2 md:py-3 bg-card/80 backdrop-blur-sm">
          <div className="flex items-center gap-1 md:gap-2">
            {/* Scroll position — compact on mobile */}
            {scrollInfo && (
              <span className="text-[10px] font-mono text-muted-foreground/50 tabular-nums shrink-0">
                {scrollInfo.position}/{scrollInfo.total}
              </span>
            )}

            {/* Navigation buttons — grouped tightly */}
            <div className="flex items-center bg-muted/30 rounded-md border border-border/40">
              <button
                type="button"
                onClick={() => handleScroll("up", { edge: "top" })}
                title="Scroll to top"
                className="h-8 w-8 flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-accent/60 rounded-l-md transition-colors"
              >
                <ChevronsUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => handleScroll("up", { page: true })}
                title="Page up"
                className="h-8 w-8 flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-accent/60 transition-colors"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => handleScroll("down", { page: true })}
                title="Page down"
                className="h-8 w-8 flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-accent/60 transition-colors"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => handleScroll("down", { edge: "bottom" })}
                title="Scroll to bottom"
                className="h-8 w-8 flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-accent/60 rounded-r-md transition-colors"
              >
                <ChevronsDown className="h-4 w-4" />
              </button>
            </div>

            {/* Search button */}
            <button
              type="button"
              onClick={() => void startSearchMode()}
              title="Search (/)"
              className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-accent/60 transition-colors shrink-0"
            >
              <Search className="h-3.5 w-3.5" />
            </button>

            <div className="flex-1" />

            {/* Exit scroll mode */}
            <button
              type="button"
              onClick={handleExitMode}
              title="Exit scroll mode (Esc)"
              className="h-8 px-2 rounded-md flex items-center gap-1 text-amber-400/70 hover:text-amber-400 bg-amber-500/5 hover:bg-amber-500/10 border border-amber-500/20 transition-colors shrink-0"
            >
              <X className="h-3.5 w-3.5" />
              <span className="text-[10px] font-mono hidden sm:inline">Esc</span>
            </button>
          </div>
        </div>
      ) : terminalMode === "search" ? (
        /* Search bar */
        <div className="border-t border-border px-2 md:px-4 py-2 md:py-3 bg-card/80 backdrop-blur-sm">
          <div className="flex items-center gap-1 md:gap-2">
            {/* Search input — takes remaining space */}
            <div className="flex-1 flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 focus-within:border-amber-500/40 px-2 py-1.5 min-w-0">
              <Search className="h-3.5 w-3.5 text-amber-400/40 shrink-0" />
              <input
                ref={searchInputRef}
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (searchQuery.trim()) {
                      handleSearch(searchQuery);
                    } else {
                      handleSearchAction("next");
                    }
                  } else if (e.key === "Enter" && e.shiftKey) {
                    e.preventDefault();
                    handleSearchAction("previous");
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    handleSearchAction("cancel");
                  }
                }}
                className="flex-1 bg-transparent text-sm font-mono text-foreground placeholder:text-muted-foreground/40 outline-none min-w-0"
              />
              {/* Position indicator inside search bar */}
              {scrollInfo && (
                <span className="text-[10px] font-mono text-muted-foreground/40 tabular-nums shrink-0">
                  {scrollInfo.position}/{scrollInfo.total}
                </span>
              )}
            </div>

            {/* Nav + cancel — grouped */}
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={() => handleSearchAction("previous")}
                title="Previous match (Shift+Enter)"
                className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-accent/60 transition-colors"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => handleSearchAction("next")}
                title="Next match (Enter)"
                className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-accent/60 transition-colors"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => handleSearchAction("cancel")}
                title="Cancel search (Esc)"
                className="h-8 w-8 rounded-md flex items-center justify-center text-amber-400/70 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : IS_TOUCH_DEVICE ? (
        <InputBar sessionId={sessionId} isEnded={isEnded} />
      ) : null}
    </div>
  );
}

// ---- Session Ended Splash ----

function SessionEndedSplash({
  status,
  sessionId,
  onResume,
  onRecover,
  canReviewConversation,
}: {
  status: string;
  sessionId: string;
  onResume: () => void;
  onRecover: () => void;
  canReviewConversation: boolean;
}) {
  const isCrashed = status === "CRASHED";
  const [resuming, setResuming] = useState(false);
  const [recovering, setRecovering] = useState(false);

  const handleResume = async () => {
    try {
      setResuming(true);
      await api.resumeSession(sessionId);
      onResume();
    } catch {
      setResuming(false);
    }
  };

  const handleRecover = async () => {
    try {
      setRecovering(true);
      await api.recoverSession(sessionId);
      onRecover();
    } catch {
      setRecovering(false);
    }
  };

  return (
    <div className="h-full w-full flex items-center justify-center px-4 bg-background">
      <div className="text-center">
        <pre
          className={`text-[10px] md:text-xs leading-tight font-mono select-none mb-4 md:mb-6 hidden sm:block ${
            isCrashed ? "text-red-500/60" : "text-muted-foreground/25"
          }`}
        >
          {isCrashed
            ? `
    ██╗  ██╗
    ╚██╗██╔╝
     ╚███╔╝
     ██╔██╗
    ██╔╝ ██╗
    ╚═╝  ╚═╝`
            : `
    ███████╗████████╗ ██████╗ ██████╗
    ██╔════╝╚══██╔══╝██╔═══██╗██╔══██╗
    ███████╗   ██║   ██║   ██║██████╔╝
    ╚════██║   ██║   ██║   ██║██╔═══╝
    ███████║   ██║   ╚██████╔╝██║
    ╚══════╝   ╚═╝    ╚═════╝ ╚═╝`}
        </pre>
        {/* Mobile: simple icon instead of ASCII art */}
        <div className="sm:hidden mb-4">
          <div
            className={`w-12 h-12 rounded-full mx-auto flex items-center justify-center ${
              isCrashed
                ? "bg-red-500/10 border border-red-500/20"
                : "bg-muted/30 border border-border"
            }`}
          >
            <span
              className={`text-lg ${isCrashed ? "text-red-400/60" : "text-muted-foreground/30"}`}
            >
              {isCrashed ? "!" : "\u25A0"}
            </span>
          </div>
        </div>
        <p
          className={`text-sm font-mono mb-2 ${isCrashed ? "text-red-400/70" : "text-muted-foreground/40"}`}
        >
          {isCrashed ? "Session crashed unexpectedly" : "Session has ended"}
        </p>
        <div className="mt-3 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={handleResume}
            disabled={resuming || recovering}
            className="px-4 py-1.5 rounded-md text-xs font-mono text-primary border border-primary/30 bg-primary/10 hover:bg-primary/15 disabled:opacity-40 transition-colors"
          >
            {resuming ? "Resuming..." : "Resume"}
          </button>
          <button
            type="button"
            onClick={handleRecover}
            disabled={resuming || recovering}
            className="px-4 py-1.5 rounded-md text-xs font-mono text-blue-300 border border-blue-400/30 bg-blue-500/10 hover:bg-blue-500/15 disabled:opacity-40 transition-colors"
          >
            {recovering ? "Recovering..." : "Recover"}
          </button>
        </div>
        {canReviewConversation && (
          <p className="text-xs text-muted-foreground/25 font-mono mt-3">
            Switch to Conversation view to review the transcript
          </p>
        )}
      </div>
    </div>
  );
}

// ---- Attach View ----

function AttachCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-muted/50 hover:bg-accent/70 border border-border text-muted-foreground hover:text-foreground transition-colors shrink-0"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-emerald-400" /> Copied!
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" /> Copy
        </>
      )}
    </button>
  );
}

function AttachCommandBlock({
  label,
  command,
  description,
}: {
  label: string;
  command: string;
  description?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 bg-muted/20">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <AttachCopyButton text={command} />
      </div>
      <div className="px-4 py-3">
        <code className="font-mono text-sm text-foreground/90 break-all">{command}</code>
      </div>
      {description && <p className="px-4 pb-3 text-xs text-muted-foreground/60">{description}</p>}
    </div>
  );
}

function AttachView({ sessionId, sessionStatus }: { sessionId: string; sessionStatus?: string }) {
  const tmuxName = `codepiper-${sessionId}`;
  const tmuxCommand = `tmux attach-session -t ${tmuxName}`;
  const tmuxDetachCommand = `tmux detach-client -s ${tmuxName}`;
  const cliCommand = `codepiper attach ${sessionId}`;

  const isAttachable =
    sessionStatus === "STARTING" ||
    sessionStatus === "RUNNING" ||
    sessionStatus === "NEEDS_PERMISSION" ||
    sessionStatus === "NEEDS_INPUT";

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="space-y-4 p-4 md:p-6 max-w-2xl">
        {/* Status banner when not attachable */}
        {!isAttachable && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2.5">
            <Monitor className="h-4 w-4 text-amber-400 shrink-0" />
            <span className="text-xs text-amber-400/80">
              Session is <span className="font-semibold">{sessionStatus}</span> — these commands are
              shown for reference but the tmux session is not currently active.
            </span>
          </div>
        )}

        {/* Primary: tmux attach */}
        <div className="space-y-1.5">
          <h2 className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
            Tmux (direct)
          </h2>
          <AttachCommandBlock
            label="Attach to tmux session"
            command={tmuxCommand}
            description={`Session name: ${tmuxName}`}
          />
          <AttachCommandBlock
            label="Detach tmux client safely"
            command={tmuxDetachCommand}
            description="Run from another terminal to detach without stopping the session"
          />
        </div>

        {/* CLI alternative */}
        <div className="space-y-1.5">
          <h2 className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
            CLI
          </h2>
          <AttachCommandBlock
            label="Attach via codepiper CLI"
            command={cliCommand}
            description="Streams via WebSocket — daemon must be running"
          />
        </div>

        {/* Tips */}
        <div className="rounded-lg border border-border/60 bg-muted/10 px-4 py-3 space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider">
            Tips
          </h3>
          <ul className="space-y-1.5 text-xs text-muted-foreground/70">
            <li className="flex items-start gap-2">
              <span className="text-primary/60 mt-0.5 shrink-0 text-[8px]">●</span>
              <span>
                To detach without stopping the session, press{" "}
                <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border font-mono text-[11px] text-foreground/80">
                  Ctrl+B
                </kbd>{" "}
                then{" "}
                <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border font-mono text-[11px] text-foreground/80">
                  D
                </kbd>
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary/60 mt-0.5 shrink-0 text-[8px]">●</span>
              <span>
                Typing <code className="font-mono">exit</code> (or pressing{" "}
                <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border font-mono text-[11px] text-foreground/80">
                  Ctrl+D
                </kbd>
                ) stops the underlying session process.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary/60 mt-0.5 shrink-0 text-[8px]">●</span>
              <span>For remote access, use SSH port forwarding:</span>
            </li>
            <li className="ml-5">
              <code className="font-mono text-xs text-primary/80 bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
                ssh user@host -t tmux attach-session -t {tmuxName}
              </code>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// ---- Conversation View ----

interface ConversationMessage {
  role: "user" | "assistant" | "system" | "command";
  content: string;
  toolUses: ToolUseBlock[];
  toolResults: ToolResultBlock[];
  timestamp: Date;
  tokens?: { input: number; output: number };
  costUsd?: number;
  model?: string;
  thinkingContent?: string;
  // Command-specific fields (role === "command")
  commandName?: string;
  commandArgs?: string;
  commandStdout?: string;
  commandStderr?: string;
}

interface ToolUseBlock {
  name: string;
  input: string;
}

interface ToolResultBlock {
  toolName: string;
  content: string;
  isError?: boolean;
}

function ConversationView({
  sessionId,
  sessionStatus,
}: {
  sessionId: string;
  sessionStatus?: string;
}) {
  const {
    events: rawEvents,
    loading,
    loadingMore,
    hasMore,
    sentinelRef,
  } = useInfiniteEvents({
    sessionId,
    source: "transcript",
    order: "desc",
    poll: true,
    pollInterval: 3000,
  });

  // parseTranscriptEvents sorts by timestamp ASC internally
  const messages = useMemo(() => parseTranscriptEvents(rawEvents), [rawEvents]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const prevMessageCountRef = useRef(0);
  const prevScrollHeightRef = useRef(0);
  const userScrolledUpRef = useRef(false);
  const initialScrollDone = useRef(false);

  // Track whether the user has scrolled away from the bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      userScrolledUpRef.current = distanceFromBottom > 60;
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // Preserve scroll position when older messages are prepended
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || loading) return;

    if (!initialScrollDone.current && messages.length > 0) {
      // Initial load — scroll to bottom
      el.scrollTop = el.scrollHeight;
      initialScrollDone.current = true;
      prevMessageCountRef.current = messages.length;
      prevScrollHeightRef.current = el.scrollHeight;
      return;
    }

    const newCount = messages.length;
    const delta = newCount - prevMessageCountRef.current;

    if (delta > 0) {
      if (userScrolledUpRef.current) {
        // Older messages were prepended -- preserve scroll position
        const heightDelta = el.scrollHeight - prevScrollHeightRef.current;
        if (heightDelta > 0) {
          el.scrollTop += heightDelta;
        }
      } else {
        // New messages at bottom -- auto-scroll
        el.scrollTop = el.scrollHeight;
      }
    }

    prevMessageCountRef.current = newCount;
    prevScrollHeightRef.current = el.scrollHeight;
  }, [messages, loading]);

  const toggleTool = (key: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          <span className="text-sm">Loading conversation...</span>
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="text-center">
          <MessageSquare className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground/60">No conversation data yet.</p>
          <p className="text-xs text-muted-foreground/40 mt-1">Send a message to get started.</p>
        </div>
      </div>
    );
  }

  const isEnded = sessionStatus === "STOPPED" || sessionStatus === "CRASHED";
  const isCrashed = sessionStatus === "CRASHED";

  return (
    <div ref={scrollRef} className="h-full overflow-auto bg-background">
      <div className="max-w-4xl mx-auto py-4 md:py-6 px-3 md:px-4 space-y-1">
        {/* Sentinel at top for loading older messages */}
        {hasMore && (
          <div ref={sentinelRef} className="flex items-center justify-center py-3">
            {loadingMore ? (
              <div className="flex items-center gap-3 text-muted-foreground">
                <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                <span className="text-xs">Loading older messages...</span>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground/30">Scroll up for more</span>
            )}
          </div>
        )}

        {messages.map((msg, idx) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: messages have no stable ID
          <div key={idx}>
            {msg.role === "user" ? (
              <UserMessage content={msg.content} timestamp={msg.timestamp} />
            ) : msg.role === "assistant" ? (
              <AssistantMessage
                content={msg.content}
                thinkingContent={msg.thinkingContent}
                toolUses={msg.toolUses}
                toolResults={msg.toolResults}
                tokens={msg.tokens}
                costUsd={msg.costUsd}
                model={msg.model}
                timestamp={msg.timestamp}
                expandedTools={expandedTools}
                onToggleTool={toggleTool}
                msgIndex={idx}
              />
            ) : msg.role === "command" ? (
              <CommandBlock
                commandName={msg.commandName || ""}
                commandArgs={msg.commandArgs}
                stdout={msg.commandStdout}
                stderr={msg.commandStderr}
                timestamp={msg.timestamp}
              />
            ) : (
              <SystemMessage content={msg.content} timestamp={msg.timestamp} />
            )}
          </div>
        ))}

        {/* Session ended marker */}
        {isEnded && messages.length > 0 && (
          <div className="pt-6 pb-2">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span
                className={`text-xs font-mono px-3 py-1 rounded-full border ${
                  isCrashed
                    ? "text-red-400/70 border-red-500/20 bg-red-500/5"
                    : "text-muted-foreground/40 border-border bg-muted/30"
                }`}
              >
                {isCrashed ? "session crashed" : "session ended"}
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function UserMessage({ content, timestamp }: { content: string; timestamp: Date }) {
  return (
    <div className="py-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-6 h-6 rounded-full bg-primary/15 border border-primary/20 flex items-center justify-center">
          <span className="text-[10px] text-primary font-bold">U</span>
        </div>
        <span className="text-sm font-semibold text-primary">You</span>
        <span className="text-[11px] text-muted-foreground/60">{formatTime(timestamp)}</span>
      </div>
      <div className="ml-8 text-sm whitespace-pre-wrap leading-relaxed">{content}</div>
    </div>
  );
}

function AssistantMessage({
  content,
  thinkingContent,
  toolUses,
  toolResults,
  tokens,
  costUsd,
  model,
  timestamp,
  expandedTools,
  onToggleTool,
  msgIndex,
}: {
  content: string;
  thinkingContent?: string;
  toolUses: ToolUseBlock[];
  toolResults: ToolResultBlock[];
  tokens?: { input: number; output: number };
  costUsd?: number;
  model?: string;
  timestamp: Date;
  expandedTools: Set<string>;
  onToggleTool: (key: string) => void;
  msgIndex: number;
}) {
  return (
    <div className="py-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-6 h-6 rounded-full bg-violet-500/15 border border-violet-500/20 flex items-center justify-center">
          <span className="text-[10px] text-violet-400 font-bold">C</span>
        </div>
        <span className="text-sm font-semibold text-violet-400">Claude</span>
        <span className="text-[11px] text-muted-foreground/60">{formatTime(timestamp)}</span>
        {model && (
          <span className="text-[10px] bg-muted/50 border border-border px-1.5 py-0.5 rounded font-mono">
            {model}
          </span>
        )}
      </div>

      <div className="ml-8 space-y-3">
        {/* Thinking block */}
        {thinkingContent && (
          <details className="group">
            <summary className="text-xs text-muted-foreground/60 cursor-pointer hover:text-muted-foreground select-none flex items-center gap-1">
              <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
              Thinking...
            </summary>
            <div className="mt-2 text-xs text-muted-foreground/70 bg-muted/30 rounded-lg p-3 border-l-2 border-violet-500/20 whitespace-pre-wrap max-h-40 overflow-auto">
              {thinkingContent}
            </div>
          </details>
        )}

        {/* Tool uses */}
        {toolUses.map((tool, tIdx) => {
          const key = `${msgIndex}-tool-${tIdx}`;
          const isExpanded = expandedTools.has(key);
          const matchingResult = toolResults[tIdx];

          return (
            <div key={key} className="rounded-lg overflow-hidden border border-border bg-muted/30">
              <button
                type="button"
                onClick={() => onToggleTool(key)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent/50 transition-colors"
              >
                <ChevronRight
                  className={`h-3 w-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`}
                />
                <span className="font-medium text-primary font-mono">{tool.name}</span>
                {matchingResult?.isError && (
                  <span className="text-red-400 text-[10px]">(error)</span>
                )}
              </button>
              {isExpanded && (
                <div className="border-t border-border">
                  <div className="px-3 py-2">
                    <div className="text-[10px] text-muted-foreground/60 mb-1 uppercase tracking-wider">
                      Input
                    </div>
                    <pre className="text-xs bg-muted p-2 rounded-md overflow-x-auto max-h-48 overflow-y-auto font-mono">
                      {tool.input}
                    </pre>
                  </div>
                  {matchingResult && (
                    <div className="px-3 py-2 border-t border-border/60">
                      <div className="text-[10px] text-muted-foreground/60 mb-1 uppercase tracking-wider">
                        Output
                      </div>
                      <pre
                        className={`text-xs p-2 rounded-md overflow-x-auto max-h-48 overflow-y-auto font-mono ${matchingResult.isError ? "bg-red-500/[0.05] text-red-300" : "bg-muted"}`}
                      >
                        {truncateContent(matchingResult.content, 2000)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Main content - rendered as Markdown */}
        {content && <MarkdownRenderer content={content} />}

        {/* Token/cost footer */}
        {tokens && (
          <div className="flex gap-3 text-[11px] text-muted-foreground/50 font-mono">
            <span>{tokens.input.toLocaleString()} in</span>
            <span>{tokens.output.toLocaleString()} out</span>
            {costUsd !== undefined && costUsd > 0 && <span>${costUsd.toFixed(4)}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function SystemMessage({ content, timestamp }: { content: string; timestamp: Date }) {
  return (
    <div className="py-2 px-3 text-xs text-muted-foreground/60 flex items-center gap-2 border-l-2 border-amber-500/20 ml-8">
      <span className="font-medium text-amber-400/80 text-[10px] uppercase tracking-wider">
        system
      </span>
      <span>{content}</span>
      <span className="ml-auto text-[10px]">{formatTime(timestamp)}</span>
    </div>
  );
}

function CommandBlock({
  commandName,
  commandArgs,
  stdout,
  stderr,
  timestamp,
}: {
  commandName: string;
  commandArgs?: string;
  stdout?: string;
  stderr?: string;
  timestamp: Date;
}) {
  return (
    <div className="py-2 ml-8">
      <div className="flex items-center gap-2">
        <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
        <code className="text-sm font-mono font-semibold text-primary">{commandName}</code>
        {commandArgs && (
          <span className="text-sm font-mono text-muted-foreground/70">{commandArgs}</span>
        )}
        <span className="text-[10px] text-muted-foreground/40 ml-auto">
          {formatTime(timestamp)}
        </span>
      </div>
      {stdout && (
        <div className="ml-5 mt-1 text-sm text-muted-foreground/80 font-mono whitespace-pre-wrap border-l-2 border-border/40 pl-3">
          {stdout}
        </div>
      )}
      {stderr && (
        <div className="ml-5 mt-1 text-sm text-red-400/80 font-mono whitespace-pre-wrap border-l-2 border-red-500/30 pl-3">
          {stderr}
        </div>
      )}
    </div>
  );
}

// ---- XML / ANSI helpers ----

/** Strip ANSI escape sequences (colors, bold, etc.) */
function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences use control chars by definition
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

/** Extract content between XML tags. Returns null if not found. */
function extractXmlTag(str: string, tagName: string): string | null {
  const open = `<${tagName}>`;
  const close = `</${tagName}>`;
  const start = str.indexOf(open);
  const end = str.indexOf(close);
  if (start === -1 || end === -1) return null;
  return str.slice(start + open.length, end).trim();
}

/** Check if a string contains a specific XML tag */
function hasXmlTag(str: string, tagName: string): boolean {
  return str.includes(`<${tagName}>`);
}

/** Strip <system-reminder> blocks from content */
function stripSystemReminders(str: string): string {
  let result = str;
  while (result.includes("<system-reminder>")) {
    const start = result.indexOf("<system-reminder>");
    const end = result.indexOf("</system-reminder>");
    if (end === -1) break;
    result = result.slice(0, start) + result.slice(end + "</system-reminder>".length);
  }
  return result.trim();
}

/** Strip <persisted-output> wrapper, keep inner text */
function cleanPersistedOutput(str: string): string {
  const inner = extractXmlTag(str, "persisted-output");
  return inner || str;
}

// ---- Parsing helpers ----

function parseTranscriptEvents(events: any[]): ConversationMessage[] {
  const messages: ConversationMessage[] = [];

  const transcriptEvents = events
    .filter((e: any) => e.source === "transcript")
    .sort((a: any, b: any) => {
      const ta = typeof a.timestamp === "string" ? new Date(a.timestamp).getTime() : a.timestamp;
      const tb = typeof b.timestamp === "string" ? new Date(b.timestamp).getTime() : b.timestamp;
      return ta - tb;
    });

  for (const event of transcriptEvents) {
    const payload = typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
    const ts =
      typeof event.timestamp === "string" ? new Date(event.timestamp) : new Date(event.timestamp);
    const type = event.type || payload.type;

    // Skip isMeta events (caveats, auto-generated prompts)
    if (payload.isMeta) continue;

    if (type === "user") {
      const rawContent = getRawStringContent(payload.message?.content || payload.content);

      // Skip local-command-caveat messages
      if (hasXmlTag(rawContent, "local-command-caveat")) continue;

      // Handle slash command messages: <command-name>/model</command-name>
      if (hasXmlTag(rawContent, "command-name")) {
        const cmdName = extractXmlTag(rawContent, "command-name") || "";
        const cmdArgs = extractXmlTag(rawContent, "command-args") || "";
        messages.push({
          role: "command",
          content: "",
          commandName: cmdName,
          commandArgs: cmdArgs || undefined,
          toolUses: [],
          toolResults: [],
          timestamp: ts,
        });
        continue;
      }

      // Handle command stdout — attach to previous command if exists
      if (hasXmlTag(rawContent, "local-command-stdout")) {
        const stdout = stripAnsi(extractXmlTag(rawContent, "local-command-stdout") || "");
        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.role === "command") {
          lastMsg.commandStdout = stdout;
        }
        continue;
      }

      // Handle command stderr — attach to previous command if exists
      if (hasXmlTag(rawContent, "local-command-stderr")) {
        const stderr = stripAnsi(extractXmlTag(rawContent, "local-command-stderr") || "");
        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.role === "command") {
          lastMsg.commandStderr = stderr;
        }
        continue;
      }

      // Regular user message
      const msgContent = payload.message?.content || payload.content;
      const content = extractTextContent(msgContent);
      if (content) {
        messages.push({
          role: "user",
          content: stripSystemReminders(content),
          toolUses: [],
          toolResults: extractToolResults(msgContent),
          timestamp: ts,
        });
      }
    } else if (type === "assistant") {
      const msgContent = payload.message?.content || payload.content;
      const textContent = extractTextContent(msgContent);
      const thinkingContent = extractThinkingContent(msgContent);
      const toolUses = extractToolUses(msgContent);
      const usage = payload.message?.usage || payload.usage;

      messages.push({
        role: "assistant",
        content: textContent,
        thinkingContent,
        toolUses,
        toolResults: [],
        timestamp: ts,
        tokens: usage
          ? {
              input: usage.input_tokens || 0,
              output: usage.output_tokens || 0,
            }
          : undefined,
        costUsd: payload.costUSD || payload.cost_usd,
        model: payload.message?.model || payload.model,
      });
    } else if (type === "system") {
      const subtype = payload.subtype;

      // Skip internal system events that aren't useful to display
      if (subtype === "turn_duration" || subtype === "stop_hook_summary") continue;

      const rawContent = payload.content || "";

      // Handle system-level local commands (e.g., /fork)
      if (subtype === "local_command") {
        if (hasXmlTag(rawContent, "command-name")) {
          const cmdName = extractXmlTag(rawContent, "command-name") || "";
          const cmdArgs = extractXmlTag(rawContent, "command-args") || "";
          messages.push({
            role: "command",
            content: "",
            commandName: cmdName,
            commandArgs: cmdArgs || undefined,
            toolUses: [],
            toolResults: [],
            timestamp: ts,
          });
          continue;
        }
        if (hasXmlTag(rawContent, "local-command-stdout")) {
          const stdout = stripAnsi(extractXmlTag(rawContent, "local-command-stdout") || "");
          const lastMsg = messages[messages.length - 1];
          if (lastMsg?.role === "command") {
            lastMsg.commandStdout = stdout;
          }
          continue;
        }
        if (hasXmlTag(rawContent, "local-command-stderr")) {
          const stderr = stripAnsi(extractXmlTag(rawContent, "local-command-stderr") || "");
          const lastMsg = messages[messages.length - 1];
          if (lastMsg?.role === "command") {
            lastMsg.commandStderr = stderr;
          }
          continue;
        }
      }

      // Compact boundary
      if (subtype === "compact_boundary") {
        messages.push({
          role: "system",
          content: "Conversation compacted",
          toolUses: [],
          toolResults: [],
          timestamp: ts,
        });
        continue;
      }

      // Generic system message
      const content = extractTextContent(
        payload.message?.content || payload.content || payload.text
      );
      if (content) {
        messages.push({
          role: "system",
          content: stripSystemReminders(content),
          toolUses: [],
          toolResults: [],
          timestamp: ts,
        });
      }
    }
  }

  return messages;
}

/** Get raw string content from message.content (string or array) for XML tag detection */
function getRawStringContent(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item: any) => {
        if (typeof item === "string") return item;
        if (item.type === "text") return item.text || "";
        if (item.type === "tool_result" && typeof item.content === "string") return item.content;
        return "";
      })
      .join("\n");
  }
  return "";
}

function extractTextContent(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .filter((item: any) => item.type === "text")
      .map((item: any) => item.text || "")
      .join("\n")
      .trim();
  }

  if (typeof content === "object" && content !== null && "text" in content) {
    return (content as any).text;
  }

  return "";
}

function extractThinkingContent(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;

  const thinking = content
    .filter((item: any) => item.type === "thinking")
    .map((item: any) => item.thinking || item.text || "")
    .join("\n")
    .trim();

  return thinking || undefined;
}

function extractToolUses(content: unknown): ToolUseBlock[] {
  if (!Array.isArray(content)) return [];

  return content
    .filter((item: any) => item.type === "tool_use")
    .map((item: any) => ({
      name: item.name || "unknown",
      input: typeof item.input === "string" ? item.input : JSON.stringify(item.input, null, 2),
    }));
}

function extractToolResults(content: unknown): ToolResultBlock[] {
  if (!Array.isArray(content)) return [];

  return content
    .filter((item: any) => item.type === "tool_result")
    .map((item: any) => {
      let resultContent = "";
      if (typeof item.content === "string") {
        resultContent = item.content;
      } else if (Array.isArray(item.content)) {
        resultContent = item.content
          .map((c: any) => (typeof c === "string" ? c : c.text || JSON.stringify(c)))
          .join("\n");
      }

      // Clean up special wrappers
      resultContent = stripSystemReminders(resultContent);
      if (hasXmlTag(resultContent, "persisted-output")) {
        resultContent = cleanPersistedOutput(resultContent);
      }

      return {
        toolName: item.tool_use_id || "unknown",
        content: resultContent,
        isError: item.is_error,
      };
    });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function truncateContent(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen)}\n... (truncated)`;
}
