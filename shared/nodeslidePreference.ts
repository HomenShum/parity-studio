export const NODESLIDE_PREFERENCE_SCHEMA_VERSION = 'nodeslide.preference/v1' as const;
export const NODESLIDE_PREFERENCE_EVALUATOR_VERSION = 'nodeslide.preference-evaluator/v1' as const;

export const NODESLIDE_PREFERENCE_EVENT_TYPES = [
  'variation_generated',
  'variation_selected',
  'variation_rejected',
  'patch_accepted',
  'patch_modified',
  'patch_declined',
  'export_completed',
] as const;

export type PreferenceEventType = (typeof NODESLIDE_PREFERENCE_EVENT_TYPES)[number];

export type PreferenceScope =
  | { kind: 'deck'; deckId: string }
  | { kind: 'slide'; deckId: string; slideId: string }
  | { kind: 'element'; deckId: string; slideId: string; elementId: string };

export interface PreferenceProvenance {
  deckVersion: number;
  sourceEventId?: string;
  variationId?: string;
  variationBatchId?: string;
  patchId?: string;
  traceId?: string;
  exportId?: string;
  profileId?: string;
}

export interface PreferenceEvent {
  schemaVersion: typeof NODESLIDE_PREFERENCE_SCHEMA_VERSION;
  id: string;
  tenantId: string;
  actorId: string;
  type: PreferenceEventType;
  scope: PreferenceScope;
  provenance: PreferenceProvenance;
  attributes: Record<string, string | number | boolean>;
  occurredAt: number;
  recordedAt: number;
}

export type PreferencePolarity = 'positive' | 'negative';
export type PreferenceDimension =
  | 'content_angle'
  | 'density'
  | 'layout_archetype'
  | 'color'
  | 'font'
  | 'workflow';

export type PreferenceEvaluatorRejectionCode =
  | 'invalid_event_schema'
  | 'invalid_signal_schema'
  | 'attribute_limit_exceeded'
  | 'attribute_not_allowed'
  | 'attribute_value_invalid'
  | 'missing_provenance'
  | 'provenance_unresolvable'
  | 'provenance_chain_invalid'
  | 'agent_trace_missing'
  | 'source_event_invalid'
  | 'export_without_accepted_change'
  | 'value_not_derivable'
  | 'contradicted_by_later_event'
  | 'sibling_axis_selected'
  | 'superseded_by_later_event'
  | 'conflicting_event_id';

export interface PreferenceEvaluatorCheckReceipt {
  passed: boolean;
  rejectionCodes: PreferenceEvaluatorRejectionCode[];
}

export interface PreferenceEvaluatorReceipt {
  evaluatorVersion: typeof NODESLIDE_PREFERENCE_EVALUATOR_VERSION;
  passed: boolean;
  checks: {
    schema: PreferenceEvaluatorCheckReceipt;
    provenance: PreferenceEvaluatorCheckReceipt;
    hallucination: PreferenceEvaluatorCheckReceipt;
  };
  rejectionCodes: PreferenceEvaluatorRejectionCode[];
  inputEventIds: string[];
}

export interface PreferenceSignal {
  id: string;
  tenantId: string;
  actorId: string;
  polarity: PreferencePolarity;
  scope: PreferenceScope;
  dimension: PreferenceDimension;
  value: string;
  confidence: number;
  evidenceEventIds: string[];
  evaluator: PreferenceEvaluatorReceipt;
  createdAt: number;
}

export interface TasteProfile {
  schemaVersion: typeof NODESLIDE_PREFERENCE_SCHEMA_VERSION;
  id: string;
  tenantId: string;
  actorId: string;
  signals: PreferenceSignal[];
  updatedAt: number;
}

export const NODESLIDE_PREFERENCE_BOUNDS = Object.freeze({
  maxRetainedEvents: 1_000,
  maxProfileSignals: 100,
  maxEventsPerExtraction: 100,
  maxSignalProposals: 20,
  maxAttributesPerEvent: 32,
  maxAttributeKeyLength: 64,
  maxAttributeStringLength: 240,
  maxEvidenceEventIds: 16,
  defaultListLimit: 50,
  maxListLimit: 200,
}) as Readonly<{
  maxRetainedEvents: 1_000;
  maxProfileSignals: 100;
  maxEventsPerExtraction: 100;
  maxSignalProposals: 20;
  maxAttributesPerEvent: 32;
  maxAttributeKeyLength: 64;
  maxAttributeStringLength: 240;
  maxEvidenceEventIds: 16;
  defaultListLimit: 50;
  maxListLimit: 200;
}>;

export const NODESLIDE_PREFERENCE_ATTRIBUTE_ALLOWLIST = Object.freeze({
  variation_generated: ['contentAngle', 'density', 'layoutArchetype', 'origin'],
  variation_selected: ['contentAngle', 'density', 'layoutArchetype'],
  variation_rejected: ['contentAngle', 'density', 'layoutArchetype'],
  patch_accepted: ['color', 'font'],
  patch_modified: ['color', 'font', 'supersededColor', 'supersededFont'],
  patch_declined: [],
  export_completed: ['exportFormat'],
} as const satisfies Readonly<Record<PreferenceEventType, readonly string[]>>);

export const NODESLIDE_PREFERENCE_ATTRIBUTE_ENUMS = Object.freeze({
  contentAngle: ['data_led', 'narrative_led', 'balanced'],
  density: ['executive', 'detail', 'balanced'],
  layoutArchetype: ['headline', 'split', 'evidence', 'comparison'],
  origin: ['free_route', 'deterministic_fallback'],
  exportFormat: ['html', 'pptx', 'pdf', 'png'],
} as const);

export type PreferenceProvenanceKey = keyof PreferenceProvenance;

export interface PreferenceProvenanceRule {
  allOf: readonly PreferenceProvenanceKey[];
  anyOf?: readonly (readonly PreferenceProvenanceKey[])[];
  traceIdWhenAgentSourced?: boolean;
}

export const NODESLIDE_PREFERENCE_PROVENANCE_REQUIREMENTS = Object.freeze({
  variation_generated: {
    allOf: ['deckVersion', 'variationId', 'variationBatchId', 'traceId'],
  },
  variation_selected: {
    allOf: ['deckVersion', 'variationId', 'variationBatchId', 'patchId', 'traceId'],
  },
  variation_rejected: {
    allOf: ['deckVersion', 'variationId', 'variationBatchId', 'traceId'],
  },
  patch_accepted: {
    allOf: ['deckVersion', 'patchId'],
    traceIdWhenAgentSourced: true,
  },
  patch_modified: {
    allOf: ['deckVersion', 'patchId', 'sourceEventId'],
  },
  patch_declined: {
    allOf: ['deckVersion'],
    anyOf: [['patchId'], ['traceId']],
  },
  export_completed: {
    allOf: ['deckVersion', 'exportId'],
  },
} as const satisfies Readonly<Record<PreferenceEventType, PreferenceProvenanceRule>>);

export const NODESLIDE_PREFERENCE_RULE_CONFIDENCE = Object.freeze({
  variation_selected: 0.9,
  variation_rejected: 0.6,
  patch_accepted: 0.85,
  patch_modified: 0.5,
  export_completed: 0.7,
} as const);
