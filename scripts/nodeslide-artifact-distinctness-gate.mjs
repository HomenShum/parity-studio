/**
 * Deck-level distinctness gate — is the archetype taxonomy real at the pixel level?
 *
 * The topology gate proves an artifact of the right KIND is present. The fidelity gate proves it
 * holds the right VALUES for its own spec. Neither can see that three archetypes emitted the same
 * artifact, because both judge one slide at a time and distinctness is a property of the set.
 *
 * This reads the whole deck at once. It is the gate that would have caught the shipped deck in
 * which DATA.KPI-STRIP, DATA.MULTI-SERIES and DATA.FUNNEL were the byte-identical two-bar
 * "series-1" placeholder while every per-slide check reported 38/38.
 *
 * Usage:
 *   node scripts/nodeslide-artifact-distinctness-gate.mjs --pptx <deck.pptx>
 *                                                        --fixtures <slide-map.json> [--json]
 * Exit 1 on any collapse, surviving placeholder, or degenerate slide.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { evaluateDistinctness } from './lib/artifact-distinctness.mjs';
import {
  extractChartContent,
  extractDiagramContent,
  extractTableContent,
  extractTimelineContent,
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
const fixturesPath = flags.get('fixtures');
if ([pptxPath, fixturesPath].some((v) => typeof v !== 'string')) {
  process.stderr.write('--pptx and --fixtures are required.\n');
  process.exit(1);
}

const zip = await JSZip.loadAsync(await readFile(path.resolve(pptxPath)));
const slideMap = await readJson(fixturesPath);
const slidePaths = Object.keys(zip.files)
  .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
  .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));

async function chartXmlForSlide(slidePath) {
  const relsPath = slidePath.replace(/slides\/(slide\d+)\.xml$/, 'slides/_rels/$1.xml.rels');
  const relsFile = zip.file(relsPath);
  if (!relsFile) return null;
  const rels = await relsFile.async('string');
  const match = rels.match(/Target="([^"]*charts?\/chart\d*\.xml)"/i);
  if (!match) return null;
  // Rel targets may be absolute ('/ppt/charts/x.xml') or relative ('../charts/x.xml').
  const target = match[1].replace(/^\.\.\//, '').replace(/^\//, '');
  const file = zip.file(target.startsWith('ppt/') ? target : `ppt/${target}`);
  return file ? file.async('string') : null;
}

/** Text bodies on the slide, longest last, so the title/body split does not depend on shape order. */
function textBodies(slideXml) {
  const bodies = [];
  for (const sp of slideXml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) ?? []) {
    const text = [...sp.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map((m) => m[1])
      .join('')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
    if (text.length === 0) continue;
    bodies.push({ text, isTitle: /<p:ph[^>]*type="(ctr)?[Tt]itle"/.test(sp) });
  }
  return bodies;
}

/** The equation's own text, so an OMML shape that lost its maths reports as empty, not absent. */
function equationText(slideXml) {
  const omml = slideXml.match(/<m:oMath[\s\S]*?<\/m:oMath>/g) ?? [];
  return omml
    .flatMap((block) => [...block.matchAll(/<m:t>([\s\S]*?)<\/m:t>/g)].map((m) => m[1]))
    .join('')
    .trim();
}

const entries = [];
for (const entry of slideMap.fixtures ?? []) {
  const slideNumber = Number(entry.number);
  const slidePath = slidePaths[slideNumber - 1];
  if (!slidePath) continue;
  const slideXml = await zip.file(slidePath).async('string');
  const chartXml = await chartXmlForSlide(slidePath);

  // Kind is read from the emitted bytes, not from the fixture's claim about itself: a slide that
  // declared a chart and emitted nothing must be judged on what it emitted.
  let kind = null;
  let content = null;
  if (chartXml && /<c:dateAx>/.test(chartXml)) {
    kind = 'timeline';
    content = extractTimelineContent(chartXml);
  } else if (chartXml) {
    kind = 'chart';
    content = extractChartContent(chartXml);
  } else if (/<a:tbl\b/.test(slideXml)) {
    kind = 'table';
    content = extractTableContent(slideXml);
  } else if (/<p:cxnSp>/.test(slideXml)) {
    kind = 'diagram';
    content = extractDiagramContent(slideXml);
  } else if (/<m:oMath/.test(slideXml)) {
    kind = 'equation';
    content = { text: equationText(slideXml) };
  } else {
    kind = 'text';
  }

  const bodies = textBodies(slideXml);
  entries.push({
    slide: slideNumber,
    archetypeId: entry.archetypeId ?? entry.artifactType ?? `slide-${slideNumber}`,
    kind,
    content,
    title: (bodies.find((b) => b.isTitle) ?? bodies[0])?.text ?? entry.title ?? '',
    // Hand over every text body and let the gate find a repeat. Which shape is "the title" is the
    // emitter's business and it does not mark one; the reader just sees the same sentence twice.
    textBodies: bodies.map((b) => b.text),
  });
}

const result = evaluateDistinctness(entries);

if (flags.get('json') === true) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  const count = (check) => result.findings.filter((f) => f.check === check);
  const lines = [
    `Artifact distinctness gate — ${path.basename(pptxPath)}`,
    `  slides              ${result.slidesChecked}`,
    `  distinct artifacts  ${result.distinctArtifacts}`,
    `  collapsed           ${count('collapse').length} (two archetypes, one artifact)`,
    `  placeholders        ${count('placeholder').length} (fixture stub reached a real slide)`,
    `  degenerate          ${count('degenerate').length} (empty artifact, or body repeats title)`,
  ];
  for (const finding of result.findings) {
    lines.push('', `  ${finding.check.toUpperCase()} ${finding.detail}`);
  }
  if (result.findings.length === 0) {
    lines.push('', '  Every archetype in this deck emits content no other archetype emits.');
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

process.exit(result.verdict === 'pass' ? 0 : 1);
