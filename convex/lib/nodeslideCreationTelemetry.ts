import { nodeslideStableId } from './nodeslideIds';

export function nodeSlideCreationTraceId(deckId: string): string {
  return nodeslideStableId('trace', deckId, 'creation');
}

export function nodeSlideCreationAuthorizationLine(args: {
  externalEgressAuthorized: boolean;
  provider?: string;
  model?: string;
}): string {
  if (!args.externalEgressAuthorized) {
    return "Consent not required; the brief stayed inside NodeSlide's deterministic route.";
  }
  const route = [args.provider, args.model].filter(Boolean).join(' · ') || 'external provider';
  return `Explicit one-shot consent authorized the external ${route} creation request.`;
}

export function nodeSlideCreationRunStartedAt(
  requestedStartedAt: number | undefined,
  observedAt: number,
): number {
  if (!Number.isFinite(observedAt) || observedAt < 0) {
    throw new Error('The observed NodeSlide run timestamp is invalid.');
  }
  if (requestedStartedAt === undefined) return Math.floor(observedAt);
  if (!Number.isFinite(requestedStartedAt) || requestedStartedAt < 0) {
    throw new Error('The requested NodeSlide run timestamp is invalid.');
  }
  if (requestedStartedAt > observedAt + 1_000) {
    throw new Error('The requested NodeSlide run timestamp is in the future.');
  }
  return Math.min(Math.floor(requestedStartedAt), Math.floor(observedAt));
}
