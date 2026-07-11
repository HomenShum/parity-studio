import {
  NODESLIDE_PREFERENCE_ATTRIBUTE_ALLOWLIST,
  NODESLIDE_PREFERENCE_ATTRIBUTE_ENUMS,
  NODESLIDE_PREFERENCE_BOUNDS,
  NODESLIDE_PREFERENCE_EVALUATOR_VERSION,
  NODESLIDE_PREFERENCE_EVENT_TYPES,
  NODESLIDE_PREFERENCE_PROVENANCE_REQUIREMENTS,
  NODESLIDE_PREFERENCE_RULE_CONFIDENCE,
  NODESLIDE_PREFERENCE_SCHEMA_VERSION,
  type PreferenceDimension,
  type PreferenceEvaluatorReceipt,
  type PreferenceEvaluatorRejectionCode,
  type PreferenceEvent,
  type PreferenceEventType,
  type PreferencePolarity,
  type PreferenceScope,
  type PreferenceSignal,
} from '../../shared/nodeslidePreference';
import { nodeslideStableId } from './nodeslideIds';

const IDENTIFIER_LIMIT = NODESLIDE_PREFERENCE_BOUNDS.maxAttributeStringLength;
const RESOLVED_LINK_LIMIT = NODESLIDE_PREFERENCE_BOUNDS.maxProfileSignals;
const DIMENSION_ORDER: readonly PreferenceDimension[] = [
  'content_angle',
  'density',
  'layout_archetype',
  'color',
  'font',
  'workflow',
];
const EVENT_KEYS = new Set([
  'schemaVersion',
  'id',
  'tenantId',
  'actorId',
  'type',
  'scope',
  'provenance',
  'attributes',
  'occurredAt',
  'recordedAt',
]);
const PROVENANCE_KEYS = new Set([
  'deckVersion',
  'sourceEventId',
  'variationId',
  'variationBatchId',
  'patchId',
  'traceId',
  'exportId',
  'profileId',
]);

type PreferenceUnknownRecord = Record<string, unknown> & {
  id?: unknown;
  schemaVersion?: unknown;
  tenantId?: unknown;
  actorId?: unknown;
  type?: unknown;
  scope?: unknown;
  provenance?: unknown;
  attributes?: unknown;
  occurredAt?: unknown;
  recordedAt?: unknown;
  deckVersion?: unknown;
  sourceEventId?: unknown;
  variationId?: unknown;
  variationBatchId?: unknown;
  patchId?: unknown;
  traceId?: unknown;
  exportId?: unknown;
  kind?: unknown;
  deckId?: unknown;
  slideId?: unknown;
  elementId?: unknown;
  acceptedPatchIds?: unknown;
  batchId?: unknown;
  axes?: unknown;
  contentAngle?: unknown;
  density?: unknown;
  layoutArchetype?: unknown;
  status?: unknown;
  variationIds?: unknown;
  source?: unknown;
  supersedesPatchId?: unknown;
  resultingDeckVersion?: unknown;
  styleChanges?: unknown;
  dimension?: unknown;
  before?: unknown;
  after?: unknown;
  format?: unknown;
  exportFormat?: unknown;
};

export type PreferenceVariationContentAngle = 'data_led' | 'narrative_led' | 'balanced';
export type PreferenceVariationDensity = 'executive' | 'detail' | 'balanced';
export type PreferenceVariationLayoutArchetype = 'headline' | 'split' | 'evidence' | 'comparison';

export interface PreferenceVariationAxes {
  contentAngle: PreferenceVariationContentAngle;
  density: PreferenceVariationDensity;
  layoutArchetype: PreferenceVariationLayoutArchetype;
}

export interface PreferenceArtifactBase {
  tenantId: string;
  deckId: string;
  scope: PreferenceScope;
}

export interface PreferenceDeckVersionArtifact extends PreferenceArtifactBase {
  kind: 'deck_version';
  deckVersion: number;
  acceptedPatchIds: readonly string[];
}

export interface PreferenceVariationArtifact extends PreferenceArtifactBase {
  kind: 'variation';
  id: string;
  batchId: string;
  axes: PreferenceVariationAxes;
  status: 'ready' | 'accepted' | 'rejected' | 'stale';
}

export interface PreferenceVariationBatchArtifact extends PreferenceArtifactBase {
  kind: 'variation_batch';
  id: string;
  variationIds: readonly string[];
}

export interface PreferenceStyleChange {
  dimension: 'color' | 'font';
  before?: string;
  after?: string;
}

export interface PreferencePatchArtifact extends PreferenceArtifactBase {
  kind: 'patch';
  id: string;
  source: 'human' | 'agent' | 'import' | 'system';
  status: 'draft' | 'validating' | 'ready' | 'accepted' | 'rejected' | 'stale';
  traceId?: string;
  variationId?: string;
  supersedesPatchId?: string;
  resultingDeckVersion?: number;
  styleChanges: readonly PreferenceStyleChange[];
}

export interface PreferenceTraceArtifact extends PreferenceArtifactBase {
  kind: 'trace';
  id: string;
  variationId?: string;
  variationBatchId?: string;
  patchId?: string;
}

export interface PreferenceExportArtifact extends PreferenceArtifactBase {
  kind: 'export';
  id: string;
  deckVersion: number;
  status: 'queued' | 'rendering' | 'ready' | 'failed';
  format: 'html' | 'pptx' | 'pdf' | 'png';
}

export type PreferenceProvenanceArtifact =
  | PreferenceDeckVersionArtifact
  | PreferenceVariationArtifact
  | PreferenceVariationBatchArtifact
  | PreferencePatchArtifact
  | PreferenceTraceArtifact
  | PreferenceExportArtifact;

export type PreferenceArtifactReference =
  | { kind: 'deck_version'; deckId: string; deckVersion: number }
  | { kind: 'variation'; id: string }
  | { kind: 'variation_batch'; id: string }
  | { kind: 'patch'; id: string }
  | { kind: 'trace'; id: string }
  | { kind: 'export'; id: string };

/** Synchronous by design: callers resolve already-read rows or pure fixtures only. */
export interface PreferenceProvenanceResolver {
  resolveArtifact(reference: PreferenceArtifactReference): PreferenceProvenanceArtifact | undefined;
  resolveEvent?(eventId: string): PreferenceEvent | undefined;
}

export interface ExtractPreferenceSignalsOptions {
  resolver?: PreferenceProvenanceResolver;
  /** May lower, but never raise, the frozen twenty-proposal output bound. */
  maxProposals?: number;
}

export interface PreferenceSignalProposal extends Omit<PreferenceSignal, 'evaluator'> {}

export interface PreferenceProposalEvaluation {
  proposal: PreferenceSignalProposal;
  sourceEventType: PreferenceEventType;
  evaluator: PreferenceEvaluatorReceipt;
}

export interface PreferenceInputRejection {
  eventId: string;
  rejectionCodes: PreferenceEvaluatorRejectionCode[];
}

export interface PreferenceExtractionDiagnostics {
  inputEvents: number;
  uniqueEvents: number;
  duplicateEvents: number;
  candidatePatterns: number;
  proposalsReturned: number;
  proposalsTruncated: number;
  signalsEmitted: number;
}

export interface PreferenceExtractionResult {
  signals: PreferenceSignal[];
  evaluations: PreferenceProposalEvaluation[];
  inputRejections: PreferenceInputRejection[];
  diagnostics: PreferenceExtractionDiagnostics;
}

export type PreferenceExtractionErrorCode = 'event_limit_exceeded' | 'invalid_options';

export class NodeSlidePreferenceExtractionError extends Error {
  constructor(
    readonly code: PreferenceExtractionErrorCode,
    message: string,
  ) {
    super(`[NODESLIDE_PREFERENCE_${code.toUpperCase()}] ${message}`);
    this.name = 'NodeSlidePreferenceExtractionError';
  }
}

export interface PreferenceEventIdInput {
  tenantId: string;
  actorId: string;
  type: PreferenceEventType;
  sourceArtifactId: string;
  idempotencyKey: string;
}

export interface PreferenceSignalIdInput {
  tenantId: string;
  actorId: string;
  polarity: PreferencePolarity;
  scope: PreferenceScope;
  dimension: PreferenceDimension;
  value: string;
}

export function nodeslidePreferenceEventId(input: PreferenceEventIdInput): string {
  assertIdPart(input.tenantId, 'tenantId');
  assertIdPart(input.actorId, 'actorId');
  assertIdPart(input.sourceArtifactId, 'sourceArtifactId');
  assertIdPart(input.idempotencyKey, 'idempotencyKey');
  if (!isPreferenceEventType(input.type)) throw new TypeError('Unknown preference event type.');
  return nodeslideStableId(
    'preference_event',
    input.tenantId,
    input.actorId,
    input.type,
    input.sourceArtifactId,
    input.idempotencyKey,
  );
}

export function nodeslidePreferenceSignalId(input: PreferenceSignalIdInput): string {
  assertIdPart(input.tenantId, 'tenantId');
  assertIdPart(input.actorId, 'actorId');
  if (!isPreferenceScope(input.scope)) throw new TypeError('Invalid preference scope.');
  const normalizedValue = normalizeSignalValue(input.dimension, input.value);
  if (normalizedValue === null) throw new TypeError('Invalid preference signal value.');
  return nodeslideStableId(
    'preference_signal',
    input.tenantId,
    input.actorId,
    input.polarity,
    scopeKey(input.scope),
    input.dimension,
    normalizedValue,
  );
}

export function nodeslideTasteProfileId(tenantId: string, actorId: string): string {
  assertIdPart(tenantId, 'tenantId');
  assertIdPart(actorId, 'actorId');
  return nodeslideStableId('taste_profile', tenantId, actorId);
}

interface ResolvedEventArtifacts {
  deckVersion: PreferenceDeckVersionArtifact | undefined;
  variation: PreferenceVariationArtifact | undefined;
  variationBatch: PreferenceVariationBatchArtifact | undefined;
  patch: PreferencePatchArtifact | undefined;
  trace: PreferenceTraceArtifact | undefined;
  export: PreferenceExportArtifact | undefined;
  sourceEvent: PreferenceEvent | undefined;
  sourceIntegrity: EventIntegrity | undefined;
  acceptedExportPatch: PreferencePatchArtifact | undefined;
}

interface EventIntegrity {
  event: PreferenceEvent;
  schemaCodes: PreferenceEvaluatorRejectionCode[];
  provenanceCodes: PreferenceEvaluatorRejectionCode[];
  artifacts: ResolvedEventArtifacts;
}

interface EvaluationContext {
  resolver: PreferenceProvenanceResolver | undefined;
  eventsById: Map<string, PreferenceEvent>;
  conflictingEventIds: Set<string>;
  integrityById: Map<string, EventIntegrity>;
  resolvingEventIds: Set<string>;
}

interface InternalProposalEvaluation extends PreferenceProposalEvaluation {
  sourceEvent: PreferenceEvent;
}

interface EventBucket {
  event: PreferenceEvent;
  fingerprint: string;
  occurrences: number;
  conflicting: boolean;
}

export function extractPreferenceSignals(
  events: readonly PreferenceEvent[],
  options: ExtractPreferenceSignalsOptions = {},
): PreferenceExtractionResult {
  if (
    !Array.isArray(events) ||
    events.length > NODESLIDE_PREFERENCE_BOUNDS.maxEventsPerExtraction
  ) {
    throw new NodeSlidePreferenceExtractionError(
      'event_limit_exceeded',
      `At most ${NODESLIDE_PREFERENCE_BOUNDS.maxEventsPerExtraction} events may be evaluated.`,
    );
  }
  const proposalLimit = resolveProposalLimit(options.maxProposals);
  const deduplicated = deduplicateEvents(events);
  const orderedEvents = deduplicated.events.sort(compareEvents);
  const context: EvaluationContext = {
    resolver: options.resolver,
    eventsById: new Map(orderedEvents.map((event) => [event.id, event])),
    conflictingEventIds: deduplicated.conflictingEventIds,
    integrityById: new Map(),
    resolvingEventIds: new Set(),
  };

  const inputRejections = [...deduplicated.rejections];
  for (const event of orderedEvents) {
    const integrity = evaluateEventIntegrity(event, context);
    const rejectionCodes = uniqueCodes([...integrity.schemaCodes, ...integrity.provenanceCodes]);
    if (rejectionCodes.length > 0) inputRejections.push({ eventId: event.id, rejectionCodes });
  }

  const candidates = orderedEvents.flatMap((event) => buildEventProposals(event, context));
  let evaluations = candidates.map((candidate) => evaluateProposal(candidate, context));
  evaluations = suppressSiblingRejections(evaluations);
  evaluations = suppressContradictionsAndDuplicates(evaluations);
  evaluations.sort(compareEvaluations);

  const proposalsTruncated = Math.max(0, evaluations.length - proposalLimit);
  const returned =
    proposalLimit === 0 ? [] : evaluations.slice(Math.max(0, evaluations.length - proposalLimit));
  const publicEvaluations = returned.map(
    ({ sourceEvent: _sourceEvent, ...evaluation }) => evaluation,
  );
  const signals = publicEvaluations
    .filter((evaluation) => evaluation.evaluator.passed)
    .map(({ proposal, evaluator }) => ({ ...proposal, evaluator }));

  return {
    signals,
    evaluations: publicEvaluations,
    inputRejections: sortInputRejections(inputRejections),
    diagnostics: {
      inputEvents: events.length,
      uniqueEvents: orderedEvents.length,
      duplicateEvents: deduplicated.duplicateEvents,
      candidatePatterns: candidates.length,
      proposalsReturned: publicEvaluations.length,
      proposalsTruncated,
      signalsEmitted: signals.length,
    },
  };
}

function resolveProposalLimit(value: number | undefined): number {
  if (value === undefined) return NODESLIDE_PREFERENCE_BOUNDS.maxSignalProposals;
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    value > NODESLIDE_PREFERENCE_BOUNDS.maxSignalProposals
  ) {
    throw new NodeSlidePreferenceExtractionError(
      'invalid_options',
      `maxProposals must be an integer from 0 to ${NODESLIDE_PREFERENCE_BOUNDS.maxSignalProposals}.`,
    );
  }
  return value;
}

function deduplicateEvents(events: readonly PreferenceEvent[]): {
  events: PreferenceEvent[];
  rejections: PreferenceInputRejection[];
  duplicateEvents: number;
  conflictingEventIds: Set<string>;
} {
  const buckets = new Map<string, EventBucket>();
  const rejections: PreferenceInputRejection[] = [];
  const conflictingEventIds = new Set<string>();
  let duplicateEvents = 0;

  for (let index = 0; index < events.length; index += 1) {
    const rawEvent: unknown = events[index];
    if (!isRecord(rawEvent) || !isIdentifier(rawEvent.id)) {
      rejections.push({
        eventId: `invalid_event_${index.toString(36)}`,
        rejectionCodes: ['invalid_event_schema'],
      });
      continue;
    }
    const event = rawEvent as unknown as PreferenceEvent;
    const fingerprint = stablePreferenceStringify(rawEvent);
    const bucket = buckets.get(event.id);
    if (!bucket) {
      buckets.set(event.id, { event, fingerprint, occurrences: 1, conflicting: false });
      continue;
    }
    duplicateEvents += 1;
    bucket.occurrences += 1;
    if (bucket.fingerprint !== fingerprint) bucket.conflicting = true;
  }

  const deduplicated: PreferenceEvent[] = [];
  for (const [eventId, bucket] of buckets) {
    if (bucket.conflicting) {
      conflictingEventIds.add(eventId);
      rejections.push({ eventId, rejectionCodes: ['conflicting_event_id'] });
    } else {
      deduplicated.push(bucket.event);
    }
  }
  return { events: deduplicated, rejections, duplicateEvents, conflictingEventIds };
}

function evaluateEventIntegrity(
  event: PreferenceEvent,
  context: EvaluationContext,
): EventIntegrity {
  const cached = context.integrityById.get(event.id);
  if (cached) return cached;

  const artifacts = emptyResolvedArtifacts();
  if (context.resolvingEventIds.has(event.id)) {
    return {
      event,
      schemaCodes: eventSchemaCodes(event),
      provenanceCodes: ['source_event_invalid'],
      artifacts,
    };
  }

  context.resolvingEventIds.add(event.id);
  const integrity: EventIntegrity = {
    event,
    schemaCodes: eventSchemaCodes(event),
    provenanceCodes: eventProvenanceCodes(event, artifacts, context),
    artifacts,
  };
  context.resolvingEventIds.delete(event.id);
  context.integrityById.set(event.id, integrity);
  return integrity;
}

function emptyResolvedArtifacts(): ResolvedEventArtifacts {
  return {
    deckVersion: undefined,
    variation: undefined,
    variationBatch: undefined,
    patch: undefined,
    trace: undefined,
    export: undefined,
    sourceEvent: undefined,
    sourceIntegrity: undefined,
    acceptedExportPatch: undefined,
  };
}

function eventSchemaCodes(event: PreferenceEvent): PreferenceEvaluatorRejectionCode[] {
  const record: unknown = event;
  if (!isRecord(record)) return ['invalid_event_schema'];
  const codes: PreferenceEvaluatorRejectionCode[] = [];
  if (
    Object.keys(record).length !== EVENT_KEYS.size ||
    Object.keys(record).some((key) => !EVENT_KEYS.has(key)) ||
    record.schemaVersion !== NODESLIDE_PREFERENCE_SCHEMA_VERSION ||
    !isIdentifier(record.id) ||
    !isIdentifier(record.tenantId) ||
    !isIdentifier(record.actorId) ||
    !isPreferenceEventType(record.type) ||
    !isPreferenceScope(record.scope) ||
    !isTimestamp(record.occurredAt) ||
    !isTimestamp(record.recordedAt) ||
    (typeof record.occurredAt === 'number' &&
      typeof record.recordedAt === 'number' &&
      record.recordedAt < record.occurredAt)
  ) {
    codes.push('invalid_event_schema');
  }

  if (!validProvenanceShape(record.provenance)) codes.push('invalid_event_schema');
  codes.push(...attributeSchemaCodes(record.type, record.attributes));
  return uniqueCodes(codes);
}

function attributeSchemaCodes(
  eventType: unknown,
  attributes: unknown,
): PreferenceEvaluatorRejectionCode[] {
  if (!isRecord(attributes)) return ['invalid_event_schema'];
  const codes: PreferenceEvaluatorRejectionCode[] = [];
  const entries = Object.entries(attributes);
  if (entries.length > NODESLIDE_PREFERENCE_BOUNDS.maxAttributesPerEvent) {
    codes.push('attribute_limit_exceeded');
  }
  if (!isPreferenceEventType(eventType)) return uniqueCodes([...codes, 'invalid_event_schema']);

  const allowlist = new Set<string>(NODESLIDE_PREFERENCE_ATTRIBUTE_ALLOWLIST[eventType]);
  for (const [key, value] of entries) {
    if (key.length === 0 || key.length > NODESLIDE_PREFERENCE_BOUNDS.maxAttributeKeyLength) {
      codes.push('attribute_limit_exceeded');
    }
    if (!allowlist.has(key)) codes.push('attribute_not_allowed');
    if (
      (typeof value === 'string' &&
        value.length > NODESLIDE_PREFERENCE_BOUNDS.maxAttributeStringLength) ||
      (typeof value === 'number' && !Number.isFinite(value)) ||
      (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
    ) {
      codes.push('attribute_value_invalid');
      continue;
    }
    if (!validSemanticAttribute(key, value)) codes.push('attribute_value_invalid');
  }
  return uniqueCodes(codes);
}

function validSemanticAttribute(key: string, value: string | number | boolean): boolean {
  if (key === 'contentAngle') {
    return (
      typeof value === 'string' &&
      includesString(NODESLIDE_PREFERENCE_ATTRIBUTE_ENUMS.contentAngle, value)
    );
  }
  if (key === 'density') {
    return (
      typeof value === 'string' &&
      includesString(NODESLIDE_PREFERENCE_ATTRIBUTE_ENUMS.density, value)
    );
  }
  if (key === 'layoutArchetype') {
    return (
      typeof value === 'string' &&
      includesString(NODESLIDE_PREFERENCE_ATTRIBUTE_ENUMS.layoutArchetype, value)
    );
  }
  if (key === 'origin') {
    return (
      typeof value === 'string' &&
      includesString(NODESLIDE_PREFERENCE_ATTRIBUTE_ENUMS.origin, value)
    );
  }
  if (key === 'exportFormat') {
    return (
      typeof value === 'string' &&
      includesString(NODESLIDE_PREFERENCE_ATTRIBUTE_ENUMS.exportFormat, value)
    );
  }
  if (key === 'color' || key === 'supersededColor') {
    return typeof value === 'string' && normalizePreferenceColor(value) !== null;
  }
  if (key === 'font' || key === 'supersededFont') {
    return typeof value === 'string' && normalizePreferenceFont(value) !== null;
  }
  return true;
}

function validProvenanceShape(value: unknown): boolean {
  if (!isRecord(value) || Object.keys(value).some((key) => !PROVENANCE_KEYS.has(key))) {
    return false;
  }
  if (!isDeckVersion(value.deckVersion)) return false;
  return [...PROVENANCE_KEYS]
    .filter((key) => key !== 'deckVersion')
    .every((key) => value[key] === undefined || isIdentifier(value[key]));
}

function eventProvenanceCodes(
  event: PreferenceEvent,
  artifacts: ResolvedEventArtifacts,
  context: EvaluationContext,
): PreferenceEvaluatorRejectionCode[] {
  const record: unknown = event;
  if (!isRecord(record) || !isPreferenceEventType(record.type) || !isRecord(record.provenance)) {
    return ['missing_provenance'];
  }
  const provenance = record.provenance;
  const rule = NODESLIDE_PREFERENCE_PROVENANCE_REQUIREMENTS[record.type];
  const missingAllOf = rule.allOf.some((key) => !hasProvenanceValue(provenance, key));
  const missingAnyOf =
    'anyOf' in rule &&
    rule.anyOf !== undefined &&
    !rule.anyOf.some((alternative) =>
      alternative.every((key) => hasProvenanceValue(provenance, key)),
    );
  if (missingAllOf || missingAnyOf) return ['missing_provenance'];
  if (
    !isIdentifier(record.tenantId) ||
    !isPreferenceScope(record.scope) ||
    !isDeckVersion(provenance.deckVersion)
  ) {
    return ['provenance_chain_invalid'];
  }

  const codes: PreferenceEvaluatorRejectionCode[] = [];
  const deckVersion = resolveArtifact(
    { kind: 'deck_version', deckId: record.scope.deckId, deckVersion: provenance.deckVersion },
    event,
    context,
    codes,
  );
  if (deckVersion?.kind === 'deck_version') artifacts.deckVersion = deckVersion;

  if (
    record.type === 'variation_generated' ||
    record.type === 'variation_selected' ||
    record.type === 'variation_rejected'
  ) {
    validateVariationProvenance(event, provenance, artifacts, context, codes);
  } else if (record.type === 'patch_accepted') {
    validateAcceptedPatchProvenance(event, provenance, artifacts, context, codes);
  } else if (record.type === 'patch_modified') {
    validateModifiedPatchProvenance(event, provenance, artifacts, context, codes);
  } else if (record.type === 'patch_declined') {
    validateDeclinedPatchProvenance(event, provenance, artifacts, context, codes);
  } else if (record.type === 'export_completed') {
    validateExportProvenance(event, provenance, artifacts, context, codes);
  }
  return uniqueCodes(codes);
}

function validateVariationProvenance(
  event: PreferenceEvent,
  provenance: PreferenceUnknownRecord,
  artifacts: ResolvedEventArtifacts,
  context: EvaluationContext,
  codes: PreferenceEvaluatorRejectionCode[],
): void {
  const variationId = provenance.variationId;
  const batchId = provenance.variationBatchId;
  const traceId = provenance.traceId;
  if (!isIdentifier(variationId) || !isIdentifier(batchId) || !isIdentifier(traceId)) return;

  const variation = resolveArtifact({ kind: 'variation', id: variationId }, event, context, codes);
  const batch = resolveArtifact({ kind: 'variation_batch', id: batchId }, event, context, codes);
  const trace = resolveArtifact({ kind: 'trace', id: traceId }, event, context, codes);
  if (variation?.kind === 'variation') artifacts.variation = variation;
  if (batch?.kind === 'variation_batch') artifacts.variationBatch = batch;
  if (trace?.kind === 'trace') artifacts.trace = trace;

  if (
    !artifacts.variation ||
    !artifacts.variationBatch ||
    !artifacts.trace ||
    !sameScope(event.scope, artifacts.variation.scope) ||
    !sameScope(event.scope, artifacts.variationBatch.scope) ||
    !sameScope(event.scope, artifacts.trace.scope) ||
    artifacts.variation.batchId !== batchId ||
    !artifacts.variationBatch.variationIds.includes(variationId) ||
    (artifacts.trace.variationId !== variationId && artifacts.trace.variationBatchId !== batchId)
  ) {
    codes.push('provenance_chain_invalid');
  }

  if (event.type === 'variation_selected') {
    const patchId = provenance.patchId;
    if (!isIdentifier(patchId)) return;
    const patch = resolveArtifact({ kind: 'patch', id: patchId }, event, context, codes);
    if (patch?.kind === 'patch') artifacts.patch = patch;
    if (
      !artifacts.patch ||
      !sameScope(event.scope, artifacts.patch.scope) ||
      artifacts.patch.status !== 'accepted' ||
      artifacts.patch.variationId !== variationId ||
      (artifacts.patch.traceId !== undefined && artifacts.patch.traceId !== traceId) ||
      !patchIsBoundToClaimedDeckVersion(
        artifacts.patch,
        artifacts.deckVersion,
        provenance.deckVersion,
      )
    ) {
      codes.push('provenance_chain_invalid');
    }
  }
}

function validateAcceptedPatchProvenance(
  event: PreferenceEvent,
  provenance: PreferenceUnknownRecord,
  artifacts: ResolvedEventArtifacts,
  context: EvaluationContext,
  codes: PreferenceEvaluatorRejectionCode[],
): void {
  const patchId = provenance.patchId;
  if (!isIdentifier(patchId)) return;
  const patch = resolveArtifact({ kind: 'patch', id: patchId }, event, context, codes);
  if (patch?.kind === 'patch') artifacts.patch = patch;
  if (
    !artifacts.patch ||
    !sameScope(event.scope, artifacts.patch.scope) ||
    artifacts.patch.status !== 'accepted' ||
    !patchIsBoundToClaimedDeckVersion(
      artifacts.patch,
      artifacts.deckVersion,
      provenance.deckVersion,
    )
  ) {
    codes.push('provenance_chain_invalid');
    return;
  }

  const traceId = provenance.traceId;
  if (artifacts.patch.source === 'agent' && !isIdentifier(traceId)) {
    codes.push('agent_trace_missing');
    return;
  }
  if (isIdentifier(traceId)) {
    const trace = resolveArtifact({ kind: 'trace', id: traceId }, event, context, codes);
    if (trace?.kind === 'trace') artifacts.trace = trace;
    if (
      !artifacts.trace ||
      !sameScope(event.scope, artifacts.trace.scope) ||
      artifacts.patch.traceId !== traceId ||
      (artifacts.trace.patchId !== undefined && artifacts.trace.patchId !== patchId)
    ) {
      codes.push('provenance_chain_invalid');
    }
  }
}

function patchIsBoundToClaimedDeckVersion(
  patch: PreferencePatchArtifact | undefined,
  deckVersion: PreferenceDeckVersionArtifact | undefined,
  claimedDeckVersion: unknown,
): boolean {
  if (
    !patch ||
    !deckVersion ||
    !isDeckVersion(claimedDeckVersion) ||
    deckVersion.deckVersion !== claimedDeckVersion
  ) {
    return false;
  }
  if (patch.resultingDeckVersion !== undefined) {
    return patch.resultingDeckVersion === claimedDeckVersion;
  }
  return deckVersion.acceptedPatchIds.includes(patch.id);
}

function validateModifiedPatchProvenance(
  event: PreferenceEvent,
  provenance: PreferenceUnknownRecord,
  artifacts: ResolvedEventArtifacts,
  context: EvaluationContext,
  codes: PreferenceEvaluatorRejectionCode[],
): void {
  const patchId = provenance.patchId;
  const sourceEventId = provenance.sourceEventId;
  if (!isIdentifier(patchId) || !isIdentifier(sourceEventId)) return;
  const patch = resolveArtifact({ kind: 'patch', id: patchId }, event, context, codes);
  if (patch?.kind === 'patch') artifacts.patch = patch;
  if (
    !artifacts.patch ||
    !sameScope(event.scope, artifacts.patch.scope) ||
    artifacts.patch.status !== 'accepted'
  ) {
    codes.push('provenance_chain_invalid');
  }

  const sourceEvent = resolveEvidenceEvent(sourceEventId, context);
  artifacts.sourceEvent = sourceEvent;
  if (!sourceEvent || sourceEvent.id === event.id) {
    codes.push('source_event_invalid');
    return;
  }
  const sourceIntegrity = evaluateEventIntegrity(sourceEvent, context);
  artifacts.sourceIntegrity = sourceIntegrity;
  const sourcePatchId = sourceEvent.provenance?.patchId;
  if (
    sourceIntegrity.schemaCodes.length > 0 ||
    sourceIntegrity.provenanceCodes.length > 0 ||
    (sourceEvent.type !== 'patch_accepted' && sourceEvent.type !== 'variation_selected') ||
    sourceEvent.tenantId !== event.tenantId ||
    sourceEvent.actorId !== event.actorId ||
    !sameScope(sourceEvent.scope, event.scope) ||
    compareEvents(sourceEvent, event) >= 0 ||
    !isIdentifier(sourcePatchId) ||
    (sourcePatchId !== patchId && artifacts.patch?.supersedesPatchId !== sourcePatchId)
  ) {
    codes.push('source_event_invalid');
  }
}

function validateDeclinedPatchProvenance(
  event: PreferenceEvent,
  provenance: PreferenceUnknownRecord,
  artifacts: ResolvedEventArtifacts,
  context: EvaluationContext,
  codes: PreferenceEvaluatorRejectionCode[],
): void {
  if (isIdentifier(provenance.patchId)) {
    const patch = resolveArtifact({ kind: 'patch', id: provenance.patchId }, event, context, codes);
    if (patch?.kind === 'patch') artifacts.patch = patch;
    if (
      !artifacts.patch ||
      !sameScope(event.scope, artifacts.patch.scope) ||
      artifacts.patch.status !== 'rejected'
    ) {
      codes.push('provenance_chain_invalid');
    }
  }
  if (isIdentifier(provenance.traceId)) {
    const trace = resolveArtifact({ kind: 'trace', id: provenance.traceId }, event, context, codes);
    if (trace?.kind === 'trace') artifacts.trace = trace;
    if (!artifacts.trace || !sameScope(event.scope, artifacts.trace.scope)) {
      codes.push('provenance_chain_invalid');
    }
  }
}

function validateExportProvenance(
  event: PreferenceEvent,
  provenance: PreferenceUnknownRecord,
  artifacts: ResolvedEventArtifacts,
  context: EvaluationContext,
  codes: PreferenceEvaluatorRejectionCode[],
): void {
  const exportId = provenance.exportId;
  if (!isIdentifier(exportId) || !isDeckVersion(provenance.deckVersion)) return;
  const resolvedExport = resolveArtifact({ kind: 'export', id: exportId }, event, context, codes);
  if (resolvedExport?.kind === 'export') artifacts.export = resolvedExport;
  if (
    event.scope.kind !== 'deck' ||
    !artifacts.export ||
    !sameScope(event.scope, artifacts.export.scope) ||
    artifacts.export.status !== 'ready' ||
    artifacts.export.deckVersion !== provenance.deckVersion
  ) {
    codes.push('provenance_chain_invalid');
  }

  const acceptedPatchIds = artifacts.deckVersion?.acceptedPatchIds ?? [];
  for (const acceptedPatchId of [...acceptedPatchIds].sort()) {
    const patchCodes: PreferenceEvaluatorRejectionCode[] = [];
    const candidate = resolveArtifact(
      { kind: 'patch', id: acceptedPatchId },
      event,
      context,
      patchCodes,
    );
    if (
      candidate?.kind === 'patch' &&
      candidate.status === 'accepted' &&
      (candidate.resultingDeckVersion === undefined ||
        candidate.resultingDeckVersion <= provenance.deckVersion)
    ) {
      artifacts.acceptedExportPatch = candidate;
      break;
    }
  }
  if (!artifacts.acceptedExportPatch) codes.push('export_without_accepted_change');
}

function resolveArtifact(
  reference: PreferenceArtifactReference,
  event: PreferenceEvent,
  context: EvaluationContext,
  codes: PreferenceEvaluatorRejectionCode[],
): PreferenceProvenanceArtifact | undefined {
  if (!context.resolver) {
    codes.push('provenance_unresolvable');
    return undefined;
  }
  let artifact: PreferenceProvenanceArtifact | undefined;
  try {
    artifact = context.resolver.resolveArtifact(reference);
  } catch {
    codes.push('provenance_unresolvable');
    return undefined;
  }
  if (artifact === undefined) {
    codes.push('provenance_unresolvable');
    return undefined;
  }
  if (!validResolvedArtifact(reference, artifact, event)) {
    codes.push('provenance_chain_invalid');
    return undefined;
  }
  return artifact;
}

function validResolvedArtifact(
  reference: PreferenceArtifactReference,
  artifact: PreferenceProvenanceArtifact,
  event: PreferenceEvent,
): boolean {
  const value: unknown = artifact;
  if (
    !isRecord(value) ||
    !isIdentifier(value.tenantId) ||
    !isIdentifier(value.deckId) ||
    !isPreferenceScope(value.scope) ||
    value.tenantId !== event.tenantId ||
    value.deckId !== event.scope.deckId ||
    !scopesCompatible(value.scope, event.scope) ||
    value.kind !== reference.kind
  ) {
    return false;
  }

  if (reference.kind === 'deck_version') {
    return (
      value.kind === 'deck_version' &&
      value.deckId === reference.deckId &&
      value.deckVersion === reference.deckVersion &&
      isDeckVersion(value.deckVersion) &&
      validIdentifierList(value.acceptedPatchIds, RESOLVED_LINK_LIMIT)
    );
  }
  if (!('id' in reference) || value.id !== reference.id || !isIdentifier(value.id)) return false;
  if (reference.kind === 'variation') return validVariationArtifact(value);
  if (reference.kind === 'variation_batch') return validVariationBatchArtifact(value);
  if (reference.kind === 'patch') return validPatchArtifact(value);
  if (reference.kind === 'trace') return validTraceArtifact(value);
  return validExportArtifact(value);
}

function validVariationArtifact(value: PreferenceUnknownRecord): boolean {
  return (
    value.kind === 'variation' &&
    isIdentifier(value.batchId) &&
    isRecord(value.axes) &&
    includesString(NODESLIDE_PREFERENCE_ATTRIBUTE_ENUMS.contentAngle, value.axes.contentAngle) &&
    includesString(NODESLIDE_PREFERENCE_ATTRIBUTE_ENUMS.density, value.axes.density) &&
    includesString(
      NODESLIDE_PREFERENCE_ATTRIBUTE_ENUMS.layoutArchetype,
      value.axes.layoutArchetype,
    ) &&
    includesString(['ready', 'accepted', 'rejected', 'stale'] as const, value.status)
  );
}

function validVariationBatchArtifact(value: PreferenceUnknownRecord): boolean {
  return (
    value.kind === 'variation_batch' && validIdentifierList(value.variationIds, RESOLVED_LINK_LIMIT)
  );
}

function validPatchArtifact(value: PreferenceUnknownRecord): boolean {
  if (
    value.kind !== 'patch' ||
    !includesString(['human', 'agent', 'import', 'system'] as const, value.source) ||
    !includesString(
      ['draft', 'validating', 'ready', 'accepted', 'rejected', 'stale'] as const,
      value.status,
    ) ||
    !validOptionalIdentifier(value.traceId) ||
    !validOptionalIdentifier(value.variationId) ||
    !validOptionalIdentifier(value.supersedesPatchId) ||
    (value.resultingDeckVersion !== undefined && !isDeckVersion(value.resultingDeckVersion)) ||
    !Array.isArray(value.styleChanges) ||
    value.styleChanges.length > RESOLVED_LINK_LIMIT
  ) {
    return false;
  }
  return value.styleChanges.every((change) => {
    if (!isRecord(change) || (change.dimension !== 'color' && change.dimension !== 'font')) {
      return false;
    }
    if (change.before === undefined && change.after === undefined) return false;
    return (
      (change.before === undefined ||
        (typeof change.before === 'string' &&
          normalizeStyleValue(change.dimension, change.before) !== null)) &&
      (change.after === undefined ||
        (typeof change.after === 'string' &&
          normalizeStyleValue(change.dimension, change.after) !== null))
    );
  });
}

function validTraceArtifact(value: PreferenceUnknownRecord): boolean {
  return (
    value.kind === 'trace' &&
    validOptionalIdentifier(value.variationId) &&
    validOptionalIdentifier(value.variationBatchId) &&
    validOptionalIdentifier(value.patchId)
  );
}

function validExportArtifact(value: PreferenceUnknownRecord): boolean {
  return (
    value.kind === 'export' &&
    isDeckVersion(value.deckVersion) &&
    includesString(['queued', 'rendering', 'ready', 'failed'] as const, value.status) &&
    includesString(NODESLIDE_PREFERENCE_ATTRIBUTE_ENUMS.exportFormat, value.format)
  );
}

function resolveEvidenceEvent(
  eventId: string,
  context: EvaluationContext,
): PreferenceEvent | undefined {
  if (context.conflictingEventIds.has(eventId)) return undefined;
  const local = context.eventsById.get(eventId);
  if (local) return local;
  if (!context.resolver?.resolveEvent) return undefined;
  try {
    const event = context.resolver.resolveEvent(eventId);
    if (event?.id !== eventId) return undefined;
    return event;
  } catch {
    return undefined;
  }
}

interface ProposalCandidate {
  proposal: PreferenceSignalProposal;
  sourceEvent: PreferenceEvent;
}

function buildEventProposals(
  event: PreferenceEvent,
  context: EvaluationContext,
): ProposalCandidate[] {
  if (
    !isPreferenceEventType(event.type) ||
    !isIdentifier(event.id) ||
    !isIdentifier(event.tenantId) ||
    !isIdentifier(event.actorId) ||
    !isPreferenceScope(event.scope)
  ) {
    return [];
  }
  const integrity = evaluateEventIntegrity(event, context);
  if (event.type === 'variation_selected' || event.type === 'variation_rejected') {
    return buildVariationProposals(event, integrity);
  }
  if (event.type === 'patch_accepted') return buildAcceptedPatchProposals(event, integrity);
  if (event.type === 'patch_modified')
    return buildModifiedPatchProposals(event, integrity, context);
  if (event.type === 'export_completed') {
    const proposal = makeProposal(
      event,
      'positive',
      'workflow',
      'export_completed',
      NODESLIDE_PREFERENCE_RULE_CONFIDENCE.export_completed,
      [event.id],
      context,
    );
    return proposal ? [{ proposal, sourceEvent: event }] : [];
  }
  return [];
}

function buildVariationProposals(
  event: PreferenceEvent,
  integrity: EventIntegrity,
): ProposalCandidate[] {
  const attributes = eventAttributes(event);
  const axes = integrity.artifacts.variation?.axes;
  const definitions: ReadonlyArray<{
    attribute: keyof PreferenceVariationAxes;
    dimension: PreferenceDimension;
  }> = [
    { attribute: 'contentAngle', dimension: 'content_angle' },
    { attribute: 'density', dimension: 'density' },
    { attribute: 'layoutArchetype', dimension: 'layout_archetype' },
  ];
  const proposals: ProposalCandidate[] = [];
  for (const definition of definitions) {
    const hasAttribute = Object.hasOwn(attributes, definition.attribute);
    const rawValue = hasAttribute ? attributes[definition.attribute] : axes?.[definition.attribute];
    if (typeof rawValue !== 'string') continue;
    const proposal = makeProposal(
      event,
      event.type === 'variation_selected' ? 'positive' : 'negative',
      definition.dimension,
      rawValue,
      event.type === 'variation_selected'
        ? NODESLIDE_PREFERENCE_RULE_CONFIDENCE.variation_selected
        : NODESLIDE_PREFERENCE_RULE_CONFIDENCE.variation_rejected,
      [event.id],
      undefined,
    );
    if (proposal) proposals.push({ proposal, sourceEvent: event });
  }
  return proposals;
}

function buildAcceptedPatchProposals(
  event: PreferenceEvent,
  integrity: EventIntegrity,
): ProposalCandidate[] {
  const attributes = eventAttributes(event);
  const proposals: ProposalCandidate[] = [];
  for (const dimension of ['color', 'font'] as const) {
    const attributeValue = attributes[dimension];
    const rawValues =
      typeof attributeValue === 'string'
        ? [attributeValue]
        : styleChangeValues(integrity.artifacts.patch, dimension, 'after');
    for (const rawValue of uniqueStrings(rawValues)) {
      const proposal = makeProposal(
        event,
        'positive',
        dimension,
        rawValue,
        NODESLIDE_PREFERENCE_RULE_CONFIDENCE.patch_accepted,
        [event.id],
        undefined,
      );
      if (proposal) proposals.push({ proposal, sourceEvent: event });
    }
  }
  return proposals;
}

function buildModifiedPatchProposals(
  event: PreferenceEvent,
  integrity: EventIntegrity,
  context: EvaluationContext,
): ProposalCandidate[] {
  const attributes = eventAttributes(event);
  const sourcePatch = integrity.artifacts.sourceIntegrity?.artifacts.patch;
  const sourceEventId = event.provenance?.sourceEventId;
  const evidenceIds = isIdentifier(sourceEventId) ? [sourceEventId, event.id] : [event.id];
  const proposals: ProposalCandidate[] = [];
  const definitions = [
    { dimension: 'color' as const, attribute: 'supersededColor' },
    { dimension: 'font' as const, attribute: 'supersededFont' },
  ];
  for (const { dimension, attribute } of definitions) {
    const attributeValue = attributes[attribute];
    const rawValues =
      typeof attributeValue === 'string'
        ? [attributeValue]
        : styleChangeValues(sourcePatch ?? integrity.artifacts.patch, dimension, 'after');
    for (const rawValue of uniqueStrings(rawValues)) {
      const proposal = makeProposal(
        event,
        'negative',
        dimension,
        rawValue,
        NODESLIDE_PREFERENCE_RULE_CONFIDENCE.patch_modified,
        evidenceIds,
        context,
      );
      if (proposal) proposals.push({ proposal, sourceEvent: event });
    }
  }
  return proposals;
}

function makeProposal(
  event: PreferenceEvent,
  polarity: PreferencePolarity,
  dimension: PreferenceDimension,
  rawValue: string,
  confidence: number,
  evidenceIds: readonly string[],
  context: EvaluationContext | undefined,
): PreferenceSignalProposal | undefined {
  if (!isPreferenceScope(event.scope)) return undefined;
  const normalizedValue = normalizeSignalValue(dimension, rawValue) ?? rawValue;
  const orderedEvidenceIds = orderEvidenceIds(evidenceIds, context);
  const id = nodeslideStableId(
    'preference_signal',
    event.tenantId,
    event.actorId,
    polarity,
    scopeKey(event.scope),
    dimension,
    normalizedValue,
  );
  return {
    id,
    tenantId: event.tenantId,
    actorId: event.actorId,
    polarity,
    scope: cloneScope(event.scope),
    dimension,
    value: normalizedValue,
    confidence,
    evidenceEventIds: orderedEvidenceIds,
    createdAt: isTimestamp(event.recordedAt) ? event.recordedAt : 0,
  };
}

function evaluateProposal(
  candidate: ProposalCandidate,
  context: EvaluationContext,
): InternalProposalEvaluation {
  const primaryIntegrity = evaluateEventIntegrity(candidate.sourceEvent, context);
  const evidenceEvents = candidate.proposal.evidenceEventIds.map((eventId) =>
    resolveEvidenceEvent(eventId, context),
  );
  const evidenceIntegrity = evidenceEvents
    .filter((event): event is PreferenceEvent => event !== undefined)
    .map((event) => evaluateEventIntegrity(event, context));
  const schemaCodes = uniqueCodes([
    ...primaryIntegrity.schemaCodes,
    ...evidenceIntegrity.flatMap((integrity) => integrity.schemaCodes),
    ...proposalSchemaCodes(candidate.proposal, candidate.sourceEvent),
  ]);
  const provenanceCodes = uniqueCodes([
    ...primaryIntegrity.provenanceCodes,
    ...evidenceIntegrity.flatMap((integrity) => integrity.provenanceCodes),
    ...(evidenceEvents.some((event) => event === undefined)
      ? (['source_event_invalid'] as const)
      : []),
  ]);
  const hallucinationCodes = proposalIsDerivable(candidate, primaryIntegrity)
    ? []
    : (['value_not_derivable'] as const);
  const receipt = makeEvaluatorReceipt(
    candidate.proposal.evidenceEventIds,
    schemaCodes,
    provenanceCodes,
    hallucinationCodes,
  );
  return {
    proposal: candidate.proposal,
    sourceEventType: candidate.sourceEvent.type,
    evaluator: receipt,
    sourceEvent: candidate.sourceEvent,
  };
}

function proposalSchemaCodes(
  proposal: PreferenceSignalProposal,
  sourceEvent: PreferenceEvent,
): PreferenceEvaluatorRejectionCode[] {
  const normalizedValue = normalizeSignalValue(proposal.dimension, proposal.value);
  const evidenceIds = proposal.evidenceEventIds;
  const expectedId =
    normalizedValue === null
      ? undefined
      : nodeslideStableId(
          'preference_signal',
          proposal.tenantId,
          proposal.actorId,
          proposal.polarity,
          scopeKey(proposal.scope),
          proposal.dimension,
          normalizedValue,
        );
  if (
    !isIdentifier(proposal.id) ||
    proposal.id !== expectedId ||
    !isIdentifier(proposal.tenantId) ||
    !isIdentifier(proposal.actorId) ||
    !isPreferenceScope(proposal.scope) ||
    (proposal.polarity !== 'positive' && proposal.polarity !== 'negative') ||
    !DIMENSION_ORDER.includes(proposal.dimension) ||
    normalizedValue === null ||
    normalizedValue !== proposal.value ||
    proposal.value.length > NODESLIDE_PREFERENCE_BOUNDS.maxAttributeStringLength ||
    !Number.isFinite(proposal.confidence) ||
    proposal.confidence < 0 ||
    proposal.confidence > 1 ||
    evidenceIds.length === 0 ||
    evidenceIds.length > NODESLIDE_PREFERENCE_BOUNDS.maxEvidenceEventIds ||
    new Set(evidenceIds).size !== evidenceIds.length ||
    evidenceIds.some((eventId) => !isIdentifier(eventId)) ||
    !isTimestamp(proposal.createdAt) ||
    sourceEvent.tenantId !== proposal.tenantId ||
    sourceEvent.actorId !== proposal.actorId ||
    !sameScope(sourceEvent.scope, proposal.scope)
  ) {
    return ['invalid_signal_schema'];
  }
  return [];
}

function proposalIsDerivable(candidate: ProposalCandidate, integrity: EventIntegrity): boolean {
  const { proposal, sourceEvent } = candidate;
  if (sourceEvent.type === 'variation_selected' || sourceEvent.type === 'variation_rejected') {
    const axes = integrity.artifacts.variation?.axes;
    if (!axes) return false;
    if (proposal.dimension === 'content_angle') return proposal.value === axes.contentAngle;
    if (proposal.dimension === 'density') return proposal.value === axes.density;
    if (proposal.dimension === 'layout_archetype') {
      return proposal.value === axes.layoutArchetype;
    }
    return false;
  }
  if (sourceEvent.type === 'patch_accepted') {
    if (proposal.dimension !== 'color' && proposal.dimension !== 'font') return false;
    return styleChangeValues(integrity.artifacts.patch, proposal.dimension, 'after').includes(
      proposal.value,
    );
  }
  if (sourceEvent.type === 'patch_modified') {
    if (proposal.dimension !== 'color' && proposal.dimension !== 'font') return false;
    const sourcePatch = integrity.artifacts.sourceIntegrity?.artifacts.patch;
    if (!sourcePatch) return false;
    const wasAccepted = styleChangeValues(sourcePatch, proposal.dimension, 'after').includes(
      proposal.value,
    );
    if (!wasAccepted) return false;
    const currentPatch = integrity.artifacts.patch;
    if (currentPatch?.supersedesPatchId === sourcePatch.id) {
      return styleChangeValues(currentPatch, proposal.dimension, 'before').includes(proposal.value);
    }
    return currentPatch?.id === sourcePatch.id;
  }
  if (sourceEvent.type === 'export_completed') {
    const exportArtifact = integrity.artifacts.export;
    const exportFormat = eventAttributes(sourceEvent).exportFormat;
    return (
      proposal.dimension === 'workflow' &&
      proposal.value === 'export_completed' &&
      exportArtifact?.status === 'ready' &&
      integrity.artifacts.acceptedExportPatch !== undefined &&
      (exportFormat === undefined || exportFormat === exportArtifact.format)
    );
  }
  return false;
}

function makeEvaluatorReceipt(
  inputEventIds: readonly string[],
  schemaCodes: readonly PreferenceEvaluatorRejectionCode[],
  provenanceCodes: readonly PreferenceEvaluatorRejectionCode[],
  hallucinationCodes: readonly PreferenceEvaluatorRejectionCode[],
): PreferenceEvaluatorReceipt {
  const schema = uniqueCodes(schemaCodes);
  const provenance = uniqueCodes(provenanceCodes);
  const hallucination = uniqueCodes(hallucinationCodes);
  const rejectionCodes = uniqueCodes([...schema, ...provenance, ...hallucination]);
  return {
    evaluatorVersion: NODESLIDE_PREFERENCE_EVALUATOR_VERSION,
    passed: rejectionCodes.length === 0,
    checks: {
      schema: { passed: schema.length === 0, rejectionCodes: schema },
      provenance: { passed: provenance.length === 0, rejectionCodes: provenance },
      hallucination: { passed: hallucination.length === 0, rejectionCodes: hallucination },
    },
    rejectionCodes,
    inputEventIds: [...inputEventIds],
  };
}

function suppressSiblingRejections(
  evaluations: InternalProposalEvaluation[],
): InternalProposalEvaluation[] {
  const validSelections = evaluations.filter(
    (evaluation) =>
      evaluation.evaluator.passed && evaluation.sourceEventType === 'variation_selected',
  );
  return evaluations.map((evaluation) => {
    if (
      !evaluation.evaluator.passed ||
      evaluation.sourceEventType !== 'variation_rejected' ||
      !isIdentifier(evaluation.sourceEvent.provenance?.variationBatchId) ||
      !isIdentifier(evaluation.sourceEvent.provenance?.variationId)
    ) {
      return evaluation;
    }
    const hasSelectedSibling = validSelections.some(
      (selected) =>
        selected.proposal.tenantId === evaluation.proposal.tenantId &&
        selected.proposal.actorId === evaluation.proposal.actorId &&
        sameScope(selected.proposal.scope, evaluation.proposal.scope) &&
        selected.proposal.dimension === evaluation.proposal.dimension &&
        selected.proposal.value === evaluation.proposal.value &&
        selected.sourceEvent.provenance.variationBatchId ===
          evaluation.sourceEvent.provenance.variationBatchId &&
        selected.sourceEvent.provenance.variationId !==
          evaluation.sourceEvent.provenance.variationId,
    );
    return hasSelectedSibling
      ? suppressEvaluation(evaluation, 'sibling_axis_selected')
      : evaluation;
  });
}

function suppressContradictionsAndDuplicates(
  evaluations: InternalProposalEvaluation[],
): InternalProposalEvaluation[] {
  const next = [...evaluations];
  const indexesBySemanticKey = new Map<string, number[]>();
  for (let index = 0; index < next.length; index += 1) {
    const evaluation = next[index];
    if (!evaluation?.evaluator.passed) continue;
    const key = semanticPreferenceKey(evaluation.proposal);
    const indexes = indexesBySemanticKey.get(key) ?? [];
    indexes.push(index);
    indexesBySemanticKey.set(key, indexes);
  }

  for (const indexes of indexesBySemanticKey.values()) {
    indexes.sort((left, right) => compareEvaluations(next[left], next[right]));
    const latestIndex = indexes.at(-1);
    if (latestIndex === undefined) continue;
    const latest = next[latestIndex];
    if (!latest) continue;
    for (const index of indexes) {
      if (index === latestIndex) continue;
      const evaluation = next[index];
      if (!evaluation) continue;
      next[index] = suppressEvaluation(
        evaluation,
        evaluation.proposal.polarity === latest.proposal.polarity
          ? 'superseded_by_later_event'
          : 'contradicted_by_later_event',
      );
    }
  }
  return next;
}

function suppressEvaluation(
  evaluation: InternalProposalEvaluation,
  code: PreferenceEvaluatorRejectionCode,
): InternalProposalEvaluation {
  return {
    ...evaluation,
    evaluator: {
      ...evaluation.evaluator,
      passed: false,
      rejectionCodes: uniqueCodes([...evaluation.evaluator.rejectionCodes, code]),
    },
  };
}

function semanticPreferenceKey(proposal: PreferenceSignalProposal): string {
  return [
    proposal.tenantId,
    proposal.actorId,
    scopeKey(proposal.scope),
    proposal.dimension,
    proposal.value,
  ].join('\u001f');
}

function compareEvaluations(
  left: InternalProposalEvaluation | undefined,
  right: InternalProposalEvaluation | undefined,
): number {
  if (!left) return right ? -1 : 0;
  if (!right) return 1;
  const eventOrder = compareEvents(left.sourceEvent, right.sourceEvent);
  if (eventOrder !== 0) return eventOrder;
  const dimensionOrder =
    DIMENSION_ORDER.indexOf(left.proposal.dimension) -
    DIMENSION_ORDER.indexOf(right.proposal.dimension);
  if (dimensionOrder !== 0) return dimensionOrder;
  const valueOrder = left.proposal.value.localeCompare(right.proposal.value);
  if (valueOrder !== 0) return valueOrder;
  return left.proposal.id.localeCompare(right.proposal.id);
}

function compareEvents(left: PreferenceEvent, right: PreferenceEvent): number {
  const occurredAt = safeOrderNumber(left.occurredAt) - safeOrderNumber(right.occurredAt);
  if (occurredAt !== 0) return occurredAt;
  const recordedAt = safeOrderNumber(left.recordedAt) - safeOrderNumber(right.recordedAt);
  if (recordedAt !== 0) return recordedAt;
  return safeString(left.id).localeCompare(safeString(right.id));
}

function safeOrderNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sortInputRejections(
  rejections: readonly PreferenceInputRejection[],
): PreferenceInputRejection[] {
  const byEvent = new Map<string, PreferenceEvaluatorRejectionCode[]>();
  for (const rejection of rejections) {
    byEvent.set(
      rejection.eventId,
      uniqueCodes([...(byEvent.get(rejection.eventId) ?? []), ...rejection.rejectionCodes]),
    );
  }
  return [...byEvent]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([eventId, rejectionCodes]) => ({ eventId, rejectionCodes }));
}

export function normalizePreferenceColor(value: string): string | null {
  const match = value.trim().match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!match?.[1]) return null;
  const body = match[1].toLowerCase();
  if (body.length === 3 || body.length === 4) {
    return `#${[...body].map((character) => `${character}${character}`).join('')}`;
  }
  return `#${body}`;
}

export function normalizePreferenceFont(value: string): string | null {
  const normalized = value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > NODESLIDE_PREFERENCE_BOUNDS.maxAttributeStringLength ||
    hasControlCharacter(normalized) ||
    normalized.includes('url(') ||
    normalized.includes('://')
  ) {
    return null;
  }
  return normalized;
}

function normalizeSignalValue(dimension: PreferenceDimension, value: string): string | null {
  if (typeof value !== 'string') return null;
  if (dimension === 'content_angle') {
    return includesString(NODESLIDE_PREFERENCE_ATTRIBUTE_ENUMS.contentAngle, value) ? value : null;
  }
  if (dimension === 'density') {
    return includesString(NODESLIDE_PREFERENCE_ATTRIBUTE_ENUMS.density, value) ? value : null;
  }
  if (dimension === 'layout_archetype') {
    return includesString(NODESLIDE_PREFERENCE_ATTRIBUTE_ENUMS.layoutArchetype, value)
      ? value
      : null;
  }
  if (dimension === 'color') return normalizePreferenceColor(value);
  if (dimension === 'font') return normalizePreferenceFont(value);
  return value === 'export_completed' ? value : null;
}

function normalizeStyleValue(dimension: 'color' | 'font', value: string): string | null {
  return dimension === 'color' ? normalizePreferenceColor(value) : normalizePreferenceFont(value);
}

function styleChangeValues(
  patch: PreferencePatchArtifact | undefined,
  dimension: 'color' | 'font',
  side: 'before' | 'after',
): string[] {
  if (!patch) return [];
  return uniqueStrings(
    patch.styleChanges.flatMap((change) => {
      if (change.dimension !== dimension || typeof change[side] !== 'string') return [];
      const normalized = normalizeStyleValue(dimension, change[side]);
      return normalized === null ? [] : [normalized];
    }),
  );
}

function eventAttributes(event: PreferenceEvent): PreferenceUnknownRecord {
  const attributes: unknown = event.attributes;
  return isRecord(attributes) ? attributes : {};
}

function orderEvidenceIds(
  evidenceIds: readonly string[],
  context: EvaluationContext | undefined,
): string[] {
  const unique = uniqueStrings(evidenceIds.filter(isIdentifier));
  return unique.sort((left, right) => {
    const leftEvent = context ? resolveEvidenceEvent(left, context) : undefined;
    const rightEvent = context ? resolveEvidenceEvent(right, context) : undefined;
    if (leftEvent && rightEvent) return compareEvents(leftEvent, rightEvent);
    if (leftEvent) return -1;
    if (rightEvent) return 1;
    return left.localeCompare(right);
  });
}

function scopeKey(scope: PreferenceScope): string {
  if (scope.kind === 'deck') return `deck:${JSON.stringify(scope.deckId)}`;
  if (scope.kind === 'slide') {
    return `slide:${JSON.stringify(scope.deckId)}:${JSON.stringify(scope.slideId)}`;
  }
  return `element:${JSON.stringify(scope.deckId)}:${JSON.stringify(scope.slideId)}:${JSON.stringify(scope.elementId)}`;
}

function cloneScope(scope: PreferenceScope): PreferenceScope {
  if (scope.kind === 'deck') return { kind: 'deck', deckId: scope.deckId };
  if (scope.kind === 'slide') {
    return { kind: 'slide', deckId: scope.deckId, slideId: scope.slideId };
  }
  return {
    kind: 'element',
    deckId: scope.deckId,
    slideId: scope.slideId,
    elementId: scope.elementId,
  };
}

function sameScope(left: PreferenceScope, right: PreferenceScope): boolean {
  return scopeKey(left) === scopeKey(right);
}

function scopesCompatible(left: PreferenceScope, right: PreferenceScope): boolean {
  if (left.deckId !== right.deckId) return false;
  if (left.kind === 'deck' || right.kind === 'deck') return true;
  if (left.slideId !== right.slideId) return false;
  if (left.kind === 'slide' || right.kind === 'slide') return true;
  return left.elementId === right.elementId;
}

function isPreferenceScope(value: unknown): value is PreferenceScope {
  if (!isRecord(value) || !isIdentifier(value.deckId)) return false;
  if (value.kind === 'deck') {
    return Object.keys(value).length === 2 && Object.hasOwn(value, 'deckId');
  }
  if (value.kind === 'slide') {
    return (
      Object.keys(value).length === 3 &&
      Object.hasOwn(value, 'deckId') &&
      isIdentifier(value.slideId)
    );
  }
  if (value.kind === 'element') {
    return (
      Object.keys(value).length === 4 &&
      Object.hasOwn(value, 'deckId') &&
      isIdentifier(value.slideId) &&
      isIdentifier(value.elementId)
    );
  }
  return false;
}

function isPreferenceEventType(value: unknown): value is PreferenceEventType {
  return typeof value === 'string' && includesString(NODESLIDE_PREFERENCE_EVENT_TYPES, value);
}

function hasProvenanceValue(
  provenance: PreferenceUnknownRecord,
  key: keyof PreferenceEvent['provenance'],
): boolean {
  return key === 'deckVersion' ? isDeckVersion(provenance[key]) : isIdentifier(provenance[key]);
}

function validIdentifierList(value: unknown, limit: number): value is readonly string[] {
  return Array.isArray(value) && value.length <= limit && value.every(isIdentifier);
}

function validOptionalIdentifier(value: unknown): boolean {
  return value === undefined || isIdentifier(value);
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= IDENTIFIER_LIMIT &&
    value.trim() === value
  );
}

function assertIdPart(value: string, name: string): void {
  if (!isIdentifier(value)) throw new TypeError(`${name} must be a bounded non-empty identifier.`);
}

function isDeckVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0;
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0;
}

function isRecord(value: unknown): value is PreferenceUnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function includesString<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function uniqueCodes(
  codes: readonly PreferenceEvaluatorRejectionCode[],
): PreferenceEvaluatorRejectionCode[] {
  return [...new Set(codes)];
}

export function stablePreferenceStringify(
  value: unknown,
  ancestors = new WeakSet<object>(),
): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value);
  if (ancestors.has(value)) return '"[circular]"';
  ancestors.add(value);
  if (Array.isArray(value)) {
    const serialized = `[${value.map((entry) => stablePreferenceStringify(entry, ancestors)).join(',')}]`;
    ancestors.delete(value);
    return serialized;
  }
  const record = value as Record<string, unknown>;
  const serialized = `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stablePreferenceStringify(record[key], ancestors)}`)
    .join(',')}}`;
  ancestors.delete(value);
  return serialized;
}
