/**
 * Decide what to work on next, from measured signals rather than from whatever is in front of you.
 *
 * This exists because of a specific failure. On 2026-07-25 an entire session went into NodeSlide UI
 * polish — type scale, inspector grouping, a notes strip. Meanwhile the same product scored lowest
 * of thirteen repos on its P0 contract, and the single highest-priority item on its own board had
 * been sitting send-ready and overdue for seven days. Nothing was lazy about that work. It was
 * chosen by proximity, because nothing ranked the alternatives.
 *
 * The rank is deliberately boring:
 *
 *   score = priorityWeight x statusWeight x agingMultiplier
 *
 * with two hard overrides that no amount of P2 volume can outvote:
 *   - anything past a stated deadline goes to the top, permanently, until it moves
 *   - anything whose only blocker is a human decision is reported separately, because an agent
 *     working around it is an agent working on the wrong thing
 *
 * Fails closed on a stale snapshot. Ranking a board nobody has refreshed is how a 13-day-overdue P0
 * stays invisible while the queue looks healthy.
 *
 * Usage: node tools/brain/decide.mjs [--max-snapshot-age-hours 24] [--json]
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not a hand-rolled slice: this repo lives under "VSCode Projects" and the space
// arrives percent-encoded, which silently resolves to a path that does not exist.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLATFORM = 'D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/node-platform';

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const asJson = process.argv.includes('--json');
const maxAgeHours = Number(flag('max-snapshot-age-hours', 24));

const PRIORITY = { P0: 100, P1: 30, P2: 8 };
const STATUS = { Blocked: 1.6, 'In Progress': 1.15, Todo: 1, Done: 0 };

const snapshot = JSON.parse(await readFile(path.join(HERE, 'notion-snapshot.json'), 'utf8'));
const ageHours = (Date.now() - Date.parse(snapshot.capturedAt)) / 36e5;
if (!Number.isFinite(ageHours)) {
  process.stderr.write('Snapshot has no readable capturedAt. Refusing to rank.\n');
  process.exit(1);
}
// A negative age means the snapshot is stamped in the future — a clock skew, a hand-typed
// timestamp, or a copied file. The first version of this gate only checked the upper bound, so a
// future stamp sailed through and the staleness check could never fire. A fail-closed gate that
// accepts an impossible input is not fail-closed; it is a gate with a hole shaped like optimism.
// Small tolerance for genuine clock skew between machines, then refuse.
if (ageHours < -0.25) {
  process.stderr.write(
    `Snapshot is stamped ${Math.abs(ageHours).toFixed(1)}h in the FUTURE. Refusing to rank.\n  capturedAt  ${snapshot.capturedAt}\n  now         ${new Date().toISOString()}\nA future timestamp means the staleness check can never fire, so the queue would look fresh forever. Fix capturedAt in notion-snapshot.json.\n`,
  );
  process.exit(1);
}
if (ageHours > maxAgeHours) {
  process.stderr.write(
    `Snapshot is ${ageHours.toFixed(1)}h old, budget is ${maxAgeHours}h. Refusing to rank.\nRe-query the Notion view and rewrite notion-snapshot.json. A queue built on a stale board hides exactly the item that has been sitting longest.\n`,
  );
  process.exit(1);
}

/** Objective gaps the dashboard measured, which the board does not know about. */
const status = await readFile(path.join(PLATFORM, 'docs/ECOSYSTEM_STATUS.md'), 'utf8').catch(
  () => '',
);
const measured = [];
for (const row of status.split('\n')) {
  const m = row.match(
    /^\|\s*NodeSlide\s*\|\s*(\w+)\s*\|\s*([\w-]+)\s*\|.*?\|\s*(\w[\w-]*)\s*\|\s*(\w+)\s*\|\s*(\d+)\s*\|\s*(\d+)\/8/,
  );
  if (!m) continue;
  const [, , , noKey, proof, , p0] = m;
  if (Number(p0) < 8) {
    measured.push({
      item: `NodeSlide P0 contract is ${p0}/8 — lowest of 13 repos`,
      why: 'nodekit dashboard, regenerated from each repo nodekit.yaml',
      priority: 'P0',
      status: 'Todo',
      source: 'measured',
    });
  }
  if (/missing/i.test(proof)) {
    measured.push({
      item: 'NodeSlide proof schema is MISSING',
      why: 'every 8/8 repo declares one; NodeSlide does not',
      priority: 'P1',
      status: 'Todo',
      source: 'measured',
    });
  }
  if (/partial/i.test(noKey)) {
    measured.push({
      item: 'NodeSlide key-free certification is only partial',
      why: 'ten of thirteen repos are certified',
      priority: 'P1',
      status: 'Todo',
      source: 'measured',
    });
  }
}

const today = Date.now();
const rows = [...snapshot.rows.map((r) => ({ ...r, source: 'notion' })), ...measured]
  .filter((r) => r.status !== 'Done')
  .map((r) => {
    const overdueDays = r.deadline ? Math.floor((today - Date.parse(r.deadline)) / 864e5) : 0;
    // Aging is capped. An old item should shout, but it should never drown out a live P0.
    const aging = 1 + Math.min(overdueDays, 30) / 10;
    const score =
      (PRIORITY[r.priority] ?? 5) * (STATUS[r.status] ?? 1) * (overdueDays > 0 ? aging : 1);
    return { ...r, overdueDays, score: Math.round(score) };
  })
  .sort((a, b) => b.score - a.score || a.item.localeCompare(b.item));

const humanBlocked = rows.filter((r) => r.blockedOnHuman);
const agentWork = rows.filter((r) => !r.blockedOnHuman);

if (asJson) {
  process.stdout.write(
    `${JSON.stringify({ snapshotAgeHours: Number(ageHours.toFixed(1)), humanBlocked, agentWork }, null, 2)}\n`,
  );
} else {
  const lines = [`Decision queue — snapshot ${ageHours.toFixed(1)}h old`, ''];
  if (humanBlocked.length > 0) {
    lines.push(
      'WAITING ON A HUMAN — an agent cannot advance these, and working around them is working on the wrong thing:',
    );
    for (const r of humanBlocked) {
      lines.push(`  ${String(r.score).padStart(4)}  ${r.item}`);
      lines.push(
        `        ${r.overdueDays > 0 ? `${r.overdueDays} days past its deadline. ` : ''}${r.note ?? ''}`,
      );
    }
    lines.push('');
  }
  lines.push('AGENT WORK, ranked:');
  for (const r of agentWork.slice(0, 12)) {
    lines.push(`  ${String(r.score).padStart(4)}  [${r.priority}] ${r.item}`);
    if (r.source === 'measured') lines.push(`        measured — ${r.why}`);
  }
  lines.push(
    '',
    `  ${agentWork.length} open items · ${measured.length} from measurement the board does not carry`,
  );
  process.stdout.write(`${lines.join('\n')}\n`);
}
