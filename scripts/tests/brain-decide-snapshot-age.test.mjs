import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Written against a gate that was fail-closed in its own docstring and fail-open in its arithmetic.
 *
 * `decide.mjs` refuses to rank a Notion snapshot older than its budget, because ranking a board
 * nobody has refreshed is how a 13-day-overdue P0 stays invisible. It computed the age as
 * `(Date.now() - Date.parse(capturedAt)) / 36e5` and refused only when that exceeded the budget. A
 * snapshot stamped in the FUTURE makes that number negative, so it passed the upper bound trivially.
 * It printed "snapshot -6.9h old" and ranked anyway — the staleness check could never fire again,
 * and the queue would look fresh forever.
 *
 * That is the worst shape of bug for this particular file: the failure is silent, it presents as
 * health, and the thing it hides is the item that has been waiting longest. So these tests pin the
 * sign of the age, not just its magnitude, and they drive the real script as a subprocess rather
 * than re-implementing its arithmetic — a test that recomputes the formula would have agreed with
 * the bug.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DECIDE = path.join(HERE, '..', '..', 'tools', 'brain', 'decide.mjs');

/**
 * decide.mjs reads notion-snapshot.json from its OWN directory, so a scenario is a throwaway
 * directory holding a copy of the script beside a snapshot we control. Nothing in the repo is
 * written, and the real snapshot is never mutated.
 */
const runWithCapturedAt = (capturedAt, extraArgs = []) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'brain-decide-'));
  copyFileSync(DECIDE, path.join(dir, 'decide.mjs'));
  writeFileSync(
    path.join(dir, 'notion-snapshot.json'),
    JSON.stringify({
      schemaVersion: 'brain.notion-snapshot/v1',
      capturedAt,
      rows: [
        {
          item: 'A P0 that has been overdue for a fortnight',
          status: 'Blocked',
          priority: 'P0',
          deadline: '2026-07-12',
          blockedOnHuman: true,
        },
        { item: 'A P1 an agent could actually advance', status: 'Todo', priority: 'P1' },
      ],
    }),
  );
  const r = spawnSync(process.execPath, [path.join(dir, 'decide.mjs'), ...extraArgs], {
    encoding: 'utf8',
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};

const hoursFromNow = (h) => new Date(Date.now() + h * 36e5).toISOString();

describe('a snapshot stamped in the future is refused, not ranked', () => {
  it('refuses the exact reported case: 6.9h ahead of the clock', () => {
    const { code, stderr, stdout } = runWithCapturedAt(hoursFromNow(6.9));
    expect(code).toBe(1);
    expect(stderr).toMatch(/stamped 6\.9h in the FUTURE/);
    // The symptom was a ranked queue printed under a negative age. Neither may survive.
    expect(stdout).toBe('');
    expect(stdout).not.toMatch(/-\d/);
  });

  it('names both timestamps, so the reader can see which one is wrong', () => {
    const capturedAt = hoursFromNow(6.9);
    const { stderr } = runWithCapturedAt(capturedAt);
    expect(stderr).toContain(capturedAt);
    expect(stderr).toMatch(/now\s+\d{4}-\d{2}-\d{2}T/);
  });

  it('refuses a wildly future stamp too — a hand-typed year, not just clock drift', () => {
    const { code, stderr } = runWithCapturedAt('2027-01-01T00:00:00Z');
    expect(code).toBe(1);
    expect(stderr).toMatch(/FUTURE/);
  });

  it('is not outvoted by a generous budget: --max-snapshot-age-hours cannot re-open the hole', () => {
    // The old gate had exactly one knob, and every knob setting accepted a future stamp.
    const { code, stderr } = runWithCapturedAt(hoursFromNow(6.9), [
      '--max-snapshot-age-hours',
      '9999',
    ]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/FUTURE/);
  });
});

describe('the gate still passes what it is supposed to pass', () => {
  it('ranks a snapshot captured two hours ago', () => {
    const { code, stdout } = runWithCapturedAt(hoursFromNow(-2));
    expect(code).toBe(0);
    expect(stdout).toMatch(/Decision queue — snapshot 2\.0h old/);
    expect(stdout).toMatch(/AGENT WORK, ranked:/);
  });

  it('tolerates sub-quarter-hour skew between two machines rather than blocking the queue', () => {
    // Refusing on any negative age at all would make the tool hostage to unsynchronised clocks.
    const { code, stderr } = runWithCapturedAt(hoursFromNow(0.1));
    expect(code).toBe(0);
    expect(stderr).not.toMatch(/FUTURE/);
  });
});

describe('the staleness gate this one sits next to is unchanged', () => {
  it('still refuses a snapshot older than the budget, and says by how much', () => {
    const { code, stderr } = runWithCapturedAt(hoursFromNow(-48));
    expect(code).toBe(1);
    expect(stderr).toMatch(/Snapshot is 48\.0h old, budget is 24h/);
  });

  it('still refuses a capturedAt it cannot parse, instead of treating NaN as fresh', () => {
    const { code, stderr } = runWithCapturedAt('sometime last week');
    expect(code).toBe(1);
    expect(stderr).toMatch(/no readable capturedAt/);
  });
});
