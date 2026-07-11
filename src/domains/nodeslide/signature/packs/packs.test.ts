import { describe, expect, it } from 'vitest';
import type { SignatureProfile } from '../../../../../shared/nodeslideSignature';
import financeIbcsJson from './finance-ibcs.json';
import {
  FINANCE_IBCS_TASTE_PACK,
  NODESLIDE_SIGNATURE_TASTE_PROFILES,
  NODESLIDE_TASTE_PACKS,
  NODESLIDE_TASTE_PACK_JSON,
  STARTUP_NARRATIVE_TASTE_PACK,
  assertNodeSlideTastePack,
  contrastRatioForHex,
  hasValidTastePackIdentity,
  sha256Hex,
  stableSerializeJson,
  stableSerializeTastePack,
  validateNodeSlideTastePack,
} from './index';
import startupNarrativeJson from './startup-narrative.json';
import type { NodeSlideTastePack } from './types';

const expectedRules = {
  'finance-ibcs': [
    'finance.message-first',
    'finance.semantic-consistency',
    'finance.no-decoration',
    'finance.dense-but-legible',
    'finance.direct-labels',
    'finance.integrity-axes-scales',
    'finance.time-horizontal',
    'finance.structure-vertical',
    'finance.highlight-with-purpose',
    'finance.chart-by-question',
  ],
  'startup-narrative': [
    'startup.audience-centered-arc',
    'startup.single-takeaway',
    'startup.current-future-contrast',
    'startup.purposeful-simplicity',
    'startup.whitespace-for-focus',
    'startup.decisive-next-action',
  ],
} as const;

const checkedInJson: Record<'finance-ibcs' | 'startup-narrative', unknown> = {
  'finance-ibcs': financeIbcsJson,
  'startup-narrative': startupNarrativeJson,
};

function internalId(pack: NodeSlideTastePack) {
  return pack.$extensions['com.nodeslide.tastePack'].id;
}

function allTokens(pack: NodeSlideTastePack) {
  return [
    ...Object.values(pack.tokens.colors),
    ...Object.values(pack.tokens.fontFamilies),
    ...Object.values(pack.tokens.fontSizes),
  ];
}

describe('W5 NodeSlide taste-pack schema', () => {
  it('exports the two frozen IDs as SignatureProfile-assignable JSON documents', () => {
    const profiles: readonly SignatureProfile[] = NODESLIDE_SIGNATURE_TASTE_PROFILES;
    expect(profiles).toHaveLength(2);
    expect(NODESLIDE_TASTE_PACKS.map(internalId)).toEqual(['finance-ibcs', 'startup-narrative']);
    expect(NODESLIDE_TASTE_PACKS.map((pack) => pack.name)).toEqual([
      'Finance reporting',
      'Startup narrative',
    ]);

    for (const pack of NODESLIDE_TASTE_PACKS) {
      expect(pack.source.kind).toBe('taste_pack');
      expect(pack.schemaVersion).toBe('nodeslide.signature/v1');
      expect(validateNodeSlideTastePack(pack)).toEqual({ ok: true, errors: [] });
      const json = NODESLIDE_TASTE_PACK_JSON[internalId(pack)];
      const parsed: unknown = JSON.parse(json);
      assertNodeSlideTastePack(parsed);
      expect(parsed).toEqual(pack);
      const artifact = checkedInJson[internalId(pack)];
      assertNodeSlideTastePack(artifact);
      expect(stableSerializeTastePack(artifact)).toBe(json);
      expect(artifact).toEqual(pack);
    }
  });

  it('rejects fabricated observed usage and incomplete citations', () => {
    const fabricated = structuredClone(FINANCE_IBCS_TASTE_PACK);
    fabricated.usage.colors.push({ value: '#FFFFFF', occurrences: 1, evidenceIds: [] });
    const fabricatedResult = validateNodeSlideTastePack(fabricated);
    expect(fabricatedResult.ok).toBe(false);
    expect(fabricatedResult.errors).toContain('Taste packs must keep observed usage arrays empty.');

    const uncited = structuredClone(STARTUP_NARRATIVE_TASTE_PACK);
    const firstRule = uncited.$extensions['com.nodeslide.rules'].rules[0];
    if (!firstRule) throw new Error('Missing startup rule fixture.');
    firstRule.citations[0].license = '';
    const citationResult = validateNodeSlideTastePack(uncited);
    expect(citationResult.ok).toBe(false);
    expect(citationResult.errors).toContain(
      'rules.startup.audience-centered-arc.citations[0].license is required.',
    );
  });

  it('returns bounded schema errors instead of throwing on incomplete nested data', () => {
    const malformed = structuredClone(FINANCE_IBCS_TASTE_PACK);
    Reflect.deleteProperty(malformed.layout, 'layoutUsage');
    expect(() => validateNodeSlideTastePack(malformed)).not.toThrow();
    const result = validateNodeSlideTastePack(malformed);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Taste pack has missing or malformed required fields.');
  });
});

describe('W5 citation coverage and licensing boundaries', () => {
  it('keeps every frozen rule in authored order with direct, licensed support', () => {
    for (const pack of NODESLIDE_TASTE_PACKS) {
      const id = internalId(pack);
      const extension = pack.$extensions['com.nodeslide.rules'];
      expect(extension.rules.map((rule) => rule.id)).toEqual(expectedRules[id]);
      expect(extension.nonAffiliation.independent).toBe(true);
      expect(extension.nonAffiliation.statement).toMatch(/not affiliated/i);
      expect(extension.nonAffiliation.organizations.length).toBeGreaterThan(0);
      expect(extension.nonAffiliation.prohibitedClaims.length).toBeGreaterThan(0);

      for (const rule of extension.rules) {
        expect(rule.title.trim()).not.toBe('');
        expect(rule.behavior.trim()).not.toBe('');
        expect(rule.citations.length).toBeGreaterThan(0);
        for (const citation of rule.citations) {
          expect(citation.title.trim()).not.toBe('');
          expect(citation.supports.trim()).not.toBe('');
          expect(citation.license.trim()).not.toBe('');
          const url = new URL(citation.url);
          expect(url.protocol).toBe('https:');
          expect(url.hostname).not.toBe('');
          expect(url.pathname).not.toBe('/');
        }
      }
    }
  });

  it('does not leak source citations into literal token provenance', () => {
    for (const pack of NODESLIDE_TASTE_PACKS) {
      const citationUrls = pack.$extensions['com.nodeslide.rules'].rules.flatMap((rule) =>
        rule.citations.map((citation) => citation.url),
      );
      const provenance = stableSerializeJson({
        evidence: pack.evidence,
        tokenExtensions: allTokens(pack).map((token) => token.$extensions),
      });
      expect(provenance).not.toMatch(/https?:\/\//i);
      for (const url of citationUrls) expect(provenance).not.toContain(url);
    }
  });
});

describe('W5 authored colors, fonts, and contrast', () => {
  it('encodes canonical uppercase hex with matching normalized sRGB components', () => {
    for (const pack of NODESLIDE_TASTE_PACKS) {
      for (const token of Object.values(pack.tokens.colors)) {
        expect(token.$value.colorSpace).toBe('srgb');
        expect(token.$value.hex).toMatch(/^#[0-9A-F]{6}$/);
        const expected = [
          Number.parseInt(token.$value.hex.slice(1, 3), 16),
          Number.parseInt(token.$value.hex.slice(3, 5), 16),
          Number.parseInt(token.$value.hex.slice(5, 7), 16),
        ].map((channel) => Math.round((channel / 255) * 1_000_000) / 1_000_000);
        expect(token.$value.components).toEqual(expected);
        for (const component of token.$value.components) {
          expect(Number.isFinite(component)).toBe(true);
          expect(component).toBeGreaterThanOrEqual(0);
          expect(component).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('passes every authored foreground/background contrast assertion', () => {
    for (const pack of NODESLIDE_TASTE_PACKS) {
      const pairs = pack.$extensions['com.nodeslide.tastePack'].approvedContrastPairs;
      expect(pairs.length).toBeGreaterThan(0);
      for (const pair of pairs) {
        const foreground = pack.tokens.colors[pair.foreground];
        const background = pack.tokens.colors[pair.background];
        expect(foreground, `missing ${pair.foreground}`).toBeDefined();
        expect(background, `missing ${pair.background}`).toBeDefined();
        if (!foreground || !background) continue;
        const ratio = contrastRatioForHex(foreground.$value.hex, background.$value.hex);
        expect(ratio).not.toBeNull();
        expect(ratio ?? 0).toBeGreaterThanOrEqual(pair.minimumRatio);
      }
    }
  });

  it('uses ordered local fallback stacks with a generic system family', () => {
    const genericFamilies = new Set(['sans-serif', 'serif', 'monospace', 'system-ui']);
    for (const pack of NODESLIDE_TASTE_PACKS) {
      const policy = pack.$extensions['com.nodeslide.tastePack'].fontPolicy;
      expect(policy).toEqual({
        networkFetch: false,
        embedsFonts: false,
        requiresGenericFallback: true,
      });
      for (const token of Object.values(pack.tokens.fontFamilies)) {
        expect(Array.isArray(token.$value)).toBe(true);
        const families = typeof token.$value === 'string' ? [token.$value] : token.$value;
        expect(families.length).toBeGreaterThan(1);
        expect(genericFamilies.has(families.at(-1)?.toLowerCase() ?? '')).toBe(true);
        expect(families.join(' ')).not.toMatch(/https?:\/\//i);
      }
    }
  });
});

describe('W5 authored-vs-observed honesty', () => {
  it('retains every literal token value as authored evidence with zero occurrences', () => {
    for (const pack of NODESLIDE_TASTE_PACKS) {
      const evidenceById = new Map(pack.evidence.map((item) => [item.id, item]));
      const tokenEvidenceIds = new Set<string>();
      for (const token of allTokens(pack)) {
        const extension = token.$extensions['com.nodeslide.signature'];
        expect(extension.confidence).toBe(1);
        expect(extension.occurrences).toBe(0);
        expect(extension.sourceRole).toBe('authored');
        expect(extension).not.toHaveProperty('originalPoints');
        expect(extension.evidenceIds).toHaveLength(1);
        const evidenceId = extension.evidenceIds[0];
        if (!evidenceId) throw new Error('Missing authored token evidence ID.');
        tokenEvidenceIds.add(evidenceId);
        const item = evidenceById.get(evidenceId);
        expect(item).toBeDefined();
        expect(item?.observedValue).toBe(stableSerializeJson(token.$value));
      }

      const layout = pack.$extensions['com.nodeslide.tastePack'].layout;
      expect(layout.sourceRole).toBe('authored');
      expect(layout.observedDeckFacts).toBe(false);
      expect(layout.intendedDensity).toBe(pack.layout.density);
      expect(layout.evidenceIds).toHaveLength(1);
      expect(pack.evidence).toHaveLength(tokenEvidenceIds.size + layout.evidenceIds.length);

      for (const item of pack.evidence) {
        expect(item.sourceKind).toBe('taste_pack');
        expect(item.method).toBe('authored');
        expect(item.confidence).toBe(1);
        expect(item.sourceDigest).toBe(pack.source.digest);
      }
    }
  });

  it('leaves observed usage and deck-fact fields neutral', () => {
    for (const pack of NODESLIDE_TASTE_PACKS) {
      expect(pack.usage).toEqual({ colors: [], fonts: [], fontSizes: [] });
      expect(pack.layout).toMatchObject({
        slideCount: 0,
        masterCount: 0,
        layoutCount: 0,
        layoutUsage: [],
        averageShapesPerSlide: 0,
        maximumShapesPerSlide: 0,
        averageTextRunsPerSlide: 0,
        embeddedFontsPresent: false,
        embeddedFontFamilies: [],
      });
      expect(pack.layout).not.toHaveProperty('medianFontSizePoints');
    }
  });
});

describe('W5 deterministic serialization, identity, and ordering', () => {
  it('uses a known SHA-256 implementation and content-derived stable identities', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    for (const pack of NODESLIDE_TASTE_PACKS) {
      expect(pack.source.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(pack.id).toBe(`taste-pack:${internalId(pack)}:${pack.source.digest.slice(7)}`);
      expect(hasValidTastePackIdentity(pack)).toBe(true);

      const changed = structuredClone(pack);
      changed.name = `${changed.name} changed`;
      expect(hasValidTastePackIdentity(changed)).toBe(false);
    }
  });

  it('is byte-stable across replay, JSON round trips, and object insertion order', () => {
    for (const pack of NODESLIDE_TASTE_PACKS) {
      const first = stableSerializeTastePack(pack);
      const second = stableSerializeTastePack(pack);
      expect(second).toBe(first);
      const roundTripped = JSON.parse(first) as NodeSlideTastePack;
      expect(stableSerializeTastePack(roundTripped)).toBe(first);
      expect(hasValidTastePackIdentity(roundTripped)).toBe(true);

      const reordered = structuredClone(pack);
      reordered.tokens.colors = Object.fromEntries(
        Object.entries(reordered.tokens.colors).reverse(),
      );
      reordered.tokens.fontFamilies = Object.fromEntries(
        Object.entries(reordered.tokens.fontFamilies).reverse(),
      );
      reordered.tokens.fontSizes = Object.fromEntries(
        Object.entries(reordered.tokens.fontSizes).reverse(),
      );
      expect(stableSerializeTastePack(reordered)).toBe(first);
      expect(hasValidTastePackIdentity(reordered)).toBe(true);
    }
  });

  it('keeps token keys and evidence records in deterministic ASCII order', () => {
    for (const pack of NODESLIDE_TASTE_PACKS) {
      for (const record of [pack.tokens.colors, pack.tokens.fontFamilies, pack.tokens.fontSizes]) {
        expect(Object.keys(record)).toEqual([...Object.keys(record)].sort());
      }
      expect(pack.evidence.map((item) => item.id)).toEqual(
        [...pack.evidence.map((item) => item.id)].sort(),
      );
      const priority = pack.$extensions['com.nodeslide.tastePack'].authoredTokenPriority;
      expect(new Set(priority.colors)).toEqual(new Set(Object.keys(pack.tokens.colors)));
      expect(new Set(priority.fontFamilies)).toEqual(
        new Set(Object.keys(pack.tokens.fontFamilies)),
      );
      expect(new Set(priority.fontSizes)).toEqual(new Set(Object.keys(pack.tokens.fontSizes)));
    }
  });
});
