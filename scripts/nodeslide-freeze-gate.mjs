/**
 * Refuse new NodeSlide work in parity-studio.
 *
 * NodeSlide has its own repo and its own deployment. Development never fully moved, and the cost of
 * that is measured rather than suspected: three board rows asserted features did not exist while
 * all three sat here unported, and two repos stayed green for months while drifting apart, because
 * green in parity says nothing about nodeslide.vercel.app.
 *
 * A freeze written in a docs file is a freeze that depends on remembering. This one is a check.
 *
 * The rule is asymmetric on purpose:
 *   - ADDING or MODIFYING a NodeSlide file here is refused. That work belongs in the product repo.
 *   - DELETING one is allowed, because Phase 3 of the decoupling plan is exactly a large deletion,
 *     and a gate that blocks its own exit is a gate nobody can satisfy.
 *
 * A pure rename registers as a delete plus an add, so the add half is refused and the move has to be
 * made deliberately rather than slipping through as a tidy-up.
 *
 * Escape hatch: PR label `freeze-exempt`, passed here as --exempt. It exists because a freeze with
 * no exemption gets bypassed by turning the whole job off, which is worse than an exemption anyone
 * can see on the pull request.
 *
 * Usage: node scripts/nodeslide-freeze-gate.mjs --base <ref> [--exempt]
 */

import { execFileSync } from 'node:child_process';

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};

const base = flag('base', 'origin/main');
const exempt = process.argv.includes('--exempt');

/** Paths that belong to the product repo. Kept narrow: a broad pattern would refuse unrelated work. */
const FROZEN = [/^src\/domains\/nodeslide\//, /^scripts\/nodeslide-/, /^shared\/nodeslide/];

let diff = '';
try {
  // --diff-filter is deliberately not used: the status letter is what decides, and reading it here
  // keeps the add/delete asymmetry visible in this file rather than hidden in a git flag.
  diff = execFileSync('git', ['diff', '--name-status', `${base}...HEAD`], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
} catch (error) {
  // A gate that cannot read the diff must not report a pass. It has established nothing.
  process.stderr.write(
    `Could not diff against ${base}, so nothing was checked: ${error.message}\nRefusing to report a pass on an unread diff.\n`,
  );
  process.exit(1);
}

const offending = [];
for (const line of diff.split('\n')) {
  if (!line.trim()) continue;
  const [status, ...paths] = line.split('\t');
  const path = paths[paths.length - 1];
  if (status.startsWith('D')) continue;
  if (FROZEN.some((pattern) => pattern.test(path))) offending.push({ status, path });
}

if (offending.length === 0) {
  process.stdout.write('No NodeSlide files added or modified.\n');
  process.exit(0);
}

const listing = offending.map((f) => `  ${f.status}  ${f.path}`).join('\n');

if (exempt) {
  process.stdout.write(
    `${offending.length} frozen file(s) touched, allowed by the freeze-exempt label:\n${listing}\n`,
  );
  process.exit(0);
}

process.stderr.write(
  `${offending.length} NodeSlide file(s) added or modified in parity-studio:\n${listing}\n\nNodeSlide ships from HomenShum/NodeSlide. A change made here does not reach the deployed\nproduct, and the two copies drift silently because both test suites are repo-local.\n\nMove the change to the product repo, or add the freeze-exempt label if it genuinely belongs\nhere and say why in the pull request.\n`,
);
process.exit(1);
