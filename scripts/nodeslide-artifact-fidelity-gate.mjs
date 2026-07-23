/**
 * Semantic fidelity gate — does each emitted artifact carry the CONTENT its spec asked for?
 *
 * The topology gate proves an artifact of the right kind exists. This proves it holds the right
 * values. Both are needed: a chart part with the wrong series passes topology perfectly.
 *
 * Every checked artifact also gets a mutation probe: the expectation is perturbed and the
 * comparator must reject it. A fidelity check that cannot fail is not a check.
 *
 * Usage:
 *   node scripts/nodeslide-artifact-fidelity-gate.mjs --pptx <deck.pptx> --atlas <atlas.json>
 *                                                     --fixtures <slide-map.json> [--json]
 * Exit 1 on any content mismatch or any probe the comparator failed to catch.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import {
  compareFidelity,
  expectedContent,
  extractChartContent,
  extractDiagramContent,
  extractTableContent,
  extractTimelineContent,
  mutationProbe,
} from './lib/artifact-fidelity.mjs';

function parseArgs(argv) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.set(token.slice(2), true);
      continue;
    }
    flags.set(token.slice(2), next);
    i += 1;
  }
  return flags;
}

const readJson = async (f) =>
  JSON.parse((await readFile(path.resolve(f), 'utf8')).replace(/^﻿/, ''));

const flags = parseArgs(process.argv.slice(2));
const pptxPath = flags.get('pptx');
const atlasPath = flags.get('atlas');
const fixturesPath = flags.get('fixtures');
if ([pptxPath, atlasPath, fixturesPath].some((v) => typeof v !== 'string')) {
  process.stderr.write('--pptx, --atlas and --fixtures are required.\n');
  process.exit(1);
}

const zip = await JSZip.loadAsync(await readFile(path.resolve(pptxPath)));
const atlas = await readJson(atlasPath);
const slideMap = await readJson(fixturesPath);

/**
 * Declared payload overrides, applied over the upstream Atlas spec before the diff.
 *
 * Some archetypes share one stub payload upstream, so the live deck declares its own. Those
 * declarations are a committed file, NOT something the compiler emits — if the answer key came
 * out of the same build, this gate would only ever confirm itself.
 */
const overrides =
  typeof flags.get('overrides') === 'string'
    ? ((await readJson(flags.get('overrides'))).overrides ?? {})
    : {};

// Slide order in the emitted deck matches the fixtures doc order (both come from the compiler).
const fixtureByTitle = new Map(
  atlas.fixtures.map((f) => [String(f.title).trim().toLowerCase(), f]),
);
const slidePaths = Object.keys(zip.files)
  .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
  .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));

/** slide number -> its chart part, via the slide rels. */
async function chartXmlForSlide(slidePath) {
  const relsPath = slidePath.replace(/slides\/(slide\d+)\.xml$/, 'slides/_rels/$1.xml.rels');
  const relsFile = zip.file(relsPath);
  if (!relsFile) return null;
  const rels = await relsFile.async('string');
  const match = rels.match(/Target="([^"]*charts?\/chart\d*\.xml)"/i);
  if (!match) return null;
  const target = match[1].replace(/^\.\.\//, '').replace(/^\//, '');
  const file = zip.file(target.startsWith('ppt/') ? target : `ppt/${target}`);
  return file ? file.async('string') : null;
}

const results = [];
for (const entry of slideMap.fixtures ?? []) {
  const upstream = fixtureByTitle.get(String(entry.title).trim().toLowerCase());
  if (!upstream) continue;
  const override = overrides[entry.artifactType];
  const fixture = override
    ? { ...upstream, artifactSpec: { ...upstream.artifactSpec, payload: override } }
    : upstream;
  const expected = expectedContent(fixture);
  const slidePath = slidePaths[Number(entry.number) - 1];
  if (!slidePath) continue;

  const slideXml = await zip.file(slidePath).async('string');
  let observed = {};
  if (expected.kind === 'chart') {
    const chartXml = await chartXmlForSlide(slidePath);
    // Also read any table on the slide: an archetype may have routed this payload into a grid,
    // and the values still have to be there.
    observed = {
      ...(chartXml ? extractChartContent(chartXml) : { series: [] }),
      ...extractTableContent(slideXml),
    };
  } else if (expected.kind === 'timeline') {
    const chartXml = await chartXmlForSlide(slidePath);
    observed = chartXml ? extractTimelineContent(chartXml) : { serials: [] };
  } else if (expected.kind === 'diagram') {
    observed = extractDiagramContent(slideXml);
  } else {
    observed = extractTableContent(slideXml);
  }

  const comparison = compareFidelity(expected, observed);
  const probe =
    comparison.verdict === 'pass'
      ? mutationProbe(expected, observed)
      : { ran: false, caught: false, detail: 'skipped (already failing)' };
  results.push({
    slide: Number(entry.number),
    title: entry.title,
    artifactType: fixture.artifactType,
    kind: expected.kind,
    ...comparison,
    probe,
  });
}

const checked = results.filter((r) => r.verdict !== 'not-checked');
const failed = checked.filter((r) => r.verdict === 'fail');
const blindProbes = checked.filter((r) => r.probe.ran && !r.probe.caught);

if (flags.get('json') === true) {
  process.stdout.write(
    `${JSON.stringify({ results, failed: failed.length, blindProbes: blindProbes.length }, null, 2)}\n`,
  );
} else {
  const lines = [
    `Artifact fidelity gate — ${path.basename(pptxPath)}`,
    `  artifacts     ${results.length}`,
    `  checked       ${checked.length} (content diffed against the spec that produced it)`,
    `  matched       ${checked.filter((r) => r.verdict === 'pass').length}`,
    `  mismatched    ${failed.length}`,
    `  not-checked   ${results.length - checked.length} (no extractor for this kind — NOT a pass)`,
    `  probes caught ${checked.filter((r) => r.probe.caught).length}/${checked.filter((r) => r.probe.ran).length} perturbed specs`,
  ];
  for (const r of failed) {
    lines.push('', `  MISMATCH slide ${r.slide} "${r.artifactType}" (${r.kind})`);
    for (const m of r.mismatches) lines.push(`    ${m}`);
  }
  for (const r of blindProbes) {
    lines.push('', `  BLIND PROBE slide ${r.slide} "${r.artifactType}" — ${r.probe.detail}`);
  }
  if (failed.length === 0 && blindProbes.length === 0) {
    lines.push('', '  Every checked artifact carries the values its spec asked for, and every');
    lines.push('  perturbed spec was rejected — the check can actually fail.');
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

process.exit(failed.length > 0 || blindProbes.length > 0 ? 1 : 0);
