export const NODESLIDE_SCHEMA_VERSION = 'nodeslide.slidelang/v1' as const;
export const NODESLIDE_TOOLCHAIN_VERSION = 'local-slidelang-adapter/1.0.0' as const;
export const NODESLIDE_PATCH_OPERATION_LIMIT = 512 as const;
export const SLIDE_WIDTH_IN = 13.333;
export const SLIDE_HEIGHT_IN = 7.5;

export type StudioDomain = 'parity' | 'nodeslide';
export type ElementKind = 'text' | 'shape' | 'image' | 'chart' | 'connector';
export type PatchSource = 'human' | 'agent' | 'import' | 'system';
export type PatchStatus = 'draft' | 'validating' | 'ready' | 'accepted' | 'rejected' | 'stale';
export type OperationMode = 'copy' | 'style' | 'layout' | 'unrestricted';
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
  imageUrl?: string;
  altText?: string;
  sourceIds: string[];
  locked: boolean;
  exportCapabilities: ExportCapability[];
  version: number;
}

export interface Slide {
  id: string;
  deckId: string;
  title: string;
  section?: string;
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
  | { op: 'replace_text'; slideId: string; elementId: string; text: string }
  | {
      op: 'update_style';
      slideId: string;
      elementId: string;
      properties: Partial<ElementStyle>;
    }
  | { op: 'add_element'; slideId: string; element: SlideElement }
  | { op: 'remove_element'; slideId: string; elementId: string }
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
  validation?: ValidationResult;
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
> {
  return (
    operation.op !== 'add_slide' &&
    operation.op !== 'remove_slide' &&
    operation.op !== 'reorder_slide' &&
    operation.op !== 'update_slide' &&
    operation.op !== 'update_deck'
  );
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
