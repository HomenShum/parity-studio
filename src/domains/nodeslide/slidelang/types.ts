import type {
  DeckBrief,
  DeckSnapshot,
  ElementKind,
  ExportCapability,
  SlideElement,
  ThemeSpec,
  ValidationIssue,
  ValidationResult,
} from '../../../../shared/nodeslide';

export type PptxBinary = ArrayBuffer | Uint8Array;

export type NativeExportStatus = 'native' | 'static_fallback' | 'unsupported';

export interface ElementCapabilityReport {
  elementId: string;
  kind: ElementKind;
  declared: ExportCapability[];
  effective: ExportCapability[];
  web: NativeExportStatus;
  pptx: NativeExportStatus;
  googleSlides: NativeExportStatus;
  warnings: string[];
}

export type RepairActionKind =
  | 'normalize_geometry'
  | 'repair_schema'
  | 'attach_asset'
  | 'fit_text'
  | 'separate_elements'
  | 'improve_contrast'
  | 'increase_font_size'
  | 'attach_source'
  | 'repair_scope'
  | 'select_export_fallback';

export interface RepairAction {
  id: string;
  issueId: string;
  issueCode: ValidationIssue['code'];
  kind: RepairActionKind;
  description: string;
  automatic: boolean;
  slideId?: string;
  elementId?: string;
}

export interface RepairPlan {
  id: string;
  validationId: string;
  deckId: string;
  deckVersion: number;
  actions: RepairAction[];
}

export interface SlideLangScaffoldInput {
  deckId: string;
  projectId: string;
  title: string;
  brief: DeckBrief;
  theme?: ThemeSpec;
  timestamp?: number;
}

export interface SlideLangLocalPlan {
  id: string;
  deckId: string;
  deckVersion: number;
  validation: ValidationResult;
  repairs: RepairPlan;
  capabilities: ElementCapabilityReport[];
  steps: string[];
}

export interface SlideLangRepairResult {
  snapshot: DeckSnapshot;
  plan: RepairPlan;
  appliedActionIds: string[];
  skippedActionIds: string[];
  validation: ValidationResult;
}

export interface SlideLangLocalPublication {
  id: string;
  deckId: string;
  deckVersion: number;
  snapshot: DeckSnapshot;
  html: string;
  validation: ValidationResult;
  capabilityWarnings: string[];
}

/**
 * Typed boundary used by NodeSlide. The local implementation performs no I/O or paid calls;
 * only PPTX generation is asynchronous because its MIT dependency is loaded on demand.
 */
export interface SlideLangAdapter {
  readonly mode: 'local';
  scaffold(input: SlideLangScaffoldInput): DeckSnapshot;
  plan(snapshot: DeckSnapshot): SlideLangLocalPlan;
  check(snapshot: DeckSnapshot): ValidationResult;
  repair(snapshot: DeckSnapshot, plan?: RepairPlan): SlideLangRepairResult;
  publish(snapshot: DeckSnapshot): SlideLangLocalPublication;
  pull(publication: SlideLangLocalPublication): DeckSnapshot;
  validate(snapshot: DeckSnapshot): ValidationResult;
  getRepairPlan(validation: ValidationResult): RepairPlan;
  getElementCapability(element: SlideElement): ElementCapabilityReport;
  getCapabilityReports(snapshot: DeckSnapshot): ElementCapabilityReport[];
  renderSlideHtml(snapshot: DeckSnapshot, slideId: string): string;
  renderDeckHtml(snapshot: DeckSnapshot): string;
  buildPptx(snapshot: DeckSnapshot): Promise<PptxBinary>;
}
