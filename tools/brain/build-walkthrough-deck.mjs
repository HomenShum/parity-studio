/**
 * Build the NodeSlide walkthrough deck.
 *
 * Context. This deck replaces a call. Nobody narrates it, so every slide has to carry its own
 * argument and every speaker note has to carry the longer version a presenter would have said.
 * The reviewer is expected to click through to the repository, so a slide that cannot be checked
 * is worse than no slide.
 *
 * Three rules the content obeys:
 *   1. Every slide prints the URL or repository path that proves its claim, in small type at the
 *      bottom. A claim without a path is not shipped.
 *   2. Verbatim product text is set in mono behind an accent rule; prose written for this deck is
 *      set in the body face. A reader can tell at a glance what the product says from what the
 *      author says.
 *   3. Nothing is asserted that a reviewer cannot reach from the two links he is given
 *      (nodeslide.vercel.app and github.com/HomenShum/NodeSlide). No test counts, no commit
 *      totals, no unmerged branches.
 *
 * Build approach follows the established one in this codebase: PptxGenJS composes the deck,
 * JSZip verifies the emitted package. See nodeslide/scripts/build-atlas-native-pptx.mjs for the
 * same pairing (compose native objects, then read the zip back and count the parts rather than
 * assert the write succeeded).
 *
 * Usage:
 *   node tools/brain/build-walkthrough-deck.mjs [--out <file.pptx>]
 *
 * Exits non-zero if the slide count read back out of the zip does not match the number of slides
 * composed, which is the one failure a successful write can hide.
 */

import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import Pptx from 'pptxgenjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/* ------------------------------------------------------------------------------------------- */
/* Design tokens                                                                                  */
/* ------------------------------------------------------------------------------------------- */

/**
 * The evidence-grade palette already used by this codebase's PPTX work: cool drafting ground, one
 * blueprint blue for structure. Deliberately not the warm cream and terracotta that every
 * generated deck lands in.
 */
const BRAND = {
  bg: 'F1F3F6',
  surface: 'FFFFFF',
  ink: '161A21',
  body: '2A3140',
  muted: '545C69',
  accent: '2A4A8F',
  line: 'D3D8E0',
  // Faces chosen for portability rather than taste alone: all three resolve on Windows and on
  // macOS PowerPoint, so the deck the reviewer opens is the deck that was composed.
  display: 'Trebuchet MS',
  bodyFace: 'Arial',
  mono: 'Consolas',
};

const W = 13.333;
const H = 7.5;
const MARGIN = 0.75;
const CONTENT_W = W - MARGIN * 2;

/* ------------------------------------------------------------------------------------------- */
/* Content                                                                                        */
/* ------------------------------------------------------------------------------------------- */

/**
 * Each beat is one claim, the place on the live application where it is shown, the literal strings
 * that appear there, and the path that proves it. `on` entries are typed: 'q' is text that appears
 * in the product verbatim, 's' is a step or an observation written for this deck.
 */
const BEATS = [
  {
    title: 'The headline is a record',
    claim:
      'A slide element is addressable typed data carrying an id, normalised geometry, export capabilities and bound sources. It is not pixels.',
    where: 'Inspector → JSON → Selection',
    seconds: 28,
    on: [
      {
        t: 's',
        text: 'On nodeslide.vercel.app click "Explore the editable sample workspace", then click the headline on the canvas.',
      },
      { t: 'q', text: 'Selection · 1' },
      { t: 'q', text: 'id  element_3cdee97100485e1f71d80bfc1764c778' },
      { t: 'q', text: 'bbox  { x 0.07, y 0.15, w 0.79, h 0.27 }' },
      {
        t: 'q',
        text: 'exportCapabilities  web_native / pptx_editable / google_importable',
      },
      { t: 'q', text: 'sourceIds  source_fe19b386…    version  1' },
      { t: 's', text: 'Apply changes and Reset sit beneath the record. The panel is editable.' },
    ],
    proof: 'https://nodeslide.vercel.app',
    why: 'This is the whole premise in one panel. Every later beat depends on the element having a name, because a patch, a citation and a version entry all address it by that name.',
    shownBy:
      'On https://nodeslide.vercel.app click "Explore the editable sample workspace", click the headline on the canvas (Selection · 1 appears in the inspector header), then Inspector → JSON → Selection. The editable record fills the panel: id element_3cdee97100485e1f71d80bfc1764c778, bbox {x 0.07, y 0.15, w 0.79, h 0.27}, exportCapabilities web_native / pptx_editable / google_importable, sourceIds source_fe19b386…, version 1, with Apply changes and Reset beneath it.',
  },
  {
    title: 'The whole deck downloads as its schema',
    claim:
      'One canonical DeckSpec is the source of truth, the rendered slide is derived from it, and it leaves with the user.',
    where: 'Inspector → JSON → Deck',
    seconds: 18,
    on: [
      { t: 'q', text: 'DECK AS CODE' },
      {
        t: 'q',
        text: 'The canonical nodeslide.slidelang/v1 DeckSpec — 7 slides · 71 elements',
      },
      {
        t: 's',
        text: 'Scroll the deck record: schemaVersion nodeslide.slidelang/v1, slideOrder, theme, version 1.',
      },
      { t: 's', text: 'Click Download deck.json. The schema leaves with the user, not a bitmap.' },
    ],
    proof: 'github.com/HomenShum/NodeSlide/blob/main/shared/nodeslide.ts',
    why: 'The schema is declared in the repository, so the record on screen and the type in shared/nodeslide.ts can be read against each other.',
    shownBy:
      'Inspector → JSON → Deck. Header reads "DECK AS CODE" and "The canonical nodeslide.slidelang/v1 DeckSpec — 7 slides · 71 elements". Scroll the deck record (schemaVersion nodeslide.slidelang/v1, slideOrder, theme, version 1), then click Download deck.json.',
  },
  {
    title: 'An agent edit is a bounded patch',
    claim:
      'The agent returns scoped operations on named elements, and the slide does not change while those operations are being read.',
    where: 'Inspector → AI → Generate 3 directions',
    seconds: 30,
    on: [
      { t: 'q', text: 'Ready to review · based on v1        Validation clean' },
      { t: 's', text: 'Expand "Review 2 bounded changes" on the first card.' },
      {
        t: 'q',
        text: 'Update letterSpacing, lineHeight on element_3cdee97100485e1f71d80bfc1764c778',
      },
      { t: 'q', text: 'Update opacity on element_1230c5ac52a33407c39e665ca5b5f110' },
      { t: 's', text: 'The first id is the element opened in beat 1.' },
      {
        t: 'q',
        text: 'Each direction is materialized and validated. Your slide stays unchanged until Accept.',
      },
    ],
    proof: 'github.com/HomenShum/NodeSlide/blob/main/convex/lib/nodeslidePatches.ts',
    why: 'The model does not write to the deck. It proposes operations against named elements, and those operations are validated before a reviewer is shown them.',
    shownBy:
      'Inspector → AI → "Generate 3 directions". Three cards return "Ready to review · based on v1" with "Validation clean". Expand "Review 2 bounded changes" on the first: "Update letterSpacing, lineHeight on element_3cdee97100485e1f71d80bfc1764c778" and "Update opacity on element_1230c5ac52a33407c39e665ca5b5f110". The first id is the element opened in beat 1. The panel states "Each direction is materialized and validated. Your slide stays unchanged until Accept."',
  },
  {
    title: 'The same run says the model degraded',
    claim:
      'When the external model cannot supply a direction, the product labels the substitute and gives a per-branch reason rather than passing it off as the model’s work.',
    where: 'Inspector → AI, same run, no reload',
    seconds: 20,
    on: [
      {
        t: 'q',
        text: 'The selected external model could not safely supply every direction. Clearly labeled deterministic fallbacks are shown instead.',
      },
      { t: 's', text: 'Each card carries a "Deterministic fallback" chip.' },
      { t: 'q', text: 'Fallback reason: provider timeout            (two branches)' },
      { t: 'q', text: 'Fallback reason: invalid provider operation  (third branch)' },
    ],
    proof: 'https://nodeslide.vercel.app',
    why: 'This is the same screen as the previous beat, unreloaded. The degradation was not staged for the recording, and the product reports it per branch rather than as one banner covering everything.',
    shownBy:
      'Stay on the AI tab from beat 3, no reload. Banner above the cards: "The selected external model could not safely supply every direction. Clearly labeled deterministic fallbacks are shown instead." Each card carries a "Deterministic fallback" chip; the reasons read "Fallback reason: provider timeout" on two branches and "Fallback reason: invalid provider operation" on the third.',
  },
  {
    title: 'Review is a diff',
    claim: 'A proposal is inspected against the baseline before anything is written to the deck.',
    where: 'Canvas → Compare',
    seconds: 22,
    on: [
      { t: 's', text: 'Click Preview on the first direction. The canvas switches to Compare.' },
      { t: 'q', text: 'proposal · pending review' },
      { t: 'q', text: 'Side by side  /  Slider  /  Overlay  /  Blink' },
      { t: 'q', text: 'Baseline · v1        set against        Balanced · Split' },
      {
        t: 'q',
        text: 'update style · element_3cdee971…     update style · element_1230c5ac…',
      },
    ],
    proof: 'https://nodeslide.vercel.app',
    why: 'The two operations listed under the comparison are the same two the AI panel enumerated one beat earlier. The review surface and the proposal surface name the same elements.',
    shownBy:
      'Click Preview on the first direction. The canvas switches to Compare, labelled "proposal · pending review", with modes Side by side / Slider / Overlay / Blink, "Baseline · v1" set against "Balanced · Split", and the two operations listed as "update style · element_3cdee971…" and "update style · element_1230c5ac…".',
  },
  {
    title: 'Accept writes a version that restores',
    claim:
      'Acceptance is a recorded version with the agent named as its author, and the prior state stays reachable.',
    where: 'Accept → Inspector → Versions',
    seconds: 20,
    on: [
      { t: 's', text: 'Click Accept. The deck clock moves v1 → v2.' },
      {
        t: 'q',
        text: 'Variation balanced/detail/split: Restyle element_…        v2 · Agent',
      },
      { t: 'q', text: 'Initial deck                                             v1 · System' },
      { t: 's', text: 'Each row offers Compare and Restore.' },
    ],
    proof: 'github.com/HomenShum/NodeSlide/blob/main/convex/nodeslide.ts',
    why: 'Authorship is recorded, not implied. The agent is named on the row it wrote, and the state before it is still one click away.',
    shownBy:
      'Click Accept. The deck clock moves v1 → v2. Inspector → Versions lists "Variation balanced/detail/split: Restyle element_…" as "v2 · Agent" above "Initial deck · v1 · System", each row offering Compare and Restore.',
  },
  {
    title: 'Sources bind to elements, and the limit is printed',
    claim:
      'Citations attach to named elements rather than to a slide as a whole, and the product states in its own UI what it does not check.',
    where: 'Inspector → Evidence',
    seconds: 25,
    on: [
      { t: 'q', text: 'EVIDENCE LAYER / Data & sources' },
      {
        t: 'q',
        text: 'NodeSlide checks attachment and disclosure; it does not independently verify facts',
      },
      { t: 's', text: 'Expand the first source record.' },
      { t: 'q', text: 'Cited by 8 elements' },
      { t: 'q', text: 'Primary metric · The handoff tax compounds' },
      { t: 'q', text: 'Editable formula · One intent three guarded passes' },
      { t: 'q', text: 'Evidence chart · Quality is measurable' },
    ],
    proof: 'https://nodeslide.vercel.app',
    why: 'A source resolves to the eight elements that cite it, each named. The second line is the product stating its own limit in its own interface rather than in a disclaimer nobody reads.',
    shownBy:
      'Inspector → Evidence. Header reads "EVIDENCE LAYER / Data & sources", followed by "NodeSlide checks attachment and disclosure; it does not independently verify facts". Expand the first source record: "Cited by 8 elements", enumerating Primary metric · The handoff tax compounds, Editable formula · One intent three guarded passes, Evidence chart · Quality is measurable, and the rest.',
  },
  {
    title: 'The trace refuses to invent telemetry',
    claim: 'Run receipts report only what was observed, and they report absence as absence.',
    where: 'Inspector → Trace',
    seconds: 20,
    on: [
      { t: 'q', text: 'COST — not recorded' },
      { t: 'q', text: 'No external provider billing was recorded for this fallback' },
      {
        t: 'q',
        text: 'Structured timeline unavailable — Legacy runs keep their custody receipt but do not invent span timing',
      },
      { t: 'q', text: 'context: — unsealed · attribution route degraded' },
      { t: 'q', text: 'Provisional seal — machine only, not signable' },
    ],
    proof: 'github.com/HomenShum/NodeSlide/blob/main/convex/nodeslideAgent.ts',
    why: 'Four separate places on one screen decline to fill a gap with a plausible number. A receipt that invents span timing is worse than one that says it has none.',
    shownBy:
      'Inspector → Trace. On screen: "COST — not recorded", "No external provider billing was recorded for this fallback", "Structured timeline unavailable — Legacy runs keep their custody receipt but do not invent span timing", context marked "— unsealed · attribution route degraded", and the approval row "Provisional seal — machine only, not signable".',
  },
  {
    title: 'The deployed page names its commit',
    claim:
      'The application just filmed is the repository at one specific commit, and that commit’s history contains the fix that made this agent route run at all.',
    where: 'View source → GitHub → git show',
    seconds: 30,
    on: [
      {
        t: 'q',
        text: 'meta nodeslide-build-sha = a836c6a29e026bb219b959bdf3e2dc9e9f407c77',
      },
      { t: 's', text: 'The same SHA is main HEAD on GitHub.' },
      { t: 'q', text: 'git show 15d2686 -- convex/lib/nodeslideValidators.ts' },
      {
        t: 's',
        text: 'Every agent request failed because moonshotai/kimi-k3 was missing from nodeslideAgentModelValidator.',
      },
      { t: 'q', text: "+ v.literal('moonshotai/kimi-k3')" },
    ],
    proof: 'github.com/HomenShum/NodeSlide/commit/15d2686',
    why: 'The build SHA in the page head is the join between what was on screen and what is in the repository. The diff it leads to is one line, which is the honest size of the fix.',
    shownBy:
      "View source on nodeslide.vercel.app and read meta nodeslide-build-sha = a836c6a29e026bb219b959bdf3e2dc9e9f407c77, then show the same SHA as main HEAD on GitHub. Cut to `git show 15d2686 -- convex/lib/nodeslideValidators.ts`: every agent request failed because moonshotai/kimi-k3 was missing from nodeslideAgentModelValidator, and the diff is one added line, `+ v.literal('moonshotai/kimi-k3')`.",
  },
];

const TOTAL_SECONDS = BEATS.reduce((sum, beat) => sum + beat.seconds, 0);

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes} min ${String(seconds).padStart(2, '0')} s`;
}

/* ------------------------------------------------------------------------------------------- */
/* Measurement                                                                                    */
/* ------------------------------------------------------------------------------------------- */

/**
 * Greedy wrap count for one line of text at a given box width.
 *
 * PptxGenJS emits no measured heights, so a stacked list of independently positioned text boxes
 * has to predict its own growth. Without this, a two-line item silently overlaps the item under
 * it, which looks like a rendering bug in PowerPoint rather than a layout error here.
 */
export function estimateLines(text, boxWidthIn, fontSize, mono) {
  const value = String(text ?? '');
  if (!value) return 1;
  // Consolas advances a fixed 0.55em. Arial averages nearer 0.50em across mixed-case prose.
  const advance = (fontSize / 72) * (mono ? 0.55 : 0.5);
  const perLine = Math.max(8, Math.floor(boxWidthIn / advance));
  let lines = 1;
  let current = 0;
  for (const word of value.split(/\s+/).filter(Boolean)) {
    const length = word.length;
    if (current === 0) current = length;
    else if (current + 1 + length <= perLine) {
      current += 1 + length;
      continue;
    } else {
      lines += 1;
      current = length;
    }
    if (current > perLine) {
      lines += Math.ceil(current / perLine) - 1;
      current = current % perLine || perLine;
    }
  }
  return lines;
}

const EVIDENCE_CARD = { x: MARGIN, y: 3.32, w: CONTENT_W, h: 3.16 };
const CARD_PAD_X = 0.26;
const CARD_PAD_Y = 0.2;
const RULE_W = 0.045;
const RULE_GAP = 0.16;
const ITEM_GAP = 0.11;

/**
 * Choose the largest type size at which the evidence list still fits inside the card, and return
 * the laid-out geometry. Sizes descend, so a seven-item beat sets smaller than a four-item beat
 * rather than overflowing at a uniform size.
 */
export function layoutEvidence(items, card = EVIDENCE_CARD) {
  const available = card.h - CARD_PAD_Y * 2;
  const sizes = [13, 12, 11.5, 11, 10.5, 10, 9.5, 9];
  for (const fontSize of sizes) {
    const lineHeight = (fontSize * 1.32) / 72;
    const placed = [];
    let cursor = card.y + CARD_PAD_Y;
    for (const item of items) {
      const mono = item.t === 'q';
      const indent = mono ? RULE_W + RULE_GAP : 0;
      const width = card.w - CARD_PAD_X * 2 - indent;
      const lines = estimateLines(item.text, width, fontSize, mono);
      const height = lines * lineHeight;
      placed.push({
        ...item,
        mono,
        x: card.x + CARD_PAD_X + indent,
        y: cursor,
        w: width,
        h: height,
        fontSize,
      });
      cursor += height + ITEM_GAP;
    }
    const used = cursor - ITEM_GAP - (card.y + CARD_PAD_Y);
    if (used <= available) {
      // Centre the block in the card. A four-item beat otherwise hangs from the top edge with an
      // inch of dead white beneath it, which reads as a slide that lost its last two lines.
      const offset = (available - used) / 2;
      return { items: placed.map((item) => ({ ...item, y: item.y + offset })), fontSize, used };
    }
  }
  throw new Error('evidence list does not fit the card at any supported type size');
}

/* ------------------------------------------------------------------------------------------- */
/* Slide composition                                                                              */
/* ------------------------------------------------------------------------------------------- */

function addRule(slide, y, color = BRAND.line, width = 0.75) {
  slide.addShape('line', { x: MARGIN, y, w: CONTENT_W, h: 0, line: { color, width } });
}

/**
 * The bottom band. Every slide gets one, because a slide without a checkable path is not shipped.
 *
 * Widths here are load-bearing rather than cosmetic. The first render set the label box to 0.7in
 * and the word PROOF broke across two lines as "PROO / F"; the right-hand box was 2.6in and
 * "Inspector → AI → Generate 3 directions" wrapped the same way. Both boxes are now sized against
 * the longest string they actually have to carry.
 */
const FOOTER_LABEL_W = 1.0;
const FOOTER_RIGHT_W = 3.6;

function addProofFooter(slide, proof, right) {
  // Fail the build rather than ship a wrapped footer. Wrapping here is invisible in a headless
  // write and only shows up once someone opens the file, which is too late.
  const proofW = CONTENT_W - FOOTER_LABEL_W - FOOTER_RIGHT_W - 0.2;
  if (estimateLines(proof, proofW, 9.5, true) > 1) {
    throw new Error(`proof path wraps in the footer: ${proof}`);
  }
  if (right && estimateLines(right, FOOTER_RIGHT_W, 8.5, false) > 1) {
    throw new Error(`footer label wraps: ${right}`);
  }
  addRule(slide, 6.72);
  slide.addText('PROOF', {
    x: MARGIN,
    y: 6.82,
    w: FOOTER_LABEL_W,
    h: 0.28,
    fontFace: BRAND.bodyFace,
    fontSize: 9,
    bold: true,
    charSpacing: 1.2,
    color: BRAND.accent,
    valign: 'middle',
  });
  slide.addText(proof, {
    x: MARGIN + FOOTER_LABEL_W,
    y: 6.82,
    w: CONTENT_W - FOOTER_LABEL_W - FOOTER_RIGHT_W - 0.2,
    h: 0.28,
    fontFace: BRAND.mono,
    fontSize: 9.5,
    color: BRAND.muted,
    valign: 'middle',
  });
  if (right) {
    slide.addText(right, {
      x: W - MARGIN - FOOTER_RIGHT_W,
      y: 6.82,
      w: FOOTER_RIGHT_W,
      h: 0.28,
      align: 'right',
      fontFace: BRAND.bodyFace,
      fontSize: 8.5,
      charSpacing: 1,
      color: BRAND.muted,
      valign: 'middle',
    });
  }
}

function addBeatSlide(pptx, beat, index) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND.bg };

  const number = String(index + 1).padStart(2, '0');
  slide.addText(`BEAT ${number} OF ${String(BEATS.length).padStart(2, '0')}`, {
    x: MARGIN,
    y: 0.38,
    w: 4,
    h: 0.3,
    fontFace: BRAND.bodyFace,
    fontSize: 10,
    bold: true,
    charSpacing: 1.8,
    color: BRAND.accent,
    valign: 'middle',
  });
  slide.addText(`${beat.seconds} SECONDS ON SCREEN`, {
    x: W - MARGIN - 4,
    y: 0.38,
    w: 4,
    h: 0.3,
    align: 'right',
    fontFace: BRAND.bodyFace,
    fontSize: 10,
    charSpacing: 1.8,
    color: BRAND.muted,
    valign: 'middle',
  });
  addRule(slide, 0.74);

  slide.addText(beat.title, {
    x: MARGIN,
    y: 0.86,
    w: CONTENT_W,
    h: 0.68,
    fontFace: BRAND.display,
    fontSize: 30,
    bold: true,
    color: BRAND.ink,
    valign: 'middle',
  });

  slide.addText(beat.where, {
    x: MARGIN,
    y: 1.58,
    w: CONTENT_W,
    h: 0.3,
    fontFace: BRAND.mono,
    fontSize: 12,
    color: BRAND.accent,
    valign: 'middle',
  });

  slide.addText(beat.claim, {
    x: MARGIN,
    y: 2.0,
    w: CONTENT_W - 0.4,
    h: 1.0,
    fontFace: BRAND.bodyFace,
    fontSize: 16.5,
    color: BRAND.body,
    lineSpacingMultiple: 1.18,
    valign: 'top',
  });

  slide.addText('ON SCREEN', {
    x: MARGIN,
    y: 3.02,
    w: 4,
    h: 0.26,
    fontFace: BRAND.bodyFace,
    fontSize: 9,
    bold: true,
    charSpacing: 1.8,
    color: BRAND.muted,
    valign: 'middle',
  });

  slide.addShape('rect', {
    ...EVIDENCE_CARD,
    fill: { color: BRAND.surface },
    line: { color: BRAND.line, width: 0.75 },
  });

  const layout = layoutEvidence(beat.on);
  for (const item of layout.items) {
    if (item.mono) {
      // The accent rule marks text that appears in the product exactly as written.
      slide.addShape('rect', {
        x: EVIDENCE_CARD.x + CARD_PAD_X,
        y: item.y + 0.02,
        w: RULE_W,
        h: Math.max(0.14, item.h - 0.04),
        fill: { color: BRAND.accent },
        line: { color: BRAND.accent, width: 0 },
      });
    }
    slide.addText(item.text, {
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      fontFace: item.mono ? BRAND.mono : BRAND.bodyFace,
      fontSize: item.fontSize,
      color: item.mono ? BRAND.ink : BRAND.muted,
      italic: !item.mono,
      lineSpacingMultiple: 1.05,
      // Zero inset so the box's y is the text's y. With the default inset every item renders about
      // a tenth of an inch below where it was measured, which pushes the whole centred block low
      // and drifts the accent rules off the lines they mark.
      margin: 0,
      valign: 'top',
    });
  }

  addProofFooter(slide, beat.proof, beat.where);

  slide.addNotes(
    [
      `Beat ${number} of ${BEATS.length} · ${beat.seconds} seconds.`,
      '',
      `Claim: ${beat.claim}`,
      '',
      `Shown by: ${beat.shownBy}`,
      '',
      `Why this beat is here: ${beat.why}`,
      '',
      `Proof path: ${beat.proof}`,
      '',
      'Monospaced lines on this slide are product text, copied as it appears. Italic lines are steps or observations written for this deck.',
    ].join('\n'),
  );
}

function addCoverSlide(pptx) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND.bg };

  slide.addText('NODESLIDE', {
    x: MARGIN,
    y: 0.9,
    w: CONTENT_W,
    h: 0.34,
    fontFace: BRAND.bodyFace,
    fontSize: 11,
    bold: true,
    charSpacing: 3,
    color: BRAND.accent,
    valign: 'middle',
  });
  slide.addText('A walkthrough you can check', {
    x: MARGIN,
    y: 1.3,
    w: CONTENT_W,
    h: 1.0,
    fontFace: BRAND.display,
    fontSize: 44,
    bold: true,
    color: BRAND.ink,
    valign: 'middle',
  });
  addRule(slide, 2.42, BRAND.accent, 1.5);

  slide.addText(
    'NodeSlide treats a deck as typed code rather than a bitmap. An agent edit arrives as a validated patch carrying its source, and you accept it as a diff.',
    {
      x: MARGIN,
      y: 2.62,
      w: CONTENT_W - 2.2,
      h: 0.9,
      fontFace: BRAND.bodyFace,
      fontSize: 17,
      color: BRAND.body,
      lineSpacingMultiple: 1.2,
      valign: 'top',
    },
  );

  slide.addShape('rect', {
    x: MARGIN,
    y: 3.72,
    w: CONTENT_W,
    h: 2.6,
    fill: { color: BRAND.surface },
    line: { color: BRAND.line, width: 0.75 },
  });

  const rows = [
    ['Nine beats', 'Each states one claim and names where it is shown.'],
    ['Every slide', 'Prints the URL or repository path that proves its claim.'],
    ['Speaker notes', 'Carry the longer version, because nobody is narrating.'],
    ['Screen budget', `${formatDuration(TOTAL_SECONDS)} across the nine beats.`],
  ];
  rows.forEach(([label, text], index) => {
    const y = 3.98 + index * 0.55;
    slide.addText(label, {
      x: MARGIN + 0.3,
      y,
      w: 2.1,
      h: 0.34,
      fontFace: BRAND.bodyFace,
      fontSize: 11.5,
      bold: true,
      color: BRAND.accent,
      valign: 'middle',
    });
    slide.addText(text, {
      x: MARGIN + 2.5,
      y,
      w: CONTENT_W - 2.8,
      h: 0.34,
      fontFace: BRAND.bodyFace,
      fontSize: 12.5,
      color: BRAND.body,
      valign: 'middle',
    });
  });

  addProofFooter(slide, 'https://nodeslide.vercel.app', 'LIVE APPLICATION');

  slide.addNotes(
    [
      'This deck replaces a walkthrough call. It is meant to be read alone, at speed, on a phone.',
      '',
      'The structure is nine beats. Each beat states one claim, then names the exact place on the live application or in the repository where that claim is shown, then prints the literal strings that appear there. Monospaced lines are product text copied as it appears; italic lines are steps written for this deck.',
      '',
      'The application is live at https://nodeslide.vercel.app. The landing page opens a real editable workspace through "Explore the editable sample workspace". Every screen named in the beats is reachable from that workspace without an account.',
      '',
      `Screen budget: ${formatDuration(TOTAL_SECONDS)} across nine beats.`,
    ].join('\n'),
  );
}

function addClosingSlide(pptx) {
  const slide = pptx.addSlide();
  slide.background = { color: BRAND.bg };

  slide.addText('WHERE TO START', {
    x: MARGIN,
    y: 0.38,
    w: 4,
    h: 0.3,
    fontFace: BRAND.bodyFace,
    fontSize: 10,
    bold: true,
    charSpacing: 1.8,
    color: BRAND.accent,
    valign: 'middle',
  });
  addRule(slide, 0.74);

  slide.addText('Under four minutes, no account, no call', {
    x: MARGIN,
    y: 0.86,
    w: CONTENT_W,
    h: 0.68,
    fontFace: BRAND.display,
    fontSize: 30,
    bold: true,
    color: BRAND.ink,
    valign: 'middle',
  });

  slide.addText(
    'Everything in the nine beats is reachable from the landing page. The build SHA in the page head names the commit, so the running application can be read against the repository.',
    {
      x: MARGIN,
      y: 1.66,
      w: CONTENT_W - 0.4,
      h: 0.9,
      fontFace: BRAND.bodyFace,
      fontSize: 16.5,
      color: BRAND.body,
      lineSpacingMultiple: 1.18,
      valign: 'top',
    },
  );

  const items = [
    {
      t: 's',
      text: 'Open https://nodeslide.vercel.app and click "Explore the editable sample workspace".',
    },
    { t: 'q', text: 'Inspector tabs:  AI  Design  Comments  Versions  Evidence  JSON  Trace' },
    { t: 's', text: 'Press Ctrl+K for the command palette.' },
    { t: 'q', text: 'Open Artifact Lab' },
    { t: 's', text: 'View source on the landing page to read the build SHA in the head.' },
    { t: 'q', text: 'nodeslide-build-sha = a836c6a29e026bb219b959bdf3e2dc9e9f407c77' },
    { t: 's', text: 'Read the schema the deck downloads as: shared/nodeslide.ts on main.' },
  ];

  slide.addText('ON SCREEN', {
    x: MARGIN,
    y: 3.02,
    w: 4,
    h: 0.26,
    fontFace: BRAND.bodyFace,
    fontSize: 9,
    bold: true,
    charSpacing: 1.8,
    color: BRAND.muted,
    valign: 'middle',
  });
  slide.addShape('rect', {
    ...EVIDENCE_CARD,
    fill: { color: BRAND.surface },
    line: { color: BRAND.line, width: 0.75 },
  });
  const layout = layoutEvidence(items);
  for (const item of layout.items) {
    if (item.mono) {
      slide.addShape('rect', {
        x: EVIDENCE_CARD.x + CARD_PAD_X,
        y: item.y + 0.02,
        w: RULE_W,
        h: Math.max(0.14, item.h - 0.04),
        fill: { color: BRAND.accent },
        line: { color: BRAND.accent, width: 0 },
      });
    }
    slide.addText(item.text, {
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      fontFace: item.mono ? BRAND.mono : BRAND.bodyFace,
      fontSize: item.fontSize,
      color: item.mono ? BRAND.ink : BRAND.muted,
      italic: !item.mono,
      lineSpacingMultiple: 1.05,
      // Zero inset so the box's y is the text's y. With the default inset every item renders about
      // a tenth of an inch below where it was measured, which pushes the whole centred block low
      // and drifts the accent rules off the lines they mark.
      margin: 0,
      valign: 'top',
    });
  }

  addProofFooter(slide, 'github.com/HomenShum/NodeSlide', 'REPOSITORY');

  slide.addNotes(
    [
      'The two links are the whole surface: the live application and the repository.',
      '',
      'The live application at https://nodeslide.vercel.app opens a real editable workspace from the landing page. The inspector carries seven tabs: AI, Design, Comments, Versions, Evidence, JSON, Trace. Ctrl+K opens a command palette that contains "Open Artifact Lab".',
      '',
      'The page head carries meta nodeslide-build-sha = a836c6a29e026bb219b959bdf3e2dc9e9f407c77, which is main HEAD in the repository. That is the join: the deployed application can be checked against the code, at one named commit, without asking anyone to take a claim on trust.',
      '',
      'If any beat does not reproduce, the path printed on that slide is where to look.',
    ].join('\n'),
  );
}

/* ------------------------------------------------------------------------------------------- */
/* Build                                                                                          */
/* ------------------------------------------------------------------------------------------- */

/** Compose the deck into a buffer. Exported so a test can assert composition without file I/O. */
export async function buildWalkthroughDeck() {
  const pptx = new Pptx();
  pptx.defineLayout({ name: 'NS16x9', width: W, height: H });
  pptx.layout = 'NS16x9';
  pptx.author = 'NodeSlide';
  pptx.title = 'NodeSlide walkthrough';
  pptx.subject = 'Nine beats, each with the path that proves it';

  addCoverSlide(pptx);
  BEATS.forEach((beat, index) => addBeatSlide(pptx, beat, index));
  addClosingSlide(pptx);

  return { buffer: await pptx.write('nodebuffer'), expectedSlides: BEATS.length + 2 };
}

/** Read the emitted package back and count real slide parts. A write that "succeeded" proves nothing. */
export async function countSlideParts(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  return Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
}

async function main() {
  const outIndex = process.argv.indexOf('--out');
  const outPath =
    outIndex >= 0 && process.argv[outIndex + 1]
      ? path.resolve(process.argv[outIndex + 1])
      : path.join(repoRoot, 'outputs/walkthrough/nodeslide-walkthrough.pptx');

  const { buffer, expectedSlides } = await buildWalkthroughDeck();
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, buffer);

  const slideCount = await countSlideParts(buffer);
  const zip = await JSZip.loadAsync(buffer);
  const notesCount = Object.keys(zip.files).filter((name) =>
    /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name),
  ).length;
  const bytes = (await stat(outPath)).size;

  process.stdout.write(
    `${outPath}\n` +
      `  slides in ppt/slides: ${slideCount} (expected ${expectedSlides})\n` +
      `  notesSlides: ${notesCount}\n` +
      `  bytes: ${bytes} (${(bytes / 1024).toFixed(1)} KB)\n` +
      `  screen budget: ${formatDuration(TOTAL_SECONDS)}\n`,
  );

  if (slideCount !== expectedSlides) {
    process.stderr.write(
      `slide count mismatch: zip has ${slideCount}, composed ${expectedSlides}\n`,
    );
    process.exitCode = 1;
    return;
  }
  if (notesCount !== expectedSlides) {
    process.stderr.write(`speaker notes missing on ${expectedSlides - notesCount} slide(s)\n`);
    process.exitCode = 1;
  }
}

export { BEATS, BRAND, formatDuration };

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
