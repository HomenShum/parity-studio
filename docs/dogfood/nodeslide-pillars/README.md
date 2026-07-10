# NodeSlide pillars proof bundle

Date: 2026-07-10
Scope: prompt-independent NodeSlide product work on `feature/nodeslide-domain`

This directory contains reproducible receipts for the five Pillars workstreams. Receipts are generated from product-owned inputs and sanitized of capability keys, provider secrets, raw model responses, and local absolute paths.

## Expected receipts

| Receipt | Proves |
|---|---|
| `w1-signature-proof.json` | deterministic bounded PPTX signature extraction and golden-deck observations |
| `w2-signature-apply-proof.json` | two distinct signatures, existing-patch application, on-brand validation, history/CAS |
| `w3-variation-proof.json` | three validated variants, honest fallback, review-before-accept, bounded retention |
| `w4-preference-proof.json` | tenant-scoped events, provenance/evaluator gate, replayed preference signal |
| `w5-taste-pack-proof.json` | cited pack schemas, citation coverage, contrast/font validation |
| `integrated-proof.json` | one continuous old-deck → signature → variants → apply → export → preference chain |

## Global artifact gate

Every receipt includes:

- schema/proof version and source commit;
- deterministic input/artifact IDs or digests;
- command/runtime bounds relevant to the workstream;
- binary metric result;
- the eight reliability booleans: `BOUND`, `HONEST_STATUS`, `HONEST_SCORES`, `TIMEOUT`, `SSRF`, `BOUND_READ`, `ERROR_BOUNDARY`, `DETERMINISTIC`;
- explicit deviations or `[]`;
- no status claim without a referenced artifact or assertion.

## IP boundary

No Build Challenge prompt, evaluator material, confidential counterparty material, or challenge-repository code is an input to these receipts. Future challenge work must remain in a fresh repository and may consume only deliberately published package interfaces.
