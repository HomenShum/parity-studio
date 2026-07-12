import type { DeckSnapshot, PatchOperation, ValidationIssue } from '../../shared/nodeslide';
import { applyDeckPatch } from '../../shared/nodeslidePatch';
import { nodeSlideSnapshotDigest } from './nodeslideDeckRepl';
import { nodeslideContentDigest } from './nodeslideIds';
import {
  type NodeSlidePatchInput,
  evaluateNodeSlideCas,
  validateNodeSlidePatch,
} from './nodeslidePatches';

export const NODESLIDE_RENDER_REPAIR_SCHEMA_VERSION = 'nodeslide.render-repair/v1' as const;

export const NODESLIDE_RENDER_REPAIR_HARD_LIMITS = Object.freeze({
  maxAttempts: 8,
  maxWallTimeMs: 120_000,
  maxOperations: 128,
  maxRenderBytes: 20_000_000,
  maxObservationBytes: 1_000_000,
  maxNoProgress: 4,
});

export interface NodeSlideRenderRepairBudget {
  maxAttempts: number;
  maxWallTimeMs: number;
  maxOperations: number;
  maxRenderBytes: number;
  maxObservationBytes: number;
  maxNoProgress: number;
}

export interface NodeSlideRepairObservation {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  slideId?: string;
  elementId?: string;
}

export interface NodeSlideRepairValidation {
  clean: boolean;
  safetyPassed: boolean;
  issues: NodeSlideRepairObservation[] | ValidationIssue[];
}

export interface NodeSlideRenderOutput {
  artifact: unknown;
  bytes: number;
  digest?: string;
}

type NodeSlideSanitizedRenderOutput = NodeSlideRenderOutput & { digest: string };

export interface NodeSlideObservationOutput {
  clean: boolean;
  observations: NodeSlideRepairObservation[];
}

export interface NodeSlideRenderRepairCallbacks {
  validate(snapshot: Readonly<DeckSnapshot>): NodeSlideRepairValidation;
  render(args: {
    snapshot: Readonly<DeckSnapshot>;
    attempt: number;
    snapshotDigest: string;
  }): NodeSlideRenderOutput;
  observe(args: {
    render: Readonly<NodeSlideRenderOutput>;
    attempt: number;
    snapshotDigest: string;
  }): NodeSlideObservationOutput;
  proposeRepair(args: {
    snapshot: Readonly<DeckSnapshot>;
    attempt: number;
    snapshotDigest: string;
    observations: readonly NodeSlideRepairObservation[];
  }): NodeSlidePatchInput;
}

export type NodeSlideRenderRepairTerminalReason =
  | 'clean'
  | 'invalid_request'
  | 'safety_failure'
  | 'stale_snapshot'
  | 'cycle_detected'
  | 'no_progress'
  | 'attempt_budget_exhausted'
  | 'wall_time_exhausted'
  | 'operation_budget_exhausted'
  | 'render_budget_exhausted'
  | 'observation_budget_exhausted'
  | 'invalid_proposal'
  | 'adapter_failure';

export interface NodeSlideRenderRepairReceipt {
  attempt: number;
  inputSnapshotDigest: string;
  semanticSnapshotDigest: string;
  validationDigest: string;
  renderDigest?: string;
  renderBytes: number;
  observationDigest?: string;
  observationBytes: number;
  proposalDigest?: string;
  resultingSnapshotDigest?: string;
  status: 'clean' | 'repaired' | 'stopped';
  summary: string;
}

export interface NodeSlideRenderRepairResult {
  schemaVersion: typeof NODESLIDE_RENDER_REPAIR_SCHEMA_VERSION;
  status: 'completed' | 'stopped';
  terminalReason: NodeSlideRenderRepairTerminalReason;
  baseSnapshotDigest: string;
  candidateSnapshotDigest: string;
  candidate: DeckSnapshot;
  proposals: NodeSlidePatchInput[];
  operations: PatchOperation[];
  receipts: NodeSlideRenderRepairReceipt[];
  usage: {
    attempts: number;
    elapsedMs: number;
    operations: number;
    renderBytes: number;
    observationBytes: number;
  };
  guardrails: readonly string[];
}

const DEFAULT_BUDGET: NodeSlideRenderRepairBudget = {
  maxAttempts: 4,
  maxWallTimeMs: 45_000,
  maxOperations: 64,
  maxRenderBytes: 8_000_000,
  maxObservationBytes: 256_000,
  maxNoProgress: 2,
};

const GUARDRAILS = Object.freeze([
  'Base and candidate snapshots are cloned; no persistence occurs in the loop',
  'Every proposal is bound to exact deck, slide, and element clocks',
  'Every proposal passes NodeSlide scope, lock, geometry, source, and patch validation',
  'Render artifacts and observations are untrusted, bounded, and excluded from receipts',
  'Cycle, no-progress, attempt, wall-time, operation, and byte ceilings terminate deterministically',
  'Returned operations remain review artifacts until a separate authorized commit',
]);

export function runNodeSlideRenderRepairLoop(args: {
  base: DeckSnapshot;
  expectedBaseDigest?: string;
  callbacks: NodeSlideRenderRepairCallbacks;
  budget?: Partial<NodeSlideRenderRepairBudget>;
  now?: () => number;
}): NodeSlideRenderRepairResult {
  const now = args.now ?? Date.now;
  const startedAt = finiteClock(now());
  const base = structuredClone(args.base);
  let candidate = structuredClone(base);
  const baseSnapshotDigest = nodeSlideSnapshotDigest(base);
  const budget = resolveBudget(args.budget);
  const receipts: NodeSlideRenderRepairReceipt[] = [];
  const proposals: NodeSlidePatchInput[] = [];
  const operations: PatchOperation[] = [];
  const seenSemanticDigests = new Set<string>([semanticSnapshotDigest(candidate)]);
  let lastObservationDigest = '';
  let repeatedObservationCount = 0;
  let renderBytes = 0;
  let observationBytes = 0;
  let terminalReason: NodeSlideRenderRepairTerminalReason = 'invalid_request';

  const elapsed = (): number => Math.max(0, finiteClock(now()) - startedAt);
  const finish = (): NodeSlideRenderRepairResult => ({
    schemaVersion: NODESLIDE_RENDER_REPAIR_SCHEMA_VERSION,
    status: terminalReason === 'clean' ? 'completed' : 'stopped',
    terminalReason,
    baseSnapshotDigest,
    candidateSnapshotDigest: nodeSlideSnapshotDigest(candidate),
    candidate,
    proposals,
    operations,
    receipts,
    usage: {
      attempts: receipts.filter((receipt) => receipt.renderDigest !== undefined).length,
      elapsedMs: elapsed(),
      operations: operations.length,
      renderBytes,
      observationBytes,
    },
    guardrails: GUARDRAILS,
  });

  if (!budget || !isSnapshotShape(base)) return finish();
  if (
    args.expectedBaseDigest !== undefined &&
    cleanDigest(args.expectedBaseDigest) !== baseSnapshotDigest
  ) {
    terminalReason = 'stale_snapshot';
    return finish();
  }

  for (let attempt = 0; attempt <= budget.maxAttempts; attempt += 1) {
    if (elapsed() > budget.maxWallTimeMs) {
      terminalReason = 'wall_time_exhausted';
      return finish();
    }
    const inputSnapshotDigest = nodeSlideSnapshotDigest(candidate);
    const semanticDigest = semanticSnapshotDigest(candidate);
    let validation: NodeSlideRepairValidation;
    try {
      validation = sanitizeValidation(args.callbacks.validate(structuredClone(candidate)));
    } catch (error) {
      terminalReason = 'adapter_failure';
      receipts.push(
        stoppedReceipt(
          attempt,
          inputSnapshotDigest,
          semanticDigest,
          'Validation callback failed.',
          error,
        ),
      );
      return finish();
    }
    const validationDigest = `validation_${nodeslideContentDigest(stableSerialize(validation))}`;
    if (!validation.safetyPassed) {
      terminalReason = 'safety_failure';
      receipts.push({
        attempt,
        inputSnapshotDigest,
        semanticSnapshotDigest: semanticDigest,
        validationDigest,
        renderBytes: 0,
        observationBytes: 0,
        status: 'stopped',
        summary: 'Deterministic validation reported a safety failure.',
      });
      return finish();
    }
    if (validation.clean) {
      terminalReason = 'clean';
      receipts.push({
        attempt,
        inputSnapshotDigest,
        semanticSnapshotDigest: semanticDigest,
        validationDigest,
        renderBytes: 0,
        observationBytes: 0,
        status: 'clean',
        summary:
          attempt === 0
            ? 'Base snapshot was already clean.'
            : 'Repaired candidate passed validation.',
      });
      return finish();
    }
    if (attempt >= budget.maxAttempts) {
      terminalReason = 'attempt_budget_exhausted';
      receipts.push({
        attempt,
        inputSnapshotDigest,
        semanticSnapshotDigest: semanticDigest,
        validationDigest,
        renderBytes: 0,
        observationBytes: 0,
        status: 'stopped',
        summary: 'Repair-attempt budget exhausted.',
      });
      return finish();
    }

    let rendered: NodeSlideSanitizedRenderOutput;
    try {
      rendered = sanitizeRender(
        args.callbacks.render({
          snapshot: structuredClone(candidate),
          attempt: attempt + 1,
          snapshotDigest: inputSnapshotDigest,
        }),
      );
    } catch (error) {
      terminalReason = 'adapter_failure';
      receipts.push(
        stoppedReceipt(
          attempt + 1,
          inputSnapshotDigest,
          semanticDigest,
          'Render callback failed.',
          error,
          validationDigest,
        ),
      );
      return finish();
    }
    const currentRenderBytes = Math.max(rendered.bytes, byteLength(rendered.artifact));
    if (!Number.isSafeInteger(currentRenderBytes) || currentRenderBytes < 0) {
      terminalReason = 'adapter_failure';
      receipts.push(
        stoppedReceipt(
          attempt + 1,
          inputSnapshotDigest,
          semanticDigest,
          'Render byte count was invalid.',
          undefined,
          validationDigest,
        ),
      );
      return finish();
    }
    if (renderBytes + currentRenderBytes > budget.maxRenderBytes) {
      terminalReason = 'render_budget_exhausted';
      receipts.push({
        attempt: attempt + 1,
        inputSnapshotDigest,
        semanticSnapshotDigest: semanticDigest,
        validationDigest,
        renderDigest: rendered.digest,
        renderBytes: currentRenderBytes,
        observationBytes: 0,
        status: 'stopped',
        summary: 'Render byte budget exhausted.',
      });
      return finish();
    }
    renderBytes += currentRenderBytes;

    let observed: NodeSlideObservationOutput;
    try {
      observed = sanitizeObservation(
        args.callbacks.observe({
          render: structuredClone(rendered),
          attempt: attempt + 1,
          snapshotDigest: inputSnapshotDigest,
        }),
      );
    } catch (error) {
      terminalReason = 'adapter_failure';
      receipts.push(
        stoppedReceipt(
          attempt + 1,
          inputSnapshotDigest,
          semanticDigest,
          'Observation callback failed.',
          error,
          validationDigest,
          rendered,
        ),
      );
      return finish();
    }
    const currentObservationBytes = byteLength(observed);
    const observationDigest = `observation_${nodeslideContentDigest(stableSerialize(observed))}`;
    if (observationBytes + currentObservationBytes > budget.maxObservationBytes) {
      terminalReason = 'observation_budget_exhausted';
      receipts.push({
        attempt: attempt + 1,
        inputSnapshotDigest,
        semanticSnapshotDigest: semanticDigest,
        validationDigest,
        renderDigest: rendered.digest,
        renderBytes: currentRenderBytes,
        observationDigest,
        observationBytes: currentObservationBytes,
        status: 'stopped',
        summary: 'Observation byte budget exhausted.',
      });
      return finish();
    }
    observationBytes += currentObservationBytes;
    if (observed.clean && observed.observations.every((item) => item.severity !== 'error')) {
      terminalReason = 'clean';
      receipts.push({
        attempt: attempt + 1,
        inputSnapshotDigest,
        semanticSnapshotDigest: semanticDigest,
        validationDigest,
        renderDigest: rendered.digest,
        renderBytes: currentRenderBytes,
        observationDigest,
        observationBytes: currentObservationBytes,
        status: 'clean',
        summary: 'Rendered candidate passed bounded observation.',
      });
      return finish();
    }
    if (observationDigest === lastObservationDigest) repeatedObservationCount += 1;
    else repeatedObservationCount = 1;
    lastObservationDigest = observationDigest;
    if (repeatedObservationCount >= budget.maxNoProgress) {
      terminalReason = 'no_progress';
      receipts.push({
        attempt: attempt + 1,
        inputSnapshotDigest,
        semanticSnapshotDigest: semanticDigest,
        validationDigest,
        renderDigest: rendered.digest,
        renderBytes: currentRenderBytes,
        observationDigest,
        observationBytes: currentObservationBytes,
        status: 'stopped',
        summary: 'The same bounded observation repeated without progress.',
      });
      return finish();
    }

    let proposal: NodeSlidePatchInput;
    try {
      proposal = structuredClone(
        args.callbacks.proposeRepair({
          snapshot: structuredClone(candidate),
          attempt: attempt + 1,
          snapshotDigest: inputSnapshotDigest,
          observations: structuredClone(observed.observations),
        }),
      );
    } catch (error) {
      terminalReason = 'adapter_failure';
      receipts.push(
        stoppedReceipt(
          attempt + 1,
          inputSnapshotDigest,
          semanticDigest,
          'Repair callback failed.',
          error,
          validationDigest,
          rendered,
          observationDigest,
          currentObservationBytes,
        ),
      );
      return finish();
    }
    const proposalDigest = `proposal_${nodeslideContentDigest(stableSerialize(proposal))}`;
    if (!proposal || !Array.isArray(proposal.operations) || proposal.operations.length === 0) {
      terminalReason = 'invalid_proposal';
      receipts.push(
        repairStoppedReceipt(
          attempt + 1,
          inputSnapshotDigest,
          semanticDigest,
          validationDigest,
          rendered,
          currentRenderBytes,
          observationDigest,
          currentObservationBytes,
          proposalDigest,
          'Repair proposal was empty or malformed.',
        ),
      );
      return finish();
    }
    if (operations.length + proposal.operations.length > budget.maxOperations) {
      terminalReason = 'operation_budget_exhausted';
      receipts.push(
        repairStoppedReceipt(
          attempt + 1,
          inputSnapshotDigest,
          semanticDigest,
          validationDigest,
          rendered,
          currentRenderBytes,
          observationDigest,
          currentObservationBytes,
          proposalDigest,
          'Operation budget exhausted.',
        ),
      );
      return finish();
    }
    const cas = evaluateNodeSlideCas(candidate, proposal);
    const errors = [...new Set([...validateNodeSlidePatch(candidate, proposal), ...cas.reasons])];
    if (!cas.canCommit || errors.length > 0) {
      terminalReason = cas.canCommit ? 'invalid_proposal' : 'stale_snapshot';
      receipts.push(
        repairStoppedReceipt(
          attempt + 1,
          inputSnapshotDigest,
          semanticDigest,
          validationDigest,
          rendered,
          currentRenderBytes,
          observationDigest,
          currentObservationBytes,
          proposalDigest,
          cleanText(errors[0] ?? 'Repair proposal was rejected.'),
        ),
      );
      return finish();
    }

    let next: DeckSnapshot;
    try {
      next = applyDeckPatch(
        candidate,
        {
          baseDeckVersion: candidate.deck.version,
          scope: proposal.scope,
          operations: proposal.operations,
        },
        candidate.deck.updatedAt + 1,
      ).snapshot;
    } catch (error) {
      terminalReason = 'invalid_proposal';
      receipts.push(
        repairStoppedReceipt(
          attempt + 1,
          inputSnapshotDigest,
          semanticDigest,
          validationDigest,
          rendered,
          currentRenderBytes,
          observationDigest,
          currentObservationBytes,
          proposalDigest,
          cleanError(error),
        ),
      );
      return finish();
    }
    const resultingDigest = semanticSnapshotDigest(next);
    proposals.push(proposal);
    operations.push(...structuredClone(proposal.operations));
    receipts.push({
      attempt: attempt + 1,
      inputSnapshotDigest,
      semanticSnapshotDigest: semanticDigest,
      validationDigest,
      renderDigest: rendered.digest,
      renderBytes: currentRenderBytes,
      observationDigest,
      observationBytes: currentObservationBytes,
      proposalDigest,
      resultingSnapshotDigest: nodeSlideSnapshotDigest(next),
      status: 'repaired',
      summary: `Applied ${proposal.operations.length} validated candidate operation${proposal.operations.length === 1 ? '' : 's'} in memory.`,
    });
    if (seenSemanticDigests.has(resultingDigest)) {
      candidate = next;
      terminalReason = 'cycle_detected';
      return finish();
    }
    seenSemanticDigests.add(resultingDigest);
    candidate = next;
  }

  terminalReason = 'attempt_budget_exhausted';
  return finish();
}

function semanticSnapshotDigest(snapshot: DeckSnapshot): string {
  const withoutKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
    Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
  const value = {
    deck: withoutKeys(snapshot.deck as unknown as Record<string, unknown>, [
      'updatedAt',
      'version',
    ]),
    slides: snapshot.slides.map((slide) =>
      withoutKeys(slide as unknown as Record<string, unknown>, ['version']),
    ),
    elements: snapshot.elements.map((element) =>
      withoutKeys(element as unknown as Record<string, unknown>, ['version']),
    ),
    sources: snapshot.sources,
  };
  return `semantic_${nodeslideContentDigest(stableSerialize(value))}`;
}

function sanitizeValidation(value: NodeSlideRepairValidation): NodeSlideRepairValidation {
  return {
    clean: value?.clean === true,
    safetyPassed: value?.safetyPassed === true,
    issues: sanitizeObservations(value?.issues ?? []),
  };
}

function sanitizeRender(value: NodeSlideRenderOutput): NodeSlideSanitizedRenderOutput {
  if (!value || !Number.isSafeInteger(value.bytes) || value.bytes < 0) {
    throw new Error('Render output declared an invalid byte count.');
  }
  const rawBytes = rawArtifactByteLength(value.artifact);
  const artifact = sanitizeArtifactReference(value.artifact);
  return {
    artifact,
    bytes: Math.max(value.bytes, rawBytes),
    digest:
      cleanDigest(value.digest) || `render_${nodeslideContentDigest(stableSerialize(artifact))}`,
  };
}

function sanitizeObservation(value: NodeSlideObservationOutput): NodeSlideObservationOutput {
  return {
    clean: value?.clean === true,
    observations: sanitizeObservations(value?.observations ?? []),
  };
}

function sanitizeObservations(
  value: readonly (NodeSlideRepairObservation | ValidationIssue)[],
): NodeSlideRepairObservation[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 256).map((item) => ({
    code: cleanId(item?.code) || 'unknown',
    severity: item?.severity === 'error' || item?.severity === 'warning' ? item.severity : 'info',
    message: cleanText(item?.message ?? ''),
    ...(item?.slideId ? { slideId: cleanId(item.slideId) } : {}),
    ...(item?.elementId ? { elementId: cleanId(item.elementId) } : {}),
  }));
}

function sanitizeArtifactReference(value: unknown): unknown {
  if (typeof value === 'string') return cleanText(value).slice(0, 2_000);
  if (value instanceof Uint8Array)
    return {
      byteLength: value.byteLength,
      digest: `bytes_${nodeslideContentDigest(value)}`,
    };
  return sanitizeValue(value, 0, 10_000);
}

function sanitizeValue(value: unknown, depth: number, maxArray: number): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (typeof value === 'string') return cleanText(value).slice(0, 2_000);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value))
    return value.slice(0, maxArray).map((item) => sanitizeValue(item, depth + 1, maxArray));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, 1_000)
        .map(([key, item]) => [cleanId(key), sanitizeValue(item, depth + 1, maxArray)]),
    );
  }
  return undefined;
}

function stoppedReceipt(
  attempt: number,
  inputSnapshotDigest: string,
  semanticDigest: string,
  summary: string,
  error?: unknown,
  validationDigest = 'validation_unavailable',
  render?: NodeSlideRenderOutput,
  observationDigest?: string,
  currentObservationBytes = 0,
): NodeSlideRenderRepairReceipt {
  return {
    attempt,
    inputSnapshotDigest,
    semanticSnapshotDigest: semanticDigest,
    validationDigest,
    ...(render?.digest ? { renderDigest: render.digest } : {}),
    renderBytes: render?.bytes ?? 0,
    ...(observationDigest ? { observationDigest } : {}),
    observationBytes: currentObservationBytes,
    status: 'stopped',
    summary: error ? `${summary} ${cleanError(error)}` : summary,
  };
}

function repairStoppedReceipt(
  attempt: number,
  inputSnapshotDigest: string,
  semanticDigest: string,
  validationDigest: string,
  rendered: NodeSlideSanitizedRenderOutput,
  currentRenderBytes: number,
  observationDigest: string,
  currentObservationBytes: number,
  proposalDigest: string,
  summary: string,
): NodeSlideRenderRepairReceipt {
  return {
    attempt,
    inputSnapshotDigest,
    semanticSnapshotDigest: semanticDigest,
    validationDigest,
    renderDigest: rendered.digest,
    renderBytes: currentRenderBytes,
    observationDigest,
    observationBytes: currentObservationBytes,
    proposalDigest,
    status: 'stopped',
    summary: cleanText(summary),
  };
}

function resolveBudget(
  requested: Partial<NodeSlideRenderRepairBudget> | undefined,
): NodeSlideRenderRepairBudget | null {
  const budget = { ...DEFAULT_BUDGET, ...requested };
  const keys = Object.keys(
    NODESLIDE_RENDER_REPAIR_HARD_LIMITS,
  ) as (keyof NodeSlideRenderRepairBudget)[];
  for (const key of keys) {
    const value = budget[key];
    if (
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > NODESLIDE_RENDER_REPAIR_HARD_LIMITS[key]
    )
      return null;
  }
  return budget;
}

function isSnapshotShape(value: unknown): value is DeckSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<DeckSnapshot>;
  return Boolean(
    candidate.deck &&
      typeof candidate.deck.id === 'string' &&
      Number.isSafeInteger(candidate.deck.version) &&
      Array.isArray(candidate.slides) &&
      Array.isArray(candidate.elements) &&
      Array.isArray(candidate.sources),
  );
}

function cleanText(value: string): string {
  return stripControlCharacters(value)
    .replace(/\b(?:sk|rk|pk|api)[-_][A-Za-z0-9_-]{12,}\b/gi, '[REDACTED]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b(api[_-]?key|token|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function cleanError(error: unknown): string {
  return cleanText(error instanceof Error ? error.message : 'Adapter failed.');
}

function cleanId(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[^A-Za-z0-9._:/+ -]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function cleanDigest(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 180);
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function rawArtifactByteLength(value: unknown): number {
  if (value instanceof Uint8Array) return value.byteLength;
  return byteLength(value);
}

function stripControlCharacters(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('');
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)]),
    );
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return value;
}

function byteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(typeof value === 'string' ? value : stableSerialize(value))
      .byteLength;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function finiteClock(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
