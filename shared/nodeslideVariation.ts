import type { PatchOperation, Slide, SlideElement, ValidationResult } from './nodeslide';

export const NODESLIDE_VARIATION_SCHEMA_VERSION = 'nodeslide.variation/v1' as const;
export const NODESLIDE_VARIANT_COUNT = 3 as const;
export const NODESLIDE_VARIANT_OPERATION_LIMIT = 8 as const;

export type VariationContentAngle = 'data_led' | 'narrative_led' | 'balanced';
export type VariationDensity = 'executive' | 'detail' | 'balanced';
export type VariationLayoutArchetype = 'headline' | 'split' | 'evidence' | 'comparison';
export type VariationOrigin = 'free_route' | 'deterministic_fallback';
export type VariationStatus = 'ready' | 'accepted' | 'rejected' | 'stale';

export interface VariationAxes {
  contentAngle: VariationContentAngle;
  density: VariationDensity;
  layoutArchetype: VariationLayoutArchetype;
}

export interface SlideVariation {
  schemaVersion: typeof NODESLIDE_VARIATION_SCHEMA_VERSION;
  id: string;
  batchId: string;
  deckId: string;
  slideId: string;
  baseDeckVersion: number;
  baseSlideVersion: number;
  baseElementVersions: Record<string, number>;
  axes: VariationAxes;
  origin: VariationOrigin;
  fallbackReason?: string;
  operations: PatchOperation[];
  candidate: { slide: Slide; elements: SlideElement[] };
  validation: ValidationResult;
  status: VariationStatus;
  selectedPatchId?: string;
  createdAt: number;
  decidedAt?: number;
}

export interface VariationBatch {
  id: string;
  deckId: string;
  slideId: string;
  requestedCount: 3;
  status: 'generating' | 'ready' | 'failed';
  origin: VariationOrigin;
  fallbackReason?: string;
  variationIds: string[];
  elapsedMs: number;
  createdAt: number;
  completedAt?: number;
}
