import type {
  DeckSnapshot,
  ElementKind,
  PatchOperation,
  PatchScope,
  SlideElement,
} from '../../shared/nodeslide';
import { nodeslideContentDigest } from './nodeslideIds';
import {
  type NodeSlidePatchInput,
  evaluateNodeSlideCas,
  validateNodeSlidePatch,
} from './nodeslidePatches';
import { boundingBoxesIntersect, isNormalizedBoundingBox } from './nodeslideValidation';

export const NODESLIDE_DECK_REPL_SCHEMA_VERSION = 'nodeslide.deck-repl/v1' as const;
export const NODESLIDE_DECK_REPL_SHADOW_RECEIPT_SCHEMA_VERSION =
  'nodeslide.deck-repl-shadow-receipt/v1' as const;

export const NODESLIDE_DECK_REPL_HARD_LIMITS = Object.freeze({
  maxSteps: 24,
  maxInputBytes: 128_000,
  maxOutputBytes: 128_000,
  maxOperations: 64,
  maxWallTimeMs: 30_000,
});

const MAX_COMMAND_ID_LENGTH = 96;
const MAX_QUERY_LENGTH = 160;
const MAX_ELEMENT_RESULTS = 50;
const MAX_RECEIPT_TEXT = 500;
const MAX_CONTENT_PREVIEW = 280;

export interface NodeSlideDeckReplBudget {
  maxSteps: number;
  maxInputBytes: number;
  maxOutputBytes: number;
  maxOperations: number;
  maxWallTimeMs: number;
}

export type NodeSlideDeckReplCommand =
  | { id: string; type: 'inspect_deck' }
  | { id: string; type: 'inspect_slide'; slideId: string }
  | {
      id: string;
      type: 'find_elements';
      slideId?: string;
      kind?: ElementKind;
      role?: string;
      text?: string;
      limit?: number;
    }
  | { id: string; type: 'measure_slide'; slideId: string }
  | {
      id: string;
      type: 'propose_patch';
      baseDeckVersion: number;
      baseSlideVersions: Record<string, number>;
      baseElementVersions: Record<string, number>;
      scope: PatchScope;
      operations: PatchOperation[];
    };

export type NodeSlideDeckReplTerminalReason =
  | 'completed'
  | 'invalid_request'
  | 'stale_snapshot'
  | 'step_budget_exhausted'
  | 'input_budget_exhausted'
  | 'output_budget_exhausted'
  | 'operation_budget_exhausted'
  | 'wall_time_exhausted'
  | 'command_rejected';

export interface NodeSlideDeckReplProposal extends NodeSlidePatchInput {
  commandId: string;
  operationDigest: string;
}

export interface NodeSlideDeckReplReceipt {
  commandId: string;
  commandType: NodeSlideDeckReplCommand['type'] | 'unknown';
  status: 'ok' | 'error';
  summary: string;
  output: unknown;
  outputDigest: string;
  elapsedMs: number;
  outputBytes: number;
}

export interface NodeSlideDeckReplUsage {
  steps: number;
  inputBytes: number;
  outputBytes: number;
  operations: number;
  elapsedMs: number;
}

export interface NodeSlideDeckReplResult {
  schemaVersion: typeof NODESLIDE_DECK_REPL_SCHEMA_VERSION;
  sessionId: string;
  traceId: string;
  deckId: string;
  snapshotDigest: string;
  baseDeckVersion: number;
  status: 'completed' | 'stopped';
  terminalReason: NodeSlideDeckReplTerminalReason;
  receipts: NodeSlideDeckReplReceipt[];
  proposals: NodeSlideDeckReplProposal[];
  budget: NodeSlideDeckReplBudget;
  usage: NodeSlideDeckReplUsage;
  guardrails: readonly string[];
}

export interface NodeSlideDeckReplShadowReceipt {
  schemaVersion: typeof NODESLIDE_DECK_REPL_SHADOW_RECEIPT_SCHEMA_VERSION;
  traceId: string;
  sessionId: string;
  deckId: string;
  snapshotDigest: string;
  baseDeckVersion: number;
  status: NodeSlideDeckReplResult['status'];
  terminalReason: NodeSlideDeckReplTerminalReason;
  receiptCount: number;
  proposalCount: number;
  proposalDigests: string[];
  usage: NodeSlideDeckReplUsage;
  candidateExposed: false;
  candidateCommitted: false;
}

export interface RunNodeSlideDeckReplArgs {
  sessionId: string;
  traceId: string;
  snapshot: DeckSnapshot;
  expectedSnapshotDigest?: string;
  commands: readonly NodeSlideDeckReplCommand[];
  budget?: Partial<NodeSlideDeckReplBudget>;
  /** Injectable monotonic clock for deterministic tests. */
  now?: () => number;
}

const DEFAULT_BUDGET: NodeSlideDeckReplBudget = {
  maxSteps: 12,
  maxInputBytes: 64_000,
  maxOutputBytes: 64_000,
  maxOperations: 32,
  maxWallTimeMs: 10_000,
};

const GUARDRAILS = Object.freeze([
  'Immutable snapshot reads only',
  'Allowlisted semantic commands only',
  'No eval, shell, filesystem, process, or network access',
  'Exact deck, slide, and element clocks for proposals',
  'Scope, lock, geometry, source, and operation validation before proposal output',
  'Proposals are review artifacts and are never committed by the REPL',
]);

/**
 * Execute a bounded semantic command session over an already-authorized snapshot.
 * The executor is intentionally pure: it never persists, fetches, shells out, or
 * evaluates provider-authored code.
 */
export function runNodeSlideDeckRepl(args: RunNodeSlideDeckReplArgs): NodeSlideDeckReplResult {
  const now = args.now ?? Date.now;
  const startedAt = finiteClock(now());
  const snapshot = structuredClone(args.snapshot);
  const snapshotDigest = nodeSlideSnapshotDigest(snapshot);
  const sessionId = cleanIdentifier(args.sessionId);
  const traceId = cleanIdentifier(args.traceId);
  const budget = resolveBudget(args.budget);
  const receipts: NodeSlideDeckReplReceipt[] = [];
  const proposals: NodeSlideDeckReplProposal[] = [];
  const commandIds = new Set<string>();
  let outputBytes = 0;
  let operations = 0;

  const baseResult = (terminalReason: NodeSlideDeckReplTerminalReason): NodeSlideDeckReplResult => {
    const elapsedMs = Math.max(0, finiteClock(now()) - startedAt);
    return {
      schemaVersion: NODESLIDE_DECK_REPL_SCHEMA_VERSION,
      sessionId,
      traceId,
      deckId: cleanIdentifier(snapshot.deck?.id ?? ''),
      snapshotDigest,
      baseDeckVersion: Number.isSafeInteger(snapshot.deck?.version) ? snapshot.deck.version : -1,
      status: terminalReason === 'completed' ? 'completed' : 'stopped',
      terminalReason,
      receipts,
      proposals,
      budget: budget ?? { ...DEFAULT_BUDGET },
      usage: {
        steps: receipts.length,
        inputBytes: safeByteLength(args.commands),
        outputBytes,
        operations,
        elapsedMs,
      },
      guardrails: GUARDRAILS,
    };
  };

  if (!sessionId || !traceId || !budget || !isDeckSnapshotShape(snapshot)) {
    return baseResult('invalid_request');
  }
  if (
    args.expectedSnapshotDigest !== undefined &&
    cleanIdentifier(args.expectedSnapshotDigest) !== snapshotDigest
  ) {
    return baseResult('stale_snapshot');
  }
  const inputBytes = safeByteLength(args.commands);
  if (inputBytes > budget.maxInputBytes) return baseResult('input_budget_exhausted');

  for (const rawCommand of args.commands) {
    if (receipts.length >= budget.maxSteps) return baseResult('step_budget_exhausted');
    const commandStartedAt = finiteClock(now());
    if (commandStartedAt - startedAt > budget.maxWallTimeMs) {
      return baseResult('wall_time_exhausted');
    }
    const identity = commandIdentity(rawCommand);
    if (!identity || commandIds.has(identity.id)) {
      const receipt = errorReceipt(
        identity?.id ?? 'invalid',
        identity?.type ?? 'unknown',
        'Command ID/type is missing, invalid, or duplicated.',
        commandStartedAt,
        now,
      );
      const appended = appendReceipt(receipts, receipt, outputBytes, budget.maxOutputBytes);
      if (!appended) return baseResult('output_budget_exhausted');
      outputBytes += receipt.outputBytes;
      return baseResult('invalid_request');
    }
    commandIds.add(identity.id);

    let execution: CommandExecution;
    try {
      execution = executeCommand(snapshot, rawCommand, operations, budget.maxOperations);
    } catch (error) {
      execution = {
        ok: false,
        terminalReason: 'command_rejected',
        summary: sanitizeError(error),
        output: { code: 'command_failed' },
      };
    }

    const receipt = makeReceipt(
      identity.id,
      identity.type,
      execution.ok ? 'ok' : 'error',
      execution.summary,
      execution.output,
      commandStartedAt,
      now,
    );
    const appended = appendReceipt(receipts, receipt, outputBytes, budget.maxOutputBytes);
    if (!appended) return baseResult('output_budget_exhausted');
    outputBytes += receipt.outputBytes;

    if (execution.proposal) {
      operations += execution.proposal.operations.length;
      proposals.push(execution.proposal);
    }
    if (!execution.ok) return baseResult(execution.terminalReason ?? 'command_rejected');
    if (finiteClock(now()) - startedAt > budget.maxWallTimeMs) {
      return baseResult('wall_time_exhausted');
    }
  }

  return baseResult('completed');
}

export function nodeSlideSnapshotDigest(snapshot: DeckSnapshot): string {
  return `snap_${nodeslideContentDigest(stableSerialize(snapshot))}`;
}

/**
 * Canonical digest shared by every planner lane that compares patch output.
 * Keeping this next to the REPL's canonical serializer prevents false
 * mismatches caused by object-property insertion order.
 */
export function nodeSlideOperationDigest(operations: readonly PatchOperation[]): string {
  return `ops_${nodeslideContentDigest(stableSerialize(operations))}`;
}

export function nodeSlideDeckReplDefaultBudget(): NodeSlideDeckReplBudget {
  return { ...DEFAULT_BUDGET };
}

export function nodeSlideDeckReplInputBytes(commands: readonly NodeSlideDeckReplCommand[]): number {
  return safeByteLength(commands);
}

export function nodeSlideDeckReplShadowReceipt(
  result: NodeSlideDeckReplResult,
): NodeSlideDeckReplShadowReceipt {
  return {
    schemaVersion: NODESLIDE_DECK_REPL_SHADOW_RECEIPT_SCHEMA_VERSION,
    traceId: result.traceId,
    sessionId: result.sessionId,
    deckId: result.deckId,
    snapshotDigest: result.snapshotDigest,
    baseDeckVersion: result.baseDeckVersion,
    status: result.status,
    terminalReason: result.terminalReason,
    receiptCount: result.receipts.length,
    proposalCount: result.proposals.length,
    proposalDigests: result.proposals.map((proposal) => proposal.operationDigest),
    usage: { ...result.usage },
    candidateExposed: false,
    candidateCommitted: false,
  };
}

type CommandExecution = {
  ok: boolean;
  summary: string;
  output: unknown;
  proposal?: NodeSlideDeckReplProposal;
  terminalReason?: NodeSlideDeckReplTerminalReason;
};

function executeCommand(
  snapshot: DeckSnapshot,
  command: NodeSlideDeckReplCommand,
  operationsUsed: number,
  operationBudget: number,
): CommandExecution {
  if (command.type === 'inspect_deck') {
    return {
      ok: true,
      summary: `Inspected deck ${snapshot.deck.id} at v${snapshot.deck.version}.`,
      output: {
        id: snapshot.deck.id,
        title: cleanReceiptText(snapshot.deck.title, 160).text,
        status: snapshot.deck.status,
        version: snapshot.deck.version,
        slideCount: snapshot.slides.length,
        elementCount: snapshot.elements.length,
        sourceCount: snapshot.sources.length,
        slideOrder: snapshot.deck.slideOrder.slice(0, 100),
      },
    };
  }

  if (command.type === 'inspect_slide') {
    const slide = snapshot.slides.find((candidate) => candidate.id === command.slideId);
    if (!slide) return rejected(`Unknown slide ${command.slideId}.`);
    const elements = orderedSlideElements(snapshot, slide.id).slice(0, MAX_ELEMENT_RESULTS);
    return {
      ok: true,
      summary: `Inspected slide ${slide.id} at v${slide.version}.`,
      output: {
        slide: {
          id: slide.id,
          title: cleanReceiptText(slide.title, 160).text,
          section: cleanReceiptText(slide.section ?? '', 120).text || undefined,
          version: slide.version,
          background: cleanReceiptText(slide.background, 80).text,
        },
        elements: elements.map(elementSummary),
        resultCount: elements.length,
        truncated:
          snapshot.elements.filter((element) => element.slideId === slide.id).length >
          elements.length,
      },
    };
  }

  if (command.type === 'find_elements') {
    const limit = boundedResultLimit(command.limit);
    const query = cleanReceiptText(command.text ?? '', MAX_QUERY_LENGTH).text.toLowerCase();
    const role = cleanReceiptText(command.role ?? '', MAX_QUERY_LENGTH).text;
    if (command.slideId && !snapshot.slides.some((slide) => slide.id === command.slideId)) {
      return rejected(`Unknown slide ${command.slideId}.`);
    }
    const allMatches = snapshot.elements.filter((element) => {
      if (command.slideId && element.slideId !== command.slideId) return false;
      if (command.kind && element.kind !== command.kind) return false;
      if (role && element.role !== role) return false;
      if (query) {
        const haystack =
          `${element.name} ${element.role ?? ''} ${element.content ?? ''}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
    const matches = allMatches
      .sort((left, right) =>
        `${left.slideId}:${left.id}`.localeCompare(`${right.slideId}:${right.id}`),
      )
      .slice(0, limit);
    return {
      ok: true,
      summary: `Found ${matches.length} bounded element result${matches.length === 1 ? '' : 's'}.`,
      output: {
        elements: matches.map(elementSummary),
        resultCount: matches.length,
        truncated: allMatches.length > matches.length,
      },
    };
  }

  if (command.type === 'measure_slide') {
    const slide = snapshot.slides.find((candidate) => candidate.id === command.slideId);
    if (!slide) return rejected(`Unknown slide ${command.slideId}.`);
    const elements = orderedSlideElements(snapshot, slide.id);
    let overlaps = 0;
    for (let left = 0; left < elements.length; left += 1) {
      for (let right = left + 1; right < elements.length; right += 1) {
        const a = elements[left];
        const b = elements[right];
        if (a && b && boundingBoxesIntersect(a.bbox, b.bbox)) overlaps += 1;
      }
    }
    const textElements = elements.filter(
      (element) => element.kind === 'text' || element.kind === 'math',
    );
    const sourceLinked = elements.filter((element) => element.sourceIds.length > 0).length;
    return {
      ok: true,
      summary: `Measured slide ${slide.id} deterministically.`,
      output: {
        slideId: slide.id,
        version: slide.version,
        elementCount: elements.length,
        textElementCount: textElements.length,
        textCharacters: textElements.reduce(
          (sum, element) =>
            sum +
            (element.kind === 'math'
              ? (element.math?.expression.length ?? 0)
              : (element.content?.length ?? 0)),
          0,
        ),
        lockedElementCount: elements.filter((element) => element.locked).length,
        sourceLinkedElementCount: sourceLinked,
        sourceCoverage: elements.length === 0 ? 1 : roundMetric(sourceLinked / elements.length),
        intersectingPairCount: overlaps,
        invalidBoxCount: elements.filter((element) => !isNormalizedBoundingBox(element.bbox))
          .length,
      },
    };
  }

  if (command.type === 'propose_patch') {
    if (!Array.isArray(command.operations) || command.operations.length === 0) {
      return rejected('A proposal requires at least one operation.');
    }
    if (operationsUsed + command.operations.length > operationBudget) {
      return {
        ok: false,
        terminalReason: 'operation_budget_exhausted',
        summary: 'The proposal would exceed the session operation budget.',
        output: { code: 'operation_budget_exhausted' },
      };
    }
    const patch: NodeSlidePatchInput = {
      deckId: snapshot.deck.id,
      baseDeckVersion: command.baseDeckVersion,
      baseSlideVersions: structuredClone(command.baseSlideVersions),
      baseElementVersions: structuredClone(command.baseElementVersions),
      scope: structuredClone(command.scope),
      operations: structuredClone(command.operations),
    };
    const validationErrors = validateNodeSlidePatch(snapshot, patch);
    const cas = evaluateNodeSlideCas(snapshot, patch);
    const errors = [...new Set([...validationErrors, ...cas.reasons])];
    if (errors.length > 0 || !cas.canCommit) {
      return {
        ok: false,
        terminalReason: cas.canCommit ? 'command_rejected' : 'stale_snapshot',
        summary: cleanReceiptText(errors[0] ?? 'The patch proposal was rejected.', MAX_RECEIPT_TEXT)
          .text,
        output: {
          code: cas.canCommit ? 'patch_invalid' : 'stale_clocks',
          errors: errors
            .slice(0, 12)
            .map((error) => cleanReceiptText(error, MAX_RECEIPT_TEXT).text),
          truncated: errors.length > 12,
        },
      };
    }
    const proposal: NodeSlideDeckReplProposal = {
      commandId: command.id,
      ...patch,
      operationDigest: nodeSlideOperationDigest(patch.operations),
    };
    return {
      ok: true,
      summary: `Validated ${patch.operations.length} operation${patch.operations.length === 1 ? '' : 's'} for human review.`,
      output: {
        operationCount: patch.operations.length,
        operationDigest: proposal.operationDigest,
        rebased: cas.rebased,
        touchedSlideIds: cas.touchedSlideIds,
        touchedElementIds: cas.touchedElementIds,
      },
      proposal,
    };
  }

  return rejected('Unknown Deck REPL command type.');
}

function rejected(summary: string): CommandExecution {
  return {
    ok: false,
    terminalReason: 'command_rejected',
    summary: cleanReceiptText(summary, MAX_RECEIPT_TEXT).text,
    output: { code: 'command_rejected' },
  };
}

function orderedSlideElements(snapshot: DeckSnapshot, slideId: string): SlideElement[] {
  const slide = snapshot.slides.find((candidate) => candidate.id === slideId);
  const rank = new Map((slide?.elementOrder ?? []).map((id, index) => [id, index]));
  return snapshot.elements
    .filter((element) => element.slideId === slideId)
    .sort((left, right) => {
      const leftRank = rank.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = rank.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || left.id.localeCompare(right.id);
    });
}

function elementSummary(element: SlideElement): Record<string, unknown> {
  const preview = cleanReceiptText(element.content ?? '', MAX_CONTENT_PREVIEW);
  return {
    id: element.id,
    slideId: element.slideId,
    name: cleanReceiptText(element.name, 120).text,
    kind: element.kind,
    role: cleanReceiptText(element.role ?? '', 96).text || undefined,
    bbox: structuredClone(element.bbox),
    locked: element.locked,
    version: element.version,
    sourceIds: element.sourceIds.slice(0, 32),
    sourceIdsTruncated: element.sourceIds.length > 32,
    contentPreview: preview.text || undefined,
    contentTruncated: preview.truncated,
  };
}

function makeReceipt(
  commandId: string,
  commandType: NodeSlideDeckReplReceipt['commandType'],
  status: NodeSlideDeckReplReceipt['status'],
  summary: string,
  output: unknown,
  startedAt: number,
  now: () => number,
): NodeSlideDeckReplReceipt {
  const safeSummary = cleanReceiptText(summary, MAX_RECEIPT_TEXT).text;
  const safeOutput = sanitizeReceiptValue(output);
  const outputDigest = `out_${nodeslideContentDigest(stableSerialize(safeOutput))}`;
  const partial = {
    commandId,
    commandType,
    status,
    summary: safeSummary,
    output: safeOutput,
    outputDigest,
    elapsedMs: Math.max(0, finiteClock(now()) - startedAt),
  };
  return { ...partial, outputBytes: safeByteLength(partial) };
}

function errorReceipt(
  commandId: string,
  commandType: NodeSlideDeckReplReceipt['commandType'],
  summary: string,
  startedAt: number,
  now: () => number,
): NodeSlideDeckReplReceipt {
  return makeReceipt(
    commandId,
    commandType,
    'error',
    summary,
    { code: 'invalid_command' },
    startedAt,
    now,
  );
}

function appendReceipt(
  receipts: NodeSlideDeckReplReceipt[],
  receipt: NodeSlideDeckReplReceipt,
  usedBytes: number,
  maxBytes: number,
): boolean {
  if (usedBytes + receipt.outputBytes > maxBytes) return false;
  receipts.push(receipt);
  return true;
}

function resolveBudget(
  requested: Partial<NodeSlideDeckReplBudget> | undefined,
): NodeSlideDeckReplBudget | null {
  const budget = { ...DEFAULT_BUDGET, ...requested };
  const keys = Object.keys(NODESLIDE_DECK_REPL_HARD_LIMITS) as (keyof NodeSlideDeckReplBudget)[];
  for (const key of keys) {
    const value = budget[key];
    if (
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > NODESLIDE_DECK_REPL_HARD_LIMITS[key]
    ) {
      return null;
    }
  }
  return budget;
}

function commandIdentity(
  command: unknown,
): { id: string; type: NodeSlideDeckReplReceipt['commandType'] } | null {
  if (!isRecord(command)) return null;
  const id = cleanIdentifier(command['id']);
  const type = typeof command['type'] === 'string' ? command['type'] : '';
  if (!id || id.length > MAX_COMMAND_ID_LENGTH || !isCommandType(type)) return null;
  return { id, type };
}

function isCommandType(value: string): value is NodeSlideDeckReplCommand['type'] {
  return [
    'inspect_deck',
    'inspect_slide',
    'find_elements',
    'measure_slide',
    'propose_patch',
  ].includes(value);
}

function isDeckSnapshotShape(value: unknown): value is DeckSnapshot {
  if (!isRecord(value) || !isRecord(value['deck'])) return false;
  const deck = value['deck'];
  return (
    typeof deck['id'] === 'string' &&
    Number.isSafeInteger(deck['version']) &&
    Array.isArray(value['slides']) &&
    Array.isArray(value['elements']) &&
    Array.isArray(value['sources'])
  );
}

function boundedResultLimit(value: number | undefined): number {
  if (value === undefined) return 20;
  if (!Number.isSafeInteger(value)) return 20;
  return Math.max(1, Math.min(MAX_ELEMENT_RESULTS, value));
}

function cleanIdentifier(value: unknown): string {
  if (typeof value !== 'string') return '';
  return stripControlCharacters(value).trim().slice(0, MAX_COMMAND_ID_LENGTH);
}

function cleanReceiptText(value: string, maxLength: number): { text: string; truncated: boolean } {
  const clean = stripControlCharacters(value)
    .replace(/\b(?:sk|rk|pk|api)[-_][A-Za-z0-9_-]{12,}\b/gi, '[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b(api[_-]?key|token|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim();
  return { text: clean.slice(0, maxLength), truncated: clean.length > maxLength };
}

function sanitizeReceiptValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (typeof value === 'string') return cleanReceiptText(value, MAX_RECEIPT_TEXT).text;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) {
    const items = value.slice(0, 100).map((item) => sanitizeReceiptValue(item, depth + 1));
    if (value.length > 100) items.push('[TRUNCATED]');
    return items;
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, 100)
        .map(([key, item]) => [cleanIdentifier(key), sanitizeReceiptValue(item, depth + 1)]),
    );
  }
  return undefined;
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Deck REPL command failed.';
  return cleanReceiptText(message, MAX_RECEIPT_TEXT).text || 'Deck REPL command failed.';
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isRecord(value)) {
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

function safeByteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(stableSerialize(value)).byteLength;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function finiteClock(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function roundMetric(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function stripControlCharacters(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
