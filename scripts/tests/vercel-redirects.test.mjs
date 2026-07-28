import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Phase 4 of docs/DECOUPLING_PLAN.md moved NodeSlide's public URLs off this deployment. Old links
 * are already out in the world — in the PRD, in docs, in sent messages — so the redirect rules in
 * vercel.json are the only thing standing between a reader and a dead page for the next 90 days
 * (decision D3).
 *
 * What this file can and cannot prove: it does NOT run Vercel's router, so it cannot certify that
 * Vercel interprets these rules the way the resolver below does. What it does certify is the part
 * that is actually easy to get wrong and impossible to notice: that the real old URLs recorded in
 * this repo's own artifacts each match a rule, that the share-slug pattern accepts the slugs
 * `createShareSlug()` actually produces and rejects the ones it never could, and that no rule can
 * send a request back to a URL that matches the same rule again. The live check is a curl against
 * the deployed URL, recorded in the pull request — not this file.
 */

const config = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../vercel.json', import.meta.url)), 'utf8'),
);

/** Mirrors `createShareSlug()` in convex/lib/nodeslideAccess.ts: `share-` + 36 hex chars. */
function realShareSlug(seed) {
  return `share-${seed.repeat(36).slice(0, 36)}`;
}

/**
 * A deliberately small model of Vercel's redirect matching: first rule whose path and every `has`
 * condition match wins, and named capture groups fill `:name` placeholders in the destination.
 */
function resolve(rawUrl) {
  const url = new URL(rawUrl, 'https://parity-studio.vercel.app');
  for (const rule of config.redirects ?? []) {
    if (rule.source !== url.pathname) continue;
    const captures = {};
    const matched = (rule.has ?? []).every((condition) => {
      if (condition.type !== 'query') return false;
      const value = url.searchParams.get(condition.key);
      if (value === null) return false;
      if (condition.value === undefined) return true;
      const match = new RegExp(condition.value).exec(value);
      if (!match) return false;
      Object.assign(captures, match.groups ?? {});
      return true;
    });
    if (!matched) continue;
    const destination = rule.destination.replace(
      /:([A-Za-z][A-Za-z0-9]*)/g,
      (whole, name) => captures[name] ?? whole,
    );
    return { destination, statusCode: rule.statusCode ?? (rule.permanent ? 308 : 307) };
  }
  return null;
}

describe('old public links survive the NodeSlide split', () => {
  it('re-enables git deployments, which is what makes any of this reach a reader', () => {
    expect(config.git.deploymentEnabled).toBe(true);
  });

  it('maps a real share link onto the /s/<slug> route the product now serves', () => {
    const slug = realShareSlug('a1b2c3');
    // The slug is the same value on both sides: PR #83's rewrite was /s/:shareSlug ->
    // /api/share?share=:shareSlug, so the id in the old query string is the id in the new path.
    expect(resolve(`/?share=${slug}&present=1`)).toEqual({
      destination: `https://nodeslide.vercel.app/s/${slug}`,
      statusCode: 301,
    });
  });

  it.each([
    // Recorded in artifacts/nodeslide-bar-opus-2026-07-13/postdeploy-verify.cjs and .qa/memory.
    ['/?domain=nodeslide', 'https://nodeslide.vercel.app/'],
    // Recorded in artifacts/nodeslide-bar-opus-2026-07-13/evidence/hero6-result-run1.json.
    ['/?domain=nodeslide&deck=deck_golden_05g6zge', 'https://nodeslide.vercel.app/'],
  ])('redirects the old domain link %s', (from, destination) => {
    expect(resolve(from)).toEqual({ destination, statusCode: 301 });
  });

  it('leaves the Atlas gallery alone, because parity still serves it', () => {
    expect(resolve('/?domain=atlas')).toBeNull();
  });

  it('does not redirect parity itself', () => {
    expect(resolve('/')).toBeNull();
    expect(resolve('/?domain=parity')).toBeNull();
    expect(resolve('/?run=jh713j417mxted5s5adwwvywxs86qkyg')).toBeNull();
  });

  it('sends a share id that was never issuable to a page that explains, not to a 404', () => {
    // `requireShareSlug` in convex/lib/nodeslideAccess.ts only ever accepted
    // /^[a-z0-9]+(?:-[a-z0-9]+)*$/, so these could not have addressed a deck even before the
    // split. Guessing a destination for them would be worse than saying so.
    for (const junk of ['', 'SHARE-UPPER', 'share slug', 'share/../etc', '-leading', 'trailing-']) {
      const resolved = resolve(`/?share=${encodeURIComponent(junk)}`);
      expect(resolved, `junk share value: ${JSON.stringify(junk)}`).toEqual({
        destination: '/link-moved.html',
        statusCode: 301,
      });
    }
  });

  it('cannot loop: no destination this deployment serves matches a rule again', () => {
    // The explainer is the one same-origin destination, and it is the loop risk: if a rule
    // matched it while `?share=` rode along, the browser would bounce forever.
    expect(resolve('/link-moved.html?share=anything')).toBeNull();
    expect(resolve('/link-moved.html')).toBeNull();
  });
});
