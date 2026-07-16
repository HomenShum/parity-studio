import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NODESLIDE_CAPTURE_MAX_PROVIDER_BYTES,
  NODESLIDE_CAPTURE_MAX_SCREENSHOT_BYTES,
  captureNodeSlideWebEvidence,
  captureNodeSlideWebEvidenceBatch,
  createNodeSlideSourceSnapshotPdf,
  readRasterImageDimensions,
  safePublicCaptureUrl,
} from './nodeslideEvidenceCapture';
import { nodeslideContentDigest } from './nodeslideIds';

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
      status: 'failed',
      provider: 'firecrawl',
      url: SOURCE_URL,
      title: 'example.com',
      markdown: '',
      error: 'Visual capture is not configured on this deployment.',
      issue: {
        code: 'configuration_missing',
        stage: 'configuration',
        message: 'Visual capture is not configured on this deployment.',
      },
      startedAt: 100,
      completedAt: 125,
    });
  });

  it.each([
    'http://169.254.169.254/internal.png',
    'https://127.0.0.1/internal.png',
    'file:///tmp/internal.png',
  ])('rejects unsafe screenshot URL %s without fetching the attachment', async (screenshot) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          markdown: 'Provider supplied text',
          screenshot,
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
      status: 'failed',
      error: 'Visual attachment URL was invalid or did not use HTTPS.',
      issue: { code: 'screenshot_url_invalid', stage: 'screenshot' },
      startedAt: 200,
      completedAt: 250,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns typed degraded evidence when the screenshot fetch fails', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            markdown: 'Provider supplied text remains usable.',
            screenshot: 'https://cdn.example.com/capture.png',
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 502 }));

    const result = await captureNodeSlideWebEvidence({
      url: SOURCE_URL,
      apiKey: 'test-key',
      fetchImpl: fetchMock,
    });

    expect(result).toMatchObject({
      ok: true,
      status: 'degraded',
      markdown: 'Provider supplied text remains usable.',
      issue: {
        code: 'screenshot_http_error',
        stage: 'screenshot',
        message: 'Visual attachment provider returned HTTP 502.',
      },
    });
    expect(result.screenshot).toBeUndefined();
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
      status: 'failed',
      error: 'Visual capture exceeded the screenshot size limit.',
      issue: { code: 'screenshot_too_large', stage: 'screenshot' },
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
        chunkedResponse(
          [new Uint8Array(NODESLIDE_CAPTURE_MAX_SCREENSHOT_BYTES), new Uint8Array([1])],
          {
            headers: { 'content-type': 'image/webp' },
          },
        ),
      );

    const result = await captureNodeSlideWebEvidence({
      url: SOURCE_URL,
      apiKey: 'test-key',
      fetchImpl: fetchMock,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'failed',
      error: 'Visual capture exceeded the screenshot size limit.',
      issue: { code: 'screenshot_too_large', stage: 'screenshot' },
    });
  });

  it('rejects an oversized chunked provider response before buffering beyond the cap', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        chunkedResponse([
          new TextEncoder().encode('{"success":true,"data":{"markdown":"'),
          new Uint8Array(NODESLIDE_CAPTURE_MAX_PROVIDER_BYTES),
          new TextEncoder().encode('"}}'),
        ]),
      );

    const result = await captureNodeSlideWebEvidence({
      url: SOURCE_URL,
      apiKey: 'test-key',
      fetchImpl: fetchMock,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'failed',
      error: 'Visual capture provider response exceeded the size limit.',
      issue: { code: 'provider_response_too_large', stage: 'provider' },
    });
  });

  it('parses valid provider JSON split across response chunks', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        chunkedResponse([
          new TextEncoder().encode('{"success":true,"data":'),
          new TextEncoder().encode('{"markdown":"chunked evidence"}}'),
        ]),
      );

    const result = await captureNodeSlideWebEvidence({
      url: SOURCE_URL,
      apiKey: 'test-key',
      fetchImpl: fetchMock,
    });

    expect(result).toMatchObject({
      ok: true,
      status: 'degraded',
      markdown: 'chunked evidence',
      issue: { code: 'provider_evidence_missing', stage: 'screenshot' },
    });
  });

  it('returns a typed failure for malformed provider JSON', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(chunkedResponse([new TextEncoder().encode('{"success": true')]));

    const result = await captureNodeSlideWebEvidence({
      url: SOURCE_URL,
      apiKey: 'test-key',
      fetchImpl: fetchMock,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'failed',
      error: 'Visual capture provider returned invalid JSON.',
      issue: { code: 'provider_response_invalid', stage: 'provider' },
    });
  });

  it('keeps source mapping stable when malformed and blocked URLs are interleaved', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({ success: true, data: { markdown: 'retained public evidence' } }),
      ),
    );

    const results = await captureNodeSlideWebEvidenceBatch({
      targets: [
        { sourceId: 'source-public-a', url: 'https://example.com/a#fragment' },
        { sourceId: 'source-malformed', url: 'not a url' },
        { sourceId: 'source-private', url: 'http://127.0.0.1/private' },
        { sourceId: 'source-public-b', url: 'https://example.org/b' },
      ],
      apiKey: 'test-key',
      fetchImpl: fetchMock,
    });

    expect(results).toHaveLength(4);
    expect(results.map(({ sourceId, sourceIndex }) => [sourceId, sourceIndex])).toEqual([
      ['source-public-a', 0],
      ['source-malformed', 1],
      ['source-private', 2],
      ['source-public-b', 3],
    ]);
    expect(results[0]).toMatchObject({
      requestedUrl: 'https://example.com/a',
      capture: { ok: true, url: 'https://example.com/a' },
    });
    expect(results[1]).toMatchObject({
      requestedUrl: 'invalid-source-url',
      capture: {
        ok: false,
        status: 'failed',
        url: 'invalid-source-url',
        issue: { code: 'source_url_invalid', stage: 'source' },
      },
    });
    expect(results[2]).toMatchObject({
      requestedUrl: 'http://127.0.0.1/private',
      capture: {
        ok: false,
        status: 'failed',
        issue: { code: 'source_url_blocked', stage: 'source' },
      },
    });
    expect(results[3]).toMatchObject({
      requestedUrl: 'https://example.org/b',
      capture: { ok: true, url: 'https://example.org/b' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
      status: 'failed',
      error: 'Visual capture provider returned HTTP 503.',
      issue: { code: 'provider_http_error', stage: 'provider' },
    });
    expect(networkFailure).toMatchObject({
      ok: false,
      status: 'failed',
      error: 'Visual capture failed safely.',
      issue: { code: 'network_error', stage: 'network' },
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
      status: 'failed',
      error: 'Visual capture timed out.',
      issue: { code: 'timeout', stage: 'network' },
    });
  });

  it('captures normalized markdown and image evidence with a deterministic content digest', async () => {
    const screenshotBytes = pngHeader(1_440, 900);
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
          new Response(
            screenshotBytes.buffer.slice(
              screenshotBytes.byteOffset,
              screenshotBytes.byteOffset + screenshotBytes.byteLength,
            ) as ArrayBuffer,
            {
              headers: {
                'content-length': String(screenshotBytes.byteLength),
                'content-type': 'image/png; charset=binary',
              },
            },
          ),
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
      status: 'captured',
      provider: 'firecrawl',
      url: SOURCE_URL,
      title: 'Quarterly evidence',
      markdown: '# Evidence\n\nRevenue: 42',
      contentDigest: nodeslideContentDigest(screenshotBytes),
      screenshot: {
        bytes: screenshotBytes,
        mimeType: 'image/png',
        viewport: { width: 1_440, height: 900 },
      },
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

describe('readRasterImageDimensions', () => {
  it('derives exact PNG dimensions from encoded bytes and rejects truncated headers', () => {
    expect(readRasterImageDimensions(pngHeader(1_920, 1_080))).toEqual({
      width: 1_920,
      height: 1_080,
    });
    expect(readRasterImageDimensions(new Uint8Array([137, 80, 78, 71]))).toBeUndefined();
  });
});

describe('createNodeSlideSourceSnapshotPdf', () => {
  it('creates a bounded, digest-bound PDF with a normalized excerpt overlay', () => {
    const snapshot = createNodeSlideSourceSnapshotPdf({
      title: 'Quarterly evidence (audited)',
      url: `${SOURCE_URL}#section`,
      excerpt: 'Revenue reached 42 million in the retained source excerpt.',
      provider: 'linkup',
      retrievedAt: Date.parse('2026-07-16T10:00:00.000Z'),
    });
    const text = new TextDecoder().decode(snapshot.bytes);

    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('Bound source excerpt:');
    expect(text).toContain('Revenue reached 42 million');
    expect(text).toContain('https://example.com/reports/quarterly');
    const authoredRegion = text.match(/48 (\d+) 516 (\d+) re f/);
    expect(authoredRegion).not.toBeNull();
    const regionBottom = Number(authoredRegion?.[1]);
    const regionHeight = Number(authoredRegion?.[2]);
    expect(snapshot.contentDigest).toBe(nodeslideContentDigest(snapshot.bytes));
    expect(snapshot.viewport).toEqual({ width: 612, height: 792 });
    expect(snapshot.box).toMatchObject({ page: 1 });
    expect(snapshot.box.x * 612).toBeCloseTo(48);
    expect(snapshot.box.y * 792).toBeCloseTo(792 - regionBottom - regionHeight);
    expect(snapshot.box.w * 612).toBeCloseTo(516);
    expect(snapshot.box.h * 792).toBeCloseTo(regionHeight);
    expect(snapshot.box.x + snapshot.box.w).toBeLessThanOrEqual(1);
    expect(snapshot.box.y + snapshot.box.h).toBeLessThanOrEqual(1);
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function chunkedResponse(chunks: readonly Uint8Array[], init?: ResponseInit): Response {
  let index = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index++];
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
    }),
    { status: 200, ...init },
  );
}

function sequenceNow(...values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
}

function pngHeader(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0x00,
    0x00,
    0x00,
    0x0d,
    0x49,
    0x48,
    0x44,
    0x52,
    (width >>> 24) & 0xff,
    (width >>> 16) & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    (height >>> 24) & 0xff,
    (height >>> 16) & 0xff,
    (height >>> 8) & 0xff,
    height & 0xff,
  ]);
}
