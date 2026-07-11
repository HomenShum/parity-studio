import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type {
  SignatureExtractionResult,
  SignatureProfile,
} from '../../../../shared/nodeslideSignature';
import { extractPptxSignature, extractSignature, stableSerializeSignature } from './extractor';
import { createSignatureFixture, createZipWithoutPresentation } from './signatureFixtures';

function successfulProfile(result: SignatureExtractionResult): SignatureProfile {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected extraction success, received ${result.error.code}.`);
  return result.profile;
}

function colorValues(profile: SignatureProfile): string[] {
  return Object.values(profile.tokens.colors)
    .map((token) => token.$value.hex)
    .sort();
}

function fontValues(profile: SignatureProfile): string[] {
  return Object.values(profile.tokens.fontFamilies)
    .flatMap((token) => token.$value)
    .sort();
}

function paletteAndFontFingerprint(profile: SignatureProfile): string {
  return JSON.stringify({ colors: colorValues(profile), fonts: fontValues(profile) });
}

describe('NodeSlide PPTX signature extraction', () => {
  it('recovers a known theme, explicit usage, slide geometry, and two layout frequencies', async () => {
    const result = await extractPptxSignature(await createSignatureFixture(), {
      fileName: 'fixture.pptx',
    });
    const profile = successfulProfile(result);

    expect(profile.schemaVersion).toBe('nodeslide.signature/v1');
    expect(profile.source.fileName).toBe('fixture.pptx');
    expect(colorValues(profile)).toEqual(
      expect.arrayContaining(['#101010', '#112233', '#ABCDEF', '#D45500', '#FAFAFA']),
    );
    expect(fontValues(profile)).toEqual(expect.arrayContaining(['Body Sans', 'Display Sans']));
    expect(profile.usage.colors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: '#112233', occurrences: 3 }),
        expect.objectContaining({ value: '#ABCDEF', occurrences: 3 }),
      ]),
    );
    expect(profile.usage.fonts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'Body Sans', occurrences: 3 }),
        expect.objectContaining({ value: 'Display Sans', occurrences: 3 }),
      ]),
    );
    expect(profile.usage.fontSizes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 12, unit: 'pt', occurrences: 3 }),
        expect.objectContaining({ value: 24, unit: 'pt', occurrences: 3 }),
      ]),
    );
    expect(profile.layout).toMatchObject({
      slideWidthInches: 13.333333,
      slideHeightInches: 7.5,
      slideCount: 3,
      masterCount: 1,
      layoutCount: 2,
      averageShapesPerSlide: 1,
      maximumShapesPerSlide: 1,
      averageTextRunsPerSlide: 2,
      medianFontSizePoints: 18,
      density: 'sparse',
    });
    expect(profile.layout.layoutUsage).toEqual([
      { partName: 'ppt/slideLayouts/slideLayout1.xml', occurrences: 2 },
      { partName: 'ppt/slideLayouts/slideLayout2.xml', occurrences: 1 },
    ]);
    expect(profile.confidence).toBe('high');
    expect(profile.warnings).toEqual([]);

    const twelvePointToken = Object.values(profile.tokens.fontSizes).find(
      (token) => token.$extensions['com.nodeslide.signature'].originalPoints === 12,
    );
    expect(twelvePointToken?.$value).toEqual({ value: 16, unit: 'px' });
    for (const token of Object.values(profile.tokens.colors)) {
      expect(token.$type).toBe('color');
      expect(token.$value.colorSpace).toBe('srgb');
      expect(token.$value.components).toHaveLength(3);
      expect(token.$extensions['com.nodeslide.signature'].confidence).toBe(1);
    }
  });

  it('is stable across replays and alternate ZIP entry order', async () => {
    const forward = await createSignatureFixture({ contentLabel: 'Stable' });
    const reversed = await createSignatureFixture({
      contentLabel: 'Stable',
      reverseEntryOrder: true,
    });
    const first = successfulProfile(
      await extractPptxSignature(forward, { fileName: 'stable.pptx' }),
    );
    const replay = successfulProfile(
      await extractPptxSignature(forward, { fileName: 'stable.pptx' }),
    );
    const reordered = successfulProfile(
      await extractPptxSignature(reversed, { fileName: 'stable.pptx' }),
    );

    expect(stableSerializeSignature(first)).toBe(stableSerializeSignature(replay));
    expect(stableSerializeSignature(first)).toBe(stableSerializeSignature(reordered));
    expect(first.id).toBe(reordered.id);
    expect(first.source.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('contains corrupt ZIP failures at the typed public boundary', async () => {
    const random = await extractPptxSignature(new Uint8Array([1, 3, 3, 7, 0, 255]));
    expect(random).toMatchObject({ ok: false, error: { code: 'invalid_zip' } });

    const valid = await createSignatureFixture();
    const truncated = await extractPptxSignature(valid.subarray(0, valid.byteLength - 12));
    expect(truncated).toMatchObject({ ok: false, error: { code: 'invalid_zip' } });
  });

  it('rejects a valid ZIP without required presentation metadata', async () => {
    const result = await extractPptxSignature(await createZipWithoutPresentation());
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_pptx' } });
  });

  it('rejects lookalike XML namespaces and forged relationship type namespaces', async () => {
    const invalidNamespaces = await extractPptxSignature(
      await createSignatureFixture({ slideCount: 1, invalidOoxmlNamespaces: true }),
    );
    const invalidRelationshipTypes = await extractPptxSignature(
      await createSignatureFixture({
        slideCount: 1,
        invalidRelationshipTypeNamespace: true,
      }),
    );

    expect(invalidNamespaces).toMatchObject({ ok: false, error: { code: 'invalid_pptx' } });
    expect(invalidRelationshipTypes).toMatchObject({
      ok: false,
      error: { code: 'invalid_pptx' },
    });
  });

  it('rejects numeric presentation metadata that could overflow profile serialization', async () => {
    const result = await extractPptxSignature(
      await createSignatureFixture({ slideCount: 0, numericOverflow: true }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_pptx' } });
  });

  it('returns typed unsupported errors for non-PPTX revision-1 inputs', async () => {
    for (const kind of ['pdf', 'screenshot', 'taste_pack'] as const) {
      const result = await extractSignature({ kind, bytes: new Uint8Array([1, 2, 3]) });
      expect(result).toMatchObject({ ok: false, error: { code: 'unsupported_input' } });
    }
  });

  it('returns a low-confidence signature for an empty valid presentation', async () => {
    const profile = successfulProfile(
      await extractPptxSignature(await createSignatureFixture({ slideCount: 0 })),
    );
    expect(profile.layout).toMatchObject({
      slideCount: 0,
      averageShapesPerSlide: 0,
      averageTextRunsPerSlide: 0,
      density: 'unknown',
    });
    expect(profile.usage).toEqual({ colors: [], fonts: [], fontSizes: [] });
    expect(profile.confidence).toBe('low');
    expect(profile.warnings.map((warning) => warning.code)).toContain('empty_deck');
  });

  it('processes 200 slides inside the default budget and rejects the declared 201st before slide scans', async () => {
    const twoHundred = await createSignatureFixture({ slideCount: 200 });
    const startedAt = performance.now();
    const bounded = await extractPptxSignature(twoHundred);
    const elapsedMs = performance.now() - startedAt;
    expect(bounded.ok).toBe(true);
    expect(bounded.diagnostics.slidesProcessed).toBe(200);
    expect(elapsedMs).toBeLessThan(10_000);

    const overLimit = await extractPptxSignature(await createSignatureFixture({ slideCount: 201 }));
    expect(overLimit).toMatchObject({
      ok: false,
      error: { code: 'slide_limit_exceeded' },
      diagnostics: { slidesDeclared: 201, slidesProcessed: 0, partsRead: 1 },
    });
  }, 20_000);

  it('records embedded-font declarations without reading or exposing font bytes or targets', async () => {
    const profile = successfulProfile(
      await extractPptxSignature(await createSignatureFixture({ embeddedFont: true })),
    );
    expect(profile.layout.embeddedFontsPresent).toBe(true);
    expect(profile.layout.embeddedFontFamilies).toEqual(['Embedded Sans']);
    expect(fontValues(profile)).toContain('Embedded Sans');
    const serialized = stableSerializeSignature(profile);
    expect(serialized).not.toContain('.odttf');
    expect(serialized).not.toContain('DEADBEEF');
    expect(serialized).not.toContain('../');
  });

  it('resolves known theme aliases and warns without guessing unknown aliases', async () => {
    const profile = successfulProfile(
      await extractPptxSignature(await createSignatureFixture({ unknownAliases: true })),
    );
    expect(fontValues(profile)).toEqual(expect.arrayContaining(['Body Sans', 'Display Sans']));
    expect(colorValues(profile)).toContain('#112233');
    expect(profile.warnings.map((warning) => warning.code)).toContain('unresolved_alias');
    expect(fontValues(profile)).not.toContain('+unknown-lt');
    expect(colorValues(profile).every((value) => /^#[0-9A-F]{6}$/.test(value))).toBe(true);
  });

  it('drops unsupported color transforms with an explicit warning instead of guessing', async () => {
    const profile = successfulProfile(
      await extractPptxSignature(
        await createSignatureFixture({ slideCount: 1, unsupportedColorTransform: true }),
      ),
    );

    expect(colorValues(profile)).not.toContain('#654321');
    expect(profile.evidence.some((evidence) => evidence.observedValue.includes('#654321'))).toBe(
      false,
    );
    expect(profile.warnings.map((warning) => warning.code)).toContain('unresolved_color');
    expect(profile.confidence).toBe('medium');
  });

  it('preserves alpha-distinct colors as separate tokens and usage values', async () => {
    const profile = successfulProfile(
      await extractPptxSignature(
        await createSignatureFixture({ slideCount: 1, alphaDistinctColors: true }),
      ),
    );
    const tokens = Object.values(profile.tokens.colors).filter(
      (token) => token.$value.hex === '#123456',
    );
    const usage = profile.usage.colors.filter((value) => value.value.startsWith('#123456'));

    expect(tokens).toHaveLength(2);
    expect(tokens.map((token) => token.$value.alpha ?? 1).sort()).toEqual([0.5, 1]);
    expect(tokens.map((token) => token.$extensions['com.nodeslide.signature'].occurrences)).toEqual(
      [1, 1],
    );
    expect(usage).toEqual([
      expect.objectContaining({ value: '#123456', occurrences: 1 }),
      expect.objectContaining({ value: '#123456@0.5', occurrences: 1 }),
    ]);
  });

  it('keeps adversarial XML and archive names bounded, inert, and deterministic', async () => {
    const bytes = await createSignatureFixture({
      duplicateFontSlugs: true,
      entityLikeText: true,
      hugeAttributeLength: 32_000,
      malformedLayout: true,
      pathTraversalEntry: true,
      unsafeLayoutRelationship: true,
    });
    const first = successfulProfile(await extractPptxSignature(bytes));
    const second = successfulProfile(await extractPptxSignature(bytes));

    expect(stableSerializeSignature(first)).toBe(stableSerializeSignature(second));
    expect(Object.keys(first.tokens.fontFamilies)).toEqual(
      expect.arrayContaining(['a-b', 'a-b-2']),
    );
    expect(first.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        'malformed_optional_part',
        'unsafe_archive_entry',
        'unsafe_relationship',
      ]),
    );
    expect(stableSerializeSignature(first)).not.toContain('never expose');
  });

  it('degrades honestly when optional theme, master, and layout evidence is missing', async () => {
    const profile = successfulProfile(
      await extractPptxSignature(
        await createSignatureFixture({
          includeTheme: false,
          includeMaster: false,
          includeLayouts: false,
        }),
      ),
    );
    expect(colorValues(profile)).toEqual(expect.arrayContaining(['#445566', '#ABCDEF']));
    expect(profile.confidence).toBe('medium');
    expect(profile.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['missing_theme', 'missing_master', 'missing_layout']),
    );
  });

  it('produces equal palette/font fingerprints for content variants of one theme', async () => {
    const first = successfulProfile(
      await extractPptxSignature(await createSignatureFixture({ contentLabel: 'Alpha' })),
    );
    const second = successfulProfile(
      await extractPptxSignature(await createSignatureFixture({ contentLabel: 'Beta' })),
    );
    expect(paletteAndFontFingerprint(first)).toBe(paletteAndFontFingerprint(second));
    expect(first.id).not.toBe(second.id);
  });

  it('covers the documented sparse, balanced, and dense classification thresholds', async () => {
    const sparse = successfulProfile(
      await extractPptxSignature(await createSignatureFixture({ slideCount: 1 })),
    );
    const balanced = successfulProfile(
      await extractPptxSignature(
        await createSignatureFixture({ slideCount: 1, extraShapesPerSlide: 5 }),
      ),
    );
    const dense = successfulProfile(
      await extractPptxSignature(
        await createSignatureFixture({ slideCount: 1, extraShapesPerSlide: 14 }),
      ),
    );
    expect(sparse.layout.density).toBe('sparse');
    expect(balanced.layout.density).toBe('balanced');
    expect(dense.layout.density).toBe('dense');
  });

  it('audits the available product-owned golden deck at >=0.90 palette/font recovery', async () => {
    const bytes = new Uint8Array(
      await readFile('docs/dogfood/nodeslide-domain-v1/nodeslide-golden.pptx'),
    );
    const profile = successfulProfile(await extractPptxSignature(bytes));
    const expectedPalette = [
      '#000000',
      '#FFFFFF',
      '#44546A',
      '#E7E6E6',
      '#4472C4',
      '#ED7D31',
      '#A5A5A5',
      '#FFC000',
      '#5B9BD5',
      '#70AD47',
      '#0563C1',
      '#954F72',
    ];
    const expectedFonts = ['Fraunces Variable', 'Geist Variable'];
    const recoveredColors = new Set(colorValues(profile));
    const recoveredFonts = new Set(fontValues(profile));
    const recovered =
      expectedPalette.filter((value) => recoveredColors.has(value)).length +
      expectedFonts.filter((value) => recoveredFonts.has(value)).length;
    const score = recovered / (expectedPalette.length + expectedFonts.length);

    expect(score).toBeGreaterThanOrEqual(0.9);
    expect(profile.layout).toMatchObject({
      slideCount: 7,
      slideWidthInches: 13.333,
      slideHeightInches: 7.5,
      layoutUsage: [{ partName: 'ppt/slideLayouts/slideLayout1.xml', occurrences: 7 }],
    });
  });
});
