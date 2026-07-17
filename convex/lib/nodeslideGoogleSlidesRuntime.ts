import type { DeckPatch, DeckSnapshot, Slide, SlideElement } from '../../shared/nodeslide';
import { nodeSlideDurableDigest } from '../../shared/nodeslideDurableSession';
import type {
  GoogleSlidesExternalPlanV1,
  GoogleSlidesInboundExternalPlanV1,
  GoogleSlidesOutboundExternalPlanV1,
  GoogleSlidesPostAcceptanceReceiptV1,
} from '../../src/domains/nodeslide/integrations/googleSlides/googleSlides';
import type { GoogleSlidesThreeWaySyncInput } from '../../src/domains/nodeslide/integrations/googleSlides/planning';
import { planGoogleSlidesThreeWaySync } from '../../src/domains/nodeslide/integrations/googleSlides/planning';
import type { GoogleSlidesBatchUpdateResponse } from '../../src/domains/nodeslide/integrations/googleSlides/types';
import type {
  NormalizedPresentationElement,
  NormalizedPresentationSlide,
  NormalizedPresentationState,
  PresentationSyncBaseline,
  SyncObjectLink,
  SyncObjectMapping,
} from '../../src/domains/nodeslide/integrations/syncContracts';
import { syncSemanticFingerprint } from '../../src/domains/nodeslide/integrations/syncContracts';
import {
  NODESLIDE_GOOGLE_SCOPE,
  decryptOAuthSecret,
  encryptOAuthSecret,
} from './nodeslideGoogleOAuth';

export const NODESLIDE_GOOGLE_RUNTIME_SCHEMA = 'nodeslide.google-runtime/v1' as const;
export const NODESLIDE_GOOGLE_RUNTIME_MAX_BYTES = 700 * 1024;
export const NODESLIDE_GOOGLE_TOKEN_REFRESH_SKEW_MS = 60_000;

export type NodeSlideGoogleRuntimeErrorCode =
  | 'bootstrap_mismatch'
  | 'credential_unavailable'
  | 'invalid_runtime_state'
  | 'payload_too_large'
  | 'proposal_mismatch'
  | 'reauthorization_required'
  | 'remote_conflict'
  | 'remote_error'
  | 'verification_failed';

export class NodeSlideGoogleRuntimeError extends Error {
  readonly code: NodeSlideGoogleRuntimeErrorCode;

  constructor(code: NodeSlideGoogleRuntimeErrorCode, message: string) {
    super(message);
    this.name = 'NodeSlideGoogleRuntimeError';
    this.code = code;
  }
}

export interface NodeSlideGoogleStoredCredential {
  accessTokenCiphertext: string;
  refreshTokenCiphertext?: string;
  accessTokenExpiresAt: number;
  scopes: string[];
  tokenType: string;
  updatedAt: number;
}

export interface NodeSlideGoogleCredentialUpdate {
  expectedUpdatedAt: number;
  accessTokenCiphertext: string;
  accessTokenExpiresAt: number;
  scopes: string[];
  tokenType: string;
  refreshTokenCiphertext?: string;
}

export interface NodeSlideGoogleResolvedToken {
  accessToken: string;
  update?: NodeSlideGoogleCredentialUpdate;
}

export interface StoredGoogleRuntimeBaselineV1 {
  schemaVersion: typeof NODESLIDE_GOOGLE_RUNTIME_SCHEMA;
  kind: 'google_runtime_baseline';
  baseline: PresentationSyncBaseline;
}

export interface StoredGoogleRuntimePlanV1 {
  schemaVersion: typeof NODESLIDE_GOOGLE_RUNTIME_SCHEMA;
  kind: 'google_runtime_plan';
  direction: 'inbound' | 'outbound';
  planningInput: GoogleSlidesThreeWaySyncInput;
  plan: GoogleSlidesExternalPlanV1;
}

export interface EncodedGoogleRuntimeValue {
  json: string;
  digest: string;
}

interface RefreshTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

export async function resolveNodeSlideGoogleAccessToken(input: {
  credential: NodeSlideGoogleStoredCredential;
  encryptionKey: string;
  clientId: string;
  clientSecret: string;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  now?: number;
  forceRefresh?: boolean;
}): Promise<NodeSlideGoogleResolvedToken> {
  const now = input.now ?? Date.now();
  const credential = input.credential;
  if (!credential.scopes.includes(NODESLIDE_GOOGLE_SCOPE)) {
    throw new NodeSlideGoogleRuntimeError(
      'reauthorization_required',
      'Google Slides authorization no longer includes per-file Drive access.',
    );
  }
  if (
    !input.forceRefresh &&
    credential.accessTokenExpiresAt > now + NODESLIDE_GOOGLE_TOKEN_REFRESH_SKEW_MS
  ) {
    return {
      accessToken: await decryptOAuthSecret(credential.accessTokenCiphertext, input.encryptionKey),
    };
  }
  if (!credential.refreshTokenCiphertext) {
    throw new NodeSlideGoogleRuntimeError(
      'reauthorization_required',
      'Google Slides authorization expired and must be granted again.',
    );
  }

  const refreshToken = await decryptOAuthSecret(
    credential.refreshTokenCiphertext,
    input.encryptionKey,
  );
  const response = await input.fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  let body: RefreshTokenResponse;
  try {
    body = (await response.json()) as RefreshTokenResponse;
  } catch {
    throw new NodeSlideGoogleRuntimeError(
      'remote_error',
      'Google Slides authorization could not be refreshed.',
    );
  }
  if (
    !response.ok ||
    !body.access_token ||
    !Number.isFinite(body.expires_in) ||
    (body.expires_in ?? 0) <= 0 ||
    (body.token_type !== undefined && body.token_type.toLowerCase() !== 'bearer')
  ) {
    throw new NodeSlideGoogleRuntimeError(
      response.status === 400 ? 'reauthorization_required' : 'remote_error',
      response.status === 400
        ? 'Google Slides authorization must be granted again.'
        : 'Google Slides authorization could not be refreshed.',
    );
  }

  const refreshedScopes = normalizeScopes(body.scope, credential.scopes);
  if (!refreshedScopes.includes(NODESLIDE_GOOGLE_SCOPE)) {
    throw new NodeSlideGoogleRuntimeError(
      'reauthorization_required',
      'Google Slides authorization no longer includes per-file Drive access.',
    );
  }
  const [accessTokenCiphertext, rotatedRefreshTokenCiphertext] = await Promise.all([
    encryptOAuthSecret(body.access_token, input.encryptionKey),
    body.refresh_token
      ? encryptOAuthSecret(body.refresh_token, input.encryptionKey)
      : Promise.resolve(undefined),
  ]);
  return {
    accessToken: body.access_token,
    update: {
      expectedUpdatedAt: credential.updatedAt,
      accessTokenCiphertext,
      accessTokenExpiresAt: now + (body.expires_in ?? 0) * 1000,
      scopes: refreshedScopes,
      tokenType: 'Bearer',
      ...(rotatedRefreshTokenCiphertext
        ? { refreshTokenCiphertext: rotatedRefreshTokenCiphertext }
        : {}),
    },
  };
}

export function createExactGoogleSlidesBootstrapBaseline(
  local: DeckSnapshot,
  remote: NormalizedPresentationState,
): PresentationSyncBaseline {
  const localSlides = orderedLocalSlides(local);
  const remoteSlides = [...remote.slides];
  if (localSlides.length !== remoteSlides.length) {
    throw bootstrapMismatch(
      `NodeSlide has ${localSlides.length} slides while Google Slides has ${remoteSlides.length}.`,
    );
  }

  const links: SyncObjectLink[] = [
    {
      kind: 'deck',
      localId: local.deck.id,
      remoteId: remote.remotePresentationId,
      semanticFingerprint: syncSemanticFingerprint({
        title: local.deck.title,
        slides: localSlides.length,
      }),
    },
  ];
  for (let slideIndex = 0; slideIndex < localSlides.length; slideIndex += 1) {
    const localSlide = localSlides[slideIndex];
    const remoteSlide = remoteSlides[slideIndex];
    if (
      !localSlide ||
      !remoteSlide ||
      slideFingerprint(localSlide) !== slideFingerprint(remoteSlide)
    ) {
      throw bootstrapMismatch(`Slide ${slideIndex + 1} is not an exact semantic match.`);
    }
    links.push({
      kind: 'slide',
      localId: localSlide.id,
      remoteId: remoteSlide.remoteId,
      semanticFingerprint: slideFingerprint(localSlide),
    });

    const localElements = orderedLocalElements(local, localSlide);
    const remoteElements = [...remoteSlide.elements];
    if (localElements.length !== remoteElements.length) {
      throw bootstrapMismatch(
        `Slide ${slideIndex + 1} has different NodeSlide and Google Slides element counts.`,
      );
    }
    for (let elementIndex = 0; elementIndex < localElements.length; elementIndex += 1) {
      const localElement = localElements[elementIndex];
      const remoteElement = remoteElements[elementIndex];
      if (!localElement || !remoteElement || !remoteElement.writable || remoteElement.lossy) {
        throw bootstrapMismatch(
          `Slide ${slideIndex + 1}, element ${elementIndex + 1} is not safely writable.`,
        );
      }
      if (elementFingerprint(localElement) !== elementFingerprint(remoteElement)) {
        throw bootstrapMismatch(
          `Slide ${slideIndex + 1}, element ${elementIndex + 1} is not an exact semantic match.`,
        );
      }
      links.push({
        kind: 'element',
        localId: localElement.id,
        remoteId: remoteElement.remoteId,
        semanticFingerprint: elementFingerprint(localElement),
        localSlideId: localSlide.id,
        remoteSlideId: remoteSlide.remoteId,
      });
    }
  }

  const mapping: SyncObjectMapping = {
    provider: 'google_slides',
    localDeckId: local.deck.id,
    remotePresentationId: remote.remotePresentationId,
    links,
  };
  return { local: structuredClone(local), remote: structuredClone(remote), mapping };
}

export function createBlockedGoogleSlidesBootstrapBaseline(
  local: DeckSnapshot,
  remote: NormalizedPresentationState,
): PresentationSyncBaseline {
  return {
    local: structuredClone(local),
    remote: structuredClone(remote),
    mapping: {
      provider: 'google_slides',
      localDeckId: local.deck.id,
      remotePresentationId: remote.remotePresentationId,
      links: [
        {
          kind: 'deck',
          localId: local.deck.id,
          remoteId: remote.remotePresentationId,
          semanticFingerprint: syncSemanticFingerprint({
            blockedBootstrap: true,
            localTitle: local.deck.title,
            remoteTitle: remote.title,
          }),
        },
      ],
    },
  };
}

export function encodeGoogleRuntimeBaseline(
  baseline: PresentationSyncBaseline,
): EncodedGoogleRuntimeValue {
  return encodeRuntimeValue({
    schemaVersion: NODESLIDE_GOOGLE_RUNTIME_SCHEMA,
    kind: 'google_runtime_baseline',
    baseline,
  } satisfies StoredGoogleRuntimeBaselineV1);
}

export function decodeGoogleRuntimeBaseline(
  json: string,
  digest: string,
): PresentationSyncBaseline {
  const value = decodeRuntimeValue<StoredGoogleRuntimeBaselineV1>(json, digest);
  if (
    value.schemaVersion !== NODESLIDE_GOOGLE_RUNTIME_SCHEMA ||
    value.kind !== 'google_runtime_baseline' ||
    value.baseline?.mapping?.provider !== 'google_slides'
  ) {
    throw invalidRuntimeState('Stored Google Slides baseline is invalid.');
  }
  return value.baseline;
}

export function encodeGoogleRuntimePlan(input: {
  direction: 'inbound' | 'outbound';
  planningInput: GoogleSlidesThreeWaySyncInput;
  plan: GoogleSlidesExternalPlanV1;
}): EncodedGoogleRuntimeValue {
  if (input.plan.direction !== input.direction) {
    throw invalidRuntimeState('Google Slides plan direction is inconsistent.');
  }
  return encodeRuntimeValue({
    schemaVersion: NODESLIDE_GOOGLE_RUNTIME_SCHEMA,
    kind: 'google_runtime_plan',
    ...input,
  } satisfies StoredGoogleRuntimePlanV1);
}

export function decodeGoogleRuntimePlan(json: string, digest: string): StoredGoogleRuntimePlanV1 {
  const value = decodeRuntimeValue<StoredGoogleRuntimePlanV1>(json, digest);
  if (
    value.schemaVersion !== NODESLIDE_GOOGLE_RUNTIME_SCHEMA ||
    value.kind !== 'google_runtime_plan' ||
    value.plan?.direction !== value.direction
  ) {
    throw invalidRuntimeState('Stored Google Slides plan is invalid.');
  }
  return value;
}

export function encodeGoogleRuntimeReceipt(
  receipt: GoogleSlidesPostAcceptanceReceiptV1,
): EncodedGoogleRuntimeValue {
  return encodeRuntimeValue(receipt);
}

export function assertGoogleRuntimeStateSize(...jsonValues: Array<string | undefined>): void {
  const bytes = jsonValues.reduce(
    (total, value) => total + (value ? new TextEncoder().encode(value).byteLength : 0),
    0,
  );
  if (bytes > NODESLIDE_GOOGLE_RUNTIME_MAX_BYTES) {
    throw new NodeSlideGoogleRuntimeError(
      'payload_too_large',
      'This presentation is too large for the bounded Google Slides runtime state.',
    );
  }
}

export function assertAcceptedInboundGoogleProposal(input: {
  patch: DeckPatch;
  patchId: string;
  plan: GoogleSlidesInboundExternalPlanV1;
  acceptedLocal: DeckSnapshot;
}): void {
  const { patch, patchId, plan, acceptedLocal } = input;
  if (
    patch.id !== patchId ||
    patch.status !== 'accepted' ||
    patch.deckId !== plan.proposal.deckId ||
    patch.resultingDeckVersion !== acceptedLocal.deck.version ||
    acceptedLocal.deck.version <= plan.proposal.baseDeckVersion
  ) {
    throw new NodeSlideGoogleRuntimeError(
      'proposal_mismatch',
      'The exact Google Slides pull proposal has not been accepted.',
    );
  }
  const storedProposal = {
    baseDeckVersion: patch.baseDeckVersion,
    baseSlideVersions: patch.baseSlideVersions,
    baseElementVersions: patch.baseElementVersions,
    scope: patch.scope,
    operations: patch.operations,
  };
  const plannedProposal = {
    baseDeckVersion: plan.proposal.baseDeckVersion,
    baseSlideVersions: plan.proposal.baseSlideVersions,
    baseElementVersions: plan.proposal.baseElementVersions,
    scope: plan.proposal.scope,
    operations: plan.proposal.operations,
  };
  if (nodeSlideDurableDigest(storedProposal) !== nodeSlideDurableDigest(plannedProposal)) {
    throw new NodeSlideGoogleRuntimeError(
      'proposal_mismatch',
      'The accepted proposal is not the exact Google Slides pull plan.',
    );
  }
}

export function assertVerifiedGoogleSlidesConvergence(input: {
  baseline: PresentationSyncBaseline;
  acceptedLocal: DeckSnapshot;
  verifiedRemote: NormalizedPresentationState;
}): void {
  const verification = planGoogleSlidesThreeWaySync({
    baseline: input.baseline,
    local: input.acceptedLocal,
    remote: input.verifiedRemote,
  });
  if (
    verification.conflicts.length > 0 ||
    verification.inbound.operations.length > 0 ||
    verification.outbound.requests.length > 0
  ) {
    throw new NodeSlideGoogleRuntimeError(
      'verification_failed',
      'Google Slides changed, but the verified presentation does not match the approved plan.',
    );
  }
}

export function assertGoogleSlidesBatchUpdateResponse(
  plan: GoogleSlidesOutboundExternalPlanV1,
  response: GoogleSlidesBatchUpdateResponse,
): void {
  if (
    response.presentationId !== plan.batchUpdate.presentationId ||
    !Array.isArray(response.replies) ||
    response.replies.length !== plan.batchUpdate.requests.length ||
    !response.writeControl?.requiredRevisionId?.trim()
  ) {
    throw new NodeSlideGoogleRuntimeError(
      'verification_failed',
      'Google Slides returned an incomplete write receipt.',
    );
  }
}

export function runtimeError(error: unknown): NodeSlideGoogleRuntimeError {
  if (error instanceof NodeSlideGoogleRuntimeError) return error;
  const status =
    error && typeof error === 'object' && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : 0;
  if (status === 400 || status === 409 || status === 412) {
    return new NodeSlideGoogleRuntimeError(
      'remote_conflict',
      'Google Slides changed before the approved operation could complete.',
    );
  }
  if (status === 401 || status === 403) {
    return new NodeSlideGoogleRuntimeError(
      'reauthorization_required',
      'Google Slides authorization must be granted again.',
    );
  }
  return new NodeSlideGoogleRuntimeError(
    'remote_error',
    'Google Slides could not complete the requested operation.',
  );
}

function encodeRuntimeValue(value: unknown): EncodedGoogleRuntimeValue {
  const json = JSON.stringify(value);
  assertGoogleRuntimeStateSize(json);
  return { json, digest: nodeSlideDurableDigest(value) };
}

function decodeRuntimeValue<T>(json: string, digest: string): T {
  assertGoogleRuntimeStateSize(json);
  let value: T;
  try {
    value = JSON.parse(json) as T;
  } catch {
    throw invalidRuntimeState('Stored Google Slides runtime JSON is invalid.');
  }
  if (nodeSlideDurableDigest(value) !== digest) {
    throw invalidRuntimeState('Stored Google Slides runtime digest does not match its payload.');
  }
  return value;
}

function normalizeScopes(scope: string | undefined, fallback: readonly string[]): string[] {
  const scopes = scope?.split(/\s+/u).filter(Boolean) ?? [...fallback];
  return [...new Set(scopes)].sort();
}

function orderedLocalSlides(snapshot: DeckSnapshot): Slide[] {
  const byId = new Map(snapshot.slides.map((slide) => [slide.id, slide]));
  return snapshot.deck.slideOrder.map((id) => {
    const slide = byId.get(id);
    if (!slide) throw bootstrapMismatch(`NodeSlide slide ${id} is unavailable.`);
    return slide;
  });
}

function orderedLocalElements(snapshot: DeckSnapshot, slide: Slide): SlideElement[] {
  const byId = new Map(snapshot.elements.map((element) => [element.id, element]));
  return slide.elementOrder.map((id) => {
    const element = byId.get(id);
    if (!element || element.slideId !== slide.id) {
      throw bootstrapMismatch(`NodeSlide element ${id} is unavailable.`);
    }
    return element;
  });
}

function slideFingerprint(slide: Slide | NormalizedPresentationSlide): string {
  return syncSemanticFingerprint({
    title: slide.title,
    notes: slide.notes ?? '',
    background: slide.background,
  });
}

function elementFingerprint(element: SlideElement | NormalizedPresentationElement): string {
  return syncSemanticFingerprint({
    kind: element.kind,
    bbox: canonicalBox(element.bbox),
    rotation: canonicalNumber(element.rotation),
    content: element.content ?? '',
    style: element.style,
    imageUrl: element.imageUrl ?? '',
    altText: element.altText ?? '',
  });
}

function canonicalBox(box: SlideElement['bbox']): SlideElement['bbox'] {
  return {
    x: canonicalNumber(box.x),
    y: canonicalNumber(box.y),
    width: canonicalNumber(box.width),
    height: canonicalNumber(box.height),
  };
}

function canonicalNumber(value: number): number {
  return Number(value.toFixed(6));
}

function bootstrapMismatch(detail: string): NodeSlideGoogleRuntimeError {
  return new NodeSlideGoogleRuntimeError(
    'bootstrap_mismatch',
    `Safe Google Slides attachment requires an exact initial match. ${detail}`,
  );
}

function invalidRuntimeState(message: string): NodeSlideGoogleRuntimeError {
  return new NodeSlideGoogleRuntimeError('invalid_runtime_state', message);
}
