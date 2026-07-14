export { createGoogleSlidesAdapter, GoogleSlidesRestError } from './adapter';
export { GOOGLE_SLIDES_SYNC_CAPABILITIES } from './capabilities';
export {
  dimensionToEmu,
  EMU_PER_POINT,
  normalizeGoogleSlidesPresentation,
} from './normalization';
export { planGoogleSlidesThreeWaySync } from './planning';
export type {
  GoogleSlidesAdapter,
  GoogleSlidesAdapterOptions,
  GoogleSlidesGetResult,
} from './adapter';
export type { GoogleSlidesNormalizationResult } from './normalization';
export type {
  GoogleSlidesThreeWaySyncInput,
  GoogleSlidesThreeWaySyncPlan,
} from './planning';
export type {
  GoogleSlidesAuth,
  GoogleSlidesBatchUpdateBody,
  GoogleSlidesBatchUpdatePlan,
  GoogleSlidesBatchUpdateResponse,
  GoogleSlidesFetch,
  GoogleSlidesNormalizationHooks,
  GoogleSlidesPresentation,
  GoogleSlidesRequest,
} from './types';
