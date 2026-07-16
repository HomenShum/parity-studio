import {
  NODESLIDE_ADD_SLIDE_ELEMENT_LIMIT,
  NODESLIDE_PATCH_OPERATION_LIMIT,
} from '../../../../shared/nodeslide';
import type { PptxImportBounds } from './pptxImportTypes';

export const NODESLIDE_JSON_LIMITS = {
  maxInputBytes: 16 * 1024 * 1024,
  maxSlides: 256,
  maxElementsPerSlide: NODESLIDE_ADD_SLIDE_ELEMENT_LIMIT,
  maxElements: 8_192,
  maxSources: 2_048,
  maxOperations: NODESLIDE_PATCH_OPERATION_LIMIT,
} as const;

export const DEFAULT_PPTX_IMPORT_BOUNDS: PptxImportBounds = {
  maxInputBytes: 64 * 1024 * 1024,
  maxEntries: 2_048,
  maxAggregateUncompressedBytes: 160 * 1024 * 1024,
  maxXmlPartBytes: 4 * 1024 * 1024,
  maxMediaPartBytes: 16 * 1024 * 1024,
  maxAggregateMediaBytes: 64 * 1024 * 1024,
  maxSlides: 64,
  maxItemsPerSlide: NODESLIDE_ADD_SLIDE_ELEMENT_LIMIT,
  maxTotalItems: 1_024,
  maxFidelityItems: 2_048,
  maxDurationMs: 8_000,
};
