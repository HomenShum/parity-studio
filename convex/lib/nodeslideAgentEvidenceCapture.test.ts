import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionCtx } from '../_generated/server';
import {
  captureWebSourcesBestEffort,
  nodeSlideEvidenceAttachmentDigest,
  pairNodeSlideStoredWebSources,
} from '../nodeslideAgent';
import { nodeslideContentDigest, nodeslideStableId } from './nodeslideIds';

const DECK_ID = 'deck_evidence_hardening';
const STORAGE_ID = 'storage_evidence_pdf';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('NodeSlide agent evidence capture hardening', () => {
  it('persists the digest of the exact stored attachment bytes and distinguishes tampering', async () => {
    vi.stubEnv('FIRECRAWL_API_KEY', '');
    const storedBlobs: Blob[] = [];
    const runMutation = vi.fn(async () => ({ created: true }));
    const context = actionContext({
      store: vi.fn(async (blob: Blob) => {
        storedBlobs.push(blob);
        return STORAGE_ID;
      }),
      delete: vi.fn(async () => undefined),
      runMutation,
    });

    await captureWebSourcesBestEffort(context, captureArgs());

    expect(storedBlobs).toHaveLength(1);
    const storedBlob = storedBlobs[0];
    if (!storedBlob) throw new Error('Expected one stored evidence attachment.');
    const storedBytes = new Uint8Array(await storedBlob.arrayBuffer());
    const recordCalls = runMutation.mock.calls as unknown as Array<[unknown, unknown]>;
    const recordArgs = recordCalls[0]?.[1] as
      | {
          contentDigest: string;
          steps: Array<{ contentDigest: string; pdfStorageId?: string }>;
        }
      | undefined;
    if (!recordArgs) throw new Error('Expected one evidence record mutation.');
    const expectedDigest = nodeslideContentDigest(storedBytes);
    expect(recordArgs.contentDigest).toBe(expectedDigest);
    expect(recordArgs.steps[0]).toMatchObject({
      contentDigest: expectedDigest,
      pdfStorageId: STORAGE_ID,
    });

    const tamperedBytes = Uint8Array.from(storedBytes);
    tamperedBytes[tamperedBytes.length - 1] ^= 0x01;
    expect(nodeSlideEvidenceAttachmentDigest(tamperedBytes)).not.toBe(expectedDigest);
    expect(expectedDigest).not.toBe(
      nodeslideContentDigest('Quarterly report\nhttps://example.com/report\nRevenue was 42.'),
    );
  });

  it('persists only byte-verified whole-screenshot geometry for a production web capture', async () => {
    vi.stubEnv('FIRECRAWL_API_KEY', 'capture-key');
    const screenshotBytes = pngHeader(1_280, 720);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>((input) => {
        const url = String(input);
        if (url === 'https://api.firecrawl.dev/v1/scrape') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: true,
                data: {
                  markdown: '# Captured report',
                  screenshot: 'https://cdn.example.com/report.png',
                  metadata: { title: 'Quarterly report' },
                },
              }),
              { headers: { 'content-type': 'application/json' } },
            ),
          );
        }
        if (url === 'https://cdn.example.com/report.png') {
          return Promise.resolve(
            new Response(
              screenshotBytes.buffer.slice(
                screenshotBytes.byteOffset,
                screenshotBytes.byteOffset + screenshotBytes.byteLength,
              ) as ArrayBuffer,
              { headers: { 'content-type': 'image/png' } },
            ),
          );
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );
    const runMutation = vi.fn(async () => ({ created: true }));
    const context = actionContext({
      store: vi.fn(async () => 'storage_evidence_screenshot'),
      delete: vi.fn(async () => undefined),
      runMutation,
    });

    await captureWebSourcesBestEffort(context, captureArgs());

    const recordCalls = runMutation.mock.calls as unknown as Array<[unknown, unknown]>;
    const recordArgs = recordCalls[0]?.[1] as
      | {
          provider: string;
          steps: Array<{
            screenshotStorageId?: string;
            box?: { x: number; y: number; w: number; h: number };
            viewport?: { width: number; height: number };
          }>;
        }
      | undefined;
    if (!recordArgs) throw new Error('Expected one evidence record mutation.');
    expect(recordArgs.provider).toBe('firecrawl');
    expect(recordArgs.steps[0]).toMatchObject({
      screenshotStorageId: 'storage_evidence_screenshot',
      box: { x: 0, y: 0, w: 1, h: 1 },
      viewport: { width: 1_280, height: 720 },
      regionScope: 'source',
    });
    expect(recordArgs.steps[0]?.box).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('deletes a stored orphan and propagates the record failure', async () => {
    vi.stubEnv('FIRECRAWL_API_KEY', '');
    const recordError = new Error('recordEvidenceCaptureInternal failed');
    const deleteStorage = vi.fn(async () => undefined);
    const context = actionContext({
      store: vi.fn(async () => STORAGE_ID),
      delete: deleteStorage,
      runMutation: vi.fn(async () => {
        throw recordError;
      }),
    });

    await expect(captureWebSourcesBestEffort(context, captureArgs())).rejects.toBe(recordError);
    expect(deleteStorage).toHaveBeenCalledTimes(1);
    expect(deleteStorage).toHaveBeenCalledWith(STORAGE_ID);
  });

  it('pairs [invalid URL, valid URL] results by stable source identity', () => {
    const validUrl = 'https://example.com/retained-report#evidence';
    const normalizedValidUrl = new URL(validUrl).toString().slice(0, 900);
    const validSourceId = nodeslideStableId('source_web', DECK_ID, normalizedValidUrl);

    const paired = pairNodeSlideStoredWebSources({
      deckId: DECK_ID,
      inputs: [
        {
          title: 'Invalid source must not rebind',
          url: 'not a URL',
          snippet: 'invalid excerpt',
          provider: 'test',
        },
        {
          title: 'Retained valid source',
          url: validUrl,
          snippet: 'valid excerpt',
          provider: 'test',
        },
      ],
      references: [{ id: validSourceId }],
    });

    expect(paired).toEqual([
      {
        sourceId: validSourceId,
        title: 'Retained valid source',
        url: normalizedValidUrl,
        snippet: 'valid excerpt',
        provider: 'test',
      },
    ]);
  });
});

function captureArgs() {
  return {
    deckId: DECK_ID,
    ownerAccessKey: 'a'.repeat(43),
    runId: 'run_evidence_hardening',
    parentSpanId: 'span_research',
    sources: [
      {
        sourceId: 'source_valid',
        title: 'Quarterly report',
        url: 'https://example.com/report',
        snippet: 'Revenue was 42.',
        provider: 'test-search',
      },
    ],
  };
}

function actionContext(args: {
  store: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  runMutation: ReturnType<typeof vi.fn>;
}): ActionCtx {
  return {
    storage: { store: args.store, delete: args.delete },
    runMutation: args.runMutation,
  } as unknown as ActionCtx;
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
    0,
    0,
    0,
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
