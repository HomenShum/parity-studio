/**
 * The scenario is the one that actually happened here.
 *
 * A person is about to publish a post saying a coding agent built the deck. The claim gate reads a
 * receipt, sees `"playwright-trace"` in the evidence list, and prints PROVEN. Nobody checked that a
 * trace existed. The producer wrote the receipt.
 *
 * These tests are the adversary. Each one is a way to get a pass without a real recording, and each
 * must come back as "not proven" rather than as a pass — but a real verifier-produced trace must
 * still get through, because a gate that refuses everything proves nothing and gets switched off.
 */

import { expect, test } from 'vitest';
import { bindTraceEvidence, isTraceBackedKind } from '../lib/claim-trace-binding.mjs';
import { TRACE_PROVENANCE } from '../lib/trace-provenance.mjs';

const receipt = (over = {}) => ({
  claimId: 'c-agent-builds',
  present: ['playwright-trace', 'agent-transcript'],
  holds: true,
  ...over,
});

const goodTrace = (over = {}) => ({
  claimId: 'c-agent-builds',
  provenance: TRACE_PROVENANCE.VERIFIER_PRODUCED,
  oracleGrade: true,
  usableAsEvidence: true,
  digest: 'sha256:abc',
  reason: 'the verifier produced this trace in-process.',
  ...over,
});

test('the attack that shipped: a receipt names a trace, and no trace exists', () => {
  const result = bindTraceEvidence({ evidence: [receipt()], traces: [] });

  expect(result.evidence[0].present).toEqual(['agent-transcript']);
  expect(result.strippedClaimIds).toEqual(['c-agent-builds']);
  expect(result.notes[0]).toMatch(/no trace file was supplied/u);
  // The reason travels with the evidence, so the gate's own output says why, not just that.
  expect(result.evidence[0].detail).toMatch(/removed by the gate/u);
});

test('a hand-written trace.zip does not become evidence', () => {
  // This is forgeable in about forty lines: NDJSON plus files named page@<hex>-<epoch>.jpeg.
  const result = bindTraceEvidence({
    evidence: [receipt()],
    traces: [
      goodTrace({
        provenance: TRACE_PROVENANCE.UNATTESTED,
        oracleGrade: false,
        reason: 'no attestation accompanies this trace.',
      }),
    ],
  });

  expect(result.evidence[0].present).toEqual(['agent-transcript']);
  expect(result.notes[0]).toMatch(/not oracle-grade/u);
});

test('an attested trace that recorded nothing is not evidence either', () => {
  // Provenance says the file is real. That does not make an empty recording a proof.
  const result = bindTraceEvidence({
    evidence: [receipt()],
    traces: [goodTrace({ usableAsEvidence: false })],
  });

  expect(result.evidence[0].present).toEqual(['agent-transcript']);
  expect(result.notes[0]).toMatch(/carries no usable evidence/u);
});

test('a real verifier-produced trace passes through untouched', () => {
  const entry = receipt();
  const result = bindTraceEvidence({ evidence: [entry], traces: [goodTrace()] });

  expect(result.evidence[0].present).toEqual(['playwright-trace', 'agent-transcript']);
  expect(result.strippedClaimIds).toEqual([]);
  expect(result.notes[0]).toMatch(/trace bound — verifier-produced, sha256:abc/u);
  expect(result.evidence[0].detail, 'a passing claim gets no removal note').toBe(undefined);
});

test('a CI-attested trace is accepted, because the producer cannot write to that runner', () => {
  const result = bindTraceEvidence({
    evidence: [receipt()],
    traces: [goodTrace({ provenance: TRACE_PROVENANCE.CI_ATTESTED })],
  });

  expect(result.evidence[0].present).toEqual(['playwright-trace', 'agent-transcript']);
});

test('a weak trace supplied beside a strong one cannot cancel it', () => {
  // Otherwise an attacker adds a junk file to a claim that has a real recording and takes it down.
  const result = bindTraceEvidence({
    evidence: [receipt()],
    traces: [
      goodTrace({
        provenance: TRACE_PROVENANCE.UNATTESTED,
        oracleGrade: false,
        digest: 'sha256:x',
      }),
      goodTrace(),
    ],
  });

  expect(result.evidence[0].present).toEqual(['playwright-trace', 'agent-transcript']);
});

test('order does not decide the outcome', () => {
  const result = bindTraceEvidence({
    evidence: [receipt()],
    traces: [
      goodTrace(),
      goodTrace({
        provenance: TRACE_PROVENANCE.UNATTESTED,
        oracleGrade: false,
        digest: 'sha256:x',
      }),
    ],
  });

  expect(result.evidence[0].present).toEqual(['playwright-trace', 'agent-transcript']);
});

test('a trace cannot add evidence the receipt never claimed', () => {
  // The gate reports the spare file rather than arguing a case the producer did not make.
  const result = bindTraceEvidence({
    evidence: [receipt({ claimId: 'c-other', present: ['agent-transcript'] })],
    traces: [goodTrace()],
  });

  expect(result.evidence[0].present).toEqual(['agent-transcript']);
  expect(result.strippedClaimIds.length).toBe(0);
  expect(result.notes.join(' ')).toMatch(/not applied/u);
});

test('claims with no trace evidence are left exactly as they were', () => {
  const entry = receipt({ present: ['agent-transcript', 'source-commit'] });
  const result = bindTraceEvidence({ evidence: [entry], traces: [] });

  expect(result.evidence[0], 'the entry is passed through by identity, not rebuilt').toBe(entry);
  expect(result.notes).toEqual([]);
});

test('one journey recording may back several claims it genuinely covers', () => {
  // A single verifier-produced run of the full journey legitimately corroborates more than one
  // claim. Refusing reuse would push producers toward recording the same session many times.
  const result = bindTraceEvidence({
    evidence: [receipt(), receipt({ claimId: 'c-agent-edits' })],
    traces: [goodTrace(), goodTrace({ claimId: 'c-agent-edits' })],
  });

  expect(result.strippedClaimIds.length).toBe(0);
  expect(result.notes.filter((n) => /trace bound/u.test(n)).length).toBe(2);
});

test('the trace-backed kind list is the thing under guard', () => {
  expect(isTraceBackedKind('playwright-trace')).toBe(true);
  expect(isTraceBackedKind('agent-transcript')).toBe(false);
});
