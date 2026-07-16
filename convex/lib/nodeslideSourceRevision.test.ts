import { describe, expect, it } from 'vitest';
import type { SourceRecord } from '../../shared/nodeslide';
import {
  assertNodeSlideSourceRevision,
  buildNodeSlideSourceRevision,
  isNodeSlideSourceRevision,
} from './nodeslideSourceRevision';

const CONTENT_DIGEST = `sha256:${'1'.repeat(64)}`;

describe('NodeSlide immutable source revisions', () => {
  it('builds a deterministic, content-addressed revision without mutating its source', () => {
    const input = source({ url: 'https://Example.com/report#page-2', columns: ['Year', 'Value'] });
    const original = structuredClone(input);

    const first = buildNodeSlideSourceRevision({ source: input });
    const second = buildNodeSlideSourceRevision({
      source: { ...input, status: 'refreshing', lastRefreshedAt: input.retrievedAt + 10 },
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schema: 'nodeslide.source-revision/v1',
      sourceId: 'source-a',
      deckId: 'deck-a',
      url: 'https://example.com/report',
      contentDigest: CONTENT_DIGEST,
      revisionId: expect.stringMatching(/^source-revision:sha256:[0-9a-f]{64}$/),
      revisionDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      columns: ['Year', 'Value'],
    });
    expect(first.revisionId).toBe(`source-revision:${first.revisionDigest}`);
    expect(input).toEqual(original);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.columns)).toBe(true);
    expect(() => assertNodeSlideSourceRevision(first)).not.toThrow();
    expect(isNodeSlideSourceRevision(first)).toBe(true);
  });

  it('supports a digest-bound predecessor and changes identity when evidence changes', () => {
    const predecessor = buildNodeSlideSourceRevision({ source: source() });
    const next = buildNodeSlideSourceRevision({
      source: source({ contentDigest: `sha256:${'2'.repeat(64)}` }),
      predecessor,
    });

    expect(next.predecessor).toEqual({
      revisionId: predecessor.revisionId,
      revisionDigest: predecessor.revisionDigest,
    });
    expect(Object.isFrozen(next.predecessor)).toBe(true);
    expect(next.revisionDigest).not.toBe(predecessor.revisionDigest);
  });

  it('requires exact retained content and canonical source metadata', () => {
    expect(() =>
      buildNodeSlideSourceRevision({ source: source({ contentDigest: undefined }) }),
    ).toThrow('content digest must be a canonical SHA-256 digest');
    expect(() =>
      buildNodeSlideSourceRevision({ source: source({ title: ' untrimmed ' }) }),
    ).toThrow('title must be non-empty, trimmed');
    expect(() =>
      buildNodeSlideSourceRevision({ source: source({ url: 'file:///private/report.pdf' }) }),
    ).toThrow('URL must use HTTP or HTTPS');
    expect(() =>
      buildNodeSlideSourceRevision({
        source: source({ url: 'https://user:secret@example.com/report' }),
      }),
    ).toThrow('URL cannot contain credentials');
    expect(() =>
      buildNodeSlideSourceRevision({ source: source({ columns: ['Value', 'Value'] }) }),
    ).toThrow('duplicate columns');
    expect(() => buildNodeSlideSourceRevision({ source: source({ byteSize: -1 }) })).toThrow(
      'byteSize must be a non-negative safe integer',
    );
  });

  it('rejects predecessor identities that are not bound to their digest', () => {
    const predecessor = buildNodeSlideSourceRevision({ source: source() });

    expect(() =>
      buildNodeSlideSourceRevision({
        source: source({ contentDigest: `sha256:${'2'.repeat(64)}` }),
        predecessor: {
          revisionId: predecessor.revisionId,
          revisionDigest: `sha256:${'3'.repeat(64)}`,
        },
      }),
    ).toThrow('predecessor revision ID is not bound to its digest');
  });

  it('detects metadata, content, identity, and extension-field tampering', () => {
    const revision = buildNodeSlideSourceRevision({ source: source() });
    const mutations: unknown[] = [
      { ...revision, title: 'Changed title' },
      { ...revision, contentDigest: `sha256:${'9'.repeat(64)}` },
      { ...revision, revisionDigest: `sha256:${'8'.repeat(64)}` },
      { ...revision, revisionId: `source-revision:sha256:${'7'.repeat(64)}` },
      { ...revision, status: 'ready' },
    ];

    for (const tampered of mutations) {
      expect(() => assertNodeSlideSourceRevision(tampered)).toThrow();
      expect(isNodeSlideSourceRevision(tampered)).toBe(false);
    }
  });
});

function source(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    id: 'source-a',
    deckId: 'deck-a',
    title: 'Audited quarterly report',
    url: 'https://example.com/report',
    sourceType: 'document',
    retrievedAt: Date.parse('2026-07-16T12:00:00.000Z'),
    citation: 'Example Corp. Audited quarterly report, 2026.',
    format: 'web',
    contentDigest: CONTENT_DIGEST,
    byteSize: 42_000,
    provider: 'direct-upload',
    retention: 'until_deleted',
    status: 'ready',
    lastRefreshedAt: Date.parse('2026-07-16T12:00:00.000Z'),
    ...overrides,
  };
}
