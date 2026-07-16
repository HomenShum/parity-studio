import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NODESLIDE_CAPTURE_MAX_SCREENSHOT_BYTES,
  captureNodeSlideWebEvidence,
  safePublicCaptureUrl,
} from './nodeslideEvidenceCapture';

const SOURCE_URL = 'https://example.com/reports/quarterly';

afterEach(() => {
  vi.useRealTimers();
});

describe('safePublicCaptureUrl', () => {
  it.each([
    'http://localhost/admin',
    'https://preview.localhost/',
    'http://0.0.0.0/',
    'http://127.0.0.1/',
    'http://10.20.30.40/',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
  ])('blocks localhost or private-network source %s', (url) => {
    expect(() => safePublicCaptureUrl(url)).toThrow(
      'Visual evidence capture cannot access private network addresses.',
    );
  });

  it.each(['file:///etc/passwd', 'ftp://example.com/report', 'data:text/plain,secret'])(
    'blocks non-HTTP source %s',
    (url) => {
      expect(() => safePublicCaptureUrl(url)).toThrow(
        'Visual evidence capture requires an HTTP or HTTPS source.',
      );
    },
  );

  it('strips fragments while preserving the public URL path and query', () => {
    expect(safePublicCaptureUrl('https://Example.COM/report?q=deck#private-fragment')).toBe(
      'https://example.com/report?q=deck',
    );
  });
});

describe('captureNodeSlideWebEvidence', () => {
  it('fails without an API key before making any request', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    const result = await captureNodeSlideWebEvidence({
      url: `${SOURCE_URL}#credentials`,
      apiKey: '   ',
      fetchImpl: fetchMock,
      now: sequenceNow(100, 125),
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      provider: 'firecrawl',
      url: SOURCE_URL,
      title: 'example.com',
      markdown: '',
      error: 'Visual capture is not configured on this deployment.',
      startedAt: 100,
      completedAt: 125,
    });
  });

  it('rejects an unsafe screenshot URL without fetching the attachment', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          markdown: 'Provider supplied text',
          screenshot: 'http://169.254.169.254/internal.png',
        },
      }),
    );

    const result = await captureNodeSlideWebEvidence({
      url: SOURCE_URL,
      apiKey: 'test-key',
      fetchImpl: fetchMock,
      now: sequenceNow(200, 250),
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'Visual capture failed safely.',
      startedAt: 200,
      completedAt: 250,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caps the normalized markdown response', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: { markdown: `  ${'x'.repeat(120_010)}\r\nignored  ` },
      }),
    );

    const result = await captureNodeSlideWebEvidence({
      url: SOURCE_URL,
      apiKey: 'test-key',
      fetchImpl: fetchMock,
    });

    expect(result.ok).toBe(true);
    expect(result.markdown).toHaveLength(120_000);
    expect(result.markdown).toBe('x'.repeat(120_000));
  });

  it('rejects a screenshot exceeding its declared size', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            screenshot: 'https://cdn.example.com/capture.png',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1]), {
          headers: {
            'content-length': String(NODESLIDE_CAPTURE_MAX_SCREENSHOT_BYTES + 1),
            'content-type': 'image/png',
          },
        }),
      );

    const result = await captureNodeSlideWebEvidence({
      url: SOURCE_URL,
      apiKey: 'test-key',
      fetchImpl: fetchMock,
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'Visual capture exceeded the screenshot size limit.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a screenshot whose actual body exceeds the size cap', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { screenshot: 'https://cdn.example.com/capture.webp' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array(NODESLIDE_CAPTURE_MAX_SCREENSHOT_BYTES + 1), {
          headers: { 'content-type': 'image/webp' },
        }),
      );

    const result = await captureNodeSlideWebEvidence({
      url: SOURCE_URL,
      apiKey: 'test-key',
      fetchImpl: fetchMock,
    });

    expect(result).toMatchObject({
      ok: false,
      error: 'Visual capture exceeded the screenshot size limit.',
    });
  });

  it('labels provider HTTP errors and fetch failures distinctly', async () => {
    const httpFailure = await captureNodeSlideWebEvidence({
      url: SOURCE_URL,
      apiKey: 'test-key',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })),
    });
    const networkFailure = await captureNodeSlideWebEvidence({
      url: SOURCE_URL,
      apiKey: 'test-key',
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error('socket details must not leak')),
    });

    expect(httpFailure).toMatchObject({
      ok: false,
      error: 'Visual capture provider returned HTTP 503.',
    });
    expect(networkFailure).toMatchObject({
      ok: false,
      error: 'Visual capture failed safely.',
    });
  });

  it('labels an aborted request as a timeout', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      });
    });

    const pending = captureNodeSlideWebEvidence({
      url: SOURCE_URL,
      apiKey: 'test-key',
      fetchImpl: fetchMock,
      timeoutMs: 1,
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: 'Visual capture timed out.',
    });
  });

  it('captures normalized markdown and image evidence with a deterministic content digest', async () => {
    const screenshotBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const url = String(input);
      if (url === 'https://api.firecrawl.dev/v1/scrape') {
        return Promise.resolve(
          jsonResponse({
            success: true,
            data: {
              markdown: ' \u0000# Evidence\r\n\r\nRevenue: 42  ',
              screenshot: 'https://cdn.example.com/capture.png',
              metadata: {
                title: '  Quarterly evidence  ',
                sourceURL: `${SOURCE_URL}#provider-fragment`,
              },
            },
          }),
        );
      }
      if (url === 'https://cdn.example.com/capture.png') {
        return Promise.resolve(
          new Response(screenshotBytes, {
            headers: {
              'content-length': String(screenshotBytes.byteLength),
              'content-type': 'image/png; charset=binary',
            },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const result = await captureNodeSlideWebEvidence({
      url: `${SOURCE_URL}#client-fragment`,
      apiKey: '  secret-test-key  ',
      fetchImpl: fetchMock,
      now: sequenceNow(1_000, 1_025),
    });

    expect(result).toEqual({
      ok: true,
      provider: 'firecrawl',
      url: SOURCE_URL,
      title: 'Quarterly evidence',
      markdown: '# Evidence\n\nRevenue: 42',
      contentDigest: 'sha256:31e9c03406c254ce8aa268f5d85144134d032db10f8086dbbfa65c47e3bb459c',
      screenshot: { bytes: screenshotBytes, mimeType: 'image/png' },
      startedAt: 1_000,
      completedAt: 1_025,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.firecrawl.dev/v1/scrape',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer secret-test-key',
        },
        body: JSON.stringify({
          url: SOURCE_URL,
          formats: ['markdown', 'screenshot'],
          onlyMainContent: true,
        }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://cdn.example.com/capture.png', {
      signal: expect.any(AbortSignal),
    });
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function sequenceNow(...values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
}
