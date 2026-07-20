// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeSessionByok } from './sessionByok';
import {
  NODESLIDE_IMAGE_GENERATION_ENDPOINT,
  NODESLIDE_IMAGE_GENERATION_MODEL,
  generateSessionIllustrativeImage,
  nodeSlideImageAspect,
} from './sessionImageGeneration';

afterEach(() => window.sessionStorage.clear());

describe('session-only illustrative image generation', () => {
  it('fails closed before network access when the session key is absent', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(
      generateSessionIllustrativeImage({ prompt: 'A calm harbor', aspect: 'landscape', fetchImpl }),
    ).rejects.toThrow('Add an OpenAI API key in Connections');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the key directly to the current Image API and returns bounded WebP data', async () => {
    writeSessionByok({ OPENAI_API_KEY: 'sk-session-only' });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: 'UklGRg==' }] }), {
        status: 200,
        headers: { 'x-request-id': 'req_image_123' },
      }),
    );
    const result = await generateSessionIllustrativeImage({
      prompt: '  A calm   harbor at dusk  ',
      aspect: 'landscape',
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, request] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(NODESLIDE_IMAGE_GENERATION_ENDPOINT);
    expect((request?.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer sk-session-only',
    );
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: NODESLIDE_IMAGE_GENERATION_MODEL,
      size: '1536x1024',
      quality: 'low',
      output_format: 'webp',
      output_compression: 50,
    });
    expect(String(body['prompt'])).toContain('A calm harbor at dusk');
    expect(result).toEqual({
      imageUrl: 'data:image/webp;base64,UklGRg==',
      model: NODESLIDE_IMAGE_GENERATION_MODEL,
      requestId: 'req_image_123',
    });
  });

  it('maps element proportions to supported standard sizes', () => {
    expect(nodeSlideImageAspect(16, 9)).toBe('landscape');
    expect(nodeSlideImageAspect(1, 1)).toBe('square');
    expect(nodeSlideImageAspect(3, 4)).toBe('portrait');
  });
});
