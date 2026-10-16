/**
 * Public model-selection boundary (model-defaults SPEC A.0.10). Pure, so the V8-runtime mutations in runs.ts can
 * use it; pi-ai is node-only there. Same rule as the action-side resolver (`failClosedRoute` in autoRouter.ts):
 * a catalog id is accepted, an unknown free-looking id is accepted because the resolver turns it into the verified
 * free constant, a free id the SPEC lists but the catalog cannot call is refused (D1: a known id is never rerouted
 * to another model), and any other unknown id is refused before it is persisted.
 */
import { KNOWN_MODEL_IDS } from './knownModelIds.generated';

/** A free route by name (`:free` / `-free` suffix). */
export const FREE_LOOKING = /[:-]free$/i;

/**
 * The live `:free` list of model-defaults SPEC 1.2 (fetched 2026-10-10): the free ids that are *known* under D1.
 * Most are in the pi-ai OpenRouter catalog; one that is not cannot be called here and must be refused, not
 * rerouted to a different model.
 */
export const SPEC_FREE_MODELS: readonly string[] = [
  'apodex/apodex-1.1-mini:free',
  'dots-studio/dots-3-note-preview:free',
  'liquid/lfm-2.5-2.6b:free',
  'nvidia/nemotron-3.5-lightning:free',
  'thinkingmachines/inkling-small:free',
  'poolside/laguna-s-2.1:free',
  'thinkingmachines/inkling:free',
  'poolside/laguna-xs-2.1:free',
  'cohere/north-mini-code:free',
  'nvidia/nemotron-3.5-content-safety:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'google/gemma-4-26b-a4b-it:free',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
];

/**
 * What a free-looking id that missed its own provider's catalog means (SPEC D1, A.0.10). `'openrouter'`: the exact
 * id is in the OpenRouter catalog, so the call is the same model on its real transport (a `google/...:free` spelling
 * that provider inference sent to Google). `'unknown'`: known nowhere, so the resolver substitutes the verified free
 * constant. Throws for an id SPEC 1.2 lists that the catalog cannot call: any substitute would be another model.
 */
export function freeLookingRoute(
  modelId: string,
  openrouterIds: readonly string[],
): 'openrouter' | 'unknown' {
  if (openrouterIds.includes(modelId)) return 'openrouter';
  if (SPEC_FREE_MODELS.includes(modelId)) {
    throw new Error(
      `Model "${modelId}" is a known free route that the pi-ai catalog cannot call; refusing to reroute it to a different model.`,
    );
  }
  return 'unknown';
}

export function assertSelectableModel(provider: string, modelId: string): void {
  if (KNOWN_MODEL_IDS[provider]?.includes(modelId)) return;
  if (FREE_LOOKING.test(modelId)) {
    freeLookingRoute(modelId, KNOWN_MODEL_IDS['openrouter'] ?? []);
    return;
  }
  throw new Error(
    `Unknown model "${modelId}" for provider "${provider}": not in the pi-ai catalog, refusing to persist a paid default.`,
  );
}
