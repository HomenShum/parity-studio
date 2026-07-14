import { normalizeGoogleSlidesPresentation } from './normalization';
import type {
  GoogleSlidesAuth,
  GoogleSlidesBatchUpdatePlan,
  GoogleSlidesBatchUpdateResponse,
  GoogleSlidesFetch,
  GoogleSlidesNormalizationHooks,
  GoogleSlidesPresentation,
} from './types';

const DEFAULT_BASE_URL = 'https://slides.googleapis.com/v1';

export interface GoogleSlidesAdapterOptions {
  fetch: GoogleSlidesFetch;
  auth: GoogleSlidesAuth;
  baseUrl?: string;
  normalizationHooks?: GoogleSlidesNormalizationHooks;
}

export interface GoogleSlidesGetResult {
  source: GoogleSlidesPresentation;
  normalized: ReturnType<typeof normalizeGoogleSlidesPresentation>;
}

export class GoogleSlidesRestError extends Error {
  readonly status: number;
  readonly responseBody: unknown;

  constructor(message: string, status: number, responseBody: unknown) {
    super(message);
    this.name = 'GoogleSlidesRestError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

export interface GoogleSlidesAdapter {
  getPresentation(presentationId: string): Promise<GoogleSlidesGetResult>;
  batchUpdate(plan: GoogleSlidesBatchUpdatePlan): Promise<GoogleSlidesBatchUpdateResponse>;
}

export function createGoogleSlidesAdapter(
  options: GoogleSlidesAdapterOptions,
): GoogleSlidesAdapter {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');

  return {
    async getPresentation(presentationId) {
      requirePresentationId(presentationId);
      const response = await options.fetch(
        `${baseUrl}/presentations/${encodeURIComponent(presentationId)}`,
        {
          method: 'GET',
          headers: await requestHeaders(options.auth),
        },
      );
      const body = await readResponseBody(response);
      if (!response.ok) {
        throw new GoogleSlidesRestError(
          `Google Slides presentations.get failed with HTTP ${response.status}.`,
          response.status,
          body,
        );
      }
      const source = body as GoogleSlidesPresentation;
      if (source.presentationId !== presentationId) {
        throw new GoogleSlidesRestError(
          'Google Slides presentations.get returned a different presentationId.',
          response.status,
          body,
        );
      }
      return {
        source,
        normalized: normalizeGoogleSlidesPresentation(source, options.normalizationHooks),
      };
    },

    async batchUpdate(plan) {
      assertExecutableBatchUpdatePlan(plan);
      const response = await options.fetch(
        `${baseUrl}/presentations/${encodeURIComponent(plan.presentationId)}:batchUpdate`,
        {
          method: 'POST',
          headers: await requestHeaders(options.auth),
          body: JSON.stringify(plan.body),
        },
      );
      const body = await readResponseBody(response);
      if (!response.ok) {
        throw new GoogleSlidesRestError(
          `Google Slides presentations.batchUpdate failed with HTTP ${response.status}.`,
          response.status,
          body,
        );
      }
      return body as GoogleSlidesBatchUpdateResponse;
    },
  };
}

export function assertExecutableBatchUpdatePlan(
  plan: GoogleSlidesBatchUpdatePlan,
): asserts plan is GoogleSlidesBatchUpdatePlan & {
  requiredRevisionId: string;
  body: NonNullable<GoogleSlidesBatchUpdatePlan['body']>;
} {
  requirePresentationId(plan.presentationId);
  if (plan.blocked) {
    throw new Error(`Google Slides batchUpdate plan is blocked: ${plan.blockedReasons.join(' ')}`);
  }
  if (!plan.requiredRevisionId?.trim()) {
    throw new Error('Google Slides batchUpdate requires a non-empty requiredRevisionId guard.');
  }
  if (!plan.body || plan.body.writeControl.requiredRevisionId !== plan.requiredRevisionId) {
    throw new Error('Google Slides batchUpdate body is not bound to its requiredRevisionId guard.');
  }
  if (plan.requests.length === 0 || plan.body.requests.length === 0) {
    throw new Error('Google Slides batchUpdate requires at least one request.');
  }
  if (JSON.stringify(plan.body.requests) !== JSON.stringify(plan.requests)) {
    throw new Error('Google Slides batchUpdate body must contain the exact planned requests.');
  }
}

async function requestHeaders(auth: GoogleSlidesAuth): Promise<Record<string, string>> {
  const authorized = await auth();
  return { Accept: 'application/json', 'Content-Type': 'application/json', ...authorized };
}

async function readResponseBody(response: {
  json(): Promise<unknown>;
  text?: () => Promise<string>;
}): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return response.text ? await response.text() : null;
  }
}

function requirePresentationId(presentationId: string): void {
  if (!presentationId.trim()) throw new Error('Google Slides presentationId is required.');
}
