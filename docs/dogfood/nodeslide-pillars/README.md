# NodeSlide pillars proof bundle

Date: 2026-07-10
Scope: prompt-independent NodeSlide product work on `feature/nodeslide-domain`

This directory contains reproducible receipts for the five Pillars workstreams. Receipts are generated from product-owned inputs and sanitized of capability keys, provider secrets, raw model responses, and local absolute paths.

## Expected receipts

| Receipt | Proves |
|---|---|
| `w1-signature-proof.json` | deterministic bounded PPTX signature extraction and golden-deck observations |
| `w2-signature-apply-proof.json` | two distinct signatures, durable profile JSON transport, production 53-operation apply, on-brand validation, history/CAS, and 512/513 bounds |
| `w3-variation-proof.json` | three validated variants, honest fallback, review-before-accept, bounded retention |
| `w4-preference-proof.json` | tenant-scoped events, provenance/evaluator gate, replayed preference signal |
| `w5-taste-pack-proof.json` | cited pack schemas, citation coverage, contrast/font validation |
| `integrated-launch-proof.json` | fresh/repeat browser journey across signature, variants, profile-aware acceptance, preference memory, present/share/export, responsive checks, and launch verdict |

## Bundle integrity

- All six receipts are valid JSON and use sanitized deterministic artifact IDs or digests.
- W1-W4 and the integrated launch receipt report the eight reliability checks: `BOUND`, `HONEST_STATUS`, `HONEST_SCORES`, `TIMEOUT`, `SSRF`, `BOUND_READ`, `ERROR_BOUNDARY`, and `DETERMINISTIC`.
- W5 reports its six pack-specific gates: parseability, rule citation coverage, citation reachability, contrast/font safety, deterministic serialization, and non-affiliation disclosure.
- Runtime bounds, deviations, and source-state metadata are recorded by the workstream where they are relevant; no receipt contains owner capabilities, provider secrets, or raw model responses.

## IP boundary

No Build Challenge prompt, evaluator material, confidential counterparty material, or challenge-repository code is an input to these receipts. Future challenge work must remain in a fresh repository and may consume only deliberately published package interfaces.
