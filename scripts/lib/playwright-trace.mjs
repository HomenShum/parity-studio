/**
 * Playwright trace → derived run record.
 *
 * The capture gate had a hole no amount of static checking could close: the RUN RECORD was a JSON
 * file the producer handed to the gate, so the producer chose what to attest. A load-bearing
 * assertion could be declared and simply omitted from the record, or recorded `not-run`, and the
 * success caption still shipped. Two adversarial rounds confirmed it — every fix closed one fixture
 * while the class ("the producer authors the record the check reads") stayed open one level up.
 *
 * This module DERIVES the record from a trace.zip instead of accepting producer JSON: actions are
 * matched before/after pairs, screenshots carry their own epoch-ms capture time in the filename,
 * and a context clock anchor puts both on one wall clock. That derivation is correct and useful.
 *
 * CORRECTION (round-3 re-attack, 2026-07-23). An earlier version of this header claimed a trace
 * "cannot be hand-written" and is "an artifact the producer did not author". THAT IS FALSE, and it
 * was a false security claim in code. A trace.zip is NDJSON text plus files named
 * `page@<hex>-<epoch>.jpeg`; a producer forged a passing one in ~40 lines with no browser, and
 * deleting a single `error` line flips a REFUSED verdict to CORROBORATED. A trace is an independent
 * oracle ONLY when its PROVENANCE is trusted — produced by a CI Playwright step the producer cannot
 * touch, or otherwise attested. This module does not establish that provenance and MUST NOT be
 * treated as if it does.
 *
 * What this correctly provides: derivation, and a check that can FAIL — a trace missing an action,
 * carrying a failed expect, lacking a clock anchor or a screenshot is refused. What it does NOT
 * provide is authenticity of the trace's origin. That is `trace-provenance.mjs`, whose decision this
 * module attaches to every record it returns as `provenance` and `usableAsEvidence`.
 *
 * ENFORCEMENT (2026-07-24). Attaching a verdict is not enforcing one, and for a while nothing read
 * these fields: `nodeslide-claim-gate.mjs` decided claims from a producer-written receipt whose
 * evidence list merely contained the string `"playwright-trace"`. A receipt asserting a trace that
 * did not exist printed PROVEN and exited 0. `claim-trace-binding.mjs` closes it — a trace-backed
 * evidence kind now survives only against a supplied file whose provenance is oracle-grade.
 *
 * Still not enforced here: reconciliation on kind/expected/route/viewport rather than selector
 * presence alone. A trace can be authentic and still be a recording of the wrong thing.
 */

import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { decideTraceProvenance } from './trace-provenance.mjs';

/** Playwright serialises each trace event as one NDJSON line inside a `*.trace` entry. */
function parseTraceEvents(text) {
  const events = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // A truncated final line is normal for an aborted run; skip it rather than throw.
    }
  }
  return events;
}

/**
 * Pair `before`/`after` action events by callId. An action without its `after` never completed —
 * that is a real signal (the run died mid-action), not something to paper over, so it is kept with
 * `completed: false` rather than dropped.
 */
function pairActions(events) {
  const before = new Map();
  const actions = [];
  for (const event of events) {
    if (event.type === 'before') {
      before.set(event.callId, event);
      continue;
    }
    if (event.type === 'after') {
      const start = before.get(event.callId);
      if (!start) continue;
      before.delete(event.callId);
      const params = start.params ?? {};
      actions.push({
        callId: event.callId,
        method: start.method ?? null,
        title: start.title ?? null,
        // The selector/URL an action targeted — this is what a declared assertion is checked against.
        selector: params.selector ?? null,
        url: params.url ?? null,
        text: params.text ?? params.value ?? null,
        startTime: start.startTime ?? null,
        endTime: event.endTime ?? null,
        // Playwright records a caught expect/error on the `after` event.
        error: event.error?.error?.message ?? event.error?.message ?? null,
        completed: true,
      });
    }
  }
  // Anything still in `before` never got an `after`.
  for (const [callId, start] of before) {
    actions.push({
      callId,
      method: start.method ?? null,
      title: start.title ?? null,
      selector: start.params?.selector ?? null,
      url: start.params?.url ?? null,
      startTime: start.startTime ?? null,
      endTime: null,
      error: 'action did not complete (no after event in the trace)',
      completed: false,
    });
  }
  return actions.sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
}

/**
 * The context-options event carries the run's clock anchor and, when the project overrode it, the
 * viewport. A trace on the project's default viewport records `options: {}` — so `viewport: null`
 * is the honest answer, not a parse failure, and the gate must treat viewport-bound assertions as
 * unsatisfiable by such a trace rather than inventing a size.
 */
function contextOf(events) {
  const ctx = events.find((event) => event.type === 'context-options');
  const options = ctx?.options ?? ctx?.params ?? {};
  const vp = options.viewport ?? options.viewportSize ?? null;
  return {
    viewport: vp
      ? {
          width: vp.width ?? null,
          height: vp.height ?? null,
          deviceScaleFactor: options.deviceScaleFactor ?? null,
        }
      : null,
    // Both clocks the browser stamped at context start. Their difference converts any action's
    // monotonic time into wall-clock epoch ms, which is the same clock the screenshot filenames
    // use — so "the shutter fired before the page settled" is a comparison between two numbers
    // neither of which the producer wrote.
    wallTimeMs: typeof ctx?.wallTime === 'number' ? ctx.wallTime : null,
    monotonicMs: typeof ctx?.monotonicTime === 'number' ? ctx.monotonicTime : null,
    browserName: ctx?.browserName || null,
  };
}

/**
 * Screenshots, with the capture timestamp DECODED FROM THE FILENAME, not supplied by anyone.
 *
 * Playwright names each frame `page@<pageId>-<epochMs>.jpeg`. The timestamp is the browser's, so
 * "the shutter fired before the page settled" becomes a checkable ordering between two numbers the
 * producer did not write — which is exactly the A2 attack the JSON record could not defend against.
 */
function screenshotsOf(zip) {
  const shots = [];
  for (const name of Object.keys(zip.files)) {
    const match = /resources\/page@[0-9a-f]+-(\d{10,})\.jpeg$/.exec(name);
    if (match) shots.push({ entry: name, capturedAtMs: Number(match[1]) });
  }
  return shots.sort((a, b) => a.capturedAtMs - b.capturedAtMs);
}

/**
 * Derive a run record from a trace.zip. Every field is read from the trace; none is caller-supplied.
 * Returns null-ish structure only when the archive carries no trace stream at all, which is itself
 * reportable (a "trace" with no events is not evidence of a run).
 */
export async function deriveRunRecordFromTrace(bufferOrPath, provenanceInput = {}) {
  const buffer = typeof bufferOrPath === 'string' ? await readFile(bufferOrPath) : bufferOrPath;
  const zip = await JSZip.loadAsync(buffer);
  // Provenance is decided from the same bytes we are about to parse, and travels WITH the record.
  // A caller cannot end up holding a derived record without also holding the verdict on whether it
  // may be believed — which is how the forged trace got scored the first time.
  const provenance = decideTraceProvenance({ buffer, ...provenanceInput });

  const traceEntries = Object.keys(zip.files).filter((name) => /\.trace$/.test(name));
  const events = [];
  for (const entry of traceEntries) {
    events.push(...parseTraceEvents(await zip.file(entry).async('string')));
  }

  const actions = pairActions(events);
  const screenshots = screenshotsOf(zip);
  const errorEvents = events.filter((event) => event.type === 'error');
  const context = contextOf(events);

  // Convert each action's monotonic time to wall-clock epoch ms, so it lives on the same clock as
  // the screenshots. Null when the anchor is missing rather than guessed.
  const toWallMs =
    context.wallTimeMs != null && context.monotonicMs != null
      ? (monotonic) =>
          monotonic == null
            ? null
            : Math.round(context.wallTimeMs + (monotonic - context.monotonicMs))
      : () => null;
  for (const action of actions) {
    action.startedAtMs = toWallMs(action.startTime);
    action.endedAtMs = toWallMs(action.endTime);
  }

  return {
    source: 'playwright-trace',
    traceStreams: traceEntries.length,
    eventCount: events.length,
    viewport: context.viewport,
    clockAnchored: context.wallTimeMs != null && context.monotonicMs != null,
    browserName: context.browserName,
    actions,
    screenshots,
    // A run that errored is not silently a pass — the trace carries the error, so the record does too.
    errors: errorEvents.map((event) => event.error?.error?.message ?? event.message ?? 'error'),
    // Cheap integrity signal: a hand-forged record tends to have unmatched or zero-duration actions.
    incompleteActions: actions.filter((action) => !action.completed).length,
    hasEvidence: events.length > 0 && actions.length > 0,
    // Content is what the trace SAYS; provenance is why we believe it. Separate claims, both
    // reported. `usableAsEvidence` is the one a gate must consult before scoring anything.
    provenance: provenance.provenance,
    provenanceReason: provenance.reason,
    traceDigest: provenance.digest ?? null,
    usableAsEvidence: Boolean(provenance.oracleGrade) && events.length > 0 && actions.length > 0,
  };
}

/**
 * Find the derived action that satisfies a declared assertion, or explain why none does.
 *
 * This is the reconciliation the gate performs: the DECLARATION says "an assertion of kind K
 * targeting SELECTOR must have happened"; the RECORD is the trace. Matching is by target, never by
 * a status field, because there is no producer-written status field to trust — that was the point.
 */
export function findAssertionInTrace(record, { method, selector, url, text }) {
  const candidates = (record.actions ?? []).filter((action) => {
    if (method && action.method !== method) return false;
    if (selector && action.selector !== selector) return false;
    if (url && action.url !== url) return false;
    if (text != null && action.text !== text) return false;
    return true;
  });
  const passing = candidates.find((action) => action.completed && !action.error);
  if (passing) return { found: true, action: passing };
  if (candidates.length > 0) {
    return {
      found: false,
      reason: candidates[0].error
        ? `the matching action failed in the trace: ${candidates[0].error}`
        : 'the matching action never completed in the trace',
    };
  }
  return {
    found: false,
    reason: `no action in the trace targets ${selector ?? url ?? method ?? 'the declared element'} — the declared interaction did not occur`,
  };
}
