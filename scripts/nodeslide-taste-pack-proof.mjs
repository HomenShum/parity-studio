import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(rootDirectory, 'docs', 'dogfood', 'nodeslide-pillars');
const outputPath = path.join(outputDirectory, 'w5-taste-pack-proof.json');
const vite = await createServer({
  appType: 'custom',
  root: rootDirectory,
  server: { hmr: false, middlewareMode: true },
});

try {
  const [{ buildGoldenNodeSlide }, patchModule, applyModule, validationModule, packs] =
    await Promise.all([
      vite.ssrLoadModule('/convex/lib/nodeslideSeed.ts'),
      vite.ssrLoadModule('/shared/nodeslidePatch.ts'),
      vite.ssrLoadModule('/shared/nodeslideSignatureApply.ts'),
      vite.ssrLoadModule('/src/domains/nodeslide/slidelang/validation.ts'),
      vite.ssrLoadModule('/src/domains/nodeslide/signature/packs/index.ts'),
    ]);
  const source = buildGoldenNodeSlide('w5-taste-pack-proof', 1_000).snapshot;
  const packResults = [];
  const citationsByUrl = new Map();

  for (const pack of packs.NODESLIDE_TASTE_PACKS) {
    const structural = packs.validateNodeSlideTastePack(pack);
    assert(structural.ok, `${pack.name} failed W5 validation: ${structural.errors.join('; ')}`);
    const plan = applyModule.planSignatureApplication(source, pack);
    assert(plan.ok, `${pack.name} did not produce an application plan.`);
    const candidate = patchModule.applyDeckPatch(source, {
      baseDeckVersion: plan.plan.baseDeckVersion,
      operations: plan.plan.operations,
      scope: plan.plan.scope,
    }).snapshot;
    const validation = validationModule.validateSnapshot(candidate, { signatureProfile: pack });
    const typographyOrContrastIssues = validation.issues.filter((issue) =>
      ['contrast', 'font_size', 'on_brand_font', 'on_brand_type_scale'].includes(issue.code),
    );
    assert(
      typographyOrContrastIssues.length === 0,
      `${pack.name} retained contrast or font issues.`,
    );
    const rules = pack.$extensions['com.nodeslide.rules'].rules;
    for (const rule of rules) {
      for (const citation of rule.citations) {
        const current = citationsByUrl.get(citation.url) ?? {
          title: citation.title,
          url: citation.url,
          license: citation.license,
          supports: [],
        };
        current.supports.push({ ruleId: rule.id, statement: citation.supports });
        citationsByUrl.set(citation.url, current);
      }
    }
    const metadata = pack.$extensions['com.nodeslide.tastePack'];
    const serialized = packs.NODESLIDE_TASTE_PACK_JSON[metadata.id];
    packResults.push({
      internalId: metadata.id,
      profileId: pack.id,
      userFacingName: pack.name,
      schemaVersion: pack.schemaVersion,
      sourceDigest: pack.source.digest,
      stableSerializationMatches: serialized === packs.stableSerializeJson(pack),
      ruleCount: rules.length,
      evidenceCount: pack.evidence.length,
      authoredLayout: metadata.layout,
      approvedContrastPairs: metadata.approvedContrastPairs,
      fontPolicy: metadata.fontPolicy,
      validation: {
        packOk: structural.ok,
        publishOk: validation.publishOk,
        cleanOk: validation.cleanOk,
        contrastOrFontIssueCount: typographyOrContrastIssues.length,
        onBrandBlockingCount: validation.issues.filter(
          (issue) => issue.code.startsWith('on_brand_') && issue.severity !== 'info',
        ).length,
      },
      nonAffiliation: pack.$extensions['com.nodeslide.rules'].nonAffiliation,
    });
  }

  const citationChecks = await Promise.all(
    [...citationsByUrl.values()].map(async (citation) => ({
      ...citation,
      ...(await checkReachable(citation.url)),
    })),
  );
  for (const citation of citationChecks) {
    assert(citation.reachable, `Citation was not reachable: ${citation.url} (${citation.error})`);
    assert(
      citation.supports.every((support) => support.statement.trim().length > 0),
      `Citation support text was empty: ${citation.url}`,
    );
  }
  assert(
    packResults.every(
      (pack) =>
        pack.stableSerializationMatches &&
        pack.validation.packOk &&
        pack.validation.contrastOrFontIssueCount === 0,
    ),
    'One or more W5 pack gates failed.',
  );

  const proof = {
    generatedAt: new Date().toISOString(),
    sourceDeckId: source.deck.id,
    packs: packResults,
    citations: citationChecks,
    disclaimer:
      'These are independent NodeSlide-authored defaults. They are not certifications, endorsements, or copies of third-party templates or trade dress.',
    gates: {
      bothProfilesParse:
        packResults.length === 2 && packResults.every((pack) => pack.validation.packOk),
      everyRuleCited: packResults.every((pack) => pack.ruleCount > 0) && citationChecks.length > 0,
      everyCitationReachable: citationChecks.every((citation) => citation.reachable),
      zeroContrastOrFontIssues: packResults.every(
        (pack) => pack.validation.contrastOrFontIssueCount === 0,
      ),
      deterministicSerialization: packResults.every((pack) => pack.stableSerializationMatches),
      nonAffiliationRecorded: packResults.every((pack) => pack.nonAffiliation.independent === true),
    },
  };
  assert(Object.values(proof.gates).every(Boolean), 'A W5 proof gate failed.');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ outputPath, proof }, null, 2)}\n`);
} finally {
  await vite.close();
}

async function checkReachable(url) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/html,application/pdf;q=0.9,*/*;q=0.8',
        Range: 'bytes=0-1023',
        'User-Agent': 'NodeSlide-proof/1.0 (+https://github.com/HomenShum/parity-studio)',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    await response.body?.cancel();
    return {
      reachable: response.status >= 200 && response.status < 400,
      status: response.status,
      finalUrl: response.url,
      checkedAt: new Date().toISOString(),
      error: null,
    };
  } catch (error) {
    return {
      reachable: false,
      status: null,
      finalUrl: null,
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
