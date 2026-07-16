import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { nodeslideExecutionTraceFields } from './lib/nodeslideExecutionTraceValidator';
import { NODESLIDE_JOB_PHASES, NODESLIDE_JOB_STATUSES } from './lib/nodeslideJobState';
import { nodeslideShadowComparisonFields } from './lib/nodeslideShadowComparisonValidator';
import {
  nodeslideBoundingBoxValidator,
  nodeslideBriefValidator,
  nodeslideCandidateValidationReceiptValidator,
  nodeslideChartDataValidator,
  nodeslideClaimSourceBindingValidator,
  nodeslideCommentAnchorValidator,
  nodeslideCursorValidator,
  nodeslideElementStyleValidator,
  nodeslideElementValidator,
  nodeslideExportCapabilityValidator,
  nodeslideImageDataValidator,
  nodeslideMathDataValidator,
  nodeslidePatchOperationValidator,
  nodeslidePatchScopeValidator,
  nodeslidePatchSourceValidator,
  nodeslidePatchStatusValidator,
  nodeslideSnapshotValidator,
  nodeslideSourceBindingStatusValidator,
  nodeslideThemeValidator,
  nodeslideValidationIssueValidator,
  nodeslideValidationResultValidator,
  nodeslideVariationAxesValidator,
  nodeslideVariationCandidateValidator,
  nodeslideVariationDecisionEventValidator,
  nodeslideVariationOriginValidator,
  nodeslideVariationStatusValidator,
  nodeslideVersionClockValidator,
  nodeslideVideoDataValidator,
} from './lib/nodeslideValidators';

const nodeslideDecisionProvenanceValidator = v.union(
  v.object({
    authority: v.literal('owner_capability'),
    decidedAt: v.number(),
  }),
  v.object({
    authority: v.literal('delegated'),
    capability: v.literal('accept_validated'),
    grantId: v.string(),
    clientKind: v.union(v.literal('browser'), v.literal('codex'), v.literal('claude')),
    policyDigest: v.string(),
    decidedAt: v.number(),
  }),
);

const nodeslidePreferenceEventTypeValidator = v.union(
  v.literal('variation_generated'),
  v.literal('variation_selected'),
  v.literal('variation_rejected'),
  v.literal('patch_accepted'),
  v.literal('patch_modified'),
  v.literal('patch_declined'),
  v.literal('export_completed'),
);

const nodeslidePreferenceScopeValidator = v.union(
  v.object({ kind: v.literal('deck'), deckId: v.string() }),
  v.object({ kind: v.literal('slide'), deckId: v.string(), slideId: v.string() }),
  v.object({
    kind: v.literal('element'),
    deckId: v.string(),
    slideId: v.string(),
    elementId: v.string(),
  }),
);

const nodeslideDurableRequestBindingValidator = v.object({
  schemaVersion: v.literal('nodeslide.request-binding/v2'),
  requestDigest: v.string(),
  capabilityDigest: v.string(),
});

const nodeslideDurableCapabilityMetadataValidator = v.object({
  schemaVersion: v.literal('nodeslide.capability-digest/v2'),
  capabilityDigest: v.string(),
  provider: v.optional(v.string()),
  model: v.optional(v.string()),
  scopes: v.array(v.string()),
  egress: v.union(
    v.literal('none'),
    v.literal('model'),
    v.literal('web'),
    v.literal('model_and_web'),
  ),
  hasSecret: v.boolean(),
  hasConsent: v.boolean(),
  attachmentCount: v.number(),
  consentDigest: v.optional(v.string()),
  attachmentsDigest: v.optional(v.string()),
});

const nodeslideDurableJobStatusValidator = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('retrying'),
  v.literal('paused'),
  v.literal('awaiting_review'),
  v.literal('succeeded'),
  v.literal('failed'),
  v.literal('cancelled'),
  v.literal('rejected'),
  v.literal('stale'),
);

const nodeslideDurableLeaseValidator = v.object({
  leaseId: v.string(),
  workerId: v.string(),
  attempt: v.number(),
  egressEpoch: v.number(),
  issuedAt: v.number(),
  expiresAt: v.number(),
});

const nodeslideDurableJobValidator = v.object({
  jobId: v.string(),
  requestBinding: nodeslideDurableRequestBindingValidator,
  status: nodeslideDurableJobStatusValidator,
  attempt: v.number(),
  retryCount: v.number(),
  resumeCount: v.number(),
  maxAttempts: v.number(),
  lease: v.optional(nodeslideDurableLeaseValidator),
  reason: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
});

const nodeslideDurableJobEventValidator = v.object({
  schemaVersion: v.literal('nodeslide.durable-session/v2'),
  sequence: v.number(),
  stateVersion: v.number(),
  jobId: v.string(),
  kind: v.union(
    v.literal('enqueued'),
    v.literal('claimed'),
    v.literal('transitioned'),
    v.literal('retried'),
    v.literal('resumed'),
    v.literal('paused'),
    v.literal('egress_rotated'),
    v.literal('stale_fenced'),
  ),
  fromStatus: v.union(v.null(), nodeslideDurableJobStatusValidator),
  toStatus: nodeslideDurableJobStatusValidator,
  requestBinding: nodeslideDurableRequestBindingValidator,
  egressEpoch: v.number(),
  attempt: v.number(),
  occurredAt: v.number(),
  leaseId: v.optional(v.string()),
  reason: v.optional(v.string()),
  eventDigest: v.string(),
});

const nodeslideDurableJournalBindingValidator = v.object({
  schemaVersion: v.literal('nodeslide.request-binding/v2'),
  sessionId: v.string(),
  jobId: v.string(),
  requestDigest: v.string(),
  capabilityDigest: v.string(),
  egressEpoch: v.number(),
  attempt: v.number(),
});

const nodeslidePreferenceProvenanceValidator = v.object({
  deckVersion: v.number(),
  sourceEventId: v.optional(v.string()),
  variationId: v.optional(v.string()),
  variationBatchId: v.optional(v.string()),
  patchId: v.optional(v.string()),
  traceId: v.optional(v.string()),
  exportId: v.optional(v.string()),
  profileId: v.optional(v.string()),
});

const nodeslidePreferenceContentAngleValidator = v.union(
  v.literal('data_led'),
  v.literal('narrative_led'),
  v.literal('balanced'),
);
const nodeslidePreferenceDensityValidator = v.union(
  v.literal('executive'),
  v.literal('detail'),
  v.literal('balanced'),
);
const nodeslidePreferenceLayoutValidator = v.union(
  v.literal('headline'),
  v.literal('split'),
  v.literal('evidence'),
  v.literal('comparison'),
);
const nodeslidePreferenceAttributesValidator = v.union(
  v.object({
    contentAngle: nodeslidePreferenceContentAngleValidator,
    density: nodeslidePreferenceDensityValidator,
    layoutArchetype: nodeslidePreferenceLayoutValidator,
    origin: v.union(v.literal('free_route'), v.literal('deterministic_fallback')),
  }),
  v.object({
    contentAngle: nodeslidePreferenceContentAngleValidator,
    density: nodeslidePreferenceDensityValidator,
    layoutArchetype: nodeslidePreferenceLayoutValidator,
  }),
  v.object({ color: v.optional(v.string()), font: v.optional(v.string()) }),
  v.object({
    color: v.optional(v.string()),
    font: v.optional(v.string()),
    supersededColor: v.optional(v.string()),
    supersededFont: v.optional(v.string()),
  }),
  v.object({}),
  v.object({
    exportFormat: v.union(v.literal('html'), v.literal('pptx'), v.literal('pdf'), v.literal('png')),
  }),
);

const nodeslidePreferenceRejectionCodeValidator = v.union(
  v.literal('invalid_event_schema'),
  v.literal('invalid_signal_schema'),
  v.literal('attribute_limit_exceeded'),
  v.literal('attribute_not_allowed'),
  v.literal('attribute_value_invalid'),
  v.literal('missing_provenance'),
  v.literal('provenance_unresolvable'),
  v.literal('provenance_chain_invalid'),
  v.literal('agent_trace_missing'),
  v.literal('source_event_invalid'),
  v.literal('export_without_accepted_change'),
  v.literal('value_not_derivable'),
  v.literal('contradicted_by_later_event'),
  v.literal('sibling_axis_selected'),
  v.literal('superseded_by_later_event'),
  v.literal('conflicting_event_id'),
);
const nodeslidePreferenceEvaluatorCheckValidator = v.object({
  passed: v.boolean(),
  rejectionCodes: v.array(nodeslidePreferenceRejectionCodeValidator),
});
const nodeslidePreferenceSignalValidator = v.object({
  id: v.string(),
  tenantId: v.string(),
  actorId: v.string(),
  polarity: v.union(v.literal('positive'), v.literal('negative')),
  scope: nodeslidePreferenceScopeValidator,
  dimension: v.union(
    v.literal('content_angle'),
    v.literal('density'),
    v.literal('layout_archetype'),
    v.literal('color'),
    v.literal('font'),
    v.literal('workflow'),
  ),
  value: v.string(),
  confidence: v.number(),
  evidenceEventIds: v.array(v.string()),
  evaluator: v.object({
    evaluatorVersion: v.literal('nodeslide.preference-evaluator/v1'),
    passed: v.boolean(),
    checks: v.object({
      schema: nodeslidePreferenceEvaluatorCheckValidator,
      provenance: nodeslidePreferenceEvaluatorCheckValidator,
      hallucination: nodeslidePreferenceEvaluatorCheckValidator,
    }),
    rejectionCodes: v.array(nodeslidePreferenceRejectionCodeValidator),
    inputEventIds: v.array(v.string()),
  }),
  createdAt: v.number(),
});

// All cost fields stored as integer micro-cents (1 USD = 1_000_000 micro-cents)
// to dodge floating-point drift on summation. UI converts back to USD on read.

export const RUN_STATUSES = [
  'queued',
  'generating',
  'decomposing',
  'verifying',
  'iterating',
  'done',
  'failed',
] as const;

const SUPPORTED_PROVIDER_UNION = v.union(
  v.literal('anthropic'),
  v.literal('openai'),
  v.literal('google'),
  v.literal('openrouter'),
  v.literal('groq'),
  v.literal('cerebras'),
  v.literal('xai'),
  v.literal('mistral'),
);

export const PARITY_STATUSES = [
  'verified',
  'needs_review',
  'needs_iteration',
  'failed',
  'unavailable',
] as const;

const nodeslidePublishedDeckValidator = v.object({
  schemaVersion: v.literal('nodeslide.slidelang/v1'),
  toolchainVersion: v.string(),
  id: v.string(),
  title: v.string(),
  theme: nodeslideThemeValidator,
  slideOrder: v.array(v.string()),
  version: v.number(),
  status: v.literal('published'),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const nodeslidePublishedSlideValidator = v.object({
  id: v.string(),
  deckId: v.string(),
  title: v.string(),
  section: v.optional(v.string()),
  background: v.string(),
  elementOrder: v.array(v.string()),
  version: v.number(),
});

const nodeslidePublishedSourceValidator = v.object({
  id: v.string(),
  deckId: v.string(),
  title: v.string(),
  url: v.optional(v.string()),
  sourceType: v.literal('url'),
  retrievedAt: v.number(),
  citation: v.string(),
  license: v.optional(v.string()),
});

const nodeslidePublishedSnapshotValidator = v.object({
  deck: nodeslidePublishedDeckValidator,
  slides: v.array(nodeslidePublishedSlideValidator),
  elements: v.array(nodeslideElementValidator),
  sources: v.array(nodeslidePublishedSourceValidator),
});

const nodeslideSyncObjectLinkValidator = v.object({
  kind: v.union(v.literal('deck'), v.literal('slide'), v.literal('element')),
  localId: v.string(),
  remoteId: v.string(),
  semanticFingerprint: v.string(),
  localSlideId: v.optional(v.string()),
  remoteSlideId: v.optional(v.string()),
});

export default defineSchema({
  projects: defineTable({
    clientSessionId: v.optional(v.string()),
    title: v.string(),
    domain: v.optional(v.union(v.literal('parity'), v.literal('nodeslide'))),
    brief: v.optional(nodeslideBriefValidator),
    sourceType: v.optional(
      v.union(
        v.literal('prompt'),
        v.literal('image'),
        v.literal('zip'),
        v.literal('platform-route'),
        v.literal('unknown'),
      ),
    ),
    starred: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_session_updated', ['clientSessionId', 'updatedAt'])
    .index('by_updated', ['updatedAt']),

  runs: defineTable({
    projectId: v.optional(v.id('projects')),
    clientSessionId: v.optional(v.string()),
    title: v.optional(v.string()),
    prompt: v.optional(v.string()),
    sourceImageStorageId: v.optional(v.id('_storage')),
    /**
     * Inline source-image bytes, persisted so the canvas can render the
     * original sketch alongside whatever component is currently scoped
     * (the SourceImagePopover). Same 2 MB cap as runs.start. For larger
     * images, sourceImageStorageId is the path forward.
     */
    sourceImageBase64: v.optional(v.string()),
    sourceImageMimeType: v.optional(
      v.union(v.literal('image/png'), v.literal('image/jpeg'), v.literal('image/webp')),
    ),
    status: v.union(...RUN_STATUSES.map((s) => v.literal(s))),
    workflowId: v.optional(v.string()),
    streamId: v.optional(v.string()),
    costMicroUsd: v.number(),
    iterationsCompleted: v.number(),
    errorMessage: v.optional(v.string()),
    finishedAt: v.optional(v.number()),
    /**
     * Optional tier override for this run. When set, the agent loop +
     * pipeline use it instead of the deployment-wide PARITY_TIER. UI
     * lets the user cycle Frontier / Balanced / Free per session.
     */
    tier: v.optional(
      v.union(v.literal('frontier'), v.literal('balanced'), v.literal('free'), v.literal('small')),
    ),
    /**
     * Optional explicit model override for advanced/BYOK runs. When set,
     * text/agent/pipeline phases use this provider+model instead of the
     * curated tier router. Deterministic checks stay local; source image
     * generation remains a separate image-model path.
     */
    modelOverride: v.optional(
      v.object({
        provider: SUPPORTED_PROVIDER_UNION,
        modelId: v.string(),
        label: v.optional(v.string()),
      }),
    ),
    /**
     * Per-stage cost + telemetry breakdown for the cost panel UI.
     * Append-only: each stage push appends one entry; iterate stages
     * append their own. Reads as a flat list ordered by stageStartedAt.
     */
    costBreakdown: v.optional(
      v.array(
        v.object({
          stage: v.string(), // 'generate' | 'decompose' | 'verify-deterministic' | 'verify-visual' | 'iterate-1' | ...
          modelId: v.string(),
          provider: v.string(),
          costMicroUsd: v.number(),
          inputTokens: v.optional(v.number()),
          outputTokens: v.optional(v.number()),
          latencyMs: v.number(),
          stageStartedAt: v.number(),
        }),
      ),
    ),
  })
    .index('by_status', ['status'])
    .index('by_session', ['clientSessionId'])
    .index('by_project', ['projectId']),

  artifacts: defineTable({
    runId: v.id('runs'),
    version: v.number(), // 0 = initial generation, 1+ = iteration outputs
    html: v.string(),
    sizeBytes: v.number(),
  }).index('by_run_version', ['runId', 'version']),

  ui_kits: defineTable({
    runId: v.id('runs'),
    artifactVersion: v.number(),
    slug: v.string(),
    schemaVersion: v.number(),
    files: v.any(), // {[path: string]: string} tree
    fileCount: v.number(),
    decomposeCostMicroUsd: v.number(),
  })
    .index('by_run', ['runId'])
    .index('by_run_version', ['runId', 'artifactVersion']),

  design_revisions: defineTable({
    runId: v.id('runs'),
    uiKitId: v.id('ui_kits'),
    revisionNumber: v.number(),
    kind: v.union(
      v.literal('initial'),
      v.literal('manual-edit'),
      v.literal('agent-edit'),
      v.literal('file-create'),
      v.literal('file-rename'),
      v.literal('file-delete'),
      v.literal('import'),
      v.literal('sync'),
      v.literal('export'),
    ),
    label: v.string(),
    summary: v.string(),
    changedPaths: v.array(v.string()),
    fileCount: v.number(),
    filesDigest: v.string(),
    source: v.optional(v.union(v.literal('app'), v.literal('agent'), v.literal('mcp'))),
    createdAt: v.number(),
  })
    .index('by_run_revision', ['runId', 'revisionNumber'])
    .index('by_run_created', ['runId', 'createdAt'])
    .index('by_uikit', ['uiKitId']),

  /**
   * User comments pinned to a region of the rendered artifact. Used by the
   * "iterate with comments" path: the agent receives the bbox + text and
   * is told to address each comment in the next decompose pass.
   *
   * Bbox coordinates are normalized to 0..1 over the rendered iframe so they
   * survive viewport changes (desktop / tablet / mobile). status='open' until
   * the next iterate run consumes it; then 'addressed'.
   */
  comments: defineTable({
    runId: v.id('runs'),
    artifactVersion: v.number(),
    text: v.string(),
    bbox: v.optional(
      v.object({
        x: v.number(),
        y: v.number(),
        w: v.number(),
        h: v.number(),
      }),
    ),
    /**
     * Optional file path within the latest ui_kit (e.g. "components/Button.tsx").
     * Set when the user clicks a file in FilesPanel before commenting, so the
     * iterate prompt can scope the change to that component instead of the whole
     * artifact. Coexists with bbox — both can be present.
     */
    targetFile: v.optional(v.string()),
    selector: v.optional(v.string()),
    domPath: v.optional(v.string()),
    elementLabel: v.optional(v.string()),
    tagName: v.optional(v.string()),
    textSnippet: v.optional(v.string()),
    componentHint: v.optional(v.string()),
    status: v.union(v.literal('open'), v.literal('addressed'), v.literal('dismissed')),
  })
    .index('by_run', ['runId'])
    .index('by_run_status', ['runId', 'status']),

  /**
   * Conversation log per run. Drives the ChatPanel surface — user turns,
   * assistant turns (with optional tool calls), and tool result turns.
   * The agent's tool calls (read_file, patch_file, upsert_file,
   * iterate_now, list_files) act on the run's ui_kit row, so any edit
   * is atomic and round-trips through the canonical-shape exporter.
   */
  chat_messages: defineTable({
    runId: v.id('runs'),
    role: v.union(v.literal('user'), v.literal('assistant'), v.literal('tool')),
    /** Plain text content. Empty string allowed for tool turns whose
     * payload is fully captured in toolName/toolArgs/toolResult. */
    content: v.string(),
    /** For assistant turns: the tool calls the model emitted alongside
     * (or instead of) prose. Each entry has id + name + args (JSON). */
    toolCalls: v.optional(
      v.array(
        v.object({
          id: v.string(),
          name: v.string(),
          args: v.string(),
        }),
      ),
    ),
    /** For tool turns: the call id this result corresponds to. */
    toolCallId: v.optional(v.string()),
    /** For tool turns: short label of the tool (e.g. 'patch_file'). */
    toolName: v.optional(v.string()),
    /** Optional model + provider tag for assistant turns. */
    modelId: v.optional(v.string()),
    provider: v.optional(v.string()),
    /** Provider-reported cost for this turn, if any. */
    costMicroUsd: v.optional(v.number()),
    /** Turn index, monotonic per run. Lets the UI keep order without
     * needing to rely on _creationTime stability under high write rate. */
    turn: v.number(),
  })
    .index('by_run_turn', ['runId', 'turn'])
    .index('by_run', ['runId']),

  parity_reports: defineTable({
    runId: v.id('runs'),
    uiKitId: v.id('ui_kits'),
    iterationNumber: v.number(),
    passCount: v.number(),
    totalChecks: v.number(),
    status: v.union(...PARITY_STATUSES.map((s) => v.literal(s))),
    gaps: v.any(), // ParityGap[]
    summary: v.string(),
    judgeCostMicroUsd: v.number(),
    judgeModel: v.optional(v.string()),
    /**
     * Sprint 3 (2026-04-28): typed 16-row check rubric per
     * docs/plans/2026-04-28-shell-revamp-from-reference.md §6.
     * Optional for back-compat with rows written before the rewrite.
     * Each entry is { id, label, status: 'pass'|'warn'|'fail'|'unavailable',
     * evidence: string[] }.
     */
    checks: v.optional(v.any()),
  })
    .index('by_run_iter', ['runId', 'iterationNumber'])
    .index('by_uikit', ['uiKitId']),

  inspiration_reports: defineTable({
    runId: v.id('runs'),
    query: v.string(),
    mediaPreference: v.union(
      v.literal('auto'),
      v.literal('images'),
      v.literal('videos'),
      v.literal('mixed'),
    ),
    status: v.union(v.literal('ready'), v.literal('failed')),
    tags: v.array(v.string()),
    diagnosis: v.string(),
    references: v.any(),
    plan: v.any(),
    beforeAfter: v.any(),
    safetyNotes: v.array(v.string()),
    providerMode: v.union(
      v.literal('curated'),
      v.literal('curated-plus-urls'),
      v.literal('external-ready'),
    ),
    appliedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_run_created', ['runId', 'createdAt']),

  nodeslide_decks: defineTable({
    id: v.string(),
    projectId: v.string(),
    projectRowId: v.id('projects'),
    clientSessionId: v.string(),
    schemaVersion: v.literal('nodeslide.slidelang/v1'),
    toolchainVersion: v.string(),
    title: v.string(),
    brief: nodeslideBriefValidator,
    theme: nodeslideThemeValidator,
    slideOrder: v.array(v.string()),
    version: v.number(),
    status: v.union(
      v.literal('draft'),
      v.literal('validating'),
      v.literal('ready'),
      v.literal('published'),
    ),
    activeSignatureProfileId: v.optional(v.string()),
    activeSignatureProfileDigest: v.optional(v.string()),
    // Optional so deployed anonymous-session rows can be claimed lazily.
    ownerAccessKey: v.optional(v.string()),
    shareSlug: v.optional(v.string()),
    plan: v.array(v.string()),
    spec: v.any(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_project_id', ['projectId'])
    .index('by_project_row', ['projectRowId'])
    .index('by_session_updated', ['clientSessionId', 'updatedAt'])
    .index('by_share_slug', ['shareSlug']),

  nodeslide_sync_connections: defineTable({
    id: v.string(),
    deckId: v.string(),
    provider: v.literal('google_slides'),
    remotePresentationId: v.string(),
    remoteRevision: v.string(),
    lastSyncedDeckVersion: v.number(),
    objectMapping: v.array(nodeslideSyncObjectLinkValidator),
    status: v.union(
      v.literal('active'),
      v.literal('syncing'),
      v.literal('conflict'),
      v.literal('error'),
      v.literal('disconnected'),
    ),
    connectionVersion: v.number(),
    lastMutationKey: v.string(),
    lastMutationFingerprint: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastSyncedAt: v.number(),
    disconnectedAt: v.optional(v.number()),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_provider', ['deckId', 'provider'])
    .index('by_provider_remote', ['provider', 'remotePresentationId']),

  nodeslide_oauth_sessions: defineTable({
    stateDigest: v.string(),
    deckId: v.string(),
    provider: v.literal('google_slides'),
    codeVerifierCiphertext: v.string(),
    returnTo: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
    consumedAt: v.optional(v.number()),
  })
    .index('by_state_digest', ['stateDigest'])
    .index('by_deck_created', ['deckId', 'createdAt']),

  nodeslide_oauth_credentials: defineTable({
    deckId: v.string(),
    provider: v.literal('google_slides'),
    accessTokenCiphertext: v.string(),
    refreshTokenCiphertext: v.optional(v.string()),
    accessTokenExpiresAt: v.number(),
    scopes: v.array(v.string()),
    tokenType: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index('by_deck_provider', ['deckId', 'provider'])
    .index('by_updated', ['updatedAt']),

  nodeslide_slides: defineTable({
    id: v.string(),
    deckId: v.string(),
    title: v.string(),
    section: v.optional(v.string()),
    notes: v.optional(v.string()),
    background: v.string(),
    elementOrder: v.array(v.string()),
    version: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck', ['deckId'])
    .index('by_deck_id', ['deckId', 'id']),

  nodeslide_elements: defineTable({
    id: v.string(),
    deckId: v.string(),
    slideId: v.string(),
    name: v.string(),
    kind: v.union(
      v.literal('text'),
      v.literal('shape'),
      v.literal('image'),
      v.literal('chart'),
      v.literal('math'),
      v.literal('video'),
      v.literal('connector'),
    ),
    role: v.optional(v.string()),
    bbox: nodeslideBoundingBoxValidator,
    rotation: v.number(),
    content: v.optional(v.string()),
    style: nodeslideElementStyleValidator,
    chart: v.optional(nodeslideChartDataValidator),
    math: v.optional(nodeslideMathDataValidator),
    video: v.optional(nodeslideVideoDataValidator),
    image: v.optional(nodeslideImageDataValidator),
    imageUrl: v.optional(v.string()),
    altText: v.optional(v.string()),
    sourceIds: v.array(v.string()),
    locked: v.boolean(),
    visible: v.optional(v.boolean()),
    groupId: v.optional(v.string()),
    exportCapabilities: v.array(nodeslideExportCapabilityValidator),
    version: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck', ['deckId'])
    .index('by_deck_id', ['deckId', 'id'])
    .index('by_slide', ['slideId']),

  nodeslide_patches: defineTable({
    id: v.string(),
    deckId: v.string(),
    baseDeckVersion: v.number(),
    baseSlideVersions: nodeslideVersionClockValidator,
    baseElementVersions: nodeslideVersionClockValidator,
    resultingDeckVersion: v.optional(v.number()),
    scope: nodeslidePatchScopeValidator,
    operations: v.array(nodeslidePatchOperationValidator),
    source: nodeslidePatchSourceValidator,
    status: nodeslidePatchStatusValidator,
    summary: v.string(),
    linkedCommentId: v.optional(v.string()),
    traceId: v.optional(v.string()),
    jobId: v.optional(v.string()),
    proposalKind: v.optional(v.union(v.literal('edit'), v.literal('propagation'))),
    parentPatchId: v.optional(v.string()),
    affectedSlideIds: v.optional(v.array(v.string())),
    affectedSlideDigest: v.optional(v.string()),
    candidateDigest: v.optional(v.string()),
    candidateValidation: v.optional(nodeslideCandidateValidationReceiptValidator),
    profileId: v.optional(v.string()),
    profileDigest: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_created', ['deckId', 'createdAt'])
    .index('by_deck_status', ['deckId', 'status'])
    .index('by_deck_status_created', ['deckId', 'status', 'createdAt'])
    .index('by_job', ['jobId']),

  nodeslide_delegation_grants: defineTable({
    schemaVersion: v.literal('nodeslide.delegation-grant/v1'),
    id: v.string(),
    deckId: v.string(),
    tokenDigest: v.string(),
    policyVersion: v.literal('nodeslide.delegation-policy/v1'),
    clientKind: v.union(v.literal('browser'), v.literal('codex'), v.literal('claude')),
    capability: v.literal('accept_validated'),
    proposalSource: v.literal('agent'),
    proposalKind: v.literal('edit'),
    maxOperations: v.number(),
    maxUses: v.number(),
    useCount: v.number(),
    policyDigest: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index('by_stable_id', ['id'])
    .index('by_token_digest', ['tokenDigest'])
    .index('by_deck_created', ['deckId', 'createdAt']),

  nodeslide_delegation_uses: defineTable({
    id: v.string(),
    grantId: v.string(),
    deckId: v.string(),
    patchId: v.string(),
    candidateDigest: v.string(),
    resultingDeckVersion: v.number(),
    rebased: v.boolean(),
    usedAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_grant_patch', ['grantId', 'patchId'])
    .index('by_grant_used', ['grantId', 'usedAt'])
    .index('by_deck_used', ['deckId', 'usedAt']),

  nodeslide_variation_batches: defineTable({
    id: v.string(),
    deckId: v.string(),
    slideId: v.string(),
    requestedCount: v.literal(3),
    status: v.union(v.literal('generating'), v.literal('ready'), v.literal('failed')),
    origin: nodeslideVariationOriginValidator,
    fallbackReason: v.optional(v.string()),
    variationIds: v.array(v.string()),
    elapsedMs: v.number(),
    acceptingVariationId: v.optional(v.string()),
    acceptedVariationId: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_created', ['deckId', 'createdAt'])
    .index('by_deck_slide_created', ['deckId', 'slideId', 'createdAt']),

  nodeslide_variations: defineTable({
    schemaVersion: v.literal('nodeslide.variation/v1'),
    id: v.string(),
    batchId: v.string(),
    deckId: v.string(),
    slideId: v.string(),
    baseDeckVersion: v.number(),
    baseSlideVersion: v.number(),
    baseElementVersions: nodeslideVersionClockValidator,
    axes: nodeslideVariationAxesValidator,
    origin: nodeslideVariationOriginValidator,
    fallbackReason: v.optional(v.string()),
    operations: v.array(nodeslidePatchOperationValidator),
    candidate: nodeslideVariationCandidateValidator,
    validation: nodeslideValidationResultValidator,
    status: nodeslideVariationStatusValidator,
    selectedPatchId: v.optional(v.string()),
    createdAt: v.number(),
    decidedAt: v.optional(v.number()),
  })
    .index('by_stable_id', ['id'])
    .index('by_batch', ['batchId'])
    .index('by_deck_created', ['deckId', 'createdAt'])
    .index('by_deck_slide_created', ['deckId', 'slideId', 'createdAt']),

  nodeslide_variation_decisions: defineTable({
    id: v.string(),
    eventName: nodeslideVariationDecisionEventValidator,
    deckId: v.string(),
    slideId: v.string(),
    batchId: v.string(),
    variationId: v.string(),
    deckVersion: v.number(),
    traceId: v.string(),
    axes: nodeslideVariationAxesValidator,
    origin: nodeslideVariationOriginValidator,
    reason: v.optional(v.string()),
    selectedPatchId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_variation', ['variationId'])
    .index('by_batch', ['batchId'])
    .index('by_deck_created', ['deckId', 'createdAt']),

  nodeslide_comments: defineTable({
    id: v.string(),
    deckId: v.string(),
    parentId: v.optional(v.string()),
    anchor: nodeslideCommentAnchorValidator,
    authorId: v.string(),
    authorName: v.string(),
    text: v.string(),
    status: v.union(v.literal('open'), v.literal('resolved'), v.literal('dismissed')),
    linkedPatchId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_created', ['deckId', 'createdAt'])
    .index('by_deck_status_created', ['deckId', 'status', 'createdAt'])
    .index('by_parent', ['parentId']),

  nodeslide_versions: defineTable({
    id: v.string(),
    deckId: v.string(),
    version: v.number(),
    label: v.string(),
    source: nodeslidePatchSourceValidator,
    patchId: v.optional(v.string()),
    snapshot: nodeslideSnapshotValidator,
    createdAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_version', ['deckId', 'version']),

  nodeslide_sources: defineTable({
    id: v.string(),
    deckId: v.string(),
    title: v.string(),
    url: v.optional(v.string()),
    sourceType: v.union(
      v.literal('internal'),
      v.literal('url'),
      v.literal('document'),
      v.literal('spreadsheet'),
      v.literal('note'),
    ),
    retrievedAt: v.number(),
    citation: v.string(),
    license: v.optional(v.string()),
    format: v.optional(
      v.union(v.literal('csv'), v.literal('json'), v.literal('txt'), v.literal('web')),
    ),
    contentDigest: v.optional(v.string()),
    byteSize: v.optional(v.number()),
    rowCount: v.optional(v.number()),
    columns: v.optional(v.array(v.string())),
    provider: v.optional(v.string()),
    retention: v.optional(v.union(v.literal('until_deleted'), v.literal('public_snapshot'))),
    status: v.optional(v.union(v.literal('ready'), v.literal('refreshing'), v.literal('failed'))),
    lastRefreshedAt: v.optional(v.number()),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck', ['deckId']),

  nodeslide_agent_jobs: defineTable({
    id: v.string(),
    kind: v.union(v.literal('create_deck'), v.literal('edit_proposal')),
    clientSessionId: v.string(),
    admissionQuotaSubject: v.string(),
    ownerDigest: v.string(),
    executionDigest: v.string(),
    idempotencyKey: v.string(),
    requestDigest: v.string(),
    status: v.union(...NODESLIDE_JOB_STATUSES.map((status) => v.literal(status))),
    phase: v.union(...NODESLIDE_JOB_PHASES.map((phase) => v.literal(phase))),
    progress: v.number(),
    attempt: v.number(),
    maxAttempts: v.number(),
    workflowId: v.optional(v.string()),
    streamId: v.string(),
    resultDeckId: v.optional(v.string()),
    resultPatchId: v.optional(v.string()),
    resultCandidateDigest: v.optional(v.string()),
    conversationRunId: v.optional(v.string()),
    // Budget ownership is intentionally optional until provider/job wiring lands.
    budgetId: v.optional(v.string()),
    memoryIds: v.array(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_stable_id', ['id'])
    .index('by_session_idempotency', ['clientSessionId', 'idempotencyKey'])
    .index('by_status_updated', ['status', 'updatedAt'])
    .index('by_result_deck', ['resultDeckId']),

  /**
   * Canonical server-owned state for a durable agent session. Request and
   * capability material is represented only by irreversible digests and safe
   * descriptors; raw prompts, credentials, and consent grants are never stored.
   */
  nodeslide_durable_sessions: defineTable({
    id: v.string(),
    schemaVersion: v.literal('nodeslide.durable-session/v2'),
    requestBinding: nodeslideDurableRequestBindingValidator,
    requestDigest: v.string(),
    capabilityDigest: v.string(),
    capability: nodeslideDurableCapabilityMetadataValidator,
    stateVersion: v.number(),
    egressEpoch: v.number(),
    activeJobId: v.union(v.null(), v.string()),
    jobs: v.record(v.string(), nodeslideDurableJobValidator),
    eventSequence: v.number(),
    transitionSequence: v.number(),
    lastTransitionDigest: v.optional(v.string()),
    stateDigest: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_binding', ['requestDigest', 'capabilityDigest'])
    .index('by_updated', ['updatedAt']),

  /** Immutable, hash-chained command outcomes for durable session recovery. */
  nodeslide_durable_session_events: defineTable({
    sessionId: v.string(),
    transitionSequence: v.number(),
    commandId: v.string(),
    commandDigest: v.string(),
    commandKind: v.union(
      v.literal('enqueue'),
      v.literal('claim'),
      v.literal('resume'),
      v.literal('retry'),
      v.literal('transition'),
      v.literal('rotate_egress'),
    ),
    stateVersion: v.number(),
    eventSequence: v.number(),
    egressEpoch: v.number(),
    requestBinding: nodeslideDurableRequestBindingValidator,
    jobId: v.optional(v.string()),
    event: v.optional(nodeslideDurableJobEventValidator),
    previousTransitionDigest: v.optional(v.string()),
    transitionDigest: v.string(),
    occurredAt: v.number(),
  })
    .index('by_session_sequence', ['sessionId', 'transitionSequence'])
    .index('by_session_command', ['sessionId', 'commandId'])
    .index('by_session_job', ['sessionId', 'jobId']),

  /**
   * Safe model/web receipts for an exact job attempt and egress epoch. Entries
   * contain digests and accounting metadata only; no prompts, URLs, or results.
   */
  nodeslide_durable_job_journal_entries: defineTable({
    sessionId: v.string(),
    jobId: v.string(),
    egressEpoch: v.number(),
    attempt: v.number(),
    sequence: v.number(),
    entryId: v.string(),
    kind: v.union(v.literal('model'), v.literal('web')),
    binding: nodeslideDurableJournalBindingValidator,
    requestDigest: v.string(),
    capabilityDigest: v.string(),
    provider: v.string(),
    model: v.optional(v.string()),
    operation: v.string(),
    inputDigest: v.optional(v.string()),
    outputDigest: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    queryDigest: v.optional(v.string()),
    urlDigest: v.optional(v.string()),
    resultDigest: v.optional(v.string()),
    resultCount: v.optional(v.number()),
    entryInputDigest: v.string(),
    previousEntryDigest: v.optional(v.string()),
    entryDigest: v.string(),
    journalDigest: v.string(),
    createdAt: v.number(),
  })
    .index('by_binding_sequence', ['sessionId', 'jobId', 'egressEpoch', 'attempt', 'sequence'])
    .index('by_binding_entry', ['sessionId', 'jobId', 'egressEpoch', 'attempt', 'entryId']),

  nodeslide_agent_runs: defineTable({
    id: v.string(),
    deckId: v.string(),
    ownerDigest: v.string(),
    idempotencyKey: v.string(),
    instruction: v.string(),
    status: v.union(
      v.literal('queued'),
      v.literal('researching'),
      v.literal('planning'),
      v.literal('validating'),
      v.literal('awaiting_review'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('cancelled'),
    ),
    provider: v.string(),
    model: v.string(),
    webResearch: v.boolean(),
    // Links this durable run to the server-authoritative cost ledger when enabled.
    budgetId: v.optional(v.string()),
    memoryIds: v.optional(v.array(v.string())),
    attempt: v.number(),
    otelTraceId: v.optional(v.string()),
    rootSpanId: v.optional(v.string()),
    checkpoint: v.optional(v.string()),
    lastHeartbeatAt: v.optional(v.number()),
    leaseExpiresAt: v.optional(v.number()),
    nextTelemetrySequence: v.optional(v.number()),
    telemetryVersion: v.optional(v.string()),
    otelExportStatus: v.optional(
      v.union(
        v.literal('pending'),
        v.literal('exported'),
        v.literal('skipped'),
        v.literal('failed'),
      ),
    ),
    otelExportedAt: v.optional(v.number()),
    otelExportError: v.optional(v.string()),
    patchId: v.optional(v.string()),
    traceId: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_created', ['deckId', 'createdAt'])
    .index('by_deck_idempotency', ['deckId', 'idempotencyKey'])
    .index('by_deck_status_updated', ['deckId', 'status', 'updatedAt']),

  /**
   * One canonical, server-owned hard budget per durable NodeSlide run. Monetary
   * amounts are integer micro-USD; `reserved` and `unreconciled` are held in
   * the exposure total until a provider call is settled or explicitly released.
   */
  nodeslide_run_budgets: defineTable({
    id: v.string(),
    version: v.literal('nodeslide.budget-ledger/v1'),
    status: v.union(v.literal('open'), v.literal('finalized')),
    budget: v.object({
      version: v.literal('nodeslide.run-budget/v1'),
      enforcement: v.literal('hard'),
      maxCostUsd: v.number(),
      maxCostMicroUsd: v.number(),
      maxInputTokens: v.number(),
      maxOutputTokens: v.number(),
      maxDurationMs: v.number(),
      maxIterations: v.number(),
      maxToolCalls: v.number(),
    }),
    configDigest: v.string(),
    actualMicroUsd: v.number(),
    reservedMicroUsd: v.number(),
    unreconciledMicroUsd: v.number(),
    accumulated: v.object({
      inputTokens: v.number(),
      outputTokens: v.number(),
      elapsedMs: v.number(),
      iterations: v.number(),
      toolCalls: v.number(),
    }),
    receiptDigests: v.record(v.string(), v.string()),
    accountingStateDigest: v.string(),
    revision: v.number(),
    eventSequence: v.number(),
    lastEventDigest: v.string(),
    stateDigest: v.string(),
    finalizeDigest: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    finalizedAt: v.optional(v.number()),
  })
    .index('by_stable_id', ['id'])
    .index('by_status_updated', ['status', 'updatedAt']),

  /** A deterministic call record, keyed by (budgetId, callId). */
  nodeslide_billable_calls: defineTable({
    budgetId: v.string(),
    callId: v.string(),
    version: v.literal('nodeslide.billable-call/v1'),
    status: v.union(
      v.literal('reserved'),
      v.literal('unreconciled'),
      v.literal('settled'),
      v.literal('released'),
    ),
    model: v.string(),
    pricingDigest: v.string(),
    quoteMicroUsd: v.number(),
    estimatedInputTokens: v.number(),
    requestedMaxOutputTokens: v.number(),
    providerSafeOutputTokenCeiling: v.number(),
    providerTimeoutMs: v.number(),
    reservationDigest: v.string(),
    terminalOperationDigest: v.optional(v.string()),
    receiptDigest: v.optional(v.string()),
    actualMicroUsd: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    elapsedMs: v.optional(v.number()),
    iterations: v.optional(v.number()),
    toolCalls: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    settledAt: v.optional(v.number()),
    releasedAt: v.optional(v.number()),
    timeoutCapturedAt: v.optional(v.number()),
  })
    .index('by_budget_call', ['budgetId', 'callId'])
    .index('by_budget_status', ['budgetId', 'status']),

  /** Immutable audit chain for every applied budget state transition. */
  nodeslide_budget_events: defineTable({
    budgetId: v.string(),
    callId: v.optional(v.string()),
    version: v.literal('nodeslide.budget-event/v1'),
    sequence: v.number(),
    revision: v.number(),
    kind: v.union(
      v.literal('created'),
      v.literal('reserved'),
      v.literal('settled'),
      v.literal('timeout_captured'),
      v.literal('released'),
      v.literal('finalized'),
    ),
    operationDigest: v.string(),
    status: v.union(v.literal('open'), v.literal('finalized')),
    actualDeltaMicroUsd: v.number(),
    reservedDeltaMicroUsd: v.number(),
    unreconciledDeltaMicroUsd: v.number(),
    actualMicroUsd: v.number(),
    reservedMicroUsd: v.number(),
    unreconciledMicroUsd: v.number(),
    capMicroUsd: v.number(),
    accountingStateDigest: v.string(),
    budgetStateCoreDigest: v.string(),
    previousEventDigest: v.optional(v.string()),
    eventDigest: v.string(),
    createdAt: v.number(),
  })
    .index('by_budget_sequence', ['budgetId', 'sequence'])
    .index('by_budget_call', ['budgetId', 'callId']),

  nodeslide_agent_messages: defineTable({
    id: v.string(),
    deckId: v.string(),
    runId: v.string(),
    role: v.union(
      v.literal('user'),
      v.literal('assistant'),
      v.literal('tool'),
      v.literal('system'),
    ),
    content: v.string(),
    toolName: v.optional(v.string()),
    toolCallId: v.optional(v.string()),
    parentMessageId: v.optional(v.string()),
    sourceIds: v.optional(v.array(v.string())),
    createdAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_created', ['deckId', 'createdAt'])
    .index('by_run_created', ['runId', 'createdAt']),

  nodeslide_agent_memories: defineTable({
    id: v.string(),
    deckId: v.string(),
    category: v.union(
      v.literal('preference'),
      v.literal('fact'),
      v.literal('decision'),
      v.literal('instruction'),
      v.literal('context'),
    ),
    content: v.string(),
    status: v.union(v.literal('active'), v.literal('archived')),
    source: v.union(v.literal('user'), v.literal('agent')),
    sourceRunId: v.optional(v.string()),
    contentDigest: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    useCount: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_updated', ['deckId', 'updatedAt'])
    .index('by_deck_status_updated', ['deckId', 'status', 'updatedAt']),

  nodeslide_agent_spans: defineTable({
    id: v.string(),
    deckId: v.string(),
    runId: v.string(),
    traceId: v.string(),
    spanId: v.string(),
    parentSpanId: v.optional(v.string()),
    name: v.string(),
    operationName: v.string(),
    kind: v.union(v.literal('internal'), v.literal('client')),
    status: v.union(v.literal('unset'), v.literal('ok'), v.literal('error')),
    startTime: v.number(),
    endTime: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    toolName: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    costMicroUsd: v.optional(v.number()),
    sourceIds: v.optional(v.array(v.string())),
    attributes: v.array(
      v.object({ key: v.string(), value: v.union(v.string(), v.number(), v.boolean()) }),
    ),
    sequence: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_run_sequence', ['runId', 'sequence'])
    .index('by_trace_sequence', ['traceId', 'sequence'])
    .index('by_deck_created', ['deckId', 'createdAt']),

  nodeslide_agent_events: defineTable({
    id: v.string(),
    deckId: v.string(),
    runId: v.string(),
    traceId: v.string(),
    spanId: v.string(),
    name: v.string(),
    severity: v.union(v.literal('info'), v.literal('warn'), v.literal('error')),
    timestamp: v.number(),
    body: v.string(),
    attributes: v.array(
      v.object({ key: v.string(), value: v.union(v.string(), v.number(), v.boolean()) }),
    ),
    sequence: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_run_sequence', ['runId', 'sequence'])
    .index('by_trace_sequence', ['traceId', 'sequence'])
    .index('by_deck_timestamp', ['deckId', 'timestamp']),

  nodeslide_validations: defineTable({
    id: v.string(),
    deckId: v.string(),
    deckVersion: v.number(),
    ok: v.boolean(),
    publishOk: v.boolean(),
    cleanOk: v.boolean(),
    issues: v.array(nodeslideValidationIssueValidator),
    checkedAt: v.number(),
    toolchainVersion: v.string(),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_checked', ['deckId', 'checkedAt'])
    .index('by_deck_version', ['deckId', 'deckVersion'])
    .index('by_deck_version_checked', ['deckId', 'deckVersion', 'checkedAt']),

  nodeslide_traces: defineTable({
    id: v.string(),
    deckId: v.string(),
    patchId: v.optional(v.string()),
    status: v.union(
      v.literal('planning'),
      v.literal('working'),
      v.literal('awaiting_review'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('cancelled'),
    ),
    summary: v.string(),
    plan: v.array(v.string()),
    context: v.array(v.string()),
    toolCalls: v.array(v.string()),
    guardrails: v.array(v.string()),
    planningInputDigest: v.optional(v.string()),
    planningSnapshotDigest: v.optional(v.string()),
    shadowComparisonExpected: v.optional(v.boolean()),
    shadowControlsDigest: v.optional(v.string()),
    validation: v.optional(nodeslideValidationResultValidator),
    candidateDigest: v.optional(v.string()),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    reasoningEffort: v.optional(
      v.union(
        v.literal('low'),
        v.literal('medium'),
        v.literal('high'),
        v.literal('xhigh'),
        v.literal('max'),
      ),
    ),
    costMicroUsd: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    sourceBindingStatus: v.optional(nodeslideSourceBindingStatusValidator),
    claimSourceBindings: v.optional(v.array(nodeslideClaimSourceBindingValidator)),
    decisionProvenance: v.optional(nodeslideDecisionProvenanceValidator),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_created', ['deckId', 'createdAt'])
    .index('by_deck_status_created', ['deckId', 'status', 'createdAt'])
    .index('by_patch', ['patchId'])
    .index('by_stable_deck_patch', ['id', 'deckId', 'patchId']),

  nodeslide_execution_traces: defineTable(nodeslideExecutionTraceFields)
    .index('by_stable_id', ['id'])
    .index('by_deck_created', ['deckId', 'createdAt'])
    .index('by_deck_session', ['deckId', 'sessionId'])
    .index('by_deck_expiry', ['deckId', 'expiresAt'])
    .index('by_expiry', ['expiresAt'])
    .index('by_status_created', ['status', 'createdAt']),

  nodeslide_shadow_comparisons: defineTable(nodeslideShadowComparisonFields)
    .index('by_stable_id', ['id'])
    .index('by_deck_created', ['deckId', 'createdAt'])
    .index('by_deck_expiry', ['deckId', 'expiresAt'])
    .index('by_expiry', ['expiresAt'])
    .index('by_baseline_patch', ['baselinePatchId']),

  nodeslide_exports: defineTable({
    id: v.string(),
    deckId: v.string(),
    deckVersion: v.number(),
    kind: v.union(v.literal('html'), v.literal('pptx'), v.literal('pdf'), v.literal('png')),
    status: v.union(
      v.literal('queued'),
      v.literal('rendering'),
      v.literal('ready'),
      v.literal('failed'),
    ),
    capabilityWarnings: v.array(v.string()),
    fileName: v.optional(v.string()),
    url: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_created', ['deckId', 'createdAt'])
    .index('by_deck_status_created', ['deckId', 'status', 'createdAt']),

  nodeslide_publications: defineTable({
    id: v.string(),
    deckId: v.string(),
    shareSlug: v.string(),
    revision: v.number(),
    deckVersion: v.number(),
    validationId: v.string(),
    status: v.union(v.literal('active'), v.literal('superseded'), v.literal('revoked')),
    snapshot: nodeslidePublishedSnapshotValidator,
    publishedAt: v.number(),
    supersededAt: v.optional(v.number()),
    supersededById: v.optional(v.string()),
    revokedAt: v.optional(v.number()),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_revision', ['deckId', 'revision'])
    .index('by_share_slug_revision', ['shareSlug', 'revision']),

  nodeslide_preference_events: defineTable({
    schemaVersion: v.literal('nodeslide.preference/v1'),
    id: v.string(),
    tenantId: v.string(),
    actorId: v.string(),
    deckId: v.string(),
    type: nodeslidePreferenceEventTypeValidator,
    scope: nodeslidePreferenceScopeValidator,
    provenance: nodeslidePreferenceProvenanceValidator,
    attributes: nodeslidePreferenceAttributesValidator,
    occurredAt: v.number(),
    recordedAt: v.number(),
    processedAt: v.optional(v.number()),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_recorded', ['deckId', 'recordedAt'])
    .index('by_tenant_actor_recorded', ['tenantId', 'actorId', 'recordedAt'])
    .index('by_tenant_deck_recorded', ['tenantId', 'deckId', 'recordedAt']),

  nodeslide_signature_profiles: defineTable({
    id: v.string(),
    tenantId: v.string(),
    profileId: v.string(),
    sourceDigest: v.string(),
    sourceKind: v.union(
      v.literal('pptx'),
      v.literal('pdf'),
      v.literal('screenshot'),
      v.literal('taste_pack'),
    ),
    name: v.string(),
    confidence: v.union(v.literal('high'), v.literal('medium'), v.literal('low')),
    warningCount: v.number(),
    profileJson: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_tenant_profile', ['tenantId', 'profileId'])
    .index('by_tenant_updated', ['tenantId', 'updatedAt']),

  nodeslide_taste_profiles: defineTable({
    schemaVersion: v.literal('nodeslide.preference/v1'),
    id: v.string(),
    tenantId: v.string(),
    actorId: v.string(),
    signals: v.array(nodeslidePreferenceSignalValidator),
    updatedAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_tenant', ['tenantId'])
    .index('by_tenant_actor', ['tenantId', 'actorId']),

  nodeslide_rate_limits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
    updatedAt: v.number(),
  }).index('by_key_window', ['key', 'windowStart']),

  nodeslide_presence: defineTable({
    id: v.string(),
    deckId: v.string(),
    sessionId: v.string(),
    displayName: v.string(),
    color: v.string(),
    slideId: v.optional(v.string()),
    elementIds: v.array(v.string()),
    cursor: v.optional(nodeslideCursorValidator),
    lastSeenAt: v.number(),
    expiresAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_session', ['deckId', 'sessionId'])
    .index('by_deck_expiry', ['deckId', 'expiresAt']),
});
