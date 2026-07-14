import {
  NODESLIDE_AGENT_READ_CONTEXT_LIMITS,
  NODESLIDE_ELEMENT_SOURCE_LIMIT,
  type NodeSlideClaimSourceBinding,
  type NodeSlideSourceBindingStatus,
  type PatchOperation,
} from '../../shared/nodeslide';
import { nodeslideContentDigest } from './nodeslideIds';

export type NodeSlideSourceBindingPolicy = 'not_applicable' | 'required_external_evidence';

export interface NodeSlideSourceLineageReceipt {
  sourceBindingStatus: Exclude<NodeSlideSourceBindingStatus, 'legacy_unavailable'>;
  claimSourceBindings: NodeSlideClaimSourceBinding[];
}

/** Source IDs bound to factual text/chart output, in deterministic operation order. */
export function nodeSlideOperationSourceIds(operations: readonly PatchOperation[]): string[] {
  const ids = operations.flatMap((operation) => sourceIdsForClaimOperation(operation));
  return [...new Set(ids)];
}

/**
 * Validates exact bounded evidence IDs and materializes immutable per-element
 * claim bindings. It intentionally ignores style/layout operations because
 * those do not assert factual output.
 */
export function buildNodeSlideSourceLineage(args: {
  operations: readonly PatchOperation[];
  authorizedSourceIds: readonly string[];
  policy: NodeSlideSourceBindingPolicy;
}): NodeSlideSourceLineageReceipt {
  if (args.authorizedSourceIds.length > NODESLIDE_AGENT_READ_CONTEXT_LIMITS.sourceIds) {
    throw new Error('Agent source authorization exceeds the bounded read-context limit.');
  }
  const authorized = new Set<string>();
  for (const sourceId of args.authorizedSourceIds) {
    if (!sourceId || sourceId.length > 256 || authorized.has(sourceId)) {
      throw new Error('Agent source authorization contains an invalid or duplicate source ID.');
    }
    authorized.add(sourceId);
  }

  const claimSourceBindings: NodeSlideClaimSourceBinding[] = [];
  args.operations.forEach((operation, operationIndex) => {
    if (
      args.policy === 'required_external_evidence' &&
      operation.op === 'update_slide' &&
      (operation.properties.title !== undefined || operation.properties.notes !== undefined)
    ) {
      throw new Error(
        'An external evidence-grounded factual operation is missing a required source binding.',
      );
    }
    if (operation.op !== 'replace_text' && operation.op !== 'update_chart') return;
    const sourceIds = sourceIdsForClaimOperation(operation);
    if (
      sourceIds.length > NODESLIDE_ELEMENT_SOURCE_LIMIT ||
      new Set(sourceIds).size !== sourceIds.length ||
      sourceIds.some((sourceId) => !sourceId || !authorized.has(sourceId))
    ) {
      throw new Error('A factual operation contains an invalid or unauthorized source binding.');
    }
    if (args.policy === 'required_external_evidence' && sourceIds.length === 0) {
      throw new Error(
        'An external evidence-grounded factual operation is missing a required source binding.',
      );
    }
    if (sourceIds.length === 0) return;
    claimSourceBindings.push({
      operationIndex,
      operation: operation.op,
      slideId: operation.slideId,
      elementId: operation.elementId,
      sourceIds: [...sourceIds],
      claimDigest: claimDigest(operation),
    });
  });

  return {
    sourceBindingStatus: claimSourceBindings.length > 0 ? 'bound' : 'not_applicable',
    claimSourceBindings,
  };
}

function sourceIdsForClaimOperation(operation: PatchOperation): string[] {
  if (operation.op === 'replace_text') return operation.sourceIds ? [...operation.sourceIds] : [];
  if (operation.op === 'update_chart') {
    return operation.chart.sourceId ? [operation.chart.sourceId] : [];
  }
  return [];
}

function claimDigest(
  operation: Extract<PatchOperation, { op: 'replace_text' | 'update_chart' }>,
): string {
  const claim =
    operation.op === 'replace_text'
      ? { operation: operation.op, text: operation.text }
      : { operation: operation.op, chart: operation.chart };
  return nodeslideContentDigest(stableJson(claim));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
