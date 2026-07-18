import type { DeckSnapshot, PatchOperation } from '../../shared/nodeslide';
import { renderDeckHtml } from '../../src/domains/nodeslide/slidelang/html';
import { applyRepairPlan } from '../../src/domains/nodeslide/slidelang/repair';
import { validateSnapshot } from '../../src/domains/nodeslide/slidelang/validation';
import { nodeslideArtifactPresenceChecks } from './nodeslideArtifactPresence';
import { nodeslideContentDigest } from './nodeslideIds';
import type { NodeSlidePatchInput } from './nodeslidePatches';
import { clocksForNodeSlideOperations } from './nodeslidePatches';
import {
  type NodeSlideRenderRepairResult,
  runNodeSlideRenderRepairLoop,
} from './nodeslideRenderRepairLoop';

const RECEIPT_SUMMARY_LIMIT = 6;
const REPAIR_OPERATION_LIMIT = 8;

/** Compact, persistable summary of one live render-repair pass (bounded). */
export interface NodeSlideJobRenderRepairSummary {
  schemaVersion: 'nodeslide.live-render-repair/v1';
  status: 'completed' | 'stopped';
  terminalReason: string;
  attempts: number;
  proposalOperationCount: number;
  baseSnapshotDigest: string;
  candidateSnapshotDigest: string;
  receipts: Array<{ attempt: number; status: string; summary: string }>;
  /**
   * The FIRST repair proposal only: it is the one clock-bound to the snapshot
   * that was actually persisted (later proposals bind intermediate candidates
   * that never left the loop). Applying it rides the normal human patch path,
   * so review authority and CAS staleness checks stay intact.
   */
  proposal?: {
    deckId: string;
    baseDeckVersion: number;
    baseSlideVersions: Record<string, number>;
    baseElementVersions: Record<string, number>;
    scope: NodeSlidePatchInput['scope'];
    operations: PatchOperation[];
  };
}

/**
 * The live production callback set for the render-repair loop: deterministic
 * validation, the real HTML renderer, artifact-presence observation, and repair
 * proposals derived from the shipped automatic repair plan (geometry clamp,
 * text fit, minimum font size, contrast). No model is in this loop; proposals
 * remain review artifacts per the loop's guardrails.
 */
export function runNodeSlideLiveRenderRepair(base: DeckSnapshot): {
  result: NodeSlideRenderRepairResult;
  summary: NodeSlideJobRenderRepairSummary;
} {
  const result = runNodeSlideRenderRepairLoop({
    base,
    callbacks: {
      validate: (snapshot) => {
        const validation = validateSnapshot(snapshot as DeckSnapshot);
        return {
          // Advisory warnings (e.g. export fallbacks) are not repair targets;
          // only error-severity findings make a snapshot dirty for this loop.
          clean: validation.issues.every((issue) => issue.severity !== 'error'),
          // The live snapshot comes from NodeSlide's own validator-guarded store,
          // so every deterministic finding (schema geometry included) is a repair
          // target, not a safety stop; unrepairable states terminate honestly via
          // no_progress/invalid_proposal instead.
          safetyPassed: true,
          issues: validation.issues,
        };
      },
      render: ({ snapshot }) => {
        const html = renderDeckHtml(snapshot as DeckSnapshot);
        // The observer needs the exact rendered snapshot; artifacts are untrusted,
        // bounded, and excluded from receipts per the loop guardrails.
        return { artifact: { html, snapshot: structuredClone(snapshot) }, bytes: html.length };
      },
      observe: ({ render }) => {
        const artifact = render.artifact as { snapshot?: DeckSnapshot } | undefined;
        if (!artifact?.snapshot) {
          return {
            clean: false,
            observations: [
              {
                code: 'render_artifact_missing',
                severity: 'error' as const,
                message: 'The render stage produced no observable snapshot artifact.',
              },
            ],
          };
        }
        const observations = [
          ...nodeslideArtifactPresenceChecks(artifact.snapshot)
            .filter((check) => check.status !== 'pass')
            .map((check) => ({
              code: check.code,
              severity: check.status === 'fail' ? ('error' as const) : ('warning' as const),
              message: check.message.slice(0, 300),
              ...(check.slideIds?.[0] ? { slideId: check.slideIds[0] } : {}),
              ...(check.elementIds?.[0] ? { elementId: check.elementIds[0] } : {}),
            })),
          ...validateSnapshot(artifact.snapshot).issues.map((issue) => ({
            code: issue.code,
            severity: issue.severity === 'error' ? ('error' as const) : ('warning' as const),
            message: issue.message.slice(0, 300),
            ...(issue.slideId ? { slideId: issue.slideId } : {}),
            ...(issue.elementId ? { elementId: issue.elementId } : {}),
          })),
        ];
        return {
          clean: observations.every((observation) => observation.severity !== 'error'),
          observations,
        };
      },
      proposeRepair: ({ snapshot }) => {
        const operations = deterministicRepairOperations(snapshot as DeckSnapshot);
        const clocks = clocksForNodeSlideOperations(snapshot as DeckSnapshot, operations);
        return {
          deckId: snapshot.deck.id,
          baseDeckVersion: snapshot.deck.version,
          baseSlideVersions: clocks.baseSlideVersions,
          baseElementVersions: clocks.baseElementVersions,
          scope: {
            kind: 'deck',
            deckId: snapshot.deck.id,
            operationMode: 'unrestricted',
          },
          operations,
        };
      },
    },
  });
  return { result, summary: summarize(result) };
}

/**
 * Deterministic repair operations from the shipped automatic repair plan:
 * apply the plan to a clone, then express each changed element as an exact
 * PatchOperation so the proposal flows through normal review authority.
 */
export function deterministicRepairOperations(snapshot: DeckSnapshot): PatchOperation[] {
  const repaired = applyRepairPlan(structuredClone(snapshot));
  const before = new Map(snapshot.elements.map((element) => [element.id, element]));
  const operations: PatchOperation[] = [];
  for (const element of repaired.snapshot.elements) {
    if (operations.length >= REPAIR_OPERATION_LIMIT) break;
    const original = before.get(element.id);
    if (!original || element.version === original.version) continue;
    if (
      element.bbox.x !== original.bbox.x ||
      element.bbox.y !== original.bbox.y ||
      element.bbox.width !== original.bbox.width ||
      element.bbox.height !== original.bbox.height
    ) {
      operations.push({
        op: 'move',
        slideId: element.slideId,
        elementId: element.id,
        x: element.bbox.x,
        y: element.bbox.y,
      });
      if (
        operations.length < REPAIR_OPERATION_LIMIT &&
        (element.bbox.width !== original.bbox.width || element.bbox.height !== original.bbox.height)
      ) {
        operations.push({
          op: 'resize',
          slideId: element.slideId,
          elementId: element.id,
          width: element.bbox.width,
          height: element.bbox.height,
        });
      }
      continue;
    }
    const styleChanges: Record<string, string | number> = {};
    if (element.style.fontSize !== original.style.fontSize && element.style.fontSize) {
      styleChanges['fontSize'] = element.style.fontSize;
    }
    if (element.style.color !== original.style.color && element.style.color) {
      styleChanges['color'] = element.style.color;
    }
    if (Object.keys(styleChanges).length > 0) {
      operations.push({
        op: 'update_style',
        slideId: element.slideId,
        elementId: element.id,
        properties: styleChanges,
      });
    }
  }
  return operations;
}

function summarize(result: NodeSlideRenderRepairResult): NodeSlideJobRenderRepairSummary {
  const firstProposal = result.proposals[0];
  return {
    schemaVersion: 'nodeslide.live-render-repair/v1',
    status: result.status,
    terminalReason: result.terminalReason,
    attempts: result.usage.attempts,
    proposalOperationCount: result.operations.length,
    ...(firstProposal && firstProposal.operations.length > 0
      ? {
          proposal: {
            deckId: firstProposal.deckId,
            baseDeckVersion: firstProposal.baseDeckVersion,
            baseSlideVersions: structuredClone(firstProposal.baseSlideVersions),
            baseElementVersions: structuredClone(firstProposal.baseElementVersions),
            scope: structuredClone(firstProposal.scope),
            operations: structuredClone(firstProposal.operations.slice(0, REPAIR_OPERATION_LIMIT)),
          },
        }
      : {}),
    baseSnapshotDigest: result.baseSnapshotDigest,
    candidateSnapshotDigest: result.candidateSnapshotDigest,
    receipts: result.receipts.slice(0, RECEIPT_SUMMARY_LIMIT).map((receipt) => ({
      attempt: receipt.attempt,
      status: receipt.status,
      summary: receipt.summary.slice(0, 200),
    })),
  };
}

/** Stable digest binding a repair summary to its exact job for evidence chains. */
export function nodeslideRenderRepairSummaryDigest(
  summary: NodeSlideJobRenderRepairSummary,
): string {
  return nodeslideContentDigest(JSON.stringify(summary));
}
