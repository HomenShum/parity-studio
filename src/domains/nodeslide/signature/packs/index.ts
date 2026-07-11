import type { SignatureProfile } from '../../../../../shared/nodeslideSignature';
import { financeIbcsTastePack, financeIbcsTastePackJson } from './finance-ibcs';
import { startupNarrativeTastePack, startupNarrativeTastePackJson } from './startup-narrative';
import type { NodeSlideTastePack, NodeSlideTastePackId } from './types';

export * from './encoding';
export * from './types';
export * from './validation';
export {
  financeIbcsTastePack,
  financeIbcsTastePackJson,
  startupNarrativeTastePack,
  startupNarrativeTastePackJson,
};

export const FINANCE_IBCS_TASTE_PACK = financeIbcsTastePack;
export const STARTUP_NARRATIVE_TASTE_PACK = startupNarrativeTastePack;

export const NODESLIDE_TASTE_PACKS: readonly NodeSlideTastePack[] = Object.freeze([
  financeIbcsTastePack,
  startupNarrativeTastePack,
]);

export const NODESLIDE_SIGNATURE_TASTE_PROFILES: readonly SignatureProfile[] =
  NODESLIDE_TASTE_PACKS;

export const NODESLIDE_TASTE_PACK_JSON: Readonly<Record<NodeSlideTastePackId, string>> =
  Object.freeze({
    'finance-ibcs': financeIbcsTastePackJson,
    'startup-narrative': startupNarrativeTastePackJson,
  });

export function getNodeSlideTastePack(id: NodeSlideTastePackId): NodeSlideTastePack {
  return id === 'finance-ibcs' ? financeIbcsTastePack : startupNarrativeTastePack;
}
