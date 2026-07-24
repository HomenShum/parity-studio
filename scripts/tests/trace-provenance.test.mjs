import { describe, expect, it } from 'vitest';
import {
  TRACE_PROVENANCE,
  decideTraceProvenance,
  gateRecordByProvenance,
  isOracleGrade,
  traceDigest,
} from '../lib/trace-provenance.mjs';

/**
 * Written against a confirmed exploit. A passing `trace.zip` was forged in about forty lines with
 * no browser — it is NDJSON plus files named `page@<hex>-<epoch>.jpeg` — and the gate printed
 * CORROBORATED over it, exit 0. Deleting one `error` line flipped REFUSED to CORROBORATED.
 *
 * The parser's derivation was fine. What was missing was any reason to believe the trace came from
 * a run the producer did not control. These tests are mostly about refusing to score that.
 */

const bytes = (s) => Buffer.from(s, 'utf8');
const FORGED = bytes('{"type":"context-options"}\n{"type":"before","callId":"1"}\n');
const REAL = bytes('a real trace produced by a browser');

describe('an unattested trace is not an oracle', () => {
  it('refuses the forged trace: handed over with nothing vouching for it', () => {
    const decision = decideTraceProvenance({ buffer: FORGED });
    expect(decision.provenance).toBe(TRACE_PROVENANCE.UNATTESTED);
    expect(decision.oracleGrade).toBe(false);
    expect(decision.reason).toMatch(/as forgeable as the producer JSON it replaced/);
  });

  it('is unattested when nothing at all is supplied — fails closed, not open', () => {
    const decision = decideTraceProvenance({});
    expect(isOracleGrade(decision.provenance)).toBe(false);
  });

  it('still reports the digest, so an unattested trace is identifiable rather than ignored', () => {
    expect(decideTraceProvenance({ buffer: FORGED }).digest).toBe(traceDigest(FORGED));
  });
});

describe('attestation must bind THESE bytes', () => {
  it('accepts an attestation bound to the trace and naming a runner', () => {
    const decision = decideTraceProvenance({
      buffer: REAL,
      attestation: { traceDigest: traceDigest(REAL), runnerIdentity: 'github-actions/deck-ci' },
    });
    expect(decision.provenance).toBe(TRACE_PROVENANCE.CI_ATTESTED);
    expect(decision.oracleGrade).toBe(true);
  });

  it('REJECTS a valid attestation replayed over a forged trace — the sharpest attack', () => {
    // The attacker keeps a genuine attestation from a real run and swaps the file underneath it.
    const genuine = { traceDigest: traceDigest(REAL), runnerIdentity: 'github-actions/deck-ci' };
    const decision = decideTraceProvenance({ buffer: FORGED, attestation: genuine });
    expect(decision.oracleGrade).toBe(false);
    expect(decision.reason).toMatch(/swapped after it was attested/);
  });

  it('rejects an attestation that binds no digest — it would vouch for any file', () => {
    const decision = decideTraceProvenance({
      buffer: REAL,
      attestation: { runnerIdentity: 'github-actions/deck-ci' },
    });
    expect(decision.oracleGrade).toBe(false);
    expect(decision.reason).toMatch(/does not bind to this file/);
  });

  it('rejects an attestation with no runner identity — nobody is vouching', () => {
    const decision = decideTraceProvenance({
      buffer: REAL,
      attestation: { traceDigest: traceDigest(REAL) },
    });
    expect(decision.oracleGrade).toBe(false);
    expect(decision.reason).toMatch(/no runner identity/);
  });
});

describe('a verifier-produced claim cannot be self-asserted', () => {
  it('accepts it only when the token matches what this run minted', () => {
    const decision = decideTraceProvenance({
      buffer: REAL,
      verifierRunToken: 'run-abc',
      expectedRunToken: 'run-abc',
    });
    expect(decision.provenance).toBe(TRACE_PROVENANCE.VERIFIER_PRODUCED);
    expect(decision.oracleGrade).toBe(true);
  });

  it('REJECTS a claimed token this run did not mint — moving the forgery up one level fails too', () => {
    const decision = decideTraceProvenance({
      buffer: FORGED,
      verifierRunToken: 'i-said-so',
      expectedRunToken: 'run-abc',
    });
    expect(decision.oracleGrade).toBe(false);
    expect(decision.reason).toMatch(/token this run did not mint/);
  });

  it('does not accept a bare claim with no expected token to check against', () => {
    const decision = decideTraceProvenance({ buffer: FORGED, verifierRunToken: 'anything' });
    expect(decision.oracleGrade).toBe(false);
  });
});

describe('gating the record: content survives, usability does not', () => {
  const record = { hasEvidence: true, actions: [{ method: 'click' }], eventCount: 42 };

  it('keeps the content readable but marks an unattested record unusable as evidence', () => {
    const gated = gateRecordByProvenance(record, decideTraceProvenance({ buffer: FORGED }));
    expect(gated.usableAsEvidence).toBe(false);
    // The content is still there — refusing to SCORE it is not the same as discarding it.
    expect(gated.eventCount).toBe(42);
    expect(gated.actions).toHaveLength(1);
    expect(gated.provenanceReason).toMatch(/forgeable/);
  });

  it('marks an attested record usable', () => {
    const gated = gateRecordByProvenance(
      record,
      decideTraceProvenance({
        buffer: REAL,
        attestation: { traceDigest: traceDigest(REAL), runnerIdentity: 'ci' },
      }),
    );
    expect(gated.usableAsEvidence).toBe(true);
  });

  it('an attested trace carrying NO evidence is still unusable — provenance is not content', () => {
    // Provenance says "this really is from a run"; it does not say the run showed anything.
    const empty = { hasEvidence: false, actions: [], eventCount: 0 };
    const gated = gateRecordByProvenance(
      empty,
      decideTraceProvenance({
        buffer: REAL,
        attestation: { traceDigest: traceDigest(REAL), runnerIdentity: 'ci' },
      }),
    );
    expect(gated.usableAsEvidence).toBe(false);
  });
});
