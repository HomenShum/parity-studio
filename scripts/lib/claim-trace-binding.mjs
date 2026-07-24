/**
 * Bind a claim's declared trace evidence to an actual trace file, or take the claim away.
 *
 * The claim gate reads a receipt JSON whose evidence entries say which kinds were present:
 *
 *   { "claimId": "c-agent-builds", "present": ["playwright-trace", "agent-transcript"], "holds": true }
 *
 * That string is a producer assertion. The gate believed it. So the whole trace-oracle work —
 * deriving the run record from the trace instead of from producer JSON, then deciding the trace's
 * provenance — stopped one step short of the decision it was built for. A producer could write
 * `"playwright-trace"` into a receipt and never supply a trace at all, and the claim passed.
 *
 * This module closes that step. A trace-backed evidence kind survives only when:
 *
 *   1. a trace file was actually supplied to the gate for that claim,
 *   2. its provenance is oracle-grade (verifier-produced or CI-attested — see trace-provenance.mjs),
 *   3. and the record derived from its bytes actually contains evidence.
 *
 * When any of those fails, the kind is REMOVED from `present` rather than the claim being marked
 * failed. That routes it into the gate's existing honest path: `decideClaim` reports `not-run` with
 * `missing: playwright-trace`, which is the true statement. A missing proof is not a disproof, and
 * inventing a `failed` verdict here would be the same rounding error in the other direction.
 */

import { isOracleGrade } from './trace-provenance.mjs';

/** Evidence kinds that may only be asserted by a verified trace. */
export const TRACE_BACKED_EVIDENCE_KINDS = Object.freeze(['playwright-trace']);

export function isTraceBackedKind(kind) {
  return TRACE_BACKED_EVIDENCE_KINDS.includes(kind);
}

/**
 * @param {object} input
 * @param {ReadonlyArray<object>} input.evidence  receipt evidence entries
 * @param {ReadonlyArray<object>} input.traces    one per supplied file:
 *   { claimId, provenance, oracleGrade, usableAsEvidence, digest, reason, path }
 * @returns {{ evidence: object[], notes: string[], strippedClaimIds: string[] }}
 */
export function bindTraceEvidence({ evidence = [], traces = [] } = {}) {
  const byClaim = new Map();
  for (const trace of traces) {
    // Several traces for one claim: keep the strongest. A weak file supplied alongside a strong one
    // must not be the one that decides, and a strong one must not be cancelled by a weak one.
    const existing = byClaim.get(trace.claimId);
    if (!existing || (!existing.oracleGrade && trace.oracleGrade))
      byClaim.set(trace.claimId, trace);
  }

  const notes = [];
  const strippedClaimIds = [];
  const usedClaimIds = new Set();

  const bound = evidence.map((entry) => {
    const declared = (entry.present ?? []).filter(isTraceBackedKind);
    if (declared.length === 0) return entry;

    const trace = byClaim.get(entry.claimId);
    usedClaimIds.add(entry.claimId);

    let problem = null;
    if (!trace) {
      problem =
        'the receipt declares a Playwright trace but no trace file was supplied to the gate, so the string is a producer assertion and nothing else';
    } else if (!isOracleGrade(trace.provenance)) {
      problem = `the supplied trace is not oracle-grade — ${trace.reason ?? 'provenance is unattested'}`;
    } else if (trace.usableAsEvidence === false) {
      problem = `the trace is ${trace.provenance} but the record derived from its bytes carries no usable evidence`;
    }

    if (!problem) {
      notes.push(
        `${entry.claimId}: trace bound — ${trace.provenance}${trace.digest ? `, ${trace.digest}` : ''}.`,
      );
      return entry;
    }

    strippedClaimIds.push(entry.claimId);
    notes.push(`${entry.claimId}: trace evidence removed — ${problem}.`);
    const detail = [entry.detail, `Trace evidence was removed by the gate: ${problem}.`]
      .filter(Boolean)
      .join(' ');
    return {
      ...entry,
      present: (entry.present ?? []).filter((kind) => !isTraceBackedKind(kind)),
      detail,
    };
  });

  // A trace handed to the gate for a claim whose receipt never declared one is reported, not
  // silently applied. Adding evidence the receipt did not claim would let the gate argue a case the
  // producer never made.
  for (const claimId of byClaim.keys()) {
    if (!usedClaimIds.has(claimId)) {
      notes.push(
        `${claimId}: a trace was supplied but the receipt declares no trace evidence for this claim; it was not applied.`,
      );
    }
  }

  return { evidence: bound, notes, strippedClaimIds };
}
