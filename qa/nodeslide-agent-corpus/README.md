# NodeSlide Agent Request Corpus benchmark

This directory fixes the NodeSlide agent benchmark inputs and evidence contracts. The registry
contains all 167 source cases in 16 categories. The 20 JSON files in `fixtures/` are the complete
minimum-release suite; their request strings are exact matches to the registry.

The source attachment is bound by SHA-256
`2254643bb268e2affd5a177e8b572818ed3c94b16f1f382354ebaa8a7462c862`. Outer smart quotes used
as Markdown table delimiters are not part of a request. Internal punctuation, including smart
quotes and the arrow in R01, is preserved.

## Files

- `registry.json`: every case ID, category, exact request/input, and compact corpus expectation.
- `fixtures/*.json`: the 20 P0 setups, scopes, operations, authority rules, traces, forbidden
  behavior, and deterministic assertions.
- `live-fixtures/*.json`: explicitly selected non-P0 live probes. These never alter the fixed
  20-case minimum-release comparability set; A05 currently verifies the hard per-run cost ceiling.
- `fixture.schema.json`: canonical fixture shape.
- `run-artifact.schema.json` and `run-record.schema.json`: supplied UXBench evidence contracts.
- `taste-artifact.schema.json` and `taste-judge.schema.json`: supplied TasteBench evidence
  contracts.
- `taste-rules.json`: evaluator-owned held-out visual rules and fixed thresholds.

## UXBench

UXBench never invokes a model or performs network access. It reads canonical fixtures and supplied
run artifacts only. A run manifest must contain provenance, the exact fixture digest, and exactly
one relative-path `run_record` evidence file. The runner verifies the evidence SHA-256 and byte
length before reading any observation.

The run record captures the exact request, operations, authority events, ordered trace,
observed-forbidden behavior, and case-specific result data. Fixed checks cover primitive operation
counts and scope, allow/deny lists, authority behavior, trace order, and forbidden behavior. The
fixture assertion DSL then reads JSON pointers from the same verified run record.

Run all 20 cases from a directory of `*.manifest.json` files:

```text
node scripts/nodeslide-uxbench.mjs \
  --artifacts path/to/run-artifacts \
  --out path/to/uxbench-report.json
```

Use repeated `--artifact` flags for individual manifests and repeated `--case` flags for a subset.
Without a supplied artifact, a case is `UNSCORED`. A valid artifact that proves a mismatch is
`FAIL`. A case is `PASS` only when every required check has verified evidence. Exit codes are 0 for
PASS, 1 for FAIL, and 2 for UNSCORED or invalid input. Output writes are idempotent and refuse to
replace a nonidentical report.

The fixture digest is `sha256(stableStringify(fixture))`; the exported `fixtureDigest` helper in
`scripts/nodeslide-uxbench.mjs` is the canonical implementation.

The opt-in browser producer runs only exact C01, E01, and A05 requests. It keeps anonymous owner
capabilities in memory, queries an owner-authorized secret-free durable receipt, binds that receipt
to a server-stored digest of the exact visible request, writes only under `benchmark-results/`,
and deletes its synthetic C01 deck in a `finally` block. Playwright traces, videos, storage state,
provider responses, source bodies, and capabilities are never evidence artifacts.

## TasteBench

TasteBench consumes separate before and after pixel manifests plus an independent visual-judge
manifest. It does not accept UI strings, self-reported polish labels, or an export/presentation
event as visual proof. Both pixel files must exist, match their declared media signatures, byte
lengths, and SHA-256 digests. The captures must share case, slide, and viewport. Judge evidence must
bind the raw before/after manifest digests, verified pixel IDs, and the evaluator-owned held-out
rules digest. The judge producer must differ from the capture producer.

```text
node scripts/nodeslide-tastebench.mjs \
  --before path/to/before.manifest.json \
  --after path/to/after.manifest.json \
  --judge path/to/judge.json \
  --out path/to/tastebench-results.ndjson
```

Missing pixels or judge evidence is always `UNSCORED`. Complete evidence is evaluated against each
held-out rule and aggregate threshold. The required output is append-only NDJSON: records have
deterministic IDs, replay is idempotent, and each new envelope binds the digest of the previous
envelope. A malformed or broken existing chain is rejected rather than rewritten.

No runner-generated timestamp participates in either report, so identical inputs produce
byte-equivalent JSON values and report IDs.

## Gates

The automation gate has two lanes. The PR lane validates the full 167-request registry, all 20
fixtures, the evidence schemas, deterministic runner behavior, and the runner's no-network and
no-model-invocation rule. The evidence lane accepts only explicitly supplied manifests. It writes
deterministic reports plus append-only hash-chained run and reward logs under its output directory.
The scheduled live lane produces C01/E01/A05 browser receipts against production, judges E01 pixels
with the independently pinned vision route, and enforces both UXBench and TasteBench. Missing
credentials, pixels, receipts, or model output remain `UNSCORED`; observed mismatches remain
`FAIL`.

```text
pnpm nodeslide:bench:pr
pnpm nodeslide:bench:evidence -- --evidence path/to/manifests --out benchmark-results
pnpm nodeslide:bench:produce-live
```

Evidence is never inferred from the repository. With no manifests, the evidence lane reports
`UNSCORED` and exits 2; `--enforce` converts both `FAIL` and `UNSCORED` into a failing gate (exit
1). Generated CI output belongs in workflow artifacts, not in the repository.

```text
pnpm exec vitest run scripts/tests/nodeslide-uxbench.test.mjs \
  scripts/tests/nodeslide-tastebench.test.mjs
pnpm exec biome check scripts/nodeslide-uxbench.mjs scripts/nodeslide-tastebench.mjs \
  scripts/tests/nodeslide-uxbench.test.mjs scripts/tests/nodeslide-tastebench.test.mjs \
  qa/nodeslide-agent-corpus
```
