import type { NodeSlideDataAttachment } from './nodeslideAttachments';

export const NODESLIDE_SCHEMA_VERSION = 'nodeslide.slidelang/v1' as const;
export const NODESLIDE_TOOLCHAIN_VERSION = 'local-slidelang-adapter/1.1.0' as const;
export const NODESLIDE_AGENT_MODELS = [
  {
    id: 'nebius/zai-org/GLM-5.2',
    upstreamId: 'zai-org/GLM-5.2',
    provider: 'nebius',
    vendor: 'Z.ai',
    label: 'GLM 5.2',
    description: 'Direct managed Nebius route for long-horizon planning and structured edits.',
    costTier: 'balanced',
    bestFor: 'Recommended direct agent route',
    supportsTemperature: true,
    supportedEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'z-ai/glm-5.2',
    upstreamId: 'z-ai/glm-5.2',
    provider: 'openrouter',
    vendor: 'Z.ai',
    label: 'GLM 5.2',
    description: 'Long-horizon planning and structured slide edits.',
    costTier: 'balanced',
    bestFor: 'Long, structured deck work',
    supportsTemperature: true,
    supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'anthropic/claude-sonnet-5',
    upstreamId: 'anthropic/claude-sonnet-5',
    provider: 'openrouter',
    vendor: 'Anthropic',
    label: 'Claude Sonnet 5',
    description: 'Latest balanced Claude for agents and professional writing.',
    costTier: 'premium',
    bestFor: 'Executive writing and synthesis',
    supportsTemperature: false,
    supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'anthropic/claude-fable-5',
    upstreamId: 'anthropic/claude-fable-5',
    provider: 'openrouter',
    vendor: 'Anthropic',
    label: 'Claude Fable 5',
    description: 'Anthropic flagship for ambitious, long-running agent work.',
    costTier: 'premium',
    bestFor: 'Complex planning and review',
    supportsTemperature: false,
    supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'google/gemini-3.5-flash',
    upstreamId: 'google/gemini-3.5-flash',
    provider: 'openrouter',
    vendor: 'Google',
    label: 'Gemini 3.5 Flash',
    description: 'Latest stable Gemini for sustained agentic and coding tasks.',
    costTier: 'fast',
    bestFor: 'Fast iteration and large context',
    supportsTemperature: true,
    supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'google/gemini-3.1-pro-preview',
    upstreamId: 'google/gemini-3.1-pro-preview',
    provider: 'openrouter',
    vendor: 'Google',
    label: 'Gemini 3.1 Pro',
    description: 'Google Pro reasoning for complex, data-heavy presentations.',
    costTier: 'premium',
    bestFor: 'Data-heavy analysis',
    supportsTemperature: true,
    supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'openai/gpt-5.6-sol',
    upstreamId: 'openai/gpt-5.6-sol',
    provider: 'openrouter',
    vendor: 'OpenAI',
    label: 'GPT-5.6 Sol',
    description: 'OpenAI flagship for highest-capability production workflows.',
    costTier: 'premium',
    bestFor: 'Highest-capability production work',
    supportsTemperature: false,
    supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    id: 'openai/gpt-5.6-terra',
    upstreamId: 'openai/gpt-5.6-terra',
    provider: 'openrouter',
    vendor: 'OpenAI',
    label: 'GPT-5.6 Terra',
    description: 'Strong OpenAI reasoning with a balanced cost profile.',
    costTier: 'balanced',
    bestFor: 'General professional decks',
    supportsTemperature: false,
    supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
] as const;
export type NodeSlideAgentModelId = (typeof NODESLIDE_AGENT_MODELS)[number]['id'];
export type NodeSlideExternalProvider = (typeof NODESLIDE_AGENT_MODELS)[number]['provider'];
export const NODESLIDE_DEFAULT_AGENT_MODEL: NodeSlideAgentModelId = 'nebius/zai-org/GLM-5.2';
export const NODESLIDE_DEFAULT_OPENROUTER_AGENT_MODEL: NodeSlideAgentModelId = 'z-ai/glm-5.2';

export const NODESLIDE_REASONING_EFFORTS = [
  { id: 'low', label: 'Light', description: 'Faster responses for straightforward work.' },
  { id: 'medium', label: 'Medium', description: 'Balanced reasoning for routine deck work.' },
  { id: 'high', label: 'High', description: 'Deeper reasoning for complex edits and synthesis.' },
  { id: 'xhigh', label: 'Extra High', description: 'More deliberation for difficult decisions.' },
  { id: 'max', label: 'Ultra', description: 'Maximum reasoning; consumes usage limits faster.' },
] as const;
export type NodeSlideReasoningEffort = (typeof NODESLIDE_REASONING_EFFORTS)[number]['id'];
export const NODESLIDE_DEFAULT_REASONING_EFFORT: NodeSlideReasoningEffort = 'high';

export function isNodeSlideReasoningEffort(value: unknown): value is NodeSlideReasoningEffort {
  return NODESLIDE_REASONING_EFFORTS.some((effort) => effort.id === value);
}

export function nodeSlideReasoningEffort(effortId: NodeSlideReasoningEffort) {
  return (
    NODESLIDE_REASONING_EFFORTS.find((effort) => effort.id === effortId) ??
    NODESLIDE_REASONING_EFFORTS[2]
  );
}

export function isNodeSlideAgentModelId(value: unknown): value is NodeSlideAgentModelId {
  return NODESLIDE_AGENT_MODELS.some((model) => model.id === value);
}

export function nodeSlideAgentModel(modelId: NodeSlideAgentModelId) {
  return NODESLIDE_AGENT_MODELS.find((model) => model.id === modelId) ?? NODESLIDE_AGENT_MODELS[0];
}

export function nodeSlideModelSupportsReasoningEffort(
  modelId: NodeSlideAgentModelId,
  effort: NodeSlideReasoningEffort,
): boolean {
  return (nodeSlideAgentModel(modelId).supportedEfforts as readonly string[]).includes(effort);
}

export function nodeSlideProviderModeForModel(
  modelId: NodeSlideAgentModelId,
): NodeSlideProviderMode {
  return nodeSlideAgentModel(modelId).provider === 'nebius' ? 'nebius' : 'openrouter_free';
}

export function nodeSlideDefaultModelForProviderMode(
  mode: Exclude<NodeSlideProviderMode, 'deterministic'>,
): NodeSlideAgentModelId {
  return mode === 'nebius'
    ? NODESLIDE_DEFAULT_AGENT_MODEL
    : NODESLIDE_DEFAULT_OPENROUTER_AGENT_MODEL;
}
export const NODESLIDE_PATCH_OPERATION_LIMIT = 512 as const;
export const NODESLIDE_SCOPE_SLIDE_LIMIT = 64 as const;
export const NODESLIDE_SCOPE_ELEMENT_LIMIT = 256 as const;
export const NODESLIDE_VERSION_CLOCK_LIMIT = 512 as const;
export const NODESLIDE_ADD_SLIDE_ELEMENT_LIMIT = 128 as const;
export const NODESLIDE_ELEMENT_SOURCE_LIMIT = 64 as const;
export const NODESLIDE_GROUP_MEMBER_LIMIT = 64 as const;
export const NODESLIDE_GROUP_ID_LIMIT = 128 as const;
export const NODESLIDE_AGENT_READ_CONTEXT_VERSION = 'nodeslide.read-context/v1' as const;
export const NODESLIDE_AGENT_READ_CONTEXT_LIMITS = {
  slideIds: 32,
  elementIds: 128,
  sourceIds: 64,
  commentIds: 32,
  totalRefs: 192,
  promptBytes: 96_000,
} as const;

/** Exact, operation-specific consent receipts. They are intentionally not interchangeable. */
export const NODESLIDE_OPENROUTER_REVIEW_CONSENT =
  'openrouter_nodeslide_review_context_v1' as const;
/** Backwards-compatible authority name for the inspector's review consent constant. */
export const NODESLIDE_OPENROUTER_EDIT_CONSENT = NODESLIDE_OPENROUTER_REVIEW_CONSENT;
export const NODESLIDE_OPENROUTER_VARIATIONS_CONSENT =
  'openrouter_nodeslide_variations_context_v1' as const;
export const NODESLIDE_NEBIUS_REVIEW_CONSENT = 'nebius_nodeslide_review_context_v1' as const;
export const NODESLIDE_NEBIUS_VARIATIONS_CONSENT =
  'nebius_nodeslide_variations_context_v1' as const;
/** Exact consent for sending an edit query to configured third-party web search providers. */
export const NODESLIDE_WEB_RESEARCH_CONSENT = 'nodeslide_web_research_v1' as const;
/** Exact consent for a local MCP process to send scoped context to a user-selected BYOK model. */
export const NODESLIDE_LOCAL_BYOK_EDIT_CONSENT = 'nodeslide_local_byok_edit_v1' as const;
export const NODESLIDE_EDITOR_CAPABILITY_VERSION = 'nodeslide.editor-capabilities/v1' as const;
export const NODESLIDE_DESIGN_BEHAVIOR_POLICY_VERSION =
  'nodeslide.design-behavior-policy/v1' as const;
export const NODESLIDE_DESIGN_BEHAVIORS = [
  'preserve',
  'refine',
  'rebalance',
  'reinterpret',
  'reimagine',
] as const;
export const NODESLIDE_REFERENCE_USE_POLICIES = [
  'context_only',
  'inspiration',
  'style_direction',
] as const;
export const NODESLIDE_EDITOR_COMMAND_IDS = ['edit', 'variations', 'propagate'] as const;
export const NODESLIDE_LAYER_OPERATION_VERSION = 'nodeslide.layers/v1' as const;
export const NODESLIDE_PROPAGATION_OPERATION_LIMIT = 128 as const;
export const SLIDE_WIDTH_IN = 13.333;
export const SLIDE_HEIGHT_IN = 7.5;
export const NODESLIDE_MIN_READABLE_FONT_SIZE = 14;

export type StudioDomain = 'parity' | 'nodeslide';
export type ElementKind = 'text' | 'shape' | 'image' | 'chart' | 'math' | 'video' | 'connector';
export type PatchSource = 'human' | 'agent' | 'import' | 'system';
export type PatchStatus = 'draft' | 'validating' | 'ready' | 'accepted' | 'rejected' | 'stale';
export type OperationMode = 'copy' | 'style' | 'layout' | 'unrestricted';
export type NodeSlideProviderMode = 'deterministic' | 'openrouter_free' | 'nebius';
export type NodeSlideDesignBehavior = (typeof NODESLIDE_DESIGN_BEHAVIORS)[number];
export type NodeSlideReferenceUsePolicy = (typeof NODESLIDE_REFERENCE_USE_POLICIES)[number];
export type NodeSlideEditorCommandId = (typeof NODESLIDE_EDITOR_COMMAND_IDS)[number];
export type NodeSlideProposalKind = 'edit' | 'propagation';
export type AgentReadReferenceKind =
  | 'deck'
  | 'slide'
  | 'element'
  | 'comment'
  | 'source'
  | 'version'
  | 'data';
export type ExportCapability =
  | 'web_native'
  | 'pptx_editable'
  | 'pptx_static_fallback'
  | 'google_importable'
  | 'web_only';

export interface BoundingBox {
  /** Normalized 0..1 coordinate relative to the slide. */
  x: number;
  /** Normalized 0..1 coordinate relative to the slide. */
  y: number;
  /** Normalized 0..1 width. */
  width: number;
  /** Normalized 0..1 height. */
  height: number;
}

export interface DeckBrief {
  prompt: string;
  audience: string;
  purpose: string;
  successCriteria: string[];
}

export interface ThemeSpec {
  id: string;
  name: string;
  mode: 'light' | 'dark';
  colors: {
    canvas: string;
    ink: string;
    muted: string;
    accent: string;
    accentSoft: string;
    insight: string;
    insightInk: string;
    trace: string;
    border: string;
  };
  typography: {
    display: string;
    body: string;
    data: string;
  };
  defaultRadius: number;
  spacingUnit: number;
}

export interface ElementStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  radius?: number;
  opacity?: number;
  padding?: number;
  shadow?: string;
}

export interface ChartSeries {
  name: string;
  values: number[];
  color?: string;
}

export interface ChartData {
  chartType: 'bar' | 'line' | 'area' | 'donut';
  labels: string[];
  series: ChartSeries[];
  unit?: string;
  sourceId?: string;
}

export interface MathVariable {
  label: string;
  value: number;
  unit?: string;
}

/** Structured formula payload retained independently from its visual treatment and source data. */
export interface MathData {
  expression: string;
  syntax?: 'plain' | 'latex';
  displayMode?: 'inline' | 'block';
  description?: string;
  display?: string;
  variables?: MathVariable[];
  sourceId?: string;
}

/** Image metadata also models intentional, editable replace-image placeholders. */
export interface ImageData {
  placeholder: boolean;
  credit?: string;
  sourceId?: string;
}

/** A first-class web video contract with an explicit non-native PowerPoint fallback. */
export interface VideoData {
  url: string;
  posterUrl?: string;
  title?: string;
  captionsUrl?: string;
  captionsLanguage?: string;
  startAtSeconds?: number;
  endAtSeconds?: number;
}

export interface SlideElement {
  id: string;
  slideId: string;
  name: string;
  kind: ElementKind;
  role?: string;
  bbox: BoundingBox;
  rotation: number;
  content?: string;
  style: ElementStyle;
  chart?: ChartData;
  math?: MathData;
  video?: VideoData;
  image?: ImageData;
  imageUrl?: string;
  altText?: string;
  sourceIds: string[];
  locked: boolean;
  /** Rows written before layers/v1 omit this field and are interpreted as visible. */
  visible?: boolean;
  /** Flat group membership. An element can belong to at most one same-slide group. */
  groupId?: string;
  exportCapabilities: ExportCapability[];
  version: number;
}

export interface Slide {
  id: string;
  deckId: string;
  title: string;
  section?: string;
  /** Private speaker notes. Published presenter snapshots intentionally omit this field. */
  notes?: string;
  background: string;
  elementOrder: string[];
  version: number;
}

export interface Deck {
  schemaVersion: typeof NODESLIDE_SCHEMA_VERSION;
  toolchainVersion: string;
  id: string;
  projectId: string;
  title: string;
  brief: DeckBrief;
  theme: ThemeSpec;
  slideOrder: string[];
  version: number;
  status: 'draft' | 'validating' | 'ready' | 'published';
  activeSignatureProfileId?: string;
  activeSignatureProfileDigest?: string;
  shareSlug?: string;
  createdAt: number;
  updatedAt: number;
}

export type CommentAnchor =
  | { type: 'deck'; deckId: string }
  | { type: 'slide'; deckId: string; slideId: string }
  | { type: 'element'; deckId: string; slideId: string; elementId: string }
  | { type: 'bounding_box'; deckId: string; slideId: string; bbox: BoundingBox };

export interface DeckComment {
  id: string;
  deckId: string;
  parentId?: string;
  anchor: CommentAnchor;
  authorId: string;
  authorName: string;
  text: string;
  status: 'open' | 'resolved' | 'dismissed';
  linkedPatchId?: string;
  createdAt: number;
  updatedAt: number;
}

export type PatchScope =
  | { kind: 'deck'; deckId: string; operationMode: OperationMode }
  | { kind: 'slide'; deckId: string; slideIds: string[]; operationMode: OperationMode }
  | {
      kind: 'elements';
      deckId: string;
      slideIds: string[];
      elementIds: string[];
      operationMode: OperationMode;
    }
  | {
      kind: 'bounding_box';
      deckId: string;
      slideIds: string[];
      elementIds: string[];
      bbox: BoundingBox;
      operationMode: OperationMode;
    }
  | {
      kind: 'comment';
      deckId: string;
      slideIds: string[];
      elementIds: string[];
      commentId: string;
      operationMode: OperationMode;
    };

export type PatchOperation =
  | { op: 'move'; slideId: string; elementId: string; x: number; y: number }
  | {
      op: 'resize';
      slideId: string;
      elementId: string;
      width: number;
      height: number;
    }
  | {
      op: 'replace_text';
      slideId: string;
      elementId: string;
      text: string;
      /** Optional provenance rebinding applied atomically with source-grounded copy. */
      sourceIds?: string[];
    }
  | {
      op: 'update_style';
      slideId: string;
      elementId: string;
      properties: Partial<ElementStyle>;
    }
  | {
      op: 'update_chart';
      slideId: string;
      elementId: string;
      chart: ChartData;
    }
  | {
      op: 'update_image';
      slideId: string;
      elementId: string;
      imageUrl: string;
      altText: string;
      credit?: string;
      sourceIds?: string[];
    }
  | { op: 'add_element'; slideId: string; element: SlideElement }
  | { op: 'remove_element'; slideId: string; elementId: string }
  | {
      op: 'set_visibility_v1';
      slideId: string;
      elementId: string;
      visible: boolean;
    }
  | {
      op: 'group_elements_v1';
      slideId: string;
      elementIds: string[];
      groupId: string;
    }
  | {
      op: 'ungroup_elements_v1';
      slideId: string;
      elementIds: string[];
      groupId: string;
    }
  | {
      op: 'reorder_element_v1';
      slideId: string;
      elementId: string;
      index: number;
    }
  | { op: 'add_slide'; slide: Slide; elements: SlideElement[]; index: number }
  | { op: 'remove_slide'; slideId: string }
  | { op: 'reorder_slide'; slideId: string; index: number }
  | {
      op: 'update_slide';
      slideId: string;
      properties: Partial<Pick<Slide, 'title' | 'notes' | 'background'>>;
    }
  | { op: 'update_deck'; properties: { title?: string } };

export interface DeckPatch {
  id: string;
  deckId: string;
  baseDeckVersion: number;
  /** Optional fine-grained CAS clocks used to safely rebase non-overlapping work. */
  baseSlideVersions: Record<string, number>;
  /** Optional fine-grained CAS clocks used to safely rebase non-overlapping work. */
  baseElementVersions: Record<string, number>;
  resultingDeckVersion?: number;
  scope: PatchScope;
  operations: PatchOperation[];
  source: PatchSource;
  status: PatchStatus;
  summary: string;
  linkedCommentId?: string;
  traceId?: string;
  /** Defaults to edit for rows created before proposal provenance v1. */
  proposalKind?: NodeSlideProposalKind;
  /** Present only for a separately reviewed propagation proposal. */
  parentPatchId?: string;
  /** Canonical, sorted slide set affected by a propagation proposal. */
  affectedSlideIds?: string[];
  /** Full SHA-256 binding of the propagation slide set and its parent patch. */
  affectedSlideDigest?: string;
  /** Full SHA-256 semantic digest of the exact preflight candidate. */
  candidateDigest?: string;
  /** Full validation receipt for this patch's materialized candidate, never the current deck. */
  candidateValidation?: CandidateValidationReceipt;
  /** Immutable signature revision; profileId and profileDigest always appear together. */
  profileId?: string;
  profileDigest?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SourceRecord {
  id: string;
  deckId: string;
  title: string;
  url?: string;
  sourceType: 'internal' | 'url' | 'document' | 'spreadsheet' | 'note';
  retrievedAt: number;
  citation: string;
  license?: string;
  /** Typed ingestion metadata. Optional for rows created before source-metadata v1. */
  format?: 'csv' | 'json' | 'txt' | 'web';
  contentDigest?: string;
  byteSize?: number;
  rowCount?: number;
  columns?: string[];
  provider?: string;
  retention?: 'until_deleted' | 'public_snapshot';
  status?: 'ready' | 'refreshing' | 'failed';
  lastRefreshedAt?: number;
}

export type NodeSlideAgentRunStatus =
  | 'queued'
  | 'researching'
  | 'planning'
  | 'validating'
  | 'awaiting_review'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface NodeSlideAgentRun {
  id: string;
  deckId: string;
  idempotencyKey: string;
  instruction: string;
  status: NodeSlideAgentRunStatus;
  provider: string;
  model: string;
  webResearch: boolean;
  attempt: number;
  /** W3C-compatible 32-hex trace identifier for this durable run. */
  otelTraceId?: string;
  /** Root invoke_agent span identifier (16 hex characters). */
  rootSpanId?: string;
  /** Last durable progress checkpoint written by the worker. */
  checkpoint?: string;
  lastHeartbeatAt?: number;
  leaseExpiresAt?: number;
  nextTelemetrySequence?: number;
  telemetryVersion?: string;
  otelExportStatus?: 'pending' | 'exported' | 'skipped' | 'failed';
  otelExportedAt?: number;
  otelExportError?: string;
  patchId?: string;
  traceId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export type NodeSlideAgentTelemetryValue = string | number | boolean;

export interface NodeSlideAgentTelemetryAttribute {
  key: string;
  value: NodeSlideAgentTelemetryValue;
}

export interface NodeSlideAgentSpan {
  id: string;
  deckId: string;
  runId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  operationName: string;
  kind: 'internal' | 'client';
  status: 'unset' | 'ok' | 'error';
  startTime: number;
  endTime?: number;
  durationMs?: number;
  provider?: string;
  model?: string;
  toolName?: string;
  inputTokens?: number;
  outputTokens?: number;
  costMicroUsd?: number;
  /** Source records read or produced by this exact span. Absent on legacy spans. */
  sourceIds?: string[];
  attributes: NodeSlideAgentTelemetryAttribute[];
  sequence: number;
  createdAt: number;
  updatedAt: number;
}

export interface NodeSlideAgentEvent {
  id: string;
  deckId: string;
  runId: string;
  traceId: string;
  spanId: string;
  name: string;
  severity: 'info' | 'warn' | 'error';
  timestamp: number;
  body: string;
  attributes: NodeSlideAgentTelemetryAttribute[];
  sequence: number;
}

export interface NodeSlideAgentTelemetryPage {
  spans: NodeSlideAgentSpan[];
  events: NodeSlideAgentEvent[];
  nextBeforeSequence?: number;
  hasMore: boolean;
  totalRecorded: number;
}

export interface NodeSlideAgentMessage {
  id: string;
  deckId: string;
  runId: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolName?: string;
  sourceIds?: string[];
  createdAt: number;
}

export type NodeSlideAgentMemoryCategory =
  | 'preference'
  | 'fact'
  | 'decision'
  | 'instruction'
  | 'context';

export type NodeSlideAgentMemoryStatus = 'active' | 'archived';

/**
 * Owner-only, deck-scoped durable memory. Memory is never part of a published
 * snapshot and is only added to a provider request when the user enables it.
 */
export interface NodeSlideAgentMemory {
  id: string;
  deckId: string;
  category: NodeSlideAgentMemoryCategory;
  content: string;
  status: NodeSlideAgentMemoryStatus;
  source: 'user' | 'agent';
  sourceRunId?: string;
  contentDigest: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
  useCount: number;
}

export interface ValidationIssue {
  id: string;
  severity: 'error' | 'warning' | 'info';
  code:
    | 'schema'
    | 'missing_asset'
    | 'overflow'
    | 'collision'
    | 'contrast'
    | 'font_size'
    | 'source'
    | 'scope'
    | 'export'
    | 'on_brand_color'
    | 'on_brand_font'
    | 'on_brand_type_scale'
    | 'on_brand_background';
  message: string;
  slideId?: string;
  elementId?: string;
}

export interface ValidationResult {
  id: string;
  deckId: string;
  deckVersion: number;
  ok: boolean;
  publishOk: boolean;
  cleanOk: boolean;
  issues: ValidationIssue[];
  checkedAt: number;
  toolchainVersion: string;
}

export interface DeckVersion {
  id: string;
  deckId: string;
  version: number;
  label: string;
  source: PatchSource;
  patchId?: string;
  snapshot: DeckSnapshot;
  createdAt: number;
}

export interface AgentTrace {
  id: string;
  deckId: string;
  patchId?: string;
  status: 'planning' | 'working' | 'awaiting_review' | 'completed' | 'failed' | 'cancelled';
  summary: string;
  plan: string[];
  context: string[];
  toolCalls: string[];
  guardrails: string[];
  planningInputDigest?: string;
  planningSnapshotDigest?: string;
  shadowComparisonExpected?: boolean;
  shadowControlsDigest?: string;
  validation?: ValidationResult;
  candidateDigest?: string;
  provider?: string;
  model?: string;
  reasoningEffort?: NodeSlideReasoningEffort;
  costMicroUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  createdAt: number;
  completedAt?: number;
}

export interface ExportArtifact {
  id: string;
  deckId: string;
  deckVersion: number;
  kind: 'html' | 'pptx' | 'pdf' | 'png';
  status: 'queued' | 'rendering' | 'ready' | 'failed';
  capabilityWarnings: string[];
  fileName?: string;
  url?: string;
  createdAt: number;
}

export interface Presence {
  id: string;
  deckId: string;
  sessionId: string;
  displayName: string;
  color: string;
  slideId?: string;
  elementIds: string[];
  cursor?: { x: number; y: number };
  lastSeenAt: number;
}

export interface DeckSnapshot {
  deck: Deck;
  slides: Slide[];
  elements: SlideElement[];
  sources: SourceRecord[];
}

/**
 * The deliberately narrow deck shape exposed by a public presentation link.
 * Owner-only creation context, signature configuration, and the mutable share
 * capability are not part of the published contract.
 */
export interface PublishedDeck {
  schemaVersion: typeof NODESLIDE_SCHEMA_VERSION;
  toolchainVersion: string;
  id: string;
  title: string;
  theme: ThemeSpec;
  slideOrder: string[];
  version: number;
  status: 'published';
  createdAt: number;
  updatedAt: number;
}

/** Speaker notes are intentionally absent from public slides. */
export type PublishedSlide = Omit<Slide, 'notes'>;

/** Only explicitly public URL citations are included in a published snapshot. */
export type PublishedSourceRecord = Omit<SourceRecord, 'sourceType'> & {
  sourceType: 'url';
};

export interface PublishedDeckSnapshot {
  deck: PublishedDeck;
  slides: PublishedSlide[];
  elements: SlideElement[];
  sources: PublishedSourceRecord[];
}

export type NodeSlidePublicationStatus = 'active' | 'superseded' | 'revoked';

/** Bounded lifecycle metadata; the immutable snapshot is stored separately. */
export interface NodeSlidePublication {
  id: string;
  deckId: string;
  shareSlug: string;
  revision: number;
  deckVersion: number;
  validationId: string;
  status: NodeSlidePublicationStatus;
  publishedAt: number;
  supersededAt?: number;
  supersededById?: string;
  revokedAt?: number;
}

/** Explicit public presenter response. */
export interface PublishedNodeSlide {
  publication: NodeSlidePublication;
  snapshot: PublishedDeckSnapshot;
}

export interface NodeSlideWorkspace extends DeckSnapshot {
  comments: DeckComment[];
  patches: DeckPatch[];
  versions: DeckVersion[];
  traces: AgentTrace[];
  validations: ValidationResult[];
  exports: ExportArtifact[];
  presence: Presence[];
  publication: NodeSlidePublication | null;
}

export interface AgentEditRequest {
  deckId: string;
  instruction: string;
  baseDeckVersion: number;
  baseSlideVersions: Record<string, number>;
  baseElementVersions: Record<string, number>;
  scope: PatchScope;
  /** Active slide at request time; narrows whole-slide intent without expanding write authority. */
  focusSlideId?: string;
  readContext?: readonly AgentReadReference[];
  designBehavior?: NodeSlideDesignBehavior;
  referenceUse?: NodeSlideReferenceUsePolicy;
  commandId?: NodeSlideEditorCommandId;
  providerMode?: NodeSlideProviderMode;
  providerModel?: NodeSlideAgentModelId;
  providerEffort?: NodeSlideReasoningEffort;
  providerConsent?:
    | typeof NODESLIDE_OPENROUTER_EDIT_CONSENT
    | typeof NODESLIDE_NEBIUS_REVIEW_CONSENT;
  /** Stable client-generated key prevents double-submit from creating two proposals. */
  idempotencyKey?: string;
  /** Web retrieval is independent from model egress and requires its own exact consent. */
  webResearch?: boolean;
  webResearchConsent?: typeof NODESLIDE_WEB_RESEARCH_CONSENT;
  /** Durable deck memory is opt-in per request and defaults to off server-side. */
  memoryMode?: 'off' | 'relevant';
}

/** Explicit read authority is independent from PatchScope, which remains write authority. */
export interface AgentReadReference {
  id: string;
  kind: AgentReadReferenceKind;
  /** Display-only input. The server derives trusted provider labels from authoritative rows. */
  label: string;
}

export interface CandidateValidationReceipt {
  id: string;
  patchId: string;
  candidateDigest: string;
  deckId: string;
  deckVersion: number;
  ok: boolean;
  publishOk: boolean;
  cleanOk: boolean;
  issues: ValidationIssue[];
  checkedAt: number;
  toolchainVersion: string;
}

export interface NodeSlideEditorCapabilityRegistry {
  version: typeof NODESLIDE_EDITOR_CAPABILITY_VERSION;
  designBehaviorPolicyVersion: typeof NODESLIDE_DESIGN_BEHAVIOR_POLICY_VERSION;
  designBehaviors: readonly NodeSlideDesignBehavior[];
  referenceUsePolicies: readonly NodeSlideReferenceUsePolicy[];
  commands: readonly {
    id: NodeSlideEditorCommandId;
    authority:
      | 'nodeslideAgent.proposeEdit'
      | 'nodeslideVariations.generate'
      | 'nodeslide.proposePropagation';
    proposalKind: NodeSlideProposalKind;
  }[];
  layerOperationVersion: typeof NODESLIDE_LAYER_OPERATION_VERSION;
  layerOperations: readonly Extract<
    PatchOperation['op'],
    'set_visibility_v1' | 'group_elements_v1' | 'ungroup_elements_v1' | 'reorder_element_v1'
  >[];
}

export interface CreateDeckRequest {
  clientSessionId: string;
  title: string;
  brief: DeckBrief;
  themeId: string;
  route: 'free' | 'balanced' | 'frontier';
  attachments?: NodeSlideDataAttachment[];
}

export type { NodeSlideDataAttachment } from './nodeslideAttachments';

export function isElementOperation(
  operation: PatchOperation,
): operation is Exclude<
  PatchOperation,
  | { op: 'add_slide' }
  | { op: 'remove_slide' }
  | { op: 'reorder_slide' }
  | { op: 'update_slide' }
  | { op: 'update_deck' }
  | { op: 'group_elements_v1' }
  | { op: 'ungroup_elements_v1' }
> {
  return (
    operation.op !== 'add_slide' &&
    operation.op !== 'remove_slide' &&
    operation.op !== 'reorder_slide' &&
    operation.op !== 'update_slide' &&
    operation.op !== 'update_deck' &&
    operation.op !== 'group_elements_v1' &&
    operation.op !== 'ungroup_elements_v1'
  );
}

export function operationElementIds(operation: PatchOperation): string[] {
  if (operation.op === 'add_slide') return operation.elements.map((element) => element.id);
  if (operation.op === 'add_element') return [operation.element.id];
  if (operation.op === 'group_elements_v1' || operation.op === 'ungroup_elements_v1') {
    return [...operation.elementIds];
  }
  if (isElementOperation(operation)) return [operation.elementId];
  return [];
}

export function clampNormalized(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function elementById(
  elements: readonly SlideElement[],
  elementId: string,
): SlideElement | undefined {
  return elements.find((element) => element.id === elementId);
}

export function slideById(slides: readonly Slide[], slideId: string): Slide | undefined {
  return slides.find((slide) => slide.id === slideId);
}
