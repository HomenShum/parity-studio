export const NODESLIDE_SCHEMA_VERSION = 'nodeslide.slidelang/v1' as const;
export const NODESLIDE_TOOLCHAIN_VERSION = 'local-slidelang-adapter/1.1.0' as const;
export const NODESLIDE_AGENT_MODELS = [
  {
    id: 'z-ai/glm-5.2',
    provider: 'openrouter',
    vendor: 'Z.ai',
    label: 'GLM 5.2',
    description: 'Long-horizon planning and structured slide edits.',
  },
  {
    id: 'anthropic/claude-sonnet-4.6',
    provider: 'openrouter',
    vendor: 'Anthropic',
    label: 'Claude Sonnet 4.6',
    description: 'Strong writing, document reasoning, and nuanced revisions.',
  },
  {
    id: 'google/gemini-3.1-pro-preview',
    provider: 'openrouter',
    vendor: 'Google',
    label: 'Gemini 3.1 Pro',
    description: 'High-context planning and data-heavy presentation work.',
  },
  {
    id: 'openai/gpt-5.4',
    provider: 'openrouter',
    vendor: 'OpenAI',
    label: 'GPT-5.4',
    description: 'Frontier reasoning and precise structured transformations.',
  },
] as const;
export type NodeSlideAgentModelId = (typeof NODESLIDE_AGENT_MODELS)[number]['id'];
export const NODESLIDE_DEFAULT_AGENT_MODEL: NodeSlideAgentModelId = 'z-ai/glm-5.2';

export function isNodeSlideAgentModelId(value: unknown): value is NodeSlideAgentModelId {
  return NODESLIDE_AGENT_MODELS.some((model) => model.id === value);
}

export function nodeSlideAgentModel(modelId: NodeSlideAgentModelId) {
  return NODESLIDE_AGENT_MODELS.find((model) => model.id === modelId) ?? NODESLIDE_AGENT_MODELS[0];
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
export type NodeSlideProviderMode = 'deterministic' | 'openrouter_free';
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
  providerConsent?: typeof NODESLIDE_OPENROUTER_EDIT_CONSENT;
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
}

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
