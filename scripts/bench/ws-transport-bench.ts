#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ProviderEvent } from "@codepiper/core";
import { EventBus } from "@codepiper/core";
import { WebSocketManager, WS_PROTOCOL_VERSION } from "../../packages/daemon/src/api/ws";
import { PTYProcess } from "../../packages/daemon/src/sessions/ptyProcess";
import { TmuxSession } from "../../packages/daemon/src/sessions/tmuxSession";

const DEFAULT_SESSION_ID = "bench-session";
const DEFAULT_TOPIC = `session:${DEFAULT_SESSION_ID}:pty`;
const SAFE_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TZ",
] as const;

interface Scenario {
  name: string;
  frames: string[];
}

interface BenchResult {
  bytes: number;
  elapsedMs: number;
  ptyOutputFrames: number;
  ptyPatchFrames: number;
  ptyBinaryFrames: number;
}

interface LatencyProbeResult {
  sampleCount: number;
  completedSamples: number;
  timedOutSamples: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  avgMs: number;
}

interface RuntimeTerminalTelemetrySnapshot {
  keyToEchoP50Ms?: number | null;
  keyToEchoP95Ms?: number | null;
  keyToEchoSamples?: number;
  scrollToPaintP50Ms?: number | null;
  scrollToPaintP95Ms?: number | null;
  scrollToPaintSamples?: number;
  reconnectResyncP50Ms?: number | null;
  reconnectResyncP95Ms?: number | null;
  reconnectResyncSamples?: number;
}

interface ComparableLatencyProbeSet {
  keyToEcho: LatencyProbeResult | null;
  scrollToPaint: LatencyProbeResult | null;
  reconnectResync: LatencyProbeResult | null;
}

interface CliOptions {
  json: boolean;
  runtimeTelemetryPath: string | null;
  artifactDir: string | null;
  artifactLabel: string | null;
  bunPtyPrototype: boolean;
}

interface GitMetadata {
  branch: string | null;
  commit: string | null;
}

interface BenchSummary {
  generatedAt: string;
  git: GitMetadata;
  comparableProbes: ComparableLatencyProbeSet;
  replayRecovery: ReplayRecoveryResult;
  runtimeTelemetry: RuntimeTerminalTelemetrySnapshot | null;
  bunPtyPrototype: BunPtyPrototypeResult | null;
}

interface ReplayRecoveryResult {
  expectedReplayFrames: number;
  recoveredReplayFrames: number;
  replayGapCount: number;
  firstReplayMs: number;
  totalReplayMs: number;
  replayOutputFrames: number;
  replayPatchFrames: number;
}

interface BunPtyPrototypeResult {
  attempted: boolean;
  supported: boolean;
  timedOut: boolean;
  bytesReceived: number;
  chunksReceived: number;
  elapsedMs: number;
  throughputMiBPerSecond: number;
  error?: string;
}

interface PtyOutputMessage {
  topic: string;
  type: "pty_output";
  data: string;
  seq: number;
}

interface PtyPatchMessage {
  topic: string;
  type: "pty_patch";
  baseSeq: number;
  seq: number;
  start: number;
  deleteCount: number;
  data: string;
}

type PtyWireMessage = PtyOutputMessage | PtyPatchMessage;

class BenchWebSocket {
  public readyState = 1; // OPEN
  public sentBytes = 0;
  public ptyOutputFrames = 0;
  public ptyPatchFrames = 0;
  public ptyBinaryFrames = 0;
  public lastPtySeq = 0;

  constructor(
    private readonly topic: string,
    private readonly onPtyMessage?: (message: PtyWireMessage) => void
  ) {}

  send(data: string | Uint8Array | Buffer): number {
    const bytes =
      typeof data === "string"
        ? Buffer.byteLength(data, "utf-8")
        : data instanceof Uint8Array
          ? data.byteLength
          : data.byteLength;
    this.sentBytes += bytes;

    const message = parsePtyWireMessage(data);
    if (!message || message.topic !== this.topic) {
      return bytes;
    }

    this.lastPtySeq = message.seq;
    if (typeof data !== "string") {
      this.ptyBinaryFrames += 1;
    }
    if (message.type === "pty_patch") {
      this.ptyPatchFrames += 1;
    } else {
      this.ptyOutputFrames += 1;
    }

    this.onPtyMessage?.(message);
    return bytes;
  }

  close(): void {
    this.readyState = 3; // CLOSED
  }
}

function parsePtyWireMessage(data: string | Uint8Array | Buffer): PtyWireMessage | null {
  if (typeof data !== "string") {
    return decodeBinaryPtyFrame(data);
  }

  try {
    const message = JSON.parse(data) as Record<string, unknown>;
    if (typeof message.topic !== "string" || typeof message.seq !== "number") {
      return null;
    }
    if (message.type === "pty_output" && typeof message.data === "string") {
      return {
        topic: message.topic,
        type: "pty_output",
        data: message.data,
        seq: message.seq,
      };
    }
    if (
      message.type === "pty_patch" &&
      typeof message.baseSeq === "number" &&
      typeof message.start === "number" &&
      typeof message.deleteCount === "number" &&
      typeof message.data === "string"
    ) {
      return {
        topic: message.topic,
        type: "pty_patch",
        baseSeq: message.baseSeq,
        start: message.start,
        deleteCount: message.deleteCount,
        data: message.data,
        seq: message.seq,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function decodeBinaryPtyFrame(data: Uint8Array | Buffer): PtyWireMessage | null {
  const bytes =
    data instanceof Uint8Array
      ? data
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (bytes.byteLength < 14) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint8(0);
  const version = view.getUint8(1);
  const frameType = view.getUint8(2);
  if (magic !== 0x43 || version !== 1) {
    return null;
  }

  const topicLength = view.getUint16(4, true);
  const seq = view.getUint32(6, true);
  let offset = 10;
  const topicEnd = offset + topicLength;
  if (topicEnd > bytes.byteLength) {
    return null;
  }

  const decoder = new TextDecoder();
  const topic = decoder.decode(bytes.subarray(offset, topicEnd));
  offset = topicEnd;

  if (frameType === 1) {
    if (offset + 4 > bytes.byteLength) {
      return null;
    }
    const dataLength = view.getUint32(offset, true);
    offset += 4;
    const dataEnd = offset + dataLength;
    if (dataEnd !== bytes.byteLength) {
      return null;
    }
    return {
      topic,
      type: "pty_output",
      seq,
      data: decoder.decode(bytes.subarray(offset, dataEnd)),
    };
  }

  if (frameType === 2) {
    if (offset + 16 > bytes.byteLength) {
      return null;
    }
    const baseSeq = view.getUint32(offset, true);
    offset += 4;
    const start = view.getUint32(offset, true);
    offset += 4;
    const deleteCount = view.getUint32(offset, true);
    offset += 4;
    const dataLength = view.getUint32(offset, true);
    offset += 4;
    const dataEnd = offset + dataLength;
    if (dataEnd !== bytes.byteLength) {
      return null;
    }
    return {
      topic,
      type: "pty_patch",
      baseSeq,
      seq,
      start,
      deleteCount,
      data: decoder.decode(bytes.subarray(offset, dataEnd)),
    };
  }

  return null;
}

function createBaseScreen(rows: number, cols: number): string {
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const prefix = `${String(r + 1).padStart(2, "0")} `;
    const fill = ".".repeat(Math.max(0, cols - prefix.length));
    lines.push(`${prefix}${fill}`);
  }
  return `${lines.join("\n")}\n`;
}

function generateTypingFrames(count: number, startAt = 0): string[] {
  const base = createBaseScreen(28, 120);
  const frames: string[] = [];
  for (let i = 0; i < count; i++) {
    const suffix = `typing-${String(i + startAt).padStart(3, "0")}`;
    frames.push(`${base}${suffix}`);
  }
  return frames;
}

function generateAppendFrames(count: number): string[] {
  const prefix = createBaseScreen(12, 80);
  const frames: string[] = [];
  let tail = "";
  for (let i = 0; i < count; i++) {
    tail += `[${String(i).padStart(3, "0")}] output line ${"x".repeat(24)}\n`;
    frames.push(`${prefix}${tail}`);
  }
  return frames;
}

function generateChurnFrames(count: number): string[] {
  const rows = 26;
  const cols = 100;
  const frames: string[] = [];
  let state = 7;

  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state;
  };

  for (let i = 0; i < count; i++) {
    const chars: string[] = [];
    for (let j = 0; j < rows * cols; j++) {
      const code = 33 + (rand() % 94);
      chars.push(String.fromCharCode(code));
    }

    const lines: string[] = [];
    for (let r = 0; r < rows; r++) {
      lines.push(chars.slice(r * cols, (r + 1) * cols).join(""));
    }
    frames.push(`${lines.join("\n")}\n`);
  }

  return frames;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarizeLatencySamples(
  samples: number[],
  sampleCount: number,
  timedOutSamples: number
): LatencyProbeResult {
  return {
    sampleCount,
    completedSamples: samples.length,
    timedOutSamples,
    minMs: samples.length > 0 ? Math.min(...samples) : 0,
    p50Ms: percentile(samples, 50),
    p95Ms: percentile(samples, 95),
    maxMs: samples.length > 0 ? Math.max(...samples) : 0,
    avgMs: average(samples),
  };
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    json: false,
    runtimeTelemetryPath: null,
    artifactDir: null,
    artifactLabel: null,
    bunPtyPrototype: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--bun-pty-prototype") {
      options.bunPtyPrototype = true;
      continue;
    }
    if (arg === "--runtime-telemetry") {
      const next = argv[i + 1];
      if (next) {
        options.runtimeTelemetryPath = next;
        i += 1;
      }
      continue;
    }
    if (arg === "--artifact-dir") {
      const next = argv[i + 1];
      if (next) {
        options.artifactDir = next;
        i += 1;
      }
      continue;
    }
    if (arg === "--artifact-label") {
      const next = argv[i + 1];
      if (next) {
        options.artifactLabel = next;
        i += 1;
      }
    }
  }

  return options;
}

function runGit(args: string[]): string | null {
  const proc = Bun.spawnSync(["git", ...args], {
    stdout: "pipe",
    stderr: "ignore",
  });
  if (proc.exitCode !== 0) {
    return null;
  }
  const output = new TextDecoder().decode(proc.stdout).trim();
  return output || null;
}

function collectGitMetadata(): GitMetadata {
  return {
    branch: runGit(["branch", "--show-current"]),
    commit: runGit(["rev-parse", "--short", "HEAD"]),
  };
}

function sanitizeArtifactLabel(label: string | null): string {
  if (!label) {
    return "";
  }
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function formatArtifactTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function writeBenchmarkArtifact(
  artifactDir: string,
  summary: BenchSummary,
  label: string | null
): Promise<string> {
  mkdirSync(artifactDir, { recursive: true });
  const safeLabel = sanitizeArtifactLabel(label);
  const timestamp = formatArtifactTimestamp(new Date(summary.generatedAt));
  const commit = summary.git.commit ?? "no-git";
  const filename = safeLabel
    ? `ws-transport-${timestamp}-${commit}-${safeLabel}.json`
    : `ws-transport-${timestamp}-${commit}.json`;
  const artifactPath = join(artifactDir, filename);
  await Bun.write(artifactPath, `${JSON.stringify(summary, null, 2)}\n`);
  return artifactPath;
}

function normalizeRuntimeTelemetry(
  raw: Record<string, unknown> | null
): RuntimeTerminalTelemetrySnapshot | null {
  if (!raw) {
    return null;
  }

  const hasProbeShape =
    "keyToEchoP50Ms" in raw || "scrollToPaintP50Ms" in raw || "reconnectResyncP50Ms" in raw;
  if (!hasProbeShape) {
    for (const value of Object.values(raw)) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        continue;
      }
      const nested = value as Record<string, unknown>;
      if (
        "keyToEchoP50Ms" in nested ||
        "scrollToPaintP50Ms" in nested ||
        "reconnectResyncP50Ms" in nested
      ) {
        return normalizeRuntimeTelemetry(nested);
      }
    }
    return null;
  }

  const asNumberOrNull = (value: unknown): number | null => {
    if (value === null) {
      return null;
    }
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };

  const asNumberOrUndefined = (value: unknown): number | undefined => {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };

  return {
    keyToEchoP50Ms: asNumberOrNull(raw.keyToEchoP50Ms),
    keyToEchoP95Ms: asNumberOrNull(raw.keyToEchoP95Ms),
    keyToEchoSamples: asNumberOrUndefined(raw.keyToEchoSamples),
    scrollToPaintP50Ms: asNumberOrNull(raw.scrollToPaintP50Ms),
    scrollToPaintP95Ms: asNumberOrNull(raw.scrollToPaintP95Ms),
    scrollToPaintSamples: asNumberOrUndefined(raw.scrollToPaintSamples),
    reconnectResyncP50Ms: asNumberOrNull(raw.reconnectResyncP50Ms),
    reconnectResyncP95Ms: asNumberOrNull(raw.reconnectResyncP95Ms),
    reconnectResyncSamples: asNumberOrUndefined(raw.reconnectResyncSamples),
  };
}

async function loadRuntimeTelemetry(
  runtimeTelemetryPath: string | null
): Promise<RuntimeTerminalTelemetrySnapshot | null> {
  if (!runtimeTelemetryPath) {
    return null;
  }

  try {
    const file = Bun.file(runtimeTelemetryPath);
    if (!(await file.exists())) {
      return null;
    }
    const parsed = (await file.json()) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return normalizeRuntimeTelemetry(parsed as Record<string, unknown>);
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSafeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = process.env[key];
    if (value) {
      env[key] = value;
    }
  }
  return env;
}

async function hasTmux(): Promise<boolean> {
  const proc = Bun.spawn(["tmux", "-V"], {
    stdout: "ignore",
    stderr: "ignore",
  });
  return (await proc.exited) === 0;
}

async function probeBunPtyPrototype(
  lineCount = 6000,
  timeoutMs = 12_000
): Promise<BunPtyPrototypeResult> {
  const payload = "x".repeat(96);
  const script = `i=1; while [ "$i" -le ${lineCount} ]; do printf 'CP_BUN_PTY_%05d ${payload}\\n' "$i"; i=$((i+1)); done`;

  let bytesReceived = 0;
  let chunksReceived = 0;
  let timedOut = false;
  let processHandle: PTYProcess | null = null;
  const startedAt = performance.now();

  const exited = new Promise<{ exitCode: number; signal: string | null }>((resolve) => {
    try {
      processHandle = new PTYProcess({
        command: ["sh", "-lc", script],
        cwd: process.cwd(),
        env: buildSafeEnv(),
        cols: 120,
        rows: 30,
        onData: (chunk) => {
          bytesReceived += Buffer.byteLength(chunk, "utf-8");
          chunksReceived += 1;
        },
        onExit: (exitCode, signal) => resolve({ exitCode, signal }),
      });
    } catch (error) {
      resolve({
        exitCode: 1,
        signal: error instanceof Error ? error.message : "spawn_error",
      });
    }
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    void processHandle?.kill("SIGTERM");
  }, timeoutMs);

  const { exitCode, signal } = await exited;
  clearTimeout(timeout);
  const elapsedMs = Math.max(0, performance.now() - startedAt);
  const throughputMiBPerSecond =
    elapsedMs > 0 ? bytesReceived / (1024 * 1024) / (elapsedMs / 1000) : 0;

  if (signal && exitCode !== 0 && signal !== "SIGTERM") {
    return {
      attempted: true,
      supported: false,
      timedOut,
      bytesReceived,
      chunksReceived,
      elapsedMs,
      throughputMiBPerSecond,
      error: signal,
    };
  }

  return {
    attempted: true,
    supported: true,
    timedOut,
    bytesReceived,
    chunksReceived,
    elapsedMs,
    throughputMiBPerSecond,
    ...(exitCode !== 0 && !timedOut ? { error: `exit code ${exitCode}` } : {}),
  };
}

function runScenario(
  scenario: Scenario,
  opts: {
    enablePtyPatch: boolean;
    enablePtyBinary: boolean;
    clientSupportsPtyPatch: boolean;
    clientSupportsPtyBinary: boolean;
  }
): BenchResult {
  const eventBus = new EventBus<{ "session:event": ProviderEvent }>();
  const wsManager = new WebSocketManager(eventBus, {
    enablePtyPatch: opts.enablePtyPatch,
    enablePtyBinary: opts.enablePtyBinary,
  });

  try {
    const ws = new BenchWebSocket(DEFAULT_TOPIC);
    wsManager.handleConnection(ws as unknown as any);
    wsManager.handleMessage(ws as unknown as any, {
      op: "hello",
      version: WS_PROTOCOL_VERSION,
      supports: {
        ptyPatch: opts.clientSupportsPtyPatch,
        ptyBinary: opts.clientSupportsPtyBinary,
      },
    });
    wsManager.handleMessage(ws as unknown as any, {
      op: "subscribe",
      topic: DEFAULT_TOPIC,
    });

    const start = performance.now();
    for (const frame of scenario.frames) {
      wsManager.broadcastPtyData(DEFAULT_SESSION_ID, frame);
    }
    const elapsedMs = performance.now() - start;

    return {
      bytes: ws.sentBytes,
      elapsedMs,
      ptyOutputFrames: ws.ptyOutputFrames,
      ptyPatchFrames: ws.ptyPatchFrames,
      ptyBinaryFrames: ws.ptyBinaryFrames,
    };
  } finally {
    wsManager.shutdown();
  }
}

async function probeKeystrokeToEchoLatency(sampleCount = 15): Promise<LatencyProbeResult | null> {
  if (!(await hasTmux())) {
    return null;
  }

  const sessionId = `bench-latency-${randomUUID()}`;
  const topic = `session:${sessionId}:pty`;
  const eventBus = new EventBus<{ "session:event": ProviderEvent }>();
  const wsManager = new WebSocketManager(eventBus, { enablePtyPatch: false });
  const tokenLatencies = new Map<
    string,
    {
      startedAt: number;
      resolve: (latencyMs: number) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  const samples: number[] = [];
  let timedOutSamples = 0;

  const ws = new BenchWebSocket(topic, (message) => {
    if (message.type !== "pty_output") {
      return;
    }

    for (const [token, pending] of tokenLatencies) {
      if (!message.data.includes(token)) {
        continue;
      }
      clearTimeout(pending.timeout);
      tokenLatencies.delete(token);
      pending.resolve(performance.now() - pending.startedAt);
    }
  });

  const tmuxSession = new TmuxSession({
    sessionName: sessionId,
    command: ["bash", "--noprofile", "--norc"],
    cwd: process.cwd(),
    env: buildSafeEnv(),
    cols: 120,
    rows: 30,
    onData: (data) => wsManager.broadcastPtyData(sessionId, data),
  });

  try {
    wsManager.handleConnection(ws as unknown as any);
    wsManager.handleMessage(ws as unknown as any, {
      op: "hello",
      version: WS_PROTOCOL_VERSION,
    });
    wsManager.handleMessage(ws as unknown as any, {
      op: "subscribe",
      topic,
    });

    await tmuxSession.create();
    tmuxSession.write("export PS1=''\n");
    await sleep(200);

    for (let i = 0; i < sampleCount; i++) {
      const token = `CP_BENCH_${Date.now()}_${i}`;
      const latency = await new Promise<number | null>((resolve) => {
        const timeout = setTimeout(() => {
          tokenLatencies.delete(token);
          timedOutSamples += 1;
          resolve(null);
        }, 5000);

        tokenLatencies.set(token, {
          startedAt: performance.now(),
          resolve: (latencyMs) => resolve(latencyMs),
          timeout,
        });

        tmuxSession.write(`echo ${token}\n`);
      });

      if (latency !== null) {
        samples.push(latency);
      }
      await sleep(80);
    }

    return summarizeLatencySamples(samples, sampleCount, timedOutSamples);
  } finally {
    for (const pending of tokenLatencies.values()) {
      clearTimeout(pending.timeout);
    }
    tokenLatencies.clear();
    try {
      await tmuxSession.kill();
    } catch {
      // best-effort cleanup
    }
    wsManager.shutdown();
  }
}

async function probeScrollToPaintLatency(sampleCount = 15): Promise<LatencyProbeResult | null> {
  if (!(await hasTmux())) {
    return null;
  }

  const sessionId = `bench-scroll-${randomUUID()}`;
  const tmuxSession = new TmuxSession({
    sessionName: sessionId,
    command: ["bash", "--noprofile", "--norc"],
    cwd: process.cwd(),
    env: buildSafeEnv(),
    cols: 120,
    rows: 30,
    onData: () => {
      // no-op: this probe measures scroll command -> refreshed pane snapshot.
    },
  });

  const samples: number[] = [];
  let timedOutSamples = 0;

  try {
    await tmuxSession.create();
    tmuxSession.write("export PS1=''\n");
    await sleep(150);

    for (let i = 0; i < 180; i++) {
      tmuxSession.write(`echo SCROLL_BENCH_${i}\n`);
    }
    await sleep(350);

    for (let i = 0; i < sampleCount; i++) {
      const startedAt = performance.now();
      try {
        await tmuxSession.scroll("up", 1);
        await tmuxSession.capturePane();
        samples.push(performance.now() - startedAt);
      } catch {
        timedOutSamples += 1;
      }
      await sleep(40);
    }

    return summarizeLatencySamples(samples, sampleCount, timedOutSamples);
  } finally {
    try {
      await tmuxSession.scrollToEdge("bottom");
    } catch {
      // best-effort cleanup
    }
    try {
      await tmuxSession.kill();
    } catch {
      // best-effort cleanup
    }
  }
}

function probeReconnectReplayRecovery(): ReplayRecoveryResult {
  const sessionId = `bench-replay-${randomUUID()}`;
  const topic = `session:${sessionId}:pty`;
  const initialFrames = generateTypingFrames(80, 0);
  const missedFrames = generateTypingFrames(40, initialFrames.length);

  const eventBus = new EventBus<{ "session:event": ProviderEvent }>();
  const wsManager = new WebSocketManager(eventBus, { enablePtyPatch: true });

  try {
    const liveWs = new BenchWebSocket(topic);
    wsManager.handleConnection(liveWs as unknown as any);
    wsManager.handleMessage(liveWs as unknown as any, {
      op: "hello",
      version: WS_PROTOCOL_VERSION,
      supports: { ptyPatch: true },
    });
    wsManager.handleMessage(liveWs as unknown as any, {
      op: "subscribe",
      topic,
    });

    for (const frame of initialFrames) {
      wsManager.broadcastPtyData(sessionId, frame);
    }
    const sinceSeq = liveWs.lastPtySeq;
    wsManager.handleDisconnect(liveWs as unknown as any);

    for (const frame of missedFrames) {
      wsManager.broadcastPtyData(sessionId, frame);
    }

    let firstReplayMs = 0;
    const replaySeqs: number[] = [];
    const start = performance.now();
    const replayWs = new BenchWebSocket(topic, (message) => {
      if (message.seq <= sinceSeq) {
        return;
      }
      if (firstReplayMs === 0) {
        firstReplayMs = performance.now() - start;
      }
      replaySeqs.push(message.seq);
    });

    wsManager.handleConnection(replayWs as unknown as any);
    wsManager.handleMessage(replayWs as unknown as any, {
      op: "subscribe",
      topic,
      sinceSeq,
    });
    const totalReplayMs = performance.now() - start;

    let replayGapCount = 0;
    for (let i = 0; i < replaySeqs.length; i++) {
      const expectedSeq = sinceSeq + i + 1;
      if (replaySeqs[i] !== expectedSeq) {
        replayGapCount += 1;
      }
    }

    return {
      expectedReplayFrames: missedFrames.length,
      recoveredReplayFrames: replaySeqs.length,
      replayGapCount,
      firstReplayMs,
      totalReplayMs,
      replayOutputFrames: replayWs.ptyOutputFrames,
      replayPatchFrames: replayWs.ptyPatchFrames,
    };
  } finally {
    wsManager.shutdown();
  }
}

function probeReconnectResyncLatency(sampleCount = 15): LatencyProbeResult {
  const samples: number[] = [];
  let timedOutSamples = 0;

  for (let i = 0; i < sampleCount; i++) {
    const result = probeReconnectReplayRecovery();
    if (result.recoveredReplayFrames === 0 || result.replayGapCount > 0) {
      timedOutSamples += 1;
      continue;
    }
    samples.push(result.firstReplayMs);
  }

  return summarizeLatencySamples(samples, sampleCount, timedOutSamples);
}

function printScenarioSummary(scenario: Scenario): void {
  const full = runScenario(scenario, {
    enablePtyPatch: false,
    enablePtyBinary: false,
    clientSupportsPtyPatch: false,
    clientSupportsPtyBinary: false,
  });
  const patchNegotiated = runScenario(scenario, {
    enablePtyPatch: true,
    enablePtyBinary: false,
    clientSupportsPtyPatch: true,
    clientSupportsPtyBinary: false,
  });
  const patchNotNegotiated = runScenario(scenario, {
    enablePtyPatch: true,
    enablePtyBinary: false,
    clientSupportsPtyPatch: false,
    clientSupportsPtyBinary: false,
  });
  const binaryOnlyNegotiated = runScenario(scenario, {
    enablePtyPatch: false,
    enablePtyBinary: true,
    clientSupportsPtyPatch: false,
    clientSupportsPtyBinary: true,
  });
  const patchBinaryNegotiated = runScenario(scenario, {
    enablePtyPatch: true,
    enablePtyBinary: true,
    clientSupportsPtyPatch: true,
    clientSupportsPtyBinary: true,
  });
  const binaryNotNegotiated = runScenario(scenario, {
    enablePtyPatch: true,
    enablePtyBinary: true,
    clientSupportsPtyPatch: true,
    clientSupportsPtyBinary: false,
  });

  const savingsBytes = full.bytes - patchNegotiated.bytes;
  const savingsPct = full.bytes === 0 ? 0 : (savingsBytes / full.bytes) * 100;
  const binarySavingsBytes = full.bytes - binaryOnlyNegotiated.bytes;
  const binarySavingsPct = full.bytes === 0 ? 0 : (binarySavingsBytes / full.bytes) * 100;
  const patchBinarySavingsBytes = full.bytes - patchBinaryNegotiated.bytes;
  const patchBinarySavingsPct = full.bytes === 0 ? 0 : (patchBinarySavingsBytes / full.bytes) * 100;

  console.log(`\nScenario: ${scenario.name}`);
  console.log(
    `  Full transport:        ${full.bytes.toLocaleString()} bytes, ${full.elapsedMs.toFixed(
      2
    )}ms, pty_output=${full.ptyOutputFrames}, pty_patch=${full.ptyPatchFrames}, pty_binary=${full.ptyBinaryFrames}`
  );
  console.log(
    `  Patch negotiated:      ${patchNegotiated.bytes.toLocaleString()} bytes, ${patchNegotiated.elapsedMs.toFixed(
      2
    )}ms, pty_output=${patchNegotiated.ptyOutputFrames}, pty_patch=${patchNegotiated.ptyPatchFrames}, pty_binary=${patchNegotiated.ptyBinaryFrames}`
  );
  console.log(
    `  Patch not negotiated:  ${patchNotNegotiated.bytes.toLocaleString()} bytes, ${patchNotNegotiated.elapsedMs.toFixed(
      2
    )}ms, pty_output=${patchNotNegotiated.ptyOutputFrames}, pty_patch=${patchNotNegotiated.ptyPatchFrames}, pty_binary=${patchNotNegotiated.ptyBinaryFrames}`
  );
  console.log(
    `  Savings vs full:       ${savingsBytes.toLocaleString()} bytes (${savingsPct.toFixed(2)}%)`
  );
  console.log(
    `  Binary only negotiated:${binaryOnlyNegotiated.bytes.toLocaleString()} bytes, ${binaryOnlyNegotiated.elapsedMs.toFixed(
      2
    )}ms, pty_output=${binaryOnlyNegotiated.ptyOutputFrames}, pty_patch=${binaryOnlyNegotiated.ptyPatchFrames}, pty_binary=${binaryOnlyNegotiated.ptyBinaryFrames}`
  );
  console.log(
    `  Patch+binary negotiated:${patchBinaryNegotiated.bytes.toLocaleString()} bytes, ${patchBinaryNegotiated.elapsedMs.toFixed(
      2
    )}ms, pty_output=${patchBinaryNegotiated.ptyOutputFrames}, pty_patch=${patchBinaryNegotiated.ptyPatchFrames}, pty_binary=${patchBinaryNegotiated.ptyBinaryFrames}`
  );
  console.log(
    `  Binary not negotiated: ${binaryNotNegotiated.bytes.toLocaleString()} bytes, ${binaryNotNegotiated.elapsedMs.toFixed(
      2
    )}ms, pty_output=${binaryNotNegotiated.ptyOutputFrames}, pty_patch=${binaryNotNegotiated.ptyPatchFrames}, pty_binary=${binaryNotNegotiated.ptyBinaryFrames}`
  );
  console.log(
    `  Binary savings vs full:${binarySavingsBytes.toLocaleString()} bytes (${binarySavingsPct.toFixed(2)}%)`
  );
  console.log(
    `  Patch+binary savings:  ${patchBinarySavingsBytes.toLocaleString()} bytes (${patchBinarySavingsPct.toFixed(2)}%)`
  );
}

function printReplayRecoverySummary(result: ReplayRecoveryResult): void {
  console.log("\nReplay recovery probe:");
  console.log(
    `  recovered:             ${result.recoveredReplayFrames}/${result.expectedReplayFrames} frames`
  );
  console.log(`  replay gaps:           ${result.replayGapCount}`);
  console.log(`  first replay frame:    ${result.firstReplayMs.toFixed(3)}ms`);
  console.log(`  total replay time:     ${result.totalReplayMs.toFixed(3)}ms`);
  console.log(
    `  replay frame types:    pty_output=${result.replayOutputFrames}, pty_patch=${result.replayPatchFrames}`
  );
}

function printLatencySummary(result: LatencyProbeResult | null): void {
  console.log("\nKeystroke-to-echo probe:");
  if (!result) {
    console.log("  skipped: tmux not available in this environment");
    return;
  }

  console.log(`  samples:               ${result.completedSamples}/${result.sampleCount}`);
  console.log(`  timeouts:              ${result.timedOutSamples}`);
  console.log(
    `  min / p50 / p95 / max: ${result.minMs.toFixed(2)} / ${result.p50Ms.toFixed(2)} / ${result.p95Ms.toFixed(2)} / ${result.maxMs.toFixed(2)} ms`
  );
  console.log(`  average:               ${result.avgMs.toFixed(2)} ms`);
}

function printComparableLatencySummary(probes: ComparableLatencyProbeSet): void {
  const rows: Array<{ label: string; result: LatencyProbeResult | null }> = [
    { label: "key->echo", result: probes.keyToEcho },
    { label: "scroll->paint", result: probes.scrollToPaint },
    { label: "reconnect->resync", result: probes.reconnectResync },
  ];

  console.log("\nComparable latency summary (matches runtime probe naming):");
  for (const row of rows) {
    if (!row.result) {
      console.log(`  ${row.label.padEnd(18)} skipped`);
      continue;
    }
    console.log(
      `  ${row.label.padEnd(18)} p50=${row.result.p50Ms.toFixed(2)}ms p95=${row.result.p95Ms.toFixed(2)}ms samples=${row.result.completedSamples}/${row.result.sampleCount}`
    );
  }
}

function printRuntimeCorrelationSummary(
  probes: ComparableLatencyProbeSet,
  runtime: RuntimeTerminalTelemetrySnapshot | null
): void {
  if (!runtime) {
    return;
  }

  const rows = [
    {
      label: "key->echo",
      bench: probes.keyToEcho,
      runtimeP50: runtime.keyToEchoP50Ms,
      runtimeP95: runtime.keyToEchoP95Ms,
      runtimeSamples: runtime.keyToEchoSamples,
    },
    {
      label: "scroll->paint",
      bench: probes.scrollToPaint,
      runtimeP50: runtime.scrollToPaintP50Ms,
      runtimeP95: runtime.scrollToPaintP95Ms,
      runtimeSamples: runtime.scrollToPaintSamples,
    },
    {
      label: "reconnect->resync",
      bench: probes.reconnectResync,
      runtimeP50: runtime.reconnectResyncP50Ms,
      runtimeP95: runtime.reconnectResyncP95Ms,
      runtimeSamples: runtime.reconnectResyncSamples,
    },
  ];

  const formatValue = (value: number | null | undefined): string =>
    typeof value === "number" ? `${value.toFixed(2)}ms` : "n/a";

  console.log("\nRuntime correlation (runtime telemetry file vs benchmark probes):");
  for (const row of rows) {
    const benchP50 = row.bench ? row.bench.p50Ms : null;
    const benchP95 = row.bench ? row.bench.p95Ms : null;
    const p50Delta =
      typeof row.runtimeP50 === "number" && benchP50 !== null ? row.runtimeP50 - benchP50 : null;
    const p95Delta =
      typeof row.runtimeP95 === "number" && benchP95 !== null ? row.runtimeP95 - benchP95 : null;
    const formatDelta = (value: number | null): string =>
      value === null ? "n/a" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}ms`;

    console.log(
      `  ${row.label.padEnd(18)} bench p50/p95=${formatValue(benchP50)}/${formatValue(benchP95)} runtime p50/p95=${formatValue(row.runtimeP50)}/${formatValue(row.runtimeP95)} delta=${formatDelta(p50Delta)}/${formatDelta(p95Delta)} runtimeSamples=${row.runtimeSamples ?? "n/a"}`
    );
  }
}

function printBunPtyPrototypeSummary(result: BunPtyPrototypeResult | null): void {
  if (!result) {
    return;
  }

  console.log("\nExperimental Bun PTY prototype probe:");
  console.log(`  attempted:             ${result.attempted ? "yes" : "no"}`);
  console.log(`  supported:             ${result.supported ? "yes" : "no"}`);
  console.log(`  timed out:             ${result.timedOut ? "yes" : "no"}`);
  console.log(`  bytes received:        ${result.bytesReceived.toLocaleString()}`);
  console.log(`  chunks received:       ${result.chunksReceived.toLocaleString()}`);
  console.log(`  elapsed:               ${result.elapsedMs.toFixed(2)}ms`);
  console.log(`  throughput:            ${result.throughputMiBPerSecond.toFixed(2)} MiB/s`);
  if (result.error) {
    console.log(`  note:                  ${result.error}`);
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const scenarios: Scenario[] = [
    { name: "Small typing edits on large screen", frames: generateTypingFrames(250) },
    { name: "Growing append-heavy output", frames: generateAppendFrames(180) },
    { name: "High churn full-screen rewrites", frames: generateChurnFrames(120) },
  ];

  console.log("CodePiper WS transport benchmark");
  console.log("Comparing full, patch, and negotiated binary PTY transports\n");

  for (const scenario of scenarios) {
    printScenarioSummary(scenario);
  }

  const replayResult = probeReconnectReplayRecovery();
  printReplayRecoverySummary(replayResult);

  const latencyResult = await probeKeystrokeToEchoLatency(15);
  printLatencySummary(latencyResult);

  const scrollToPaintResult = await probeScrollToPaintLatency(15);
  const reconnectResyncResult = probeReconnectResyncLatency(15);
  const comparableProbes: ComparableLatencyProbeSet = {
    keyToEcho: latencyResult,
    scrollToPaint: scrollToPaintResult,
    reconnectResync: reconnectResyncResult,
  };
  printComparableLatencySummary(comparableProbes);

  const runtimeTelemetry = await loadRuntimeTelemetry(options.runtimeTelemetryPath);
  printRuntimeCorrelationSummary(comparableProbes, runtimeTelemetry);
  const bunPtyPrototypeResult = options.bunPtyPrototype ? await probeBunPtyPrototype() : null;
  printBunPtyPrototypeSummary(bunPtyPrototypeResult);

  const summary: BenchSummary = {
    generatedAt: new Date().toISOString(),
    git: collectGitMetadata(),
    comparableProbes,
    replayRecovery: replayResult,
    runtimeTelemetry,
    bunPtyPrototype: bunPtyPrototypeResult,
  };

  if (options.artifactDir) {
    const artifactPath = await writeBenchmarkArtifact(
      options.artifactDir,
      summary,
      options.artifactLabel
    );
    console.log(`\nBenchmark artifact written: ${artifactPath}`);
  }

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  }
}

void main().catch((error) => {
  console.error("[bench] ws-transport benchmark failed:", error);
  process.exitCode = 1;
});
