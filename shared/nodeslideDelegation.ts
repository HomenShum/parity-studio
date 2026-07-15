import {
  type ChartData,
  type DeckPatch,
  type DeckSnapshot,
  type ElementStyle,
  NODESLIDE_MIN_READABLE_FONT_SIZE,
  type NodeSlideWorkspace,
  type PatchOperation,
  type SlideElement,
  type ValidationResult,
} from './nodeslide';
import { validatePatchScope } from './nodeslidePatch';

export const NODESLIDE_DELEGATION_GRANT_VERSION = 'nodeslide.delegation-grant/v1' as const;
export const NODESLIDE_DELEGATION_POLICY_VERSION = 'nodeslide.delegation-policy/v1' as const;
export const NODESLIDE_DELEGATION_CAPABILITY = 'accept_validated' as const;
export const NODESLIDE_DELEGATION_PROPOSAL_SOURCE = 'agent' as const;
export const NODESLIDE_DELEGATION_PROPOSAL_KIND = 'edit' as const;
export const NODESLIDE_DELEGATION_MAX_OPERATIONS = 8 as const;
export const NODESLIDE_DELEGATION_MAX_USES = 64 as const;
export const NODESLIDE_DELEGATION_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const NODESLIDE_BROWSER_DELEGATION_TTL_MS = 12 * 60 * 60 * 1_000;

export type NodeSlideDelegationClientKind = 'browser' | 'codex' | 'claude';
export type NodeSlideDelegationGrantStatus = 'active' | 'expired' | 'revoked' | 'exhausted';

/** Immutable fields covered by a grant's SHA-256 policy digest. */
export interface NodeSlideDelegationPolicy {
  policyVersion: typeof NODESLIDE_DELEGATION_POLICY_VERSION;
  deckId: string;
  clientKind: NodeSlideDelegationClientKind;
  capability: typeof NODESLIDE_DELEGATION_CAPABILITY;
  proposalSource: typeof NODESLIDE_DELEGATION_PROPOSAL_SOURCE;
  proposalKind: typeof NODESLIDE_DELEGATION_PROPOSAL_KIND;
  maxOperations: number;
  maxUses: number;
  createdAt: number;
  expiresAt: number;
}

/** Safe public projection. Raw tokens and token digests are intentionally absent. */
export interface NodeSlideDelegationGrant extends NodeSlideDelegationPolicy {
  schemaVersion: typeof NODESLIDE_DELEGATION_GRANT_VERSION;
  id: string;
  useCount: number;
  policyDigest: string;
  status: NodeSlideDelegationGrantStatus;
  lastUsedAt?: number;
  revokedAt?: number;
}

export interface NodeSlideDelegationIssueReceipt {
  grant: NodeSlideDelegationGrant;
  /** Opaque bearer capability returned only by issueGrant. */
  token: string;
}

export interface NodeSlideDelegationUseReceipt {
  grantId: string;
  useCount: number;
  maxUses: number;
  replayed: boolean;
}

export interface NodeSlideDelegationAcceptanceReceipt {
  patch: DeckPatch;
  workspace: NodeSlideWorkspace | null;
  validation?: ValidationResult;
  rebased: boolean;
  staleReasons?: string[];
  delegation: NodeSlideDelegationUseReceipt;
}

export type NodeSlideDecisionProvenance =
  | {
      authority: 'owner_capability';
      decidedAt: number;
    }
  | {
      authority: 'delegated';
      capability: typeof NODESLIDE_DELEGATION_CAPABILITY;
      grantId: string;
      clientKind: NodeSlideDelegationClientKind;
      policyDigest: string;
      decidedAt: number;
    };

/** Canonical fixed-order serialization used as the input to the policy SHA-256 digest. */
export function nodeSlideDelegationPolicyDigestInput(policy: NodeSlideDelegationPolicy): string {
  return JSON.stringify({
    policyVersion: policy.policyVersion,
    deckId: policy.deckId,
    clientKind: policy.clientKind,
    capability: policy.capability,
    proposalSource: policy.proposalSource,
    proposalKind: policy.proposalKind,
    maxOperations: policy.maxOperations,
    maxUses: policy.maxUses,
    createdAt: policy.createdAt,
    expiresAt: policy.expiresAt,
  });
}

export function nodeSlideDelegationGrantStatus(
  grant: Pick<NodeSlideDelegationGrant, 'expiresAt' | 'revokedAt' | 'useCount' | 'maxUses'>,
  now: number,
): NodeSlideDelegationGrantStatus {
  if (grant.revokedAt !== undefined) return 'revoked';
  if (now >= grant.expiresAt) return 'expired';
  if (grant.useCount >= grant.maxUses) return 'exhausted';
  return 'active';
}

/**
 * Fast policy checks performed before the normal commit path. The commit path
 * remains authoritative for full snapshot, scope, CAS, and validation checks.
 */
export function nodeSlideDelegationProposalViolations(args: {
  grant: Pick<NodeSlideDelegationGrant, 'deckId' | 'maxOperations'>;
  proposal: Pick<
    DeckPatch,
    'deckId' | 'scope' | 'operations' | 'source' | 'proposalKind' | 'traceId'
  >;
}): string[] {
  const { grant, proposal } = args;
  const violations: string[] = [];
  if (proposal.deckId !== grant.deckId || proposal.scope.deckId !== grant.deckId) {
    violations.push('The proposal is outside the delegated deck scope.');
  }
  if (proposal.source !== NODESLIDE_DELEGATION_PROPOSAL_SOURCE) {
    violations.push('Delegated acceptance requires an agent proposal.');
  }
  if ((proposal.proposalKind ?? 'edit') !== NODESLIDE_DELEGATION_PROPOSAL_KIND) {
    violations.push('Delegated acceptance permits edit proposals only.');
  }
  if (!proposal.traceId) {
    violations.push('Delegated acceptance requires trace-bound proposal provenance.');
  }
  if (
    proposal.operations.length === 0 ||
    proposal.operations.length > grant.maxOperations ||
    proposal.operations.length > NODESLIDE_DELEGATION_MAX_OPERATIONS
  ) {
    violations.push('The proposal exceeds the delegated operation policy.');
  }
  if (proposal.operations.some(nodeSlideDelegationOperationRequiresReview)) {
    violations.push('Destructive operations require explicit review.');
  }
  if (nodeSlideDelegationCompositionRequiresReview(proposal.operations)) {
    violations.push('The composed candidate requires explicit review.');
  }
  violations.push(...validatePatchScope(proposal.scope, proposal.operations));
  return [...new Set(violations)];
}

/**
 * Delegated mode is intentionally narrower than the general patch contract.
 * Operations that erase, hide, or make content unreadable remain review-only,
 * even when they use a nominally non-destructive opcode.
 */
export function nodeSlideDelegationOperationRequiresReview(operation: PatchOperation): boolean {
  switch (operation.op) {
    case 'remove_element':
    case 'remove_slide':
      return true;
    case 'set_visibility_v1':
      return !operation.visible;
    case 'replace_text':
      return !hasVisibleText(operation.text);
    case 'resize':
      return operation.width < 0.01 || operation.height < 0.01;
    case 'update_style':
      return styleRequiresReview(operation.properties);
    case 'add_element':
      return addedElementRequiresReview(operation.element, true);
    case 'add_slide':
      return (
        !hasVisibleText(operation.slide.title) ||
        operation.elements.some((element) => addedElementRequiresReview(element, false))
      );
    case 'update_image':
      return true;
    case 'update_slide':
      return (
        operation.properties.background !== undefined ||
        (operation.properties.title !== undefined && !hasVisibleText(operation.properties.title)) ||
        (operation.properties.notes !== undefined && !hasVisibleText(operation.properties.notes))
      );
    case 'update_deck':
      return (
        operation.properties.title !== undefined && !hasVisibleText(operation.properties.title)
      );
    case 'move':
    case 'group_elements_v1':
    case 'ungroup_elements_v1':
    case 'reorder_slide':
      return false;
    case 'reorder_element_v1':
      return true;
    case 'update_chart':
      return chartRequiresReview(operation.chart);
    default: {
      const exhaustiveOperation: never = operation;
      return exhaustiveOperation;
    }
  }
}

function styleRequiresReview(
  properties: Extract<PatchOperation, { op: 'update_style' }>['properties'],
) {
  const {
    color,
    fill,
    fontSize,
    fontWeight,
    letterSpacing,
    lineHeight,
    opacity,
    padding,
    shadow,
    stroke,
    strokeWidth,
  } = properties;
  if (opacity !== undefined && (!Number.isFinite(opacity) || opacity < 0.05 || opacity > 1)) {
    return true;
  }
  if (
    fontSize !== undefined &&
    (!Number.isFinite(fontSize) || fontSize < NODESLIDE_MIN_READABLE_FONT_SIZE)
  ) {
    return true;
  }
  if (
    fontWeight !== undefined &&
    (!Number.isFinite(fontWeight) || fontWeight < 100 || fontWeight > 1_000)
  ) {
    return true;
  }
  if (
    lineHeight !== undefined &&
    (!Number.isFinite(lineHeight) || lineHeight < 0.5 || lineHeight > 4)
  ) {
    return true;
  }
  if (
    letterSpacing !== undefined &&
    (!Number.isFinite(letterSpacing) || letterSpacing < -4 || letterSpacing > 32)
  ) {
    return true;
  }
  if (padding !== undefined && (!Number.isFinite(padding) || padding < 0 || padding > 64)) {
    return true;
  }
  if (
    strokeWidth !== undefined &&
    (!Number.isFinite(strokeWidth) || strokeWidth < 0 || strokeWidth > 16)
  ) {
    return true;
  }
  if (
    shadow !== undefined &&
    hasVisibleText(shadow) &&
    shadow.trim().toLocaleLowerCase() !== 'none'
  ) {
    return true;
  }
  if ([color, fill, stroke].some(isUnsafePaint)) return true;
  return color !== undefined && fill !== undefined && samePaint(color, fill);
}

function addedElementRequiresReview(
  element: Extract<PatchOperation, { op: 'add_element' }>['element'],
  canOccludeExistingContent: boolean,
): boolean {
  if (element.locked || element.visible === false) return true;
  if (element.bbox.width < 0.01 || element.bbox.height < 0.01) return true;
  if (styleRequiresReview(element.style)) return true;
  if (element.kind === 'text' && !hasVisibleText(element.content ?? '')) return true;
  if (
    element.kind === 'image' &&
    (!hasVisibleText(element.imageUrl ?? '') || !hasVisibleText(element.altText ?? ''))
  ) {
    return true;
  }
  if (element.kind === 'chart' && (!element.chart || chartRequiresReview(element.chart)))
    return true;
  if (canOccludeExistingContent && element.bbox.width * element.bbox.height >= 0.45) {
    return elementCanOcclude(element);
  }
  return false;
}

function hasVisibleText(value: string): boolean {
  return (
    value.normalize('NFKD').replace(/[\s\p{Cc}\p{Cs}\p{Default_Ignorable_Code_Point}\p{M}]/gu, '')
      .length > 0
  );
}

function isTransparentPaint(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLocaleLowerCase();
  if (normalized === 'transparent') return true;
  const paint = canonicalPaint(normalized);
  if (paint && /^#[0-9a-f]{8}$/u.test(paint)) {
    return Number.parseInt(paint.slice(-2), 16) < 13;
  }
  const alpha = cssAlphaToken(normalized);
  if (alpha === undefined) return false;
  const numericAlpha = parseCssAlpha(alpha);
  return numericAlpha === null || numericAlpha < 0.05 || numericAlpha > 1;
}

function canonicalPaint(value: string): string | null {
  const normalized = value.trim().toLocaleLowerCase();
  if (isAmbiguousPaint(normalized)) return null;
  if (normalized === 'white') return '#ffffffff';
  if (normalized === 'black') return '#000000ff';
  const shortHex = normalized.match(/^#([0-9a-f]{3,4})$/u)?.[1];
  if (shortHex) {
    const expanded = [...shortHex].map((digit) => `${digit}${digit}`).join('');
    return `#${expanded}${shortHex.length === 3 ? 'ff' : ''}`;
  }
  const longHex = normalized.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/u);
  if (longHex) return `#${longHex[1]}${longHex[2] ?? 'ff'}`;
  const rgb = canonicalRgb(normalized);
  if (rgb) return rgb;
  return normalized.replace(/[\s,]+/gu, '');
}

function isUnsafePaint(value: string | undefined): boolean {
  return value !== undefined && (isTransparentPaint(value) || isAmbiguousPaint(value));
}

function isAmbiguousPaint(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase();
  if (/^#[0-9a-f]{3,8}$/u.test(normalized)) return false;
  if (/^rgba?\(/u.test(normalized)) return false;
  if (normalized === 'white' || normalized === 'black') return false;
  return true;
}

function samePaint(left: string, right: string): boolean {
  const canonicalLeft = canonicalPaint(left);
  const canonicalRight = canonicalPaint(right);
  return canonicalLeft !== null && canonicalRight !== null && canonicalLeft === canonicalRight;
}

function canonicalRgb(value: string): string | null {
  const match = value.match(/^rgba?\((.*)\)$/u);
  if (!match?.[1]) return null;
  const body = match[1].trim();
  const [channelBody, slashAlpha] = body.split('/').map((part) => part.trim());
  const commaParts = channelBody?.split(',').map((part) => part.trim()) ?? [];
  const channelParts =
    commaParts.length >= 3 ? commaParts.slice(0, 3) : (channelBody?.split(/\s+/u) ?? []);
  if (channelParts.length !== 3) return null;
  const channels = channelParts.map(parseRgbChannel);
  if (channels.some((channel) => channel === null)) return null;
  const legacyAlpha = commaParts.length === 4 ? commaParts[3] : undefined;
  const alphaToken = slashAlpha ?? legacyAlpha;
  const alpha = alphaToken === undefined ? 1 : parseCssAlpha(alphaToken);
  if (alpha === null) return null;
  return `#${channels
    .map((channel) =>
      Math.round(channel ?? 0)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}${Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0')}`;
}

function parseRgbChannel(value: string): number | null {
  const numeric = value.endsWith('%') ? (Number(value.slice(0, -1)) / 100) * 255 : Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 255 ? numeric : null;
}

function cssAlphaToken(value: string): string | undefined {
  const functionBody = value.match(/^[a-z][a-z0-9-]*\((.*)\)$/u)?.[1];
  if (functionBody === undefined) return undefined;
  const slashIndex = functionBody.lastIndexOf('/');
  if (slashIndex >= 0) return functionBody.slice(slashIndex + 1).trim();
  if (/^(?:rgba|hsla)\(/u.test(value)) {
    const parts = functionBody.split(',').map((part) => part.trim());
    if (parts.length === 4) return parts[3];
  }
  return undefined;
}

function parseCssAlpha(value: string): number | null {
  const token = value.trim().toLocaleLowerCase();
  const numeric = token.endsWith('%') ? Number(token.slice(0, -1)) / 100 : Number(token);
  return Number.isFinite(numeric) ? numeric : null;
}

function chartRequiresReview(chart: ChartData): boolean {
  if (
    chart.labels.length === 0 ||
    chart.labels.some((label) => !hasVisibleText(label)) ||
    chart.series.length === 0
  ) {
    return true;
  }
  return chart.series.some(
    (series) =>
      !hasVisibleText(series.name) ||
      series.values.length !== chart.labels.length ||
      series.values.some((value) => !Number.isFinite(value)) ||
      isUnsafePaint(series.color),
  );
}

function elementCanOcclude(element: SlideElement): boolean {
  return (
    element.visible !== false &&
    (element.style.opacity ?? 1) >= 0.5 &&
    element.style.fill !== undefined &&
    !isUnsafePaint(element.style.fill)
  );
}

/**
 * Operation-local checks are insufficient when several individually benign
 * operations compose into an erase or cover. This bounded reducer evaluates
 * only the proposal's own writes and fails closed before delegated commit.
 */
export function nodeSlideDelegationCompositionRequiresReview(
  operations: readonly PatchOperation[],
): boolean {
  const added = new Map<string, SlideElement>();
  const styles = new Map<string, Partial<ElementStyle>>();
  for (const operation of operations) {
    if (operation.op === 'add_element') {
      added.set(
        elementKey(operation.slideId, operation.element.id),
        structuredClone(operation.element),
      );
      continue;
    }
    if (operation.op === 'add_slide') {
      for (const element of operation.elements) {
        added.set(elementKey(element.slideId, element.id), structuredClone(element));
      }
      continue;
    }
    if (!('elementId' in operation)) continue;
    const key = elementKey(operation.slideId, operation.elementId);
    const element = added.get(key);
    if (operation.op === 'resize' && element) {
      element.bbox.width = operation.width;
      element.bbox.height = operation.height;
    } else if (operation.op === 'move' && element) {
      element.bbox.x = operation.x;
      element.bbox.y = operation.y;
    } else if (operation.op === 'update_style') {
      const merged = { ...styles.get(key), ...operation.properties };
      styles.set(key, merged);
      if (element) element.style = { ...element.style, ...operation.properties };
    } else if (operation.op === 'set_visibility_v1' && element) {
      element.visible = operation.visible;
    } else if (operation.op === 'replace_text' && element) {
      element.content = operation.text;
    } else if (operation.op === 'update_chart' && element) {
      element.chart = operation.chart;
    }
  }
  if ([...styles.values()].some(styleRequiresReview)) return true;
  return [...added.values()].some((element) => addedElementRequiresReview(element, true));
}

/** Authoritative post-composition check used immediately before delegated writes. */
export function nodeSlideDelegationCandidateViolations(args: {
  baseline: Pick<DeckSnapshot, 'elements'>;
  candidate: Pick<DeckSnapshot, 'elements'>;
  operations: readonly PatchOperation[];
}): string[] {
  const baseline = new Map(
    args.baseline.elements.map((element) => [elementKey(element.slideId, element.id), element]),
  );
  const candidate = new Map(
    args.candidate.elements.map((element) => [elementKey(element.slideId, element.id), element]),
  );
  const touched = touchedElementPolicies(args.operations);
  const violations: string[] = [];
  for (const [key, policy] of touched) {
    const before = baseline.get(key);
    const after = candidate.get(key);
    if (!after) {
      violations.push('The composed candidate removes delegated content.');
      continue;
    }
    if (policy.added && addedElementRequiresReview(after, true)) {
      violations.push('The composed candidate adds a review-only element.');
    }
    if (policy.text && after.kind === 'text' && !hasVisibleText(after.content ?? '')) {
      violations.push('The composed candidate erases visible text.');
    }
    if (
      policy.geometry &&
      (after.bbox.width < 0.01 ||
        after.bbox.height < 0.01 ||
        (after.bbox.width * after.bbox.height >= 0.45 && elementCanOcclude(after)))
    ) {
      violations.push('The composed candidate hides or covers slide content.');
    }
    if (policy.style) {
      const compareForegroundAndFill = 'color' in policy.style || 'fill' in policy.style;
      const properties: Partial<ElementStyle> = {
        ...policy.style,
        ...(compareForegroundAndFill && after.style.color !== undefined
          ? { color: after.style.color }
          : {}),
        ...(compareForegroundAndFill && after.style.fill !== undefined
          ? { fill: after.style.fill }
          : {}),
      };
      if (styleRequiresReview(properties)) {
        violations.push('The composed candidate makes content unreadable.');
      }
      if (
        after.bbox.width * after.bbox.height >= 0.45 &&
        elementCanOcclude(after) &&
        (!before || !elementCanOcclude(before))
      ) {
        violations.push('The composed candidate hides or covers slide content.');
      }
    }
    if (policy.chart && (!after.chart || chartRequiresReview(after.chart))) {
      violations.push('The composed candidate hides chart data.');
    }
    if (policy.image) violations.push('Image replacement requires explicit review.');
    if (
      policy.visibility &&
      after.bbox.width * after.bbox.height >= 0.45 &&
      elementCanOcclude(after)
    ) {
      violations.push('The composed candidate reveals content that can cover the slide.');
    }
  }
  return [...new Set(violations)];
}

interface TouchedElementPolicy {
  added: boolean;
  chart: boolean;
  geometry: boolean;
  image: boolean;
  style: Partial<ElementStyle> | null;
  text: boolean;
  visibility: boolean;
}

function touchedElementPolicies(
  operations: readonly PatchOperation[],
): Map<string, TouchedElementPolicy> {
  const result = new Map<string, TouchedElementPolicy>();
  const touch = (slideId: string, elementId: string) => {
    const key = elementKey(slideId, elementId);
    const policy =
      result.get(key) ??
      ({
        added: false,
        chart: false,
        geometry: false,
        image: false,
        style: null,
        text: false,
        visibility: false,
      } satisfies TouchedElementPolicy);
    result.set(key, policy);
    return policy;
  };
  for (const operation of operations) {
    if (operation.op === 'add_element') {
      touch(operation.slideId, operation.element.id).added = true;
    } else if (operation.op === 'add_slide') {
      for (const element of operation.elements) touch(element.slideId, element.id).added = true;
    } else if ('elementId' in operation) {
      const policy = touch(operation.slideId, operation.elementId);
      if (operation.op === 'move' || operation.op === 'resize') policy.geometry = true;
      else if (operation.op === 'replace_text') policy.text = true;
      else if (operation.op === 'update_style') {
        policy.style = { ...policy.style, ...operation.properties };
      } else if (operation.op === 'update_chart') policy.chart = true;
      else if (operation.op === 'update_image') policy.image = true;
      else if (operation.op === 'set_visibility_v1') policy.visibility = true;
    }
  }
  return result;
}

function elementKey(slideId: string, elementId: string): string {
  return `${slideId}:${elementId}`;
}
