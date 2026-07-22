/**
 * Deep PPTX inspection.
 *
 * Reads the OOXML inside a .pptx and reports, per slide, the artifact kinds that are *directly
 * observable* in the markup — rather than inferring them from shape counts.
 *
 * Detection is by namespaced element name. That is sound for presence/absence: OOXML escapes all
 * text content, so a literal `<m:oMath` can never appear inside a run of prose.
 *
 *   <m:oMath>        real equation (OMML)            -> equation
 *   <a:tbl>          real table grid                 -> table
 *   <p:graphicFrame> + chart relationship            -> chart   (native, editable)
 *   <p:cxnSp>        connector between shapes        -> diagram (a genuine relationship, not just boxes)
 *   <p:pic>          picture; alt text classifies it -> screenshot | media
 *   monospace run    <a:latin typeface="Consolas">   -> code
 *
 * Kinds it still cannot decide are omitted, never guessed. `scrollytelling` is deliberately
 * absent: scroll-driven scenes do not exist in PowerPoint at all, so a PPTX can never evidence one.
 *
 * Usage:
 *   node scripts/nodeslide-pptx-inspect.mjs --pptx <file.pptx> [--out <file.ndjson>] [--json]
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

const MONOSPACE_FACES = [
  'consolas',
  'courier',
  'courier new',
  'menlo',
  'monaco',
  'roboto mono',
  'jetbrains mono',
  'source code pro',
  'sf mono',
  'ibm plex mono',
  'dejavu sans mono',
  'liberation mono',
  'cascadia code',
  'cascadia mono',
  'fira code',
  'fira mono',
  'ubuntu mono',
];

const SCREENSHOT_ALT_HINTS = [
  'screenshot',
  'screen capture',
  'ui capture',
  'app screen',
  'browser render',
  'pptx render',
  'render of',
];

/** Slide XML paths sort lexically, which puts slide10 before slide2. Sort by the trailing number. */
export function slideNumberFromPath(entryPath) {
  const match = /slide(\d+)\.xml$/i.exec(entryPath);
  return match ? Number.parseInt(match[1], 10) : Number.NaN;
}

function decodeXmlEntities(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Visible text, used only to recover a slide title. Never used to infer an artifact kind. */
export function slideTextRuns(xml) {
  const runs = [];
  const pattern = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
  let match = pattern.exec(xml);
  while (match !== null) {
    const text = decodeXmlEntities(match[1]).trim();
    if (text) runs.push(text);
    match = pattern.exec(xml);
  }
  return runs;
}

export function pictureAltTexts(xml) {
  const alts = [];
  const picPattern = /<p:pic\b[\s\S]*?<\/p:pic>/g;
  let pic = picPattern.exec(xml);
  while (pic !== null) {
    const descr = /<p:cNvPr\b[^>]*\bdescr="([^"]*)"/.exec(pic[0]);
    const title = /<p:cNvPr\b[^>]*\bname="([^"]*)"/.exec(pic[0]);
    alts.push(decodeXmlEntities(descr?.[1] ?? title?.[1] ?? ''));
    pic = picPattern.exec(xml);
  }
  return alts;
}

export function monospaceFacesUsed(xml) {
  const faces = new Set();
  const pattern = /<a:(?:latin|cs|ea)\b[^>]*\btypeface="([^"]*)"/g;
  let match = pattern.exec(xml);
  while (match !== null) {
    const face = decodeXmlEntities(match[1]).trim().toLowerCase();
    if (MONOSPACE_FACES.some((mono) => face === mono || face.includes(mono))) faces.add(face);
    match = pattern.exec(xml);
  }
  return [...faces].sort();
}

function countMatches(xml, pattern) {
  const matches = xml.match(pattern);
  return matches ? matches.length : 0;
}

/**
 * Observe one slide. Returns the artifact kinds the markup directly evidences, each with the
 * signal that justified it, so a reviewer can check the claim rather than trust it.
 */
export function observeSlideXml(xml, { hasChartRelationship = false } = {}) {
  const evidence = [];
  const kinds = new Set();

  const textRuns = countMatches(xml, /<a:t(?:\s[^>]*)?>/g);
  if (textRuns > 0) {
    kinds.add('text');
    evidence.push({ kind: 'text', signal: `${textRuns} text runs` });
  }

  const equations = countMatches(xml, /<m:oMath\b/g);
  if (equations > 0) {
    kinds.add('equation');
    evidence.push({ kind: 'equation', signal: `${equations} OMML oMath elements` });
  }

  const tables = countMatches(xml, /<a:tbl\b/g);
  if (tables > 0) {
    kinds.add('table');
    evidence.push({ kind: 'table', signal: `${tables} a:tbl grids` });
  }

  const graphicFrames = countMatches(xml, /<p:graphicFrame\b/g);
  if (hasChartRelationship) {
    kinds.add('chart');
    evidence.push({ kind: 'chart', signal: 'slide references a native chart part' });
  }

  const connectors = countMatches(xml, /<p:cxnSp\b/g);
  const shapes = countMatches(xml, /<p:sp\b/g);
  if (connectors > 0) {
    kinds.add('diagram');
    evidence.push({
      kind: 'diagram',
      signal: `${connectors} connectors joining ${shapes} shapes`,
    });
  }

  const alts = pictureAltTexts(xml);
  if (alts.length > 0) {
    const screenshotAlts = alts.filter((alt) =>
      SCREENSHOT_ALT_HINTS.some((hint) => alt.toLowerCase().includes(hint)),
    );
    if (screenshotAlts.length > 0) {
      kinds.add('screenshot');
      evidence.push({
        kind: 'screenshot',
        signal: `picture alt text names a capture: ${JSON.stringify(screenshotAlts[0].slice(0, 80))}`,
      });
    }
    kinds.add('media');
    evidence.push({ kind: 'media', signal: `${alts.length} pictures` });
  }

  const monospace = monospaceFacesUsed(xml);
  if (monospace.length > 0) {
    kinds.add('code');
    evidence.push({ kind: 'code', signal: `monospace faces: ${monospace.join(', ')}` });
  }

  return {
    kinds: [...kinds].sort(),
    evidence,
    counts: {
      textRuns,
      equations,
      tables,
      graphicFrames,
      connectors,
      shapes,
      pictures: alts.length,
    },
  };
}

function parseArgs(argv) {
  const flags = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.set(token.slice(2), true);
      continue;
    }
    flags.set(token.slice(2), next);
    index += 1;
  }
  return flags;
}

export async function inspectPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry))
    .sort((left, right) => slideNumberFromPath(left) - slideNumberFromPath(right));

  const slides = [];
  for (const slidePath of slidePaths) {
    const xml = await zip.file(slidePath).async('string');
    const relsPath = slidePath.replace(/slides\/(slide\d+)\.xml$/i, 'slides/_rels/$1.xml.rels');
    const relsFile = zip.file(relsPath);
    const rels = relsFile ? await relsFile.async('string') : '';
    const hasChartRelationship = /charts?\/chart\d*\.xml/i.test(rels);

    const observation = observeSlideXml(xml, { hasChartRelationship });
    const runs = slideTextRuns(xml);
    slides.push({
      slide: slideNumberFromPath(slidePath),
      title: runs[0] ?? '',
      ...observation,
    });
  }
  return slides;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const pptxPath = flags.get('pptx');
  if (typeof pptxPath !== 'string') {
    process.stderr.write('--pptx <file.pptx> is required.\n');
    process.exit(1);
  }

  const slides = await inspectPptx(await readFile(path.resolve(pptxPath)));

  const lines = [];
  for (const slide of slides) {
    lines.push(
      JSON.stringify({
        kind: 'slide',
        slide: slide.slide,
        title: slide.title,
        counts: slide.counts,
      }),
    );
    for (const item of slide.evidence) {
      lines.push({ ...item, kind: 'artifact', artifactKind: item.kind, slide: slide.slide });
    }
  }
  const ndjson = `${lines
    .map((line) => (typeof line === 'string' ? line : JSON.stringify(line)))
    .join('\n')}\n`;

  const outPath = flags.get('out');
  if (typeof outPath === 'string') {
    await writeFile(path.resolve(outPath), ndjson, 'utf8');
    process.stdout.write(`Inspected ${slides.length} slides -> ${outPath}\n`);
  } else if (flags.get('json') === true) {
    process.stdout.write(`${JSON.stringify(slides, null, 2)}\n`);
  } else {
    process.stdout.write(ndjson);
  }
}

if (process.argv[1]?.endsWith('nodeslide-pptx-inspect.mjs')) {
  await main();
}
