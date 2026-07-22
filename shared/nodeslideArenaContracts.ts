import projection from './generated/nodeslide-arena-contracts.json';

/**
 * Consumer of the Arena contract projection emitted by the live nodeslide repo.
 *
 * Per the Arena reconciliation council (2026-07-22, docs/NODESLIDE_ARENA_RECONCILIATION.md),
 * nodeslide owns the canonical Arena contract family. parity-studio does NOT mint its own Arena
 * schema — it reads this generated projection, the same pattern as the MCP `atlas.json`, flowing
 * nodeslide → parity because nodeslide is live. Regenerate on the nodeslide side with
 * `node scripts/emit-arena-contracts.mjs`; the sha256 in `meta` binds it to its source.
 *
 * This replaced the deleted `shared/nodeslideArena.ts`, whose `nodeslide.arena/v1` schema and
 * runtime `confounded` verdict were retired. The coverage-drop accounting, null-gate scoring and
 * cross-axis guard those provided now live and are tested in nodeslide.
 */

export interface NodeSlideArenaContracts {
  schemaVersion: 'nodeslide.contract-projection/v1';
  sourceRepository: 'nodeslide';
  schemaIds: readonly string[];
  receiptGates: readonly string[];
  arenaOmissionReasons: readonly string[];
  gateStates: readonly string[];
  receiptStatuses: readonly string[];
  crossAxisPolicy: {
    representable: boolean;
    errorName: string;
    codes: readonly string[];
  };
  sourceFiles: readonly string[];
  meta: { sourceCommit: string; sha256: `sha256:${string}` };
}

export const NODESLIDE_ARENA_CONTRACTS = projection as NodeSlideArenaContracts;

/** The canonical Arena schema ids parity may reference but must not redefine. */
export function arenaSchemaIds(): readonly string[] {
  return NODESLIDE_ARENA_CONTRACTS.schemaIds;
}

/**
 * Whether cross-axis (model + harness both changed) comparison is a representable result.
 * It is not: the canonical path throws rather than emitting a `confounded` verdict.
 */
export function crossAxisComparisonRepresentable(): boolean {
  return NODESLIDE_ARENA_CONTRACTS.crossAxisPolicy.representable;
}
