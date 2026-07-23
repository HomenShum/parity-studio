import { describe, expect, it } from 'vitest';
import {
  canonicalUrl,
  decideEvidenceLink,
  evaluateEvidenceLinks,
} from '../lib/evidence-binding.mjs';

/**
 * Written against this repo's own failure.
 *
 * The Atlas deck shipped five evidence links and every one of them rendered as the bare word
 * "source". The relationships resolved, the targets were real PRs and a real Microsoft spec page,
 * and the `evidence` kind was detected — while a reader looking at the slide could not tell which
 * claim any of them supported. The builder knew the claim and discarded it at emit time.
 *
 * So the case that matters most here is the WORKING hyperlink to a REAL source that is still not
 * evidence.
 */

const link = (over = {}) => ({
  anchorText: 'Atlas v3 shipped zero native chart parts',
  target: 'https://github.com/HomenShum/NodeSlide/pull/52',
  resolved: true,
  visible: true,
  ...over,
});

describe('a working link to a real source is not automatically evidence', () => {
  it('rejects the exact anchor this repo shipped — "source"', () => {
    const decision = decideEvidenceLink(link({ anchorText: 'source' }));
    expect(decision.verdict).toBe('unbound');
    expect(decision.problems.join(' ')).toMatch(/cannot tell which claim it backs/);
  });

  it('rejects the whole family of anchors that name themselves', () => {
    for (const anchor of ['Link', 'here', 'Click here', 'read more', 'reference', 'docs', 'URL']) {
      expect(decideEvidenceLink(link({ anchorText: anchor })).verdict, anchor).toBe('unbound');
    }
  });

  it('rejects a bare citation marker', () => {
    expect(decideEvidenceLink(link({ anchorText: '[1]' })).verdict).toBe('unbound');
    expect(decideEvidenceLink(link({ anchorText: '(2026)' })).verdict).toBe('unbound');
    expect(decideEvidenceLink(link({ anchorText: '*' })).problems.join(' ')).toMatch(/bare marker/);
  });

  it('rejects an anchor too short to carry a claim', () => {
    expect(decideEvidenceLink(link({ anchorText: 'PR 52' })).verdict).toBe('unbound');
  });

  it('accepts an anchor that states what the source supports', () => {
    const decision = decideEvidenceLink(link());
    expect(decision.verdict).toBe('bound');
    expect(decision.problems).toEqual([]);
  });
});

describe('the mechanical failures, kept separate from the claim failure', () => {
  it('rejects a relationship that does not resolve', () => {
    expect(decideEvidenceLink(link({ resolved: false })).problems.join(' ')).toMatch(
      /does not resolve/,
    );
  });

  it('rejects an invisible anchor — a link nobody can see is not a citation', () => {
    expect(decideEvidenceLink(link({ visible: false })).problems.join(' ')).toMatch(/not visible/);
  });

  it('rejects an empty anchor', () => {
    expect(decideEvidenceLink(link({ anchorText: '' })).problems.join(' ')).toMatch(/no text/);
  });

  it('reports every problem at once rather than stopping at the first', () => {
    const decision = decideEvidenceLink(link({ anchorText: 'source', resolved: false }));
    expect(decision.problems.length).toBeGreaterThan(1);
  });
});

describe('declared-source equality', () => {
  it('rejects a target the recipe never declared', () => {
    const decision = decideEvidenceLink(
      link({ declaredSources: ['https://github.com/HomenShum/parity-studio/pull/61'] }),
    );
    expect(decision.problems.join(' ')).toMatch(/not among the sources this recipe declared/);
  });

  it('accepts a declared target despite cosmetic URL differences', () => {
    const decision = decideEvidenceLink(
      link({
        target: 'HTTPS://GitHub.com/HomenShum/NodeSlide/pull/52/#discussion',
        declaredSources: ['https://github.com/HomenShum/NodeSlide/pull/52'],
      }),
    );
    expect(decision.verdict).toBe('bound');
  });

  it('keeps the query string, which usually selects the resource', () => {
    expect(canonicalUrl('https://x.com/a?page=2')).not.toBe(canonicalUrl('https://x.com/a'));
  });

  it('normalises scheme case, default port, trailing slash and fragment', () => {
    expect(canonicalUrl('HTTPS://Example.com:443/docs/#top')).toBe('https://example.com/docs');
  });

  it('does not throw on a malformed target', () => {
    expect(canonicalUrl('not a url')).toBe('not a url');
  });
});

describe('slide-level verdict', () => {
  it('fails a slide whose links are all bare "source" anchors — the shipped deck', () => {
    const result = evaluateEvidenceLinks([
      link({ anchorText: 'source' }),
      link({ anchorText: 'source', target: 'https://github.com/HomenShum/parity-studio/pull/61' }),
    ]);
    expect(result.verdict).toBe('fail');
    expect(result.boundCount).toBe(0);
    expect(result.summary).toMatch(/0\/2/);
  });

  it('passes on one good citation — five broken ones do not rescue zero, and one is enough', () => {
    const result = evaluateEvidenceLinks([link({ anchorText: 'source' }), link()]);
    expect(result.verdict).toBe('pass');
    expect(result.boundCount).toBe(1);
  });

  it('says plainly when a slide has no links at all', () => {
    expect(evaluateEvidenceLinks([]).summary).toMatch(/no external source links/);
  });
});
