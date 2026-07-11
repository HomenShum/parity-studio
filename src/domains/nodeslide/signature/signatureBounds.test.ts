import { describe, expect, it } from 'vitest';
import type {
  SignatureExtractionResult,
  SignatureProfile,
} from '../../../../shared/nodeslideSignature';
import { extractPptxSignature } from './extractor';
import { createForgedSizeAggregateFixture, createSignatureFixture } from './signatureFixtures';

function successfulProfile(result: SignatureExtractionResult): SignatureProfile {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected extraction success, received ${result.error.code}.`);
  return result.profile;
}

describe('NodeSlide signature extraction bounds', () => {
  it('enforces the compressed-input cap before opening the ZIP', async () => {
    const bytes = await createSignatureFixture({ slideCount: 1 });
    const result = await extractPptxSignature(bytes, {
      bounds: { maxCompressedBytes: bytes.byteLength - 1 },
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'input_too_large' },
      diagnostics: { zipEntries: 0, partsRead: 0 },
    });
  });

  it('enforces the central-directory entry cap before inflation', async () => {
    const result = await extractPptxSignature(await createSignatureFixture({ slideCount: 1 }), {
      bounds: { maxZipEntries: 2 },
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'archive_too_large' },
      diagnostics: { partsRead: 0 },
    });
  });

  it('enforces aggregate XML bytes across otherwise valid parts', async () => {
    const result = await extractPptxSignature(await createSignatureFixture({ slideCount: 1 }), {
      bounds: { maxAggregateXmlBytes: 1_200 },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'archive_too_large' } });
  });

  it('charges forged oversized optional inflations against the aggregate XML budget', async () => {
    const fixture = await createForgedSizeAggregateFixture();
    expect(fixture.actualOptionalXmlBytes).toBeGreaterThan(4_096);

    const result = await extractPptxSignature(fixture.bytes, {
      bounds: { maxXmlPartBytes: 1_024, maxAggregateXmlBytes: 4_096 },
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'archive_too_large' } });
    expect(result.diagnostics.xmlBytesRead).toBeGreaterThan(1_024);
  });

  it('skips an oversized optional XML part with a warning', async () => {
    const result = await extractPptxSignature(
      await createSignatureFixture({ slideCount: 1, themePaddingLength: 8_000 }),
      { bounds: { maxXmlPartBytes: 4_000 } },
    );
    const profile = successfulProfile(result);
    expect(profile.warnings.map((warning) => warning.code)).toContain('part_too_large');
    expect(profile.tokens.colors).not.toEqual({});
  });

  it('fails when the required presentation part exceeds the single-part cap', async () => {
    const result = await extractPptxSignature(await createSignatureFixture({ slideCount: 1 }), {
      bounds: { maxXmlPartBytes: 100 },
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid_pptx' },
      diagnostics: { warningCodes: expect.arrayContaining(['part_too_large']) },
    });
  });

  it('retains highest-value evidence and usage values at deterministic configured caps', async () => {
    const bytes = await createSignatureFixture({ slideCount: 5, variedUsage: true });
    const options = {
      bounds: { maxEvidenceRecords: 2, maxUsageValuesPerCategory: 1 },
    } as const;
    const firstResult = await extractPptxSignature(bytes, options);
    const secondResult = await extractPptxSignature(bytes, options);
    const first = successfulProfile(firstResult);
    const second = successfulProfile(secondResult);

    expect(first.evidence).toHaveLength(2);
    expect(first.usage.colors.length).toBeLessThanOrEqual(1);
    expect(first.usage.fonts.length).toBeLessThanOrEqual(1);
    expect(first.usage.fontSizes.length).toBeLessThanOrEqual(1);
    expect(first.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['evidence_truncated', 'usage_truncated']),
    );
    expect(first.evidence).toEqual(second.evidence);
    expect(first.usage).toEqual(second.usage);
  });

  it('bounds token output to retained evidence under adversarial distinct-value input', async () => {
    const bytes = await createSignatureFixture({ slideCount: 1, distinctFontsPerSlide: 10_000 });
    const options = {
      bounds: { maxEvidenceRecords: 16, maxUsageValuesPerCategory: 4 },
    } as const;
    const first = successfulProfile(await extractPptxSignature(bytes, options));
    const second = successfulProfile(await extractPptxSignature(bytes, options));
    const tokens = [
      ...Object.values(first.tokens.colors),
      ...Object.values(first.tokens.fontFamilies),
      ...Object.values(first.tokens.fontSizes),
    ];
    const evidenceIds = new Set(first.evidence.map((evidence) => evidence.id));

    expect(first.evidence).toHaveLength(16);
    expect(tokens.length).toBeLessThanOrEqual(first.evidence.length);
    expect(
      tokens.every((token) => {
        const ids = token.$extensions['com.nodeslide.signature'].evidenceIds;
        return ids.length > 0 && ids.every((id) => evidenceIds.has(id));
      }),
    ).toBe(true);
    expect(first.usage.fonts).toHaveLength(4);
    expect(first.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(['evidence_truncated', 'usage_truncated']),
    );
    expect(first.confidence).toBe('medium');
    expect(first.tokens).toEqual(second.tokens);
    expect(first.evidence).toEqual(second.evidence);
  });

  it('returns a cooperative timeout without throwing', async () => {
    const result = await extractPptxSignature(await createSignatureFixture({ slideCount: 1 }), {
      bounds: { timeoutMs: 0 },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'timeout' } });
  });

  it('rechecks the deadline after profile assembly before returning success', async () => {
    const bytes = await createSignatureFixture({ slideCount: 1 });
    const ownDescriptor = Object.getOwnPropertyDescriptor(performance, 'now');
    const originalNow = performance.now.bind(performance);
    const restoreNow = (): void => {
      if (ownDescriptor) Object.defineProperty(performance, 'now', ownDescriptor);
      else Reflect.deleteProperty(performance, 'now');
    };

    let baselineCalls = 0;
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => {
        baselineCalls += 1;
        return originalNow();
      },
    });
    try {
      expect((await extractPptxSignature(bytes)).ok).toBe(true);
    } finally {
      restoreNow();
    }

    let replayCalls = 0;
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => {
        replayCalls += 1;
        return replayCalls >= baselineCalls - 1 ? 20_000 : 0;
      },
    });
    try {
      const result = await extractPptxSignature(bytes, { bounds: { timeoutMs: 10_000 } });
      expect(result).toMatchObject({ ok: false, error: { code: 'timeout' } });
      expect(result.diagnostics.elapsedMs).toBe(20_000);
    } finally {
      restoreNow();
    }
  });
});
