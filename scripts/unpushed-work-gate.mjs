#!/usr/bin/env node
/**
 * Resolve and run the shared unpushed-work gate. This file deliberately contains none of the check.
 *
 * The gate answers one question: is the commit you are standing on held by any remote? It exists
 * because two sessions hit the same defect independently on 2026-07-27, hours apart, in this repo.
 * Mine: `git push origin main` while HEAD was on a feature branch. Git pushed the local `main` ref,
 * which had not moved, reported success, and the follow-up `echo "pushed $(git rev-parse HEAD)"`
 * printed the BRANCH commit — so four consecutive commits were reported as pushed to main and none
 * of them were. Theirs: `git rev-list --count main..origin/main` returning `ahead: 0` about a branch
 * the checkout was not on, which is the number a person runs specifically to confirm their work is
 * safe, returning the hoped-for answer about something else.
 *
 * Both are the same shape: a status line that reads a different ref than the one the work is on.
 *
 * WHY A RESOLVER AND NOT A COPY. The check's entire value is being identical everywhere; the copy
 * that drifts is the one that stops catching the bug. So this looks for the real implementation and
 * refuses to invent a fallback — a local reimplementation that silently passes would be worse than
 * having no gate, because it would be believed.
 *
 * Verified against the failure it exists for: a commit made in a fresh worktree and not pushed
 * exits 1 and names the branch to push. It does NOT claim to catch work pushed to the wrong branch
 * — reachable-from-some-remote is a weaker property than reachable-from-the-branch-you-meant, and
 * the gate is honest about which one it proves.
 *
 * Usage: node scripts/unpushed-work-gate.mjs [--repo <path>] [--allow-dirty]
 * Exit:  0 reachable · 1 no remote holds HEAD · 2 tracked files modified · 3 not a repo
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

/**
 * Candidates in preference order. The published package first, because that is the copy everyone
 * else gets; the sibling checkout second, for this machine before `@homenshum/nodekit` publishes
 * (blocked on the licence decision, DECOUPLING_PLAN.md §8 D2).
 */
const SIBLING = path.resolve(
  here,
  '../../cafecorner_nodebench/nodebench_ai4/node-platform/scripts/unpushed-work-gate.mjs',
);

const viaNpx = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['--no-install', 'nodekit-unpushed-work-gate', ...args],
  { stdio: 'inherit' },
);
if (viaNpx.status !== null && viaNpx.status !== 127) process.exit(viaNpx.status);

if (existsSync(SIBLING)) {
  const viaSibling = spawnSync(process.execPath, [SIBLING, ...args], { stdio: 'inherit' });
  process.exit(viaSibling.status ?? 1);
}

process.stderr.write(
  `unpushed-work-gate is not available here.
  Tried: npx nodekit-unpushed-work-gate (not installed — @homenshum/nodekit is not published yet)
  Tried: ${SIBLING} (not present)
Refusing to substitute a local reimplementation. A second copy of this check is how it drifts,
and a drifted gate that passes is worse than no gate, because it gets believed.
`,
);
process.exit(3);
