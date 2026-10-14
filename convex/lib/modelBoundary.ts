/**
 * Public model-selection boundary (model-defaults SPEC A.0.10). Pure, so the V8-runtime mutations in runs.ts can
 * use it; pi-ai is node-only there. Same rule as the action-side resolver (`failClosedRoute` in autoRouter.ts):
 * a catalog id is accepted, an unknown free-looking id is accepted because the resolver turns it into the verified
 * free constant, and any other unknown id is refused before it is persisted.
 */
import { KNOWN_MODEL_IDS } from './knownModelIds.generated';

/** A free route by name (`:free` / `-free` suffix). */
export const FREE_LOOKING = /[:-]free$/i;

export function assertSelectableModel(provider: string, modelId: string): void {
  if (KNOWN_MODEL_IDS[provider]?.includes(modelId)) return;
  if (FREE_LOOKING.test(modelId)) return;
  throw new Error(
    `Unknown model "${modelId}" for provider "${provider}": not in the pi-ai catalog, refusing to persist a paid default.`,
  );
}
