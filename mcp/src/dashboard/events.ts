/**
 * In-memory run state store + SSE pub/sub for the local dashboard.
 *
 * Bounded per agentic_reliability BOUND rule: caps at 50 most-recent runs,
 * evicts oldest by createdAt. Each SSE subscriber is also tracked in a Set
 * so server shutdown can close them cleanly.
 *
 * Data flow:
 *   MCP tool handler -> updateRun(id, patch) -> notifies subscribers via SSE
 *   Dashboard browser -> GET /events (SSE) -> receives {runId, ...patch} on every change
 *   Dashboard browser -> GET /api/runs (REST) -> hydration on first load
 */

export type RunStage = 'generate' | 'decompose' | 'verify' | 'iterate' | 'done';
export type StageState = 'idle' | 'running' | 'done' | 'failed' | 'unavailable';
export type RunStatus =
  | 'queued'
  | 'generating'
  | 'decomposing'
  | 'verifying'
  | 'iterating'
  | 'done'
  | 'failed';

export interface ParityCheck {
  dimension: string;
  id: string;
  passed: boolean;
  note: string;
}

export interface ParityReportLite {
  passCount: number;
  totalChecks: number;
  parityScore: number;
  status: 'verified' | 'needs_review' | 'needs_iteration' | 'failed' | 'unavailable';
  summary: string;
  basis: 'deterministic' | 'visual' | 'deterministic+visual';
  failedChecks?: ParityCheck[];
}

export interface RunRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: RunStatus;
  stages: Record<RunStage, StageState>;
  prompt?: string;
  /** base64 source image, capped to ~2 MB so the SSE channel doesn't choke. */
  sourceImageBase64?: string;
  sourceImageMimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
  /** Latest artifact HTML (clipped to 50 KB for the dashboard preview). */
  artifactHtmlPreview?: string;
  /** Full artifact HTML kept server-side for ZIP export. */
  artifactHtmlFull?: string;
  /** Latest decomposed ui_kit files (kept server-side for ZIP export). */
  uiKitFiles?: Record<string, string>;
  uiKitSlug?: string;
  parityReport?: ParityReportLite;
  costUsd: number;
  /** Per-stage latency in ms. */
  latencies: Partial<Record<RunStage, number>>;
  /** Per-stage model used. */
  modelsUsed: Partial<Record<RunStage, string>>;
  /** Free-form log lines, capped to 200. */
  log: Array<{ ts: number; level: 'info' | 'warn' | 'error'; message: string }>;
  errorMessage?: string;
}

const MAX_RUNS = 50;
const MAX_LOG_LINES = 200;
const ARTIFACT_PREVIEW_BYTES = 50_000;
const SOURCE_IMAGE_PREVIEW_BYTES = 2_000_000;

class EventBus {
  private runs = new Map<string, RunRecord>();
  private subscribers = new Set<(event: string) => void>();

  createRun(id: string, init: Partial<RunRecord> = {}): RunRecord {
    const now = Date.now();
    const run: RunRecord = {
      id,
      createdAt: now,
      updatedAt: now,
      status: 'queued',
      stages: {
        generate: 'idle',
        decompose: 'idle',
        verify: 'idle',
        iterate: 'idle',
        done: 'idle',
      },
      costUsd: 0,
      latencies: {},
      modelsUsed: {},
      log: [],
      ...init,
    };
    this.runs.set(id, run);
    this.evictIfNeeded();
    this.broadcast('run.created', run);
    return run;
  }

  updateRun(id: string, patch: Partial<RunRecord>): RunRecord | null {
    const run = this.runs.get(id);
    if (run === undefined) return null;
    Object.assign(run, patch, { updatedAt: Date.now() });

    // Cap artifact preview + image size before broadcast
    if (patch.artifactHtmlFull && !patch.artifactHtmlPreview) {
      run.artifactHtmlPreview = patch.artifactHtmlFull.slice(0, ARTIFACT_PREVIEW_BYTES);
    }
    if (
      run.sourceImageBase64 !== undefined &&
      run.sourceImageBase64.length > SOURCE_IMAGE_PREVIEW_BYTES
    ) {
      run.sourceImageBase64 = run.sourceImageBase64.slice(0, SOURCE_IMAGE_PREVIEW_BYTES);
    }

    this.broadcast('run.updated', run);
    return run;
  }

  appendLog(id: string, level: 'info' | 'warn' | 'error', message: string): void {
    const run = this.runs.get(id);
    if (run === undefined) return;
    run.log.push({ ts: Date.now(), level, message });
    if (run.log.length > MAX_LOG_LINES) {
      run.log.splice(0, run.log.length - MAX_LOG_LINES);
    }
    run.updatedAt = Date.now();
    this.broadcast('run.log', { runId: id, level, message, ts: run.log[run.log.length - 1]?.ts });
  }

  setStage(
    id: string,
    stage: RunStage,
    state: StageState,
    latencyMs?: number,
    modelUsed?: string,
  ): void {
    const run = this.runs.get(id);
    if (run === undefined) return;
    run.stages[stage] = state;
    if (latencyMs !== undefined) run.latencies[stage] = latencyMs;
    if (modelUsed !== undefined) run.modelsUsed[stage] = modelUsed;
    run.updatedAt = Date.now();
    this.broadcast('run.stage', { runId: id, stage, state, latencyMs, modelUsed });
  }

  addCost(id: string, addUsd: number): void {
    const run = this.runs.get(id);
    if (run === undefined) return;
    run.costUsd += Math.max(0, addUsd);
    run.updatedAt = Date.now();
    this.broadcast('run.cost', { runId: id, totalCostUsd: run.costUsd });
  }

  getRun(id: string): RunRecord | undefined {
    return this.runs.get(id);
  }

  listRuns(): RunRecord[] {
    return Array.from(this.runs.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Returns the unsubscribe fn. Subscriber must be drained as soon as possible. */
  subscribe(send: (event: string) => void): () => void {
    this.subscribers.add(send);
    return () => {
      this.subscribers.delete(send);
    };
  }

  subscriberCount(): number {
    return this.subscribers.size;
  }

  /** Stable JSON-serialized SSE message with `event:` + `data:` framing. */
  private broadcast(eventName: string, payload: unknown): void {
    const data = JSON.stringify(payload);
    const message = `event: ${eventName}\ndata: ${data}\n\n`;
    for (const send of this.subscribers) {
      try {
        send(message);
      } catch {
        // Subscriber will be removed by the unsubscribe path; swallow
      }
    }
  }

  private evictIfNeeded(): void {
    if (this.runs.size <= MAX_RUNS) return;
    const sorted = Array.from(this.runs.values()).sort((a, b) => a.createdAt - b.createdAt);
    const toEvict = sorted.slice(0, this.runs.size - MAX_RUNS);
    for (const run of toEvict) this.runs.delete(run.id);
  }
}

export const eventBus = new EventBus();

/** Generate a short, sortable run id (timestamp + 4-char rand). */
export function makeRunId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}-${rand}`;
}
