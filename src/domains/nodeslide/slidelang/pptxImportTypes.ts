import type {
  DeckSnapshot,
  PatchOperation,
  PatchScope,
  ValidationResult,
} from '../../../../shared/nodeslide';

export type PptxImportFidelity = 'native' | 'approximated' | 'dropped';

export type PptxImportFeature =
  | 'presentation'
  | 'slide_dimensions'
  | 'slide_order'
  | 'slide'
  | 'background'
  | 'notes'
  | 'text'
  | 'shape'
  | 'connector'
  | 'image'
  | 'chart'
  | 'smartart'
  | 'animation'
  | 'grouped_transform'
  | 'macro'
  | 'omml'
  | 'table'
  | 'media'
  | 'ole'
  | 'unsupported_object';

export interface PptxImportFidelityItem {
  id: string;
  feature: PptxImportFeature;
  fidelity: PptxImportFidelity;
  reason: string;
  sourcePart?: string;
  sourceId?: string;
  /** Exact p:cNvPr/@name objectName used as the preferred round-trip identity signal. */
  sourceObjectName?: string;
  slideIndex?: number;
  targetId?: string;
}

export interface PptxImportFidelityReport {
  items: PptxImportFidelityItem[];
  summary: Record<PptxImportFidelity, number>;
  hasLoss: boolean;
}

export interface PptxImportBounds {
  maxInputBytes: number;
  maxEntries: number;
  maxAggregateUncompressedBytes: number;
  maxXmlPartBytes: number;
  maxMediaPartBytes: number;
  maxAggregateMediaBytes: number;
  maxSlides: number;
  maxItemsPerSlide: number;
  maxTotalItems: number;
  maxFidelityItems: number;
  maxDurationMs: number;
}

export interface PptxImportOptions {
  deckId: string;
  projectId: string;
  fileName?: string;
  title?: string;
  timestamp?: number;
  bounds?: Partial<PptxImportBounds>;
}

export type PptxImportErrorCode =
  | 'invalid_zip'
  | 'invalid_pptx'
  | 'archive_too_large'
  | 'part_too_large'
  | 'too_many_slides'
  | 'too_many_items'
  | 'deadline_exceeded'
  | 'candidate_too_large'
  | 'candidate_invalid';

export interface PptxImportError {
  code: PptxImportErrorCode;
  message: string;
  partName?: string;
}

export interface PptxImportSourceMetadata {
  fileName?: string;
  slideWidthEmu: number;
  slideHeightEmu: number;
  aspectRatio: number;
  slideCount: number;
  importedElementCount: number;
}

export interface PptxImportSuccess {
  ok: true;
  snapshot: DeckSnapshot;
  validation: ValidationResult;
  fidelity: PptxImportFidelityReport;
  source: PptxImportSourceMetadata;
}

export interface PptxImportFailure {
  ok: false;
  error: PptxImportError;
  fidelity: PptxImportFidelityReport;
}

export type PptxImportResult = PptxImportSuccess | PptxImportFailure;

/**
 * Read-only handoff for the existing applyPatch mutation. The clocks and scope are captured from
 * the same base snapshot used to materialize `snapshot` locally through applyDeckPatch.
 */
export interface PptxImportCandidate {
  deckId: string;
  baseDeckVersion: number;
  baseSlideVersions: Record<string, number>;
  baseElementVersions: Record<string, number>;
  scope: PatchScope;
  operations: PatchOperation[];
  summary: string;
  snapshot: DeckSnapshot;
  validation: ValidationResult;
  fidelity: PptxImportFidelityReport;
  source: PptxImportSourceMetadata;
}

export interface PptxImportCandidateSuccess {
  ok: true;
  candidate: PptxImportCandidate;
}

export type PptxImportCandidateResult = PptxImportCandidateSuccess | PptxImportFailure;
