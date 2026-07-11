export const NODESLIDE_SIGNATURE_SCHEMA_VERSION = 'nodeslide.signature/v1' as const;

export const NODESLIDE_SIGNATURE_DEFAULT_BOUNDS = Object.freeze({
  maxCompressedBytes: 64 * 1024 * 1024,
  maxZipEntries: 5_000,
  maxSlides: 200,
  maxAggregateXmlBytes: 64 * 1024 * 1024,
  maxXmlPartBytes: 8 * 1024 * 1024,
  timeoutMs: 10_000,
  maxEvidenceRecords: 2_000,
  maxUsageValuesPerCategory: 128,
}) satisfies SignatureExtractionBounds;

export type SignatureSourceKind = 'pptx' | 'pdf' | 'screenshot' | 'taste_pack';
export type SignatureExtractionMethod = 'ooxml' | 'vision' | 'authored';
export type SignatureConfidence = 'high' | 'medium' | 'low';
export type SignatureSourceRole = 'theme' | 'master' | 'layout' | 'slide' | 'inferred' | 'authored';

export interface SignatureTokenEvidenceExtension {
  evidenceIds: string[];
  confidence: number;
  occurrences: number;
  sourceRole: SignatureSourceRole;
  /** Present only for font-size tokens extracted from OOXML point values. */
  originalPoints?: number;
}

export interface SignatureEvidence {
  id: string;
  sourceKind: SignatureSourceKind;
  method: SignatureExtractionMethod;
  sourceDigest: string;
  locator: string;
  observedValue: string;
  confidence: number;
}

export interface SignatureColorValue {
  colorSpace: 'srgb';
  components: [number, number, number];
  alpha?: number;
  hex: string;
}

export interface SignatureDimensionValue {
  value: number;
  unit: 'px';
}

export interface SignatureColorToken {
  $type: 'color';
  $value: SignatureColorValue;
  $description?: string;
  $extensions: {
    'com.nodeslide.signature': SignatureTokenEvidenceExtension;
  };
}

export interface SignatureFontFamilyToken {
  $type: 'fontFamily';
  $value: string | [string, ...string[]];
  $description?: string;
  $extensions: {
    'com.nodeslide.signature': SignatureTokenEvidenceExtension;
  };
}

export interface SignatureDimensionToken {
  $type: 'dimension';
  $value: SignatureDimensionValue;
  $description?: string;
  $extensions: {
    'com.nodeslide.signature': SignatureTokenEvidenceExtension;
  };
}

export interface SignatureUsage {
  value: string;
  occurrences: number;
  evidenceIds: string[];
}

export interface SignatureNumericUsage {
  value: number;
  unit: 'pt';
  occurrences: number;
  evidenceIds: string[];
}

export interface SignatureLayoutUsage {
  partName: string;
  occurrences: number;
}

export type SignatureDensity = 'sparse' | 'balanced' | 'dense' | 'unknown';

export interface SignatureLayoutTendencies {
  slideWidthInches: number;
  slideHeightInches: number;
  aspectRatio: number;
  slideCount: number;
  masterCount: number;
  layoutCount: number;
  layoutUsage: SignatureLayoutUsage[];
  averageShapesPerSlide: number;
  maximumShapesPerSlide: number;
  averageTextRunsPerSlide: number;
  medianFontSizePoints?: number;
  density: SignatureDensity;
  embeddedFontsPresent: boolean;
  embeddedFontFamilies: string[];
}

export type SignatureWarningCode =
  | 'empty_deck'
  | 'part_too_large'
  | 'evidence_truncated'
  | 'usage_truncated'
  | 'unresolved_alias'
  | 'unresolved_color'
  | 'missing_theme'
  | 'missing_master'
  | 'missing_layout'
  | 'missing_slide'
  | 'malformed_optional_part'
  | 'unsafe_archive_entry'
  | 'unsafe_relationship'
  | 'embedded_font_unresolved';

export interface SignatureWarning {
  code: SignatureWarningCode;
  message: string;
  locator?: string;
}

export interface SignatureProfile {
  schemaVersion: typeof NODESLIDE_SIGNATURE_SCHEMA_VERSION;
  id: string;
  name: string;
  source: {
    kind: SignatureSourceKind;
    digest: string;
    fileName?: string;
  };
  tokens: {
    colors: Record<string, SignatureColorToken>;
    fontFamilies: Record<string, SignatureFontFamilyToken>;
    fontSizes: Record<string, SignatureDimensionToken>;
  };
  usage: {
    colors: SignatureUsage[];
    fonts: SignatureUsage[];
    fontSizes: SignatureNumericUsage[];
  };
  layout: SignatureLayoutTendencies;
  evidence: SignatureEvidence[];
  confidence: SignatureConfidence;
  warnings: SignatureWarning[];
}

export interface SignatureExtractionBounds {
  maxCompressedBytes: number;
  maxZipEntries: number;
  maxSlides: number;
  maxAggregateXmlBytes: number;
  maxXmlPartBytes: number;
  timeoutMs: number;
  maxEvidenceRecords: number;
  maxUsageValuesPerCategory: number;
}

export interface SignatureExtractionOptions {
  fileName?: string;
  bounds?: Partial<SignatureExtractionBounds>;
}

export interface SignatureDiagnostics {
  bounds: SignatureExtractionBounds;
  elapsedMs: number;
  zipEntries: number;
  xmlBytesRead: number;
  partsRead: number;
  slidesDeclared: number;
  slidesProcessed: number;
  evidenceRetained: number;
  usageValuesRetained: {
    colors: number;
    fonts: number;
    fontSizes: number;
  };
  warningCodes: SignatureWarningCode[];
}

export type SignatureExtractionErrorCode =
  | 'unsupported_input'
  | 'input_too_large'
  | 'archive_too_large'
  | 'slide_limit_exceeded'
  | 'timeout'
  | 'invalid_zip'
  | 'invalid_pptx';

export interface SignatureExtractionError {
  code: SignatureExtractionErrorCode;
  message: string;
}

export type SignatureExtractionResult =
  | { ok: true; profile: SignatureProfile; diagnostics: SignatureDiagnostics }
  | { ok: false; error: SignatureExtractionError; diagnostics: SignatureDiagnostics };

export type SignatureBytes = ArrayBuffer | Uint8Array;

export interface SignatureExtractionInput {
  kind: SignatureSourceKind;
  bytes: SignatureBytes;
  fileName?: string;
}
