import { readSessionByok } from './sessionByok';

export const NODESLIDE_IMAGE_GENERATION_MODEL = 'gpt-image-2' as const;
export const NODESLIDE_IMAGE_GENERATION_ENDPOINT =
  'https://api.openai.com/v1/images/generations' as const;
const MAX_GENERATED_IMAGE_DATA_URL_CHARS = 680_000;
const MAX_IMAGE_PROMPT_CHARS = 2_000;

export type NodeSlideImageAspect = 'landscape' | 'square' | 'portrait';

export interface SessionIllustrativeImage {
  imageUrl: string;
  model: typeof NODESLIDE_IMAGE_GENERATION_MODEL;
  requestId?: string;
}

interface ImageApiResponse {
  data?: Array<{ b64_json?: unknown }>;
  error?: { code?: unknown; message?: unknown };
}

/**
 * Generate one low-quality illustrative draft with the user's session-only
 * OpenAI key. The request goes directly from this browser to OpenAI; NodeSlide
 * never sends the key through Convex or persists it in deck state.
 */
export async function generateSessionIllustrativeImage(input: {
  prompt: string;
  aspect: NodeSlideImageAspect;
  fetchImpl?: typeof fetch;
}): Promise<SessionIllustrativeImage> {
  const prompt = input.prompt.replace(/\s+/gu, ' ').trim();
  if (!prompt) throw new Error('Describe the illustrative image before generating it.');
  if (prompt.length > MAX_IMAGE_PROMPT_CHARS) {
    throw new Error(
      `Image prompts are capped at ${MAX_IMAGE_PROMPT_CHARS.toLocaleString()} characters.`,
    );
  }
  const apiKey = readSessionByok()['OPENAI_API_KEY']?.trim();
  if (!apiKey) {
    throw new Error('Add an OpenAI API key in Connections before generating an image.');
  }
  const response = await (input.fetchImpl ?? fetch)(NODESLIDE_IMAGE_GENERATION_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: NODESLIDE_IMAGE_GENERATION_MODEL,
      prompt: `Create an illustrative presentation asset. Do not add logos, citations, factual labels, or text unless the prompt explicitly requests them. ${prompt}`,
      n: 1,
      size: imageGenerationSize(input.aspect),
      quality: 'low',
      output_format: 'webp',
      output_compression: 50,
      moderation: 'auto',
    }),
  });
  const requestId = response.headers.get('x-request-id')?.trim() || undefined;
  const payload = (await response.json().catch(() => null)) as ImageApiResponse | null;
  if (!response.ok) throw imageGenerationError(response.status, payload, requestId);
  const encoded = payload?.data?.[0]?.b64_json;
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/=\s]+$/u.test(encoded)) {
    throw new Error('OpenAI returned no usable generated image. No deck change was applied.');
  }
  const compact = encoded.replace(/\s+/gu, '');
  const imageUrl = `data:image/webp;base64,${compact}`;
  if (imageUrl.length > MAX_GENERATED_IMAGE_DATA_URL_CHARS) {
    throw new Error(
      'The generated image is too large for versioned deck history. Try a simpler prompt.',
    );
  }
  return {
    imageUrl,
    model: NODESLIDE_IMAGE_GENERATION_MODEL,
    ...(requestId ? { requestId } : {}),
  };
}

export function nodeSlideImageAspect(width: number, height: number): NodeSlideImageAspect {
  const ratio = height > 0 ? width / height : 1;
  if (ratio >= 1.2) return 'landscape';
  if (ratio <= 0.83) return 'portrait';
  return 'square';
}

function imageGenerationSize(aspect: NodeSlideImageAspect): string {
  if (aspect === 'landscape') return '1536x1024';
  if (aspect === 'portrait') return '1024x1536';
  return '1024x1024';
}

function imageGenerationError(
  status: number,
  payload: ImageApiResponse | null,
  requestId: string | undefined,
): Error {
  const code = typeof payload?.error?.code === 'string' ? payload.error.code : '';
  const apiMessage = typeof payload?.error?.message === 'string' ? payload.error.message : '';
  const suffix = requestId ? ` Request ID: ${requestId}.` : '';
  if (code === 'moderation_blocked') {
    return new Error(`This image prompt or result was blocked by a safety check.${suffix}`);
  }
  if (status === 401 || status === 403) {
    return new Error(`The session OpenAI key could not authorize image generation.${suffix}`);
  }
  if (status === 429) {
    return new Error(`OpenAI rate or quota limits blocked this image generation.${suffix}`);
  }
  return new Error(
    `${apiMessage.trim().slice(0, 240) || `OpenAI image generation failed with HTTP ${status}.`}${suffix}`,
  );
}
