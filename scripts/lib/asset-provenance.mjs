/**
 * Embedded-asset provenance and safety.
 *
 * A deck that embeds real product screenshots is shipping whatever was on screen when they were
 * taken. Nothing in this repo previously asked where an embedded image came from, whether it may
 * be redistributed, or whether anyone had looked at it for credentials or customer data. Five
 * source policies do not answer that for a folder of ~2,000 captures.
 *
 * Three separate questions, kept separate because they fail differently:
 *   PROVENANCE — does every embedded byte resolve to a known source asset with a policy?
 *   SAFETY     — has a human attested the capture is free of secrets/PII, and does its metadata
 *                leak absolute paths or usernames?
 *   HONESTY    — do images presented as a PAIR actually differ? Captioning one capture as two
 *                states is the same lie as calling autoshapes a chart.
 *
 * This gate cannot read pixels. It never claims an image is clean — it reports what still needs a
 * human, and fails when something ships without one.
 */

import { createHash } from 'node:crypto';

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** PNG text chunks routinely carry the capture tool's absolute path, and with it a username. */
const LEAK_PATTERNS = [
  { id: 'windows-user-path', re: /[A-Za-z]:\\Users\\[^\\/:*?"<>|\r\n]+/i },
  { id: 'unix-home-path', re: /\/(?:home|Users)\/[A-Za-z0-9._-]+/ },
  {
    id: 'bearer-token',
    re: /\b(?:bearer\s+)?[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  },
  { id: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'generic-secret-assignment', re: /\b(api[_-]?key|secret|password|token)\s*[:=]\s*\S{8,}/i },
];

/** Scan embedded text metadata only. Pixels are out of scope and are reported as such. */
export function scanAssetMetadata(buffer) {
  const text = buffer.toString('latin1');
  const findings = [];
  for (const chunk of text.matchAll(/(?:tEXt|iTXt|zTXt|Exif)([\x20-\x7e]{4,400})/g)) {
    for (const pattern of LEAK_PATTERNS) {
      const hit = pattern.re.exec(chunk[1]);
      if (hit) findings.push({ rule: pattern.id, sample: hit[0].slice(0, 60) });
    }
  }
  return findings;
}

/**
 * Which media parts each slide actually references, read from its relationships.
 *
 * `relsBySlide` : { "<slide number>": "<contents of slideN.xml.rels>" }
 *
 * This used to be inferred from the writer's `image-<slide>-<n>.png` filename convention. That is
 * a proxy for slide membership, and it silently stopped being true the moment byte-identical media
 * parts were deduplicated and repointed: every declared pair disappeared from the gate while the
 * deck was unchanged and still correct. A vanishing check reads exactly like a passing one.
 *
 * Relationships are the authority, and they survive renaming. Entries are deliberately NOT
 * deduplicated — a slide referencing the same part twice is a before/after showing one image
 * twice, which is the false claim the pair check exists to catch.
 */
export function resolveSlideImagePairs(relsBySlide) {
  const pairs = [];
  for (const [slide, rels] of Object.entries(relsBySlide ?? {})) {
    const parts = [...String(rels).matchAll(/Target="([^"]*media\/[^"]+)"/g)].map((match) =>
      // Targets are relative ('../media/x.png') or absolute ('/ppt/media/x.png').
      match[1]
        .replace(/^\.\.\//, 'ppt/')
        .replace(/^\//, ''),
    );
    if (parts.length === 2) pairs.push({ label: `slide ${slide} two-state pair`, parts });
  }
  return pairs;
}

/**
 * Verify every embedded image against the manifest.
 *
 * `embedded`  : [{ part, buffer }]
 * `manifest`  : { assets: [{ sha256, path, sourcePolicyId, capturedAt, secretsReview: {...} }] }
 * `pairs`     : [{ label, parts: [partA, partB] }] — images presented as distinct states
 */
export function verifyEmbeddedAssets({ embedded, manifest, pairs = [] }) {
  const bySha = new Map((manifest.assets ?? []).map((a) => [a.sha256, a]));
  const assets = [];

  for (const item of embedded) {
    const digest = sha256(item.buffer);
    const record = bySha.get(digest);
    const leaks = scanAssetMetadata(item.buffer);
    const review = record?.secretsReview;
    const reviewed =
      review?.reviewed === true && Boolean(review.reviewedBy) && Boolean(review.reviewedAt);

    const problems = [];
    if (!record)
      problems.push('no manifest entry: the embedded bytes match no declared source asset');
    else {
      if (!record.sourcePolicyId) problems.push('no source policy: redistribution rights unknown');
      if (!reviewed)
        problems.push(
          'no attested secrets review: nobody has confirmed this capture is safe to ship',
        );
    }
    for (const leak of leaks) problems.push(`metadata leak (${leak.rule}): ${leak.sample}`);

    assets.push({
      part: item.part,
      sha256: digest,
      path: record?.path ?? null,
      sourcePolicyId: record?.sourcePolicyId ?? null,
      reviewed,
      leaks,
      verdict: problems.length === 0 ? 'pass' : 'fail',
      problems,
    });
  }

  // A pair that is the same image twice is a false claim, however well-provenanced each copy is.
  const pairFindings = [];
  for (const pair of pairs) {
    const digests = pair.parts.map((part) => assets.find((a) => a.part === part)?.sha256);
    if (digests.some((d) => !d)) {
      pairFindings.push({
        label: pair.label,
        verdict: 'fail',
        detail: 'a declared pair member is not embedded',
      });
      continue;
    }
    const identical = new Set(digests).size === 1;
    pairFindings.push({
      label: pair.label,
      verdict: identical ? 'fail' : 'pass',
      detail: identical
        ? `both images are byte-identical (${digests[0].slice(0, 12)}) — captioned as two states but showing one`
        : 'the two states are genuinely different images',
    });
  }

  const failed = assets.filter((a) => a.verdict === 'fail');
  const pairFailed = pairFindings.filter((p) => p.verdict === 'fail');

  // Report the attestation that actually exists rather than a fixed string. This gate never reads
  // pixels itself, so who looked — and what they found — is the only thing that makes a capture
  // safe to ship. Anything still flagged for external publication is surfaced, not buried.
  const reviewers = new Set(
    (manifest.assets ?? []).map((a) => a.secretsReview?.reviewedBy).filter(Boolean),
  );
  const flaggedForExternal = (manifest.assets ?? []).filter(
    (a) =>
      a.secretsReview?.reviewed === true && a.secretsReview.externalPublicationCleared === false,
  );

  return {
    assets,
    pairs: pairFindings,
    failed: failed.length,
    pairFailed: pairFailed.length,
    pixelReview:
      reviewers.size === 0
        ? 'none attested — this gate reads text metadata only; nobody has looked at the pixels'
        : `attested by ${[...reviewers].join(', ')}`,
    // Cleared to ship internally is not the same as cleared to publish.
    flaggedForExternalPublication: flaggedForExternal.map((a) => ({
      path: a.path,
      findings: a.secretsReview.findings,
    })),
    verdict: failed.length === 0 && pairFailed.length === 0 ? 'pass' : 'fail',
  };
}
