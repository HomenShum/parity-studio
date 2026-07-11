import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, '..');
const inputPath = path.join(
  rootDirectory,
  'docs',
  'dogfood',
  'nodeslide-domain-v1',
  'nodeslide-golden.pptx',
);
const outputDirectory = path.join(rootDirectory, 'docs', 'dogfood', 'nodeslide-pillars');
const outputPath = path.join(outputDirectory, 'w1-signature-proof.json');

const vite = await createServer({
  appType: 'custom',
  root: rootDirectory,
  server: { hmr: false, middlewareMode: true },
});
const originalFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls += 1;
  throw new Error('The W1 proof forbids network access.');
};

try {
  const extractor = await vite.ssrLoadModule('/src/domains/nodeslide/signature/index.ts');
  const fixtures = await vite.ssrLoadModule(
    '/src/domains/nodeslide/signature/signatureFixtures.ts',
  );
  const input = new Uint8Array(await readFile(inputPath));
  const first = await extractor.extractPptxSignature(input, {
    fileName: 'nodeslide-golden.pptx',
  });
  const replay = await extractor.extractPptxSignature(input, {
    fileName: 'nodeslide-golden.pptx',
  });
  assert(first.ok && replay.ok, 'Golden signature extraction failed.');

  const corrupt = await extractor.extractPptxSignature(
    new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xde, 0xad, 0xbe, 0xef]),
  );
  const unsupported = await extractor.extractSignature({
    kind: 'pdf',
    bytes: new Uint8Array([1, 2, 3]),
  });
  const invalidPptx = await extractor.extractPptxSignature(
    await fixtures.createZipWithoutPresentation(),
  );
  const compressedBound = await extractor.extractPptxSignature(input, {
    bounds: { maxCompressedBytes: input.byteLength - 1 },
  });
  const entryBound = await extractor.extractPptxSignature(input, {
    bounds: { maxZipEntries: 0 },
  });
  const aggregateBound = await extractor.extractPptxSignature(input, {
    bounds: { maxAggregateXmlBytes: 1 },
  });
  const partBound = await extractor.extractPptxSignature(input, {
    bounds: { maxXmlPartBytes: 1 },
  });

  const tokenBoundInput = await fixtures.createSignatureFixture({
    slideCount: 1,
    distinctFontsPerSlide: 3_000,
  });
  const retainedBounds = await extractor.extractPptxSignature(tokenBoundInput, {
    bounds: { maxEvidenceRecords: 16, maxUsageValuesPerCategory: 4 },
  });
  const forgedFixture = await fixtures.createForgedSizeAggregateFixture();
  const forgedAggregate = await extractor.extractPptxSignature(forgedFixture.bytes, {
    bounds: { maxXmlPartBytes: 1_024, maxAggregateXmlBytes: 4_096 },
  });
  const slideBound = await extractor.extractPptxSignature(
    await fixtures.createSignatureFixture({ slideCount: 201 }),
  );
  const timeoutAtStart = await extractor.extractPptxSignature(input, {
    bounds: { timeoutMs: 0 },
  });
  const postAssemblyTimeout = await measurePostAssemblyTimeout(extractor, input);

  const invalidNamespaces = await extractor.extractPptxSignature(
    await fixtures.createSignatureFixture({ slideCount: 1, invalidOoxmlNamespaces: true }),
  );
  const invalidRelationshipTypes = await extractor.extractPptxSignature(
    await fixtures.createSignatureFixture({
      slideCount: 1,
      invalidRelationshipTypeNamespace: true,
    }),
  );
  const numericOverflow = await extractor.extractPptxSignature(
    await fixtures.createSignatureFixture({ slideCount: 0, numericOverflow: true }),
  );
  const unsupportedTransform = await extractor.extractPptxSignature(
    await fixtures.createSignatureFixture({
      slideCount: 1,
      unsupportedColorTransform: true,
    }),
  );
  const alphaDistinct = await extractor.extractPptxSignature(
    await fixtures.createSignatureFixture({ slideCount: 1, alphaDistinctColors: true }),
  );
  const unsafeRelationship = await extractor.extractPptxSignature(
    await fixtures.createSignatureFixture({ slideCount: 1, unsafeLayoutRelationship: true }),
  );

  const twoHundredBytes = await fixtures.createSignatureFixture({ slideCount: 200 });
  const twoHundredStartedAt = performance.now();
  const twoHundred = await extractor.extractPptxSignature(twoHundredBytes);
  const twoHundredWallClockMs = performance.now() - twoHundredStartedAt;

  const orderedFixture = await fixtures.createSignatureFixture({
    slideCount: 3,
    contentLabel: 'Proof determinism',
  });
  const reorderedFixture = await fixtures.createSignatureFixture({
    slideCount: 3,
    contentLabel: 'Proof determinism',
    reverseEntryOrder: true,
  });
  const ordered = await extractor.extractPptxSignature(orderedFixture, {
    fileName: 'proof-determinism.pptx',
  });
  const reordered = await extractor.extractPptxSignature(reorderedFixture, {
    fileName: 'proof-determinism.pptx',
  });

  const profile = first.profile;
  const warningCodes = profile.warnings.map((warning) => warning.code);
  const retainedProfile = retainedBounds.ok ? retainedBounds.profile : undefined;
  const retainedTokens = retainedProfile ? allTokens(retainedProfile) : [];
  const retainedEvidenceIds = new Set(
    retainedProfile?.evidence.map((evidence) => evidence.id) ?? [],
  );
  const unsupportedProfile = unsupportedTransform.ok ? unsupportedTransform.profile : undefined;
  const alphaProfile = alphaDistinct.ok ? alphaDistinct.profile : undefined;
  const alphaTokens =
    alphaProfile?.tokens.colors === undefined
      ? []
      : Object.values(alphaProfile.tokens.colors).filter((token) => token.$value.hex === '#123456');

  const reliability = {
    BOUND:
      isError(entryBound, 'archive_too_large') &&
      isError(aggregateBound, 'archive_too_large') &&
      isError(forgedAggregate, 'archive_too_large') &&
      isError(slideBound, 'slide_limit_exceeded') &&
      partBound.diagnostics.warningCodes.includes('part_too_large') &&
      retainedBounds.ok &&
      retainedBounds.profile.evidence.length === 16 &&
      retainedTokens.length <= retainedBounds.profile.evidence.length &&
      retainedBounds.profile.usage.colors.length <= 4 &&
      retainedBounds.profile.usage.fonts.length <= 4 &&
      retainedBounds.profile.usage.fontSizes.length <= 4 &&
      retainedBounds.profile.warnings.some((warning) => warning.code === 'evidence_truncated') &&
      retainedBounds.profile.warnings.some((warning) => warning.code === 'usage_truncated'),
    HONEST_STATUS:
      isError(corrupt, 'invalid_zip') &&
      isError(invalidPptx, 'invalid_pptx') &&
      isError(unsupported, 'unsupported_input') &&
      isError(invalidNamespaces, 'invalid_pptx') &&
      isError(invalidRelationshipTypes, 'invalid_pptx') &&
      isError(numericOverflow, 'invalid_pptx'),
    HONEST_SCORES:
      evidenceConfidenceIsBounded(profile) &&
      allTokens(profile).every((token) =>
        token.$extensions['com.nodeslide.signature'].evidenceIds.every((id) =>
          profile.evidence.some((evidence) => evidence.id === id),
        ),
      ) &&
      retainedTokens.every((token) => {
        const ids = token.$extensions['com.nodeslide.signature'].evidenceIds;
        return ids.length > 0 && ids.every((id) => retainedEvidenceIds.has(id));
      }) &&
      retainedProfile?.confidence === 'medium' &&
      Boolean(
        unsupportedProfile?.warnings.some((warning) => warning.code === 'unresolved_color'),
      ) &&
      !unsupportedProfile?.evidence.some((evidence) =>
        evidence.observedValue.includes('#654321'),
      ) &&
      alphaTokens.length === 2 &&
      alphaTokens
        .map((token) => token.$value.alpha ?? 1)
        .sort()
        .join(',') === '0.5,1',
    TIMEOUT:
      isError(timeoutAtStart, 'timeout') &&
      isError(postAssemblyTimeout.result, 'timeout') &&
      postAssemblyTimeout.result.diagnostics.elapsedMs >
        postAssemblyTimeout.result.diagnostics.bounds.timeoutMs &&
      twoHundred.ok &&
      twoHundred.diagnostics.slidesProcessed === 200 &&
      twoHundredWallClockMs < 10_000,
    SSRF:
      unsafeRelationship.ok &&
      unsafeRelationship.profile.warnings.some(
        (warning) => warning.code === 'unsafe_relationship',
      ) &&
      fetchCalls === 0,
    BOUND_READ:
      isError(compressedBound, 'input_too_large') &&
      isError(aggregateBound, 'archive_too_large') &&
      isError(forgedAggregate, 'archive_too_large') &&
      forgedAggregate.diagnostics.xmlBytesRead > 1_024 &&
      partBound.diagnostics.warningCodes.includes('part_too_large'),
    ERROR_BOUNDARY: isError(corrupt, 'invalid_zip'),
    DETERMINISTIC:
      profile.id === replay.profile.id &&
      extractor.stableSerializeSignature(profile) ===
        extractor.stableSerializeSignature(replay.profile) &&
      ordered.ok &&
      reordered.ok &&
      ordered.profile.id === reordered.profile.id &&
      extractor.stableSerializeSignature(ordered.profile) ===
        extractor.stableSerializeSignature(reordered.profile),
  };
  assert(Object.values(reliability).every(Boolean), 'One or more W1 reliability checks failed.');

  const proof = {
    generatedAt: new Date().toISOString(),
    input: {
      fileName: 'nodeslide-golden.pptx',
      bytes: input.byteLength,
      digestSha256: createHash('sha256').update(input).digest('hex'),
      canonicalSourceDigest: profile.source.digest,
      extractorSchemaVersion: profile.schemaVersion,
    },
    extraction: {
      elapsedMilliseconds: first.diagnostics.elapsedMs,
      bounds: first.diagnostics.bounds,
      zipEntries: first.diagnostics.zipEntries,
      xmlBytesRead: first.diagnostics.xmlBytesRead,
      partsRead: first.diagnostics.partsRead,
      slidesProcessed: first.diagnostics.slidesProcessed,
    },
    timing200Slides: {
      extractorElapsedMilliseconds: twoHundred.ok ? twoHundred.diagnostics.elapsedMs : null,
      wallClockMilliseconds: round(twoHundredWallClockMs, 3),
      budgetMilliseconds: 10_000,
      slidesProcessed: twoHundred.diagnostics.slidesProcessed,
      insideDefaultBudget:
        twoHundred.ok &&
        twoHundred.diagnostics.slidesProcessed === 200 &&
        twoHundredWallClockMs < 10_000,
    },
    recovered: {
      palette: [
        ...new Set(Object.values(profile.tokens.colors).map((token) => token.$value.hex)),
      ].sort(),
      fontFamilies: [
        ...new Set(Object.values(profile.tokens.fontFamilies).flatMap((token) => token.$value)),
      ].sort(),
    },
    layout: profile.layout,
    warningCodes,
    deterministicReplayEqual: reliability.DETERMINISTIC,
    hostileFixture: {
      kind: 'forged-size-and-invalid-ooxml-suite',
      forgedEntries: forgedFixture.forgedEntries,
      actualOptionalXmlBytes: forgedFixture.actualOptionalXmlBytes,
      aggregateLimitBytes: 4_096,
      forgedSizeTypedError: forgedAggregate.ok ? null : forgedAggregate.error.code,
      invalidNamespaceTypedError: invalidNamespaces.ok ? null : invalidNamespaces.error.code,
      invalidRelationshipTypeError: invalidRelationshipTypes.ok
        ? null
        : invalidRelationshipTypes.error.code,
      numericOverflowTypedError: numericOverflow.ok ? null : numericOverflow.error.code,
      throwEscaped: false,
    },
    measurements: {
      evidenceCap: retainedBounds.ok
        ? {
            configured: 16,
            retained: retainedBounds.profile.evidence.length,
            emittedTokens: retainedTokens.length,
            tokenEvidenceLinksValid: retainedTokens.every((token) => {
              const ids = token.$extensions['com.nodeslide.signature'].evidenceIds;
              return ids.length > 0 && ids.every((id) => retainedEvidenceIds.has(id));
            }),
          }
        : null,
      postAssemblyTimeout: {
        baselineClockCalls: postAssemblyTimeout.baselineClockCalls,
        replayClockCalls: postAssemblyTimeout.replayClockCalls,
        typedError: postAssemblyTimeout.result.ok ? null : postAssemblyTimeout.result.error.code,
        elapsedMilliseconds: postAssemblyTimeout.result.diagnostics.elapsedMs,
        budgetMilliseconds: postAssemblyTimeout.result.diagnostics.bounds.timeoutMs,
      },
      unsupportedTransform: {
        warningEmitted: Boolean(
          unsupportedProfile?.warnings.some((warning) => warning.code === 'unresolved_color'),
        ),
        guessedColorEmitted: Boolean(
          unsupportedProfile?.evidence.some((evidence) =>
            evidence.observedValue.includes('#654321'),
          ),
        ),
      },
      alphaDistinct: {
        tokens: alphaTokens.map((token) => ({
          hex: token.$value.hex,
          alpha: token.$value.alpha ?? 1,
        })),
      },
      fetchCalls,
    },
    reliability,
  };

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ outputPath, proof }, null, 2)}\n`);
} finally {
  globalThis.fetch = originalFetch;
  await vite.close();
}

function allTokens(profile) {
  return [
    ...Object.values(profile.tokens.colors),
    ...Object.values(profile.tokens.fontFamilies),
    ...Object.values(profile.tokens.fontSizes),
  ];
}

function evidenceConfidenceIsBounded(profile) {
  return profile.evidence.every(
    (evidence) =>
      Number.isFinite(evidence.confidence) && evidence.confidence >= 0 && evidence.confidence <= 1,
  );
}

async function measurePostAssemblyTimeout(extractor, input) {
  const ownDescriptor = Object.getOwnPropertyDescriptor(performance, 'now');
  const originalNow = performance.now.bind(performance);
  const restoreNow = () => {
    if (ownDescriptor) Object.defineProperty(performance, 'now', ownDescriptor);
    else Reflect.deleteProperty(performance, 'now');
  };

  let baselineClockCalls = 0;
  Object.defineProperty(performance, 'now', {
    configurable: true,
    value: () => {
      baselineClockCalls += 1;
      return originalNow();
    },
  });
  let baseline;
  try {
    baseline = await extractor.extractPptxSignature(input);
  } finally {
    restoreNow();
  }
  assert(baseline.ok, 'Post-assembly timeout baseline failed.');

  let replayClockCalls = 0;
  Object.defineProperty(performance, 'now', {
    configurable: true,
    value: () => {
      replayClockCalls += 1;
      return replayClockCalls >= baselineClockCalls - 1 ? 20_000 : 0;
    },
  });
  let result;
  try {
    result = await extractor.extractPptxSignature(input, { bounds: { timeoutMs: 10_000 } });
  } finally {
    restoreNow();
  }
  return { result, baselineClockCalls, replayClockCalls };
}

function isError(result, code) {
  return !result.ok && result.error.code === code;
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
