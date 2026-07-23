/**
 * Evidence binding — is the link attached to a CLAIM, or just present?
 *
 * The `evidence` artifact kind was detected by: does the slide carry an `a:hlinkClick` bound to an
 * external relationship? That is machine-checkable and it is not enough. A run reading "source"
 * pointed at any URL satisfies it, and so does a decorative "learn more" in a footer. The link
 * proves a URL exists somewhere on the slide; the claim it supports is nowhere in the check.
 *
 * This repo's own Atlas deck failed the harder question when it was first asked: all five evidence
 * links rendered as the bare word "source". The builder knew the claim — its EVIDENCE_SOURCES map
 * carries "Atlas v3 shipped zero native chart parts" — and threw it away at emit time, so the
 * reader saw a link with nothing attached to it.
 *
 * Four checks, each failing differently:
 *   RESOLVED   the relationship points at a real external target
 *   BOUND      the anchor text states a claim rather than naming itself
 *   VISIBLE    the anchor is non-empty text a reader can actually see and click
 *   DECLARED   the target matches the source the recipe declared, compared canonically
 *
 * A link that fails BOUND is the interesting case: it is a working hyperlink to a real source, and
 * still not evidence, because evidence is a claim you can follow — not a URL you can visit.
 */

/**
 * Anchors that name the link instead of stating what it supports. These are the words a generator
 * reaches for when it has a URL and no claim, which is exactly the condition being detected.
 */
const GENERIC_ANCHORS = new Set([
  'source',
  'sources',
  'link',
  'links',
  'here',
  'click here',
  'read more',
  'learn more',
  'more',
  'ref',
  'reference',
  'citation',
  'cite',
  'see',
  'details',
  'docs',
  'documentation',
  'url',
  'website',
  'this',
]);

/** Minimum words in an anchor before it can plausibly carry a claim. */
const MIN_ANCHOR_WORDS = 3;

const normalise = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Canonical URL form for equality: scheme and host lowercased, default port dropped, trailing
 * slash removed, fragment removed. Query is KEPT — it routinely selects the resource.
 */
export function canonicalUrl(value) {
  try {
    const url = new URL(String(value));
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    url.protocol = url.protocol.toLowerCase();
    if (
      (url.protocol === 'https:' && url.port === '443') ||
      (url.protocol === 'http:' && url.port === '80')
    ) {
      url.port = '';
    }
    let out = url.toString();
    if (out.endsWith('/') && url.pathname !== '/') out = out.slice(0, -1);
    return out;
  } catch {
    return String(value ?? '').trim();
  }
}

/** A bare citation marker — "[1]", "(2026)", "*" — carries no claim either. */
function isBareMarker(text) {
  return /^[\s[\](){}*†‡0-9.,;:-]*$/.test(String(text ?? ''));
}

/**
 * Decide one evidence link.
 *
 * `link`: { anchorText, target, resolved, visible, declaredSources }
 */
export function decideEvidenceLink(link) {
  const problems = [];
  const anchor = String(link.anchorText ?? '').trim();

  if (!link.resolved) {
    problems.push('the relationship does not resolve to an external target');
  }
  if (link.visible === false) {
    problems.push('the anchor is not visible, so no reader can follow it');
  }
  if (anchor.length === 0) {
    problems.push('the anchor carries no text at all');
  } else if (isBareMarker(anchor)) {
    problems.push(`the anchor "${anchor}" is a bare marker and states no claim`);
  } else if (GENERIC_ANCHORS.has(normalise(anchor))) {
    problems.push(
      `the anchor "${anchor}" names the link instead of stating what it supports — a reader cannot tell which claim it backs`,
    );
  } else if (normalise(anchor).split(' ').filter(Boolean).length < MIN_ANCHOR_WORDS) {
    problems.push(`the anchor "${anchor}" is too short to carry a claim`);
  }

  const declared = link.declaredSources;
  if (Array.isArray(declared) && declared.length > 0) {
    const targets = new Set(declared.map(canonicalUrl));
    if (!targets.has(canonicalUrl(link.target))) {
      problems.push(
        `the target ${link.target} is not among the sources this recipe declared, so the link was not reviewed`,
      );
    }
  }

  return {
    anchorText: anchor,
    target: link.target ?? null,
    verdict: problems.length === 0 ? 'bound' : 'unbound',
    problems,
  };
}

/**
 * Judge every evidence link on a slide. A slide only evidences the `evidence` kind if at least one
 * link is fully bound — one good citation is enough, and zero is not rescued by five broken ones.
 */
export function evaluateEvidenceLinks(links) {
  const findings = links.map(decideEvidenceLink);
  const bound = findings.filter((f) => f.verdict === 'bound');
  return {
    findings,
    boundCount: bound.length,
    verdict: bound.length > 0 ? 'pass' : 'fail',
    summary:
      links.length === 0
        ? 'no external source links on this slide'
        : `${bound.length}/${links.length} links state the claim they support`,
  };
}
