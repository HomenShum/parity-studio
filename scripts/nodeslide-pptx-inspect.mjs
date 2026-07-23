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
import { decidePrimacy, parseFrame } from './lib/semantic-primacy.mjs';

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
export function observeSlideXml(
  xml,
  {
    hasChartRelationship = false,
    chartHasDateAxis = false,
    externalSourceLinks = 0,
    slideSize = null,
  } = {},
) {
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

  // Primacy, checked separately from presence. An object that is off-slide, negligible or fully
  // covered is reported as such, so the topology gate can refuse to count it as the artifact.
  if (slideSize) {
    const { objects, paintOrder } = semanticObjectsOf(xml);
    for (const object of objects) {
      const index = paintOrder.findIndex((entry) => entry.id === object.id);
      const covers = index === -1 ? [] : paintOrder.slice(index + 1);
      const decision = decidePrimacy({ frame: object.frame, slide: slideSize, covers });
      evidence.push({
        kind: object.artifactKind,
        signal: `primacy: ${decision.verdict} — ${decision.reason}`,
        primacy: decision.verdict,
        visibleFraction: decision.visibleFraction ?? null,
      });
    }
  }

  // The timeline primitive. PowerPoint has no <a:timeline>, but OOXML *does* have a real time
  // axis: <c:dateAx>, whose categories are date serials rather than opaque strings. A chart built
  // on one genuinely places events on a shared, editable time axis — which is exactly the job
  // `progression.timeline` describes. Detecting it is what makes the archetype satisfiable in
  // PowerPoint at all, instead of unsatisfiable by construction.
  if (chartHasDateAxis) {
    kinds.add('timeline');
    evidence.push({
      kind: 'timeline',
      signal: 'chart part uses a real c:dateAx time axis with date-serial categories',
    });
  }

  // The evidence primitive. "Evidence" is not a visual style — it is a claim you can follow back to
  // its source. In OOXML that is a run carrying <a:hlinkClick> bound to an external relationship,
  // which is machine-checkable: the target either resolves to a real source or it does not. A
  // citation rendered as decorative grey text carries no such link and is correctly NOT evidence.
  if (externalSourceLinks > 0) {
    kinds.add('evidence');
    evidence.push({
      kind: 'evidence',
      signal: `${externalSourceLinks} claim(s) hyperlinked to an external source relationship`,
    });
  }

  // The motion primitive. Calling scroll-driven scenes "impossible in PowerPoint" was wrong:
  // OOXML carries a full animation model in <p:timing>. A scrollytelling scene is one pinned
  // visual revealed in stages, which is exactly a click-triggered build sequence.
  //
  // The anti-gaming rule: a single fade-in is not a scene. Require at least two `clickEffect`
  // build steps targeting DISTINCT shape ids — that is a staged reveal, not decoration. A slide
  // that merely animates one title still reports no scrollytelling.
  const buildSteps = [
    ...xml.matchAll(/<p:cTn\b[^>]*nodeType="clickEffect"[\s\S]*?<p:spTgt spid="(\d+)"/g),
  ].map((match) => match[1]);
  const distinctTargets = new Set(buildSteps);
  // A transition must carry a genuine animation behavior; a bare <p:cTn> is not animation.
  const hasRealBehavior = /<p:(set|anim|animEffect|animMotion|animScale|animRot|animClr)\b/.test(
    xml,
  );
  if (/<p:timing>/.test(xml) && distinctTargets.size >= 2 && hasRealBehavior) {
    // Deliberately NOT `scrollytelling`. PowerPoint advances on user click — discrete steps — so
    // this is a step-build. Scroll-linked scrubbing is continuous and genuinely unsupported.
    // Calling a step-build "scrub" would be the same overclaim as calling autoshapes a chart, so
    // the archetype is satisfied only via a declared fallback, never as a native pass.
    kinds.add('step-build');
    evidence.push({
      kind: 'step-build',
      signal: `p:timing sequence: ${buildSteps.length} user-advance transitions over ${distinctTargets.size} distinct shapes (${distinctTargets.size + 1} observable states; first visible at slide entry)`,
    });
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

/**
 * Semantic objects on a slide, WITH their geometry and paint order.
 *
 * Presence alone cannot answer "is the native chart the chart I am looking at". A genuine 1x1 inch
 * chart parked at x=14in on a 10in slide is present, valid, and invisible — and the topology gate
 * passed exactly that fixture before this existed. Geometry is what turns presence into primacy.
 */
function semanticObjectsOf(xml) {
  const objects = [];
  const paintOrder = [];
  // <p:sp>, <p:graphicFrame>, <p:cxnSp> and <p:pic> paint in document order; later covers earlier.
  for (const match of xml.matchAll(/<p:(sp|graphicFrame|cxnSp|pic)\b[\s\S]*?<\/p:\1>/g)) {
    const block = match[0];
    const tag = match[1];
    const id = (/<p:cNvPr id="(\d+)"/.exec(block) ?? [])[1] ?? null;
    const name = (/<p:cNvPr id="\d+" name="([^"]*)"/.exec(block) ?? [])[1] ?? '';
    const frame = parseFrame(block);
    // A shape with a solid fill and no alpha hides whatever it fully covers.
    const opaque = /<a:solidFill>/.test(block) && !/<a:alpha val="(?!100000)/.test(block);
    paintOrder.push({ id, name, frame, opaque });

    if (tag !== 'graphicFrame') continue;
    const artifactKind = /<c:chart\b|graphicframe.*chart/i.test(block)
      ? 'chart'
      : /<a:tbl\b/.test(block)
        ? 'table'
        : null;
    if (artifactKind) objects.push({ id, name, artifactKind, frame });
  }
  return { objects, paintOrder };
}

export async function inspectPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry))
    .sort((left, right) => slideNumberFromPath(left) - slideNumberFromPath(right));

  // Slide dimensions live in the presentation part, not in any slide.
  const presentationFile = zip.file('ppt/presentation.xml');
  const presentationXml = presentationFile ? await presentationFile.async('string') : '';
  const sldSz = /<p:sldSz\s+cx="(\d+)"\s+cy="(\d+)"/.exec(presentationXml);
  const slideSize = sldSz ? { cx: Number(sldSz[1]), cy: Number(sldSz[2]) } : null;

  const slides = [];
  for (const slidePath of slidePaths) {
    const xml = await zip.file(slidePath).async('string');
    const relsPath = slidePath.replace(/slides\/(slide\d+)\.xml$/i, 'slides/_rels/$1.xml.rels');
    const relsFile = zip.file(relsPath);
    const rels = relsFile ? await relsFile.async('string') : '';
    const hasChartRelationship = /charts?\/chart\d*\.xml/i.test(rels);

    // Open the referenced chart part(s) — the time axis lives there, not in the slide.
    let chartHasDateAxis = false;
    for (const match of rels.matchAll(/Target="([^"]*charts?\/chart\d*\.xml)"/gi)) {
      // Targets appear in three forms across writers: "../charts/chart1.xml" (relative),
      // "/ppt/charts/chart1.xml" (absolute) and "charts/chart1.xml". Normalise all of them.
      const target = match[1].replace(/^\.\.\//, '').replace(/^\//, '');
      const chartPath = target.startsWith('ppt/') ? target : `ppt/${target}`;
      const chartFile = zip.file(chartPath);
      if (!chartFile) continue;
      if (/<c:dateAx>/.test(await chartFile.async('string'))) {
        chartHasDateAxis = true;
        break;
      }
    }

    // An external hyperlink relationship is only evidence if the slide actually references it.
    const externalIds = new Set(
      [...rels.matchAll(/Id="([^"]+)"[^>]*TargetMode="External"/g)].map((m) => m[1]),
    );
    const externalSourceLinks = [...xml.matchAll(/<a:hlinkClick[^>]*r:id="([^"]+)"/g)].filter((m) =>
      externalIds.has(m[1]),
    ).length;

    const observation = observeSlideXml(xml, {
      hasChartRelationship,
      chartHasDateAxis,
      externalSourceLinks,
      slideSize,
    });
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
