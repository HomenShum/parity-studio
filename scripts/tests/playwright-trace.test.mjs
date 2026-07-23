import { execSync } from 'node:child_process';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { deriveRunRecordFromTrace, findAssertionInTrace } from '../lib/playwright-trace.mjs';

/**
 * The run record used to be a JSON file the producer handed the gate, and two adversarial rounds
 * proved the consequence: the producer chose what to attest, so a declared assertion could be
 * omitted or recorded not-run and the success caption shipped anyway. The class only closes when
 * the record comes from an artifact the producer cannot author — the Playwright trace.
 *
 * These tests run against REAL traces from this repo's own e2e runs wherever one exists, because a
 * parser verified only against synthetic fixtures would itself be the self-reference it replaces.
 * Synthetic archives are used only for the adversarial cases a real run cannot produce.
 */

function realTraces() {
  try {
    return execSync('find .tmp -name trace.zip', { encoding: 'utf8', cwd: process.cwd() })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Build a synthetic trace.zip in memory — used ONLY for adversarial shapes. */
async function syntheticTrace(events, extraFiles = {}) {
  const zip = new JSZip();
  zip.file('0-trace.trace', events.map((event) => JSON.stringify(event)).join('\n'));
  for (const [name, content] of Object.entries(extraFiles)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const HAS_REAL = realTraces().length > 0;

describe.runIf(HAS_REAL)('against real traces from this repo', () => {
  const trace = realTraces()[0];

  it('derives paired actions with real selectors and no incompletes from a green run', async () => {
    const record = await deriveRunRecordFromTrace(trace);
    expect(record.hasEvidence).toBe(true);
    expect(record.actions.length).toBeGreaterThan(10);
    expect(record.incompleteActions).toBe(0);
    expect(record.actions.some((action) => action.selector)).toBe(true);
  });

  it('anchors both clocks and they cohere — actions land inside the screenshot window', async () => {
    const record = await deriveRunRecordFromTrace(trace);
    expect(record.clockAnchored).toBe(true);
    const action = record.actions.find((a) => a.endedAtMs != null);
    const shots = record.screenshots;
    expect(shots.length).toBeGreaterThan(0);
    // Two independent sources — filename epoch vs context-anchored monotonic — must agree on the
    // same run to within a minute, or the conversion is wrong.
    expect(action.startedAtMs).toBeGreaterThan(shots[0].capturedAtMs - 60_000);
    expect(action.endedAtMs).toBeLessThan(shots.at(-1).capturedAtMs + 60_000);
  });

  it('keeps screenshot timestamps monotonic — they come from filenames, not from anyone', async () => {
    const record = await deriveRunRecordFromTrace(trace);
    const stamps = record.screenshots.map((shot) => shot.capturedAtMs);
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
  });

  it('finds a declared assertion that really ran, and rejects one that never did', async () => {
    const record = await deriveRunRecordFromTrace(trace);
    const real = record.actions.find((a) => a.selector && a.completed && !a.error);
    expect(findAssertionInTrace(record, { selector: real.selector }).found).toBe(true);
    const fake = findAssertionInTrace(record, { selector: 'text=NeverClickedThisFakeButton' });
    expect(fake.found).toBe(false);
    expect(fake.reason).toMatch(/did not occur/);
  });

  it('reports the default-viewport trace honestly as viewport unknown, never invented', async () => {
    // This repo's config sets no explicit viewport, so options is {} in the trace. The honest
    // derivation is null — a gate must then refuse viewport-bound assertions, not assume 1280x720.
    const record = await deriveRunRecordFromTrace(trace);
    expect(record.viewport).toBeNull();
  });
});

describe('adversarial shapes a real run cannot produce', () => {
  it('an action with no after event is incomplete, not silently dropped', async () => {
    const buffer = await syntheticTrace([
      { type: 'context-options', wallTime: 1_784_000_000_000, monotonicTime: 1000, options: {} },
      {
        type: 'before',
        callId: 'c1',
        method: 'click',
        params: { selector: '#save' },
        startTime: 1500,
      },
      // no matching after — the run died mid-click
    ]);
    const record = await deriveRunRecordFromTrace(buffer);
    expect(record.incompleteActions).toBe(1);
    expect(record.actions[0].error).toMatch(/did not complete/);
    // And the reconciler refuses to count it as a satisfied assertion.
    expect(findAssertionInTrace(record, { selector: '#save' }).found).toBe(false);
  });

  it('a failed expect carries its error and does not satisfy the declared assertion', async () => {
    const buffer = await syntheticTrace([
      { type: 'context-options', wallTime: 1_784_000_000_000, monotonicTime: 1000, options: {} },
      {
        type: 'before',
        callId: 'c1',
        method: 'expect',
        params: { selector: '#deck-count' },
        startTime: 1500,
      },
      {
        type: 'after',
        callId: 'c1',
        endTime: 1900,
        error: { error: { message: 'expected 12, received 0' } },
      },
    ]);
    const record = await deriveRunRecordFromTrace(buffer);
    const result = findAssertionInTrace(record, { selector: '#deck-count' });
    expect(result.found).toBe(false);
    expect(result.reason).toMatch(/expected 12, received 0/);
  });

  it('an empty archive is not evidence of a run', async () => {
    const record = await deriveRunRecordFromTrace(await syntheticTrace([]));
    expect(record.hasEvidence).toBe(false);
    expect(record.eventCount).toBe(0);
  });

  it('a trace with no clock anchor yields null wall times, never guessed ones', async () => {
    const buffer = await syntheticTrace([
      { type: 'before', callId: 'c1', method: 'click', params: { selector: '#x' }, startTime: 10 },
      { type: 'after', callId: 'c1', endTime: 20 },
    ]);
    const record = await deriveRunRecordFromTrace(buffer);
    expect(record.clockAnchored).toBe(false);
    expect(record.actions[0].startedAtMs).toBeNull();
  });

  it('screenshot filenames that do not carry a timestamp are excluded, not defaulted', async () => {
    const buffer = await syntheticTrace(
      [{ type: 'context-options', wallTime: 1_784_000_000_000, monotonicTime: 1000, options: {} }],
      { 'resources/page@abc-notanumber.jpeg': 'xx', 'resources/page@abc-1784000001000.jpeg': 'yy' },
    );
    const record = await deriveRunRecordFromTrace(buffer);
    expect(record.screenshots).toHaveLength(1);
    expect(record.screenshots[0].capturedAtMs).toBe(1_784_000_001_000);
  });

  it('a truncated final line is skipped without losing the rest of the stream', async () => {
    const zip = new JSZip();
    const good = [
      { type: 'context-options', wallTime: 1_784_000_000_000, monotonicTime: 1000, options: {} },
      {
        type: 'before',
        callId: 'c1',
        method: 'click',
        params: { selector: '#ok' },
        startTime: 1200,
      },
      { type: 'after', callId: 'c1', endTime: 1300 },
    ].map((event) => JSON.stringify(event));
    zip.file('0-trace.trace', `${good.join('\n')}\n{"type":"before","callId":"c2","meth`);
    const record = await deriveRunRecordFromTrace(await zip.generateAsync({ type: 'nodebuffer' }));
    expect(record.actions).toHaveLength(1);
    expect(record.actions[0].completed).toBe(true);
  });

  it('an explicit viewport IS derived when the trace carries one', async () => {
    const buffer = await syntheticTrace([
      {
        type: 'context-options',
        wallTime: 1_784_000_000_000,
        monotonicTime: 1000,
        options: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
      },
    ]);
    const record = await deriveRunRecordFromTrace(buffer);
    expect(record.viewport).toEqual({ width: 1440, height: 900, deviceScaleFactor: 2 });
  });
});
