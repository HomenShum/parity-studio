/**
 * Claim gate — decide each claim in a manifest against a receipt, and refuse to round up.
 *
 * The post this exists for makes nine claims of six different kinds. One recording can establish
 * some of them; nothing establishes the positioning one. Run this before any of that copy goes out,
 * and it prints exactly which sentences the evidence supports.
 *
 * Usage:
 *   node scripts/nodeslide-claim-gate.mjs --manifest qa/claims/<set>.json [--receipt <run>.json]
 *                                         [--json]
 *
 * Exit 1 when a required claim did not reach a proof verdict — including when it was never run,
 * which is the case a summary line hides most easily. Exit 0 with unproven claims listed is a
 * legitimate outcome: it means nothing REQUIRED is outstanding, not that everything is proven.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

// The evaluator stays in TypeScript beside the rest of the contract layer — one source of truth is
// worth more than avoiding this import. Node 22.18+ strips types natively; on anything older the
// bare import fails with a module error that says nothing useful, so check first and say what.
if (process.features.typescript !== 'strip') {
  process.stderr.write(
    `This gate imports shared/nodeslideClaimProof.ts directly and needs native type stripping (Node 22.18+ or 23.6+). Running ${process.version}, where process.features.typescript is ${String(process.features.typescript)}.\n`,
  );
  process.exit(1);
}
const { evaluateAutonomy, evaluateClaimSet } = await import('../shared/nodeslideClaimProof.ts');

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

const readJson = async (file) =>
  JSON.parse((await readFile(path.resolve(file), 'utf8')).replace(/^﻿/, ''));

const flags = parseArgs(process.argv.slice(2));
const manifestPath = flags.get('manifest');
if (typeof manifestPath !== 'string') {
  process.stderr.write('--manifest is required.\n');
  process.exit(1);
}

const manifest = await readJson(manifestPath);
// No receipt is the honest default: every claim reports not-run rather than the gate refusing to
// speak. "Nothing has been measured yet" is a legitimate, publishable state.
const receipt =
  typeof flags.get('receipt') === 'string'
    ? await readJson(flags.get('receipt'))
    : { evidence: [] };

const report = evaluateClaimSet({
  claimSet: manifest.claimSet,
  definitions: manifest.claims,
  evidence: receipt.evidence ?? [],
  requiredScenarios: manifest.requiredScenarios ?? [],
});

const autonomy = receipt.autonomy
  ? evaluateAutonomy(receipt.autonomy, manifest.autonomyBudget)
  : null;

if (flags.get('json') === true) {
  process.stdout.write(`${JSON.stringify({ ...report, autonomy }, null, 2)}\n`);
} else {
  const SYMBOL = {
    passed: 'PROVEN  ',
    'supported-by-separate-benchmark': 'PROVEN* ',
    failed: 'FAILED  ',
    'partially-proven': 'PARTIAL ',
    'in-progress': 'WIP     ',
    'not-run': 'NOT RUN ',
    'positioning-only': 'FRAMING ',
  };
  const byId = new Map(manifest.claims.map((c) => [c.id, c]));
  const lines = [
    `Claim gate — ${manifest.claimSet} (${path.basename(manifestPath)})`,
    `  ${report.summary}`,
    '',
  ];
  for (const decision of report.decisions) {
    const definition = byId.get(decision.claimId);
    lines.push(
      `  ${SYMBOL[decision.verdict] ?? decision.verdict} ${decision.claimId}  [${decision.proof}${definition?.required ? ', required' : ''}]`,
    );
    lines.push(`            "${definition?.statement ?? ''}"`);
    lines.push(`            ${decision.reason}`);
    if (decision.missingEvidence.length > 0) {
      lines.push(`            missing: ${decision.missingEvidence.join(', ')}`);
    }
    lines.push('');
  }
  if (autonomy) {
    lines.push(
      `  autonomy: ${autonomy.withinBudget ? 'within budget' : 'OUTSIDE BUDGET'}${autonomy.reasons.length ? ` — ${autonomy.reasons.join(' ')}` : ''}`,
      '',
    );
  }
  lines.push(
    '  PROVEN* is carried by a separate benchmark receipt, not by the live run.',
    '  FRAMING is market positioning and has no provable form — it is not a weaker pass.',
    `  Verdict: ${report.verdict.toUpperCase()} (${report.provenClaims.length} presentable as proven, ${report.unprovenClaims.length} not)`,
  );
  process.stdout.write(`${lines.join('\n')}\n`);
}

process.exit(report.verdict === 'pass' ? 0 : 1);
