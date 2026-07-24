/**
 * Trace provenance — the missing half of the trace oracle.
 *
 * The run record was moved out of producer-authored JSON and into a Playwright trace so the
 * producer could not choose what to attest. Then an attacker forged a passing `trace.zip` in about
 * forty lines with no browser: it is NDJSON plus files named `page@<hex>-<epoch>.jpeg`, all of it
 * writable by hand, and deleting one `error` line flipped a REFUSED verdict to CORROBORATED. The
 * parser's own header had claimed a trace "cannot be hand-written". It can.
 *
 * The derivation was never the problem — reading actions and screenshot timestamps out of a trace
 * is sound. What was missing is the reason to believe THIS trace came from a run the producer did
 * not control. That is provenance, and it is a separate claim from content.
 *
 *   content     what the trace says happened        (playwright-trace.mjs)
 *   provenance  why we believe the trace is real    (this module)
 *
 * A trace with no provenance is not an oracle. It is exactly as forgeable as the JSON it replaced,
 * so it fails closed here rather than being scored.
 */

import { createHash } from 'node:crypto';

/**
 * How a trace came to exist, in descending order of trust.
 *
 * `verifier-produced` — the verifier ran the browser itself in this process. Nothing to forge:
 *   the producer never touched the file.
 * `ci-attested` — produced by a CI job the producer cannot write to, and accompanied by an
 *   attestation binding the trace's own bytes. Forging it requires forging the attestation.
 * `unattested` — a file someone handed us. The default, and never oracle-grade.
 */
export const TRACE_PROVENANCE = Object.freeze({
  VERIFIER_PRODUCED: 'verifier-produced',
  CI_ATTESTED: 'ci-attested',
  UNATTESTED: 'unattested',
});

/** Provenance levels that may be treated as independent evidence. */
const ORACLE_GRADE = Object.freeze([
  TRACE_PROVENANCE.VERIFIER_PRODUCED,
  TRACE_PROVENANCE.CI_ATTESTED,
]);

export function isOracleGrade(provenance) {
  return ORACLE_GRADE.includes(provenance);
}

/** sha256 of the trace bytes. The attestation binds to this, so swapping the file breaks it. */
export function traceDigest(buffer) {
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
}

/**
 * Decide a trace's provenance.
 *
 * Deliberately conservative in three ways, each of which is a hole someone would otherwise walk
 * through:
 *
 *   - An attestation that does not name the trace's own digest is rejected. Otherwise a valid
 *     attestation for run A could be replayed over a forged trace B.
 *   - An attestation whose digest does not MATCH the bytes we hashed is rejected, which is the
 *     same attack one step later: keep the attestation, swap the file.
 *   - A `verifierProduced` claim is only honoured when this process produced it, signalled by a
 *     token the verifier minted at run start. A caller-supplied boolean would just move the
 *     forgery up one level.
 */
export function decideTraceProvenance({
  buffer = null,
  digest = null,
  attestation = null,
  verifierRunToken = null,
  expectedRunToken = null,
} = {}) {
  const actualDigest = digest ?? (buffer ? traceDigest(buffer) : null);

  if (!actualDigest) {
    return {
      provenance: TRACE_PROVENANCE.UNATTESTED,
      oracleGrade: false,
      reason: 'no trace bytes or digest supplied, so nothing could be bound or checked.',
    };
  }

  // Strongest: the verifier ran the browser in this process.
  if (verifierRunToken && expectedRunToken && verifierRunToken === expectedRunToken) {
    return {
      provenance: TRACE_PROVENANCE.VERIFIER_PRODUCED,
      oracleGrade: true,
      digest: actualDigest,
      reason: 'the verifier produced this trace in-process; the producer never handled the file.',
    };
  }
  if (verifierRunToken && verifierRunToken !== expectedRunToken) {
    return {
      provenance: TRACE_PROVENANCE.UNATTESTED,
      oracleGrade: false,
      digest: actualDigest,
      reason:
        'a verifier-produced claim was made with a token this run did not mint, which is what a forged claim looks like.',
    };
  }

  if (!attestation) {
    return {
      provenance: TRACE_PROVENANCE.UNATTESTED,
      oracleGrade: false,
      digest: actualDigest,
      reason:
        'no attestation accompanies this trace, so it is exactly as forgeable as the producer JSON it replaced — a trace.zip is NDJSON plus named JPEGs and can be written by hand.',
    };
  }
  if (!attestation.traceDigest) {
    return {
      provenance: TRACE_PROVENANCE.UNATTESTED,
      oracleGrade: false,
      digest: actualDigest,
      reason:
        'the attestation names no trace digest, so it does not bind to this file and could be replayed over any other.',
    };
  }
  if (attestation.traceDigest !== actualDigest) {
    return {
      provenance: TRACE_PROVENANCE.UNATTESTED,
      oracleGrade: false,
      digest: actualDigest,
      reason: `the attestation binds ${attestation.traceDigest} but these bytes hash to ${actualDigest} — the file was swapped after it was attested.`,
    };
  }
  if (!attestation.runnerIdentity) {
    return {
      provenance: TRACE_PROVENANCE.UNATTESTED,
      oracleGrade: false,
      digest: actualDigest,
      reason:
        'the attestation names no runner identity, so there is nothing to say the producer could not have issued it themselves.',
    };
  }

  return {
    provenance: TRACE_PROVENANCE.CI_ATTESTED,
    oracleGrade: true,
    digest: actualDigest,
    runnerIdentity: attestation.runnerIdentity,
    reason: `attested by ${attestation.runnerIdentity}, bound to ${actualDigest}.`,
  };
}

/**
 * Gate a derived run record on its provenance.
 *
 * The record's CONTENT is left untouched — what the trace says happened is still worth reporting.
 * What changes is whether it may be used as corroboration. An unattested trace yields
 * `usableAsEvidence: false`, so a consumer that scores it has to do so knowingly rather than by
 * default, and the honest verdict is `not-run` rather than a pass.
 */
export function gateRecordByProvenance(record, provenanceDecision) {
  return {
    ...record,
    provenance: provenanceDecision.provenance,
    provenanceReason: provenanceDecision.reason,
    usableAsEvidence: Boolean(provenanceDecision.oracleGrade) && Boolean(record?.hasEvidence),
  };
}
