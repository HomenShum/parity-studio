import type {
  CandidateValidationReceipt,
  DeckPatch,
  DeckSnapshot,
  PatchOperation,
  PatchScope,
  SlideElement,
  ValidationResult,
} from '../../shared/nodeslide';
import { applyDeckPatch } from '../../shared/nodeslidePatch';
import { nodeslideContentDigest, nodeslideStableId } from './nodeslideIds';

export const NODESLIDE_SEMANTIC_COVERAGE_SCHEMA_VERSION = 'nodeslide.semantic-coverage/v1' as const;

export type NodeSlideSemanticCoverageStatus = 'not_applicable' | 'pass' | 'blocked';
export type NodeSlideSemanticOperationClass =
  | 'copy'
  | 'style'
  | 'layout'
  | 'chart'
  | 'remove'
  | 'visibility';

export interface NodeSlideSemanticCoverageObligation {
  id: string;
  field: string;
  slideId: string;
  elementId: string | null;
  operationClass: NodeSlideSemanticOperationClass;
  expectedText?: string;
  expectedVisibility?: boolean;
}

export interface NodeSlideSemanticCoverageReceipt {
  schemaVersion: typeof NODESLIDE_SEMANTIC_COVERAGE_SCHEMA_VERSION;
  id: string;
  status: NodeSlideSemanticCoverageStatus;
  instructionDigest: string;
  baseSnapshotDigest: string;
  candidateDigest: string;
  operationsDigest: string;
  obligations: NodeSlideSemanticCoverageObligation[];
  coveredObligationIds: string[];
  missingObligationIds: string[];
  digest: string;
}

interface NodeSlideSemanticCoverageInput {
  snapshot: DeckSnapshot;
  instruction: string;
  scope: PatchScope;
  operations: readonly PatchOperation[];
  focusSlideId?: string;
}

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

/**
 * Proves that a bounded candidate covers every field/role/slide target the user explicitly
 * enumerated. Structural validation answers "is this operation legal?"; this receipt answers
 * the separate question "does this operation address the requested work?".
 */
export function evaluateNodeSlideSemanticCoverage(
  input: NodeSlideSemanticCoverageInput,
): NodeSlideSemanticCoverageReceipt {
  const obligations = semanticCoverageObligations(input);
  const coveredObligationIds = obligations
    .filter((obligation) => operationCoversObligation(input.operations, obligation))
    .map((obligation) => obligation.id);
  const covered = new Set(coveredObligationIds);
  const missingObligationIds = obligations
    .filter((obligation) => !covered.has(obligation.id))
    .map((obligation) => obligation.id);
  const status: NodeSlideSemanticCoverageStatus =
    obligations.length === 0
      ? 'not_applicable'
      : missingObligationIds.length === 0
        ? 'pass'
        : 'blocked';
  const candidate = materializeNodeSlideCandidate(
    input.snapshot,
    { scope: input.scope, operations: [...input.operations] },
    0,
  );
  const partial = {
    schemaVersion: NODESLIDE_SEMANTIC_COVERAGE_SCHEMA_VERSION,
    id: nodeslideStableId(
      'semantic_coverage',
      nodeslideContentDigest(input.instruction),
      nodeslideContentDigest(stableJson(input.operations)),
    ),
    status,
    instructionDigest: nodeslideContentDigest(input.instruction),
    baseSnapshotDigest: nodeSlideCandidateDigest(input.snapshot),
    candidateDigest: nodeSlideCandidateDigest(candidate),
    operationsDigest: nodeslideContentDigest(stableJson(input.operations)),
    obligations,
    coveredObligationIds,
    missingObligationIds,
  };
  return { ...partial, digest: nodeslideContentDigest(stableJson(partial)) };
}

export function nodeSlideSemanticCoverageReceiptMatches(
  receipt: NodeSlideSemanticCoverageReceipt,
  candidate: DeckSnapshot,
): boolean {
  const { digest, ...partial } = receipt;
  const obligationIds = receipt.obligations.map((obligation) => obligation.id);
  const uniqueObligationIds = new Set(obligationIds);
  const coveredIds = new Set(receipt.coveredObligationIds);
  const missingIds = new Set(receipt.missingObligationIds);
  const expectedMissingIds = obligationIds.filter((id) => !coveredIds.has(id));
  return (
    receipt.schemaVersion === NODESLIDE_SEMANTIC_COVERAGE_SCHEMA_VERSION &&
    receipt.candidateDigest === nodeSlideCandidateDigest(candidate) &&
    digest === nodeslideContentDigest(stableJson(partial)) &&
    uniqueObligationIds.size === obligationIds.length &&
    coveredIds.size === receipt.coveredObligationIds.length &&
    missingIds.size === receipt.missingObligationIds.length &&
    receipt.coveredObligationIds.every((id) => uniqueObligationIds.has(id)) &&
    receipt.missingObligationIds.every((id) => uniqueObligationIds.has(id)) &&
    expectedMissingIds.length === missingIds.size &&
    expectedMissingIds.every((id) => missingIds.has(id)) &&
    (receipt.status === 'not_applicable'
      ? receipt.obligations.length === 0 && receipt.missingObligationIds.length === 0
      : receipt.status === 'pass'
        ? receipt.obligations.length > 0 && receipt.missingObligationIds.length === 0
        : receipt.obligations.length > 0 && receipt.missingObligationIds.length > 0)
  );
}

interface SemanticFieldDescriptor {
  field: string;
  matches: (element: SlideElement) => boolean;
}

function semanticCoverageObligations(
  input: NodeSlideSemanticCoverageInput,
): NodeSlideSemanticCoverageObligation[] {
  const instruction = normalizedInstruction(input.instruction);
  const mutationIntent = semanticMutationIntent(instruction);
  const descriptors = requestedSemanticFields(mutationIntent);
  const exactReplacement = exactReplacementIntent(input.instruction);
  const scoped = semanticScopedElements(input.snapshot, input.scope);
  const requestedSlideIds = semanticRequestedSlideIds(input, instruction);
  const operationClass = requestedSemanticOperationClass(mutationIntent, descriptors);
  const expectedVisibility = requestedVisibility(mutationIntent, operationClass);
  const obligations: NodeSlideSemanticCoverageObligation[] = [];
  const singleScopedElementId =
    input.scope.kind !== 'deck' &&
    'elementIds' in input.scope &&
    input.scope.elementIds.length === 1
      ? input.scope.elementIds[0]
      : undefined;

  for (const descriptor of descriptors) {
    let targets = scoped.filter(
      (element) => requestedSlideIds.has(element.slideId) && descriptor.matches(element),
    );
    if (targets.length === 0 && descriptors.length === 1 && singleScopedElementId) {
      targets = scoped.filter((element) => element.id === singleScopedElementId);
    }
    if (targets.length === 0) {
      for (const slideId of requestedSlideIds) {
        obligations.push(
          semanticObligation({
            field: descriptor.field,
            slideId,
            elementId: null,
            operationClass,
            ...(exactReplacement?.expected && descriptors.length === 1
              ? { expectedText: exactReplacement.expected }
              : {}),
            ...(expectedVisibility === undefined ? {} : { expectedVisibility }),
          }),
        );
      }
      continue;
    }
    for (const target of targets) {
      obligations.push(
        semanticObligation({
          field: descriptor.field,
          slideId: target.slideId,
          elementId: target.id,
          operationClass,
          ...(exactReplacement?.expected && descriptors.length === 1
            ? { expectedText: exactReplacement.expected }
            : {}),
          ...(expectedVisibility === undefined ? {} : { expectedVisibility }),
        }),
      );
    }
  }

  // Exact element-scoped replacements are explicit even when the user names the old text
  // instead of a semantic role (for example: Replace "Before" with "After").
  if (descriptors.length === 0 && exactReplacement) {
    const exactTargets = scoped.filter(
      (element) =>
        requestedSlideIds.has(element.slideId) &&
        element.kind === 'text' &&
        (element.content === exactReplacement.current ||
          (input.scope.kind !== 'deck' &&
            'elementIds' in input.scope &&
            input.scope.elementIds.length === 1)),
    );
    for (const target of exactTargets) {
      obligations.push(
        semanticObligation({
          field: target.name || target.role || 'selected text',
          slideId: target.slideId,
          elementId: target.id,
          operationClass: 'copy',
          expectedText: exactReplacement.expected,
        }),
      );
    }
  }

  return dedupeObligations(obligations);
}

/**
 * Semantic coverage binds requested mutations, not preservation constraints. A phrase such as
 * "rewrite the headline; keep the chart and layout unchanged" must require a headline edit while
 * treating the chart and layout as protected context rather than additional mutation targets.
 */
function semanticMutationIntent(instruction: string): string {
  return instruction
    .replace(
      /\b(?:and\s+)?(?:keep|preserve|leave|retain)\b[^.;!?]{0,160}\b(?:every\s+other|all\s+other|other\s+(?:elements?|content)|current\s+(?:layout|position|geometry|styling|formatting)|existing\s+(?:layout|position|geometry|styling|formatting)|everything\s+else)\b[^.;!?]*/gu,
      ' ',
    )
    .replace(
      /\b(?:and\s+)?(?:keep|preserve|leave|retain)\b[^.;!?]{0,160}?\b(?:unchanged|intact|as is|the same)\b/gu,
      ' ',
    )
    .replace(
      /\b(?:and\s+)?(?:do not|don['’]?t|must not|never)\s+(?:change|alter|modify|touch|remove)\b[^.;!?]*/gu,
      ' ',
    )
    .replace(
      /\b(?:and\s+)?without\s+(?:changing|altering|modifying|touching|removing)\b[^.;!?]*/gu,
      ' ',
    )
    .replace(/\b(?:and\s+)?change\s+nothing\s+else\b/gu, ' ')
    .replace(/[.;!?]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function semanticObligation(
  input: Omit<NodeSlideSemanticCoverageObligation, 'id'>,
): NodeSlideSemanticCoverageObligation {
  return {
    id: nodeslideStableId(
      'semantic_obligation',
      input.field,
      input.slideId,
      input.elementId ?? 'missing',
      input.operationClass,
      input.expectedText ?? '',
      input.expectedVisibility === undefined ? '' : String(input.expectedVisibility),
    ),
    ...input,
  };
}

function requestedSemanticFields(instruction: string): SemanticFieldDescriptor[] {
  const descriptors: SemanticFieldDescriptor[] = [];
  const add = (descriptor: SemanticFieldDescriptor) => {
    if (!descriptors.some((candidate) => candidate.field === descriptor.field)) {
      descriptors.push(descriptor);
    }
  };
  if (/\bsection\s+(?:label|title|name)\b/u.test(instruction)) {
    add(
      fieldDescriptor('section label', (element) =>
        /\bsection\b/u.test(normalizedElementIdentity(element)),
      ),
    );
  }
  if (/\b(?:headline|heading|slide\s+title)\b/u.test(instruction)) {
    add(
      fieldDescriptor('headline', (element) =>
        /\b(?:headline|heading|title)\b/u.test(normalizedElementIdentity(element)),
      ),
    );
  }
  if (/\b(?:body(?:\s+copy)?|paragraph|description)\b/u.test(instruction)) {
    add(
      fieldDescriptor('body copy', (element) =>
        /\b(?:body|paragraph|description)\b/u.test(normalizedElementIdentity(element)),
      ),
    );
  }
  const numberedPoints = [...instruction.matchAll(/\b(?:key\s+point|bullet)\s*(\d+)\b/gu)];
  for (const match of numberedPoints) {
    const index = match[1];
    if (!index) continue;
    add(
      fieldDescriptor(`key point ${index}`, (element) =>
        new RegExp(`\\b(?:key\\s+point|bullet)\\s*${index}\\b`, 'u').test(
          normalizedElementIdentity(element),
        ),
      ),
    );
  }
  if (numberedPoints.length === 0 && /\b(?:key\s+points|bullets)\b/u.test(instruction)) {
    add(
      fieldDescriptor('key points', (element) =>
        /\b(?:bullet|key\s+point)\b/u.test(normalizedElementIdentity(element)),
      ),
    );
  }
  if (/\bfooter\b/u.test(instruction)) {
    add(
      fieldDescriptor('footer', (element) =>
        /\bfooter\b/u.test(normalizedElementIdentity(element)),
      ),
    );
  }
  if (/\b(?:page|slide)\s+number\b/u.test(instruction)) {
    add(
      fieldDescriptor('page number', (element) =>
        /\b(?:page|slide)[ _-]*number\b/u.test(normalizedElementIdentity(element)),
      ),
    );
  }
  if (/\bcaption\b/u.test(instruction)) {
    add(
      fieldDescriptor('caption', (element) =>
        /\bcaption\b/u.test(normalizedElementIdentity(element)),
      ),
    );
  }
  if (/\b(?:metric|kpi)\b/u.test(instruction)) {
    add(
      fieldDescriptor('metric', (element) =>
        /\b(?:metric|kpi)\b/u.test(normalizedElementIdentity(element)),
      ),
    );
  }
  if (/\b(?:chart|graph)\b/u.test(instruction)) {
    add(fieldDescriptor('chart', (element) => element.kind === 'chart'));
  }
  if (/\b(?:formula|equation|math)\b/u.test(instruction)) {
    add(fieldDescriptor('formula', (element) => element.kind === 'math'));
  }
  if (/\bimage\b/u.test(instruction)) {
    add(fieldDescriptor('image', (element) => element.kind === 'image'));
  }
  return descriptors;
}

function fieldDescriptor(
  field: string,
  matches: (element: SlideElement) => boolean,
): SemanticFieldDescriptor {
  return { field, matches };
}

function requestedSemanticOperationClass(
  instruction: string,
  descriptors: readonly SemanticFieldDescriptor[],
): NodeSlideSemanticOperationClass {
  if (/\b(?:delete|remove|erase)\b/u.test(instruction)) return 'remove';
  if (/\b(?:hide|unhide|reveal|visible|invisible|visibility)\b/u.test(instruction)) {
    return 'visibility';
  }
  if (descriptors.some((descriptor) => descriptor.field === 'chart')) {
    return 'chart';
  }
  if (/\b(?:move|position|align|layout|resize|spacing|place)\b/u.test(instruction)) return 'layout';
  const explicitlyRequestsCopy =
    /\b(?:replace|rewrite|copy|text|wording|say|read|shorten|summarize)\b/u.test(instruction);
  if (
    /\b(?:style|color|font|weight|bold|appearance|theme|contrast|decisive|assertive|stronger|emphasis|accent)\b/u.test(
      instruction,
    ) &&
    !explicitlyRequestsCopy
  ) {
    return 'style';
  }
  return descriptors.length > 0 ? 'copy' : 'copy';
}

function requestedVisibility(
  instruction: string,
  operationClass: NodeSlideSemanticOperationClass,
): boolean | undefined {
  if (operationClass !== 'visibility') return undefined;
  if (
    /\b(?:hide|conceal|invisible)\b/u.test(instruction) ||
    /\bvisibility\s+to\s+false\b/u.test(instruction)
  ) {
    return false;
  }
  if (
    /\b(?:unhide|reveal)\b/u.test(instruction) ||
    /\bvisibility\s+to\s+true\b/u.test(instruction)
  ) {
    return true;
  }
  return undefined;
}

function semanticRequestedSlideIds(
  input: NodeSlideSemanticCoverageInput,
  instruction: string,
): Set<string> {
  const scopedSlideIds =
    input.scope.kind === 'deck' ? input.snapshot.deck.slideOrder : input.scope.slideIds;
  const explicitNumbers = explicitRequestedSlideNumbers(instruction)
    .filter((value) => Number.isSafeInteger(value) && value >= 1)
    .map((value) => input.snapshot.deck.slideOrder[value - 1])
    .filter(
      (value): value is string => typeof value === 'string' && scopedSlideIds.includes(value),
    );
  if (explicitNumbers.length > 0) return new Set(explicitNumbers);
  if (/\b(?:selected|these|both|all|every|each|multiple)\s+slides?\b/u.test(instruction)) {
    return new Set(scopedSlideIds);
  }
  if (input.focusSlideId && scopedSlideIds.includes(input.focusSlideId)) {
    return new Set([input.focusSlideId]);
  }
  return new Set(scopedSlideIds.length === 1 ? scopedSlideIds : scopedSlideIds.slice(0, 1));
}

function explicitRequestedSlideNumbers(instruction: string): number[] {
  const values = [...instruction.matchAll(/\bslide\s+(\d+)\b/gu)].flatMap((match) =>
    match[1] ? [Number(match[1])] : [],
  );
  for (const match of instruction.matchAll(/\bslides\s+((?:\d+\s*(?:(?:,|and|&|to|-)\s*)?)+)/gu)) {
    const segment = match[1] ?? '';
    const numbers = [...segment.matchAll(/\d+/gu)].map((item) => Number(item[0]));
    if (/\bto\b|-/u.test(segment) && numbers.length === 2) {
      const start = numbers[0] ?? 0;
      const end = numbers[1] ?? 0;
      if (start >= 1 && end >= start && end - start <= 8) {
        for (let value = start; value <= end; value += 1) values.push(value);
        continue;
      }
    }
    values.push(...numbers);
  }
  return [...new Set(values)];
}

function semanticScopedElements(snapshot: DeckSnapshot, scope: PatchScope): SlideElement[] {
  const slideIds = new Set(scope.kind === 'deck' ? snapshot.deck.slideOrder : scope.slideIds);
  const elementIds =
    scope.kind !== 'deck' && 'elementIds' in scope ? new Set(scope.elementIds) : null;
  return snapshot.elements.filter(
    (element) =>
      slideIds.has(element.slideId) &&
      (!elementIds || elementIds.has(element.id)) &&
      !element.locked &&
      element.visible !== false,
  );
}

function normalizedElementIdentity(element: SlideElement): string {
  return normalizedInstruction(`${element.role ?? ''} ${element.name}`);
}

function normalizedInstruction(value: string): string {
  return value.toLowerCase().replace(/[_-]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function exactReplacementIntent(
  instruction: string,
): { current?: string; expected: string } | null {
  const replacement = instruction.match(/\breplace\s+["“]([^"”]+)["”]\s+with\s+["“]([^"”]+)["”]/iu);
  if (replacement?.[1] && replacement[2]) {
    return { current: replacement[1], expected: replacement[2] };
  }
  if (!/\bexact(?:ly)?\b/iu.test(instruction)) return null;
  const quoted = [...instruction.matchAll(/["“]([^"”]+)["”]/gu)];
  const expected = quoted.at(-1)?.[1];
  return expected ? { expected } : null;
}

function operationCoversObligation(
  operations: readonly PatchOperation[],
  obligation: NodeSlideSemanticCoverageObligation,
): boolean {
  if (!obligation.elementId) {
    // No existing element satisfies the request; only a same-slide agent add of the
    // matching artifact kind can cover it.
    return operations.some(
      (operation) =>
        operation.op === 'add_element' &&
        operation.slideId === obligation.slideId &&
        ((obligation.operationClass === 'chart' && operation.element.kind === 'chart') ||
          (obligation.operationClass === 'copy' && operation.element.kind === 'text')),
    );
  }
  return operations.some((operation) => {
    if (!('elementId' in operation)) return false;
    if (operation.slideId !== obligation.slideId || operation.elementId !== obligation.elementId) {
      return false;
    }
    if (obligation.operationClass === 'copy') {
      return (
        operation.op === 'replace_text' &&
        (obligation.expectedText === undefined || operation.text === obligation.expectedText)
      );
    }
    if (obligation.operationClass === 'style') return operation.op === 'update_style';
    if (obligation.operationClass === 'layout') {
      return (
        operation.op === 'move' ||
        operation.op === 'resize' ||
        operation.op === 'reorder_element_v1'
      );
    }
    if (obligation.operationClass === 'chart') return operation.op === 'update_chart';
    if (obligation.operationClass === 'remove') return operation.op === 'remove_element';
    return (
      operation.op === 'set_visibility_v1' &&
      (obligation.expectedVisibility === undefined ||
        operation.visible === obligation.expectedVisibility)
    );
  });
}

function dedupeObligations(
  obligations: readonly NodeSlideSemanticCoverageObligation[],
): NodeSlideSemanticCoverageObligation[] {
  return [...new Map(obligations.map((obligation) => [obligation.id, obligation])).values()];
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
