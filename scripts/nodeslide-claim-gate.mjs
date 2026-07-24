/**
 * Claim gate — decide each claim in a manifest against a receipt, and refuse to round up.
 *
 * The post this exists for makes nine claims of six different kinds. One recording can establish
 * some of them; nothing establishes the positioning one. Run this before any of that copy goes out,
 * and it prints exactly which sentences the evidence supports.
 *
 * Usage:
 *   node scripts/nodeslide-claim-gate.mjs --manifest qa/claims/<set>.json [--receipt <run>.json]
 *                                         [--trace <claimId>=<trace.zip>]
 *                                         [--attestation <claimId>=<attestation.json>]
 *                                         [--json]
 *
 * Exit 1 when a required claim did not reach a proof verdict — including when it was never run,
 * which is the case a summary line hides most easily. Exit 0 with unproven claims listed is a
 * legitimate outcome: it means nothing REQUIRED is outstanding, not that everything is proven.
 *
 * The receipt is written by the producer, so its evidence list is a set of assertions. The string
 * `"playwright-trace"` in that list used to be enough to decide a claim, which made the whole
 * trace-oracle work decorative: nothing checked that a trace existed, let alone that it was real.
 * Trace-backed evidence now survives only if the file is supplied here with `--trace` AND its
 * provenance is oracle-grade. Anything less is removed from the evidence, and the claim reports
 * `not-run` — the true statement, rather than a pass or an invented failure.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { bindTraceEvidence } from './lib/claim-trace-binding.mjs';
import { deriveRunRecordFromTrace } from './lib/playwright-trace.mjs';

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

// `--trace` and `--attestation` may appear once per claim, so they collect instead of overwriting.
// Every other flag keeps last-wins, which is what a reader expects of `--manifest`.
const REPEATABLE = new Set(['trace', 'attestation']);

function parseArgs(argv) {
  const flags = new Map();
  const repeated = new Map(REPEATABLE.keys ? [...REPEATABLE].map((k) => [k, []]) : []);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.set(name, true);
      continue;
    }
    if (REPEATABLE.has(name)) repeated.get(name).push(next);
    else flags.set(name, next);
    i += 1;
  }
  return { flags, repeated };
}

/** `claimId=path`. The claim id is required — a trace with no claim proves nothing in particular. */
function parsePair(token, flagName) {
  const at = token.indexOf('=');
  if (at <= 0) {
    process.stderr.write(
      `--${flagName} expects <claimId>=<file>, got "${token}". A trace that names no claim cannot be bound to one.\n`,
    );
    process.exit(1);
  }
  return { claimId: token.slice(0, at), file: token.slice(at + 1) };
}

const readJson = async (file) =>
  JSON.parse((await readFile(path.resolve(file), 'utf8')).replace(/^﻿/, ''));

const { flags, repeated } = parseArgs(process.argv.slice(2));
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

// Attestations are keyed by claim so one trace's attestation can never vouch for another's file.
const attestations = new Map();
for (const token of repeated.get('attestation')) {
  const { claimId, file } = parsePair(token, 'attestation');
  attestations.set(claimId, await readJson(file));
}

// Each trace is judged from its own bytes here, in the gate, rather than from anything the receipt
// says about it. The producer supplies the file; the file does not get to describe itself.
const traces = [];
for (const token of repeated.get('trace')) {
  const { claimId, file } = parsePair(token, 'trace');
  const record = await deriveRunRecordFromTrace(path.resolve(file), {
    attestation: attestations.get(claimId) ?? null,
  });
  traces.push({
    claimId,
    path: file,
    provenance: record.provenance,
    reason: record.provenanceReason,
    digest: record.traceDigest,
    usableAsEvidence: record.usableAsEvidence,
    oracleGrade: record.usableAsEvidence,
  });
}

const binding = bindTraceEvidence({ evidence: receipt.evidence ?? [], traces });

const report = evaluateClaimSet({
  claimSet: manifest.claimSet,
  definitions: manifest.claims,
  evidence: binding.evidence,
  requiredScenarios: manifest.requiredScenarios ?? [],
});

const autonomy = receipt.autonomy
  ? evaluateAutonomy(receipt.autonomy, manifest.autonomyBudget)
  : null;

if (flags.get('json') === true) {
  process.stdout.write(
    `${JSON.stringify({ ...report, autonomy, traceBinding: { notes: binding.notes, strippedClaimIds: binding.strippedClaimIds } }, null, 2)}\n`,
  );
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
  // Printed before the verdict, because a removal silently changes what follows it. A gate that
  // takes evidence away without saying so is the same untraceable summary line it exists to stop.
  if (binding.notes.length > 0) {
    lines.push('  trace binding:');
    for (const note of binding.notes) lines.push(`    ${note}`);
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
