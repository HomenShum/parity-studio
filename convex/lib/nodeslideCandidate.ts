import type {
  CandidateValidationReceipt,
  DeckPatch,
  DeckSnapshot,
  ValidationResult,
} from '../../shared/nodeslide';
import { applyDeckPatch } from '../../shared/nodeslidePatch';
import { nodeslideContentDigest, nodeslideStableId } from './nodeslideIds';

export function materializeNodeSlideCandidate(
  snapshot: DeckSnapshot,
  patch: Pick<DeckPatch, 'scope' | 'operations'>,
  committedAt: number,
): DeckSnapshot {
  return applyDeckPatch(
    snapshot,
    {
      baseDeckVersion: snapshot.deck.version,
      scope: patch.scope,
      operations: patch.operations,
    },
    committedAt,
  ).snapshot;
}

/** Excludes only the commit timestamp; all semantic content, order, and versions are bound. */
export function nodeSlideCandidateDigest(snapshot: DeckSnapshot): string {
  return nodeslideContentDigest(
    stableJson({
      ...snapshot,
      deck: { ...snapshot.deck, updatedAt: 0 },
    }),
  );
}

export function nodeSlideCandidateValidationId(patchId: string, candidateDigest: string): string {
  return nodeslideStableId('candidate_validation', patchId, candidateDigest);
}

export function candidateValidationReceipt(args: {
  patchId: string;
  candidateDigest: string;
  validation: ValidationResult;
}): CandidateValidationReceipt {
  return {
    id: args.validation.id,
    patchId: args.patchId,
    candidateDigest: args.candidateDigest,
    deckId: args.validation.deckId,
    deckVersion: args.validation.deckVersion,
    ok: args.validation.ok,
    publishOk: args.validation.publishOk,
    cleanOk: args.validation.cleanOk,
    issues: structuredClone(args.validation.issues),
    checkedAt: args.validation.checkedAt,
    toolchainVersion: args.validation.toolchainVersion,
  };
}

export function validationFromCandidateReceipt(
  receipt: CandidateValidationReceipt,
): ValidationResult {
  return {
    id: receipt.id,
    deckId: receipt.deckId,
    deckVersion: receipt.deckVersion,
    ok: receipt.ok,
    publishOk: receipt.publishOk,
    cleanOk: receipt.cleanOk,
    issues: structuredClone(receipt.issues),
    checkedAt: receipt.checkedAt,
    toolchainVersion: receipt.toolchainVersion,
  };
}

export function candidateValidationBindingMatches(args: {
  patchId: string;
  candidateDigest: string;
  persistedDigest?: string;
  persistedReceipt?: CandidateValidationReceipt;
  validation: ValidationResult;
}): boolean {
  const receipt = args.persistedReceipt;
  if (!args.persistedDigest || !receipt) return false;
  if (
    args.persistedDigest !== args.candidateDigest ||
    receipt.patchId !== args.patchId ||
    receipt.candidateDigest !== args.candidateDigest
  ) {
    return false;
  }
  return validationSemanticDigest(args.validation) === validationSemanticDigest(receipt);
}

function validationSemanticDigest(
  validation: ValidationResult | CandidateValidationReceipt,
): string {
  return nodeslideContentDigest(
    stableJson({
      id: validation.id,
      deckId: validation.deckId,
      deckVersion: validation.deckVersion,
      ok: validation.ok,
      publishOk: validation.publishOk,
      cleanOk: validation.cleanOk,
      issues: validation.issues,
      toolchainVersion: validation.toolchainVersion,
    }),
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
