# W1 — NodeSlide signature extractor

Status: **FROZEN — revision 1**
Frozen: 2026-07-10
Owner: NodeSlide product work; prompt-independent prior art
Implementation lane: `feature/nodeslide-domain`

## Outcome

Implement a deterministic, bounded PPTX-to-signature pipeline:

```text
extractSignature({ kind: 'pptx', bytes, fileName? }) -> SignatureExtractionResult
```

The successful result contains a `SignatureProfile` whose token tree is compatible with the Design Tokens Community Group 2025.10 format (`$type`, `$value`, `$description`, `$extensions`), plus presentation-specific layout tendencies and evidence-level provenance. The 2025.10 format is the first stable DTCG community report: <https://www.designtokens.org/TR/2025.10/format/>.

The PPTX route performs no network calls and uses no model. The same bytes and options must produce byte-for-byte equivalent JSON after stable serialization.

Binary metric: on three real reference decks, the extractor recovers at least 90% of the hand-audited theme palette and Latin theme fonts. The audit denominator is the unique expected tokens, not OOXML occurrence count.

## Public contract

The contract lives in `shared/nodeslideSignature.ts`. Implementations may add private helpers but may not rename or weaken these fields.

```ts
export const NODESLIDE_SIGNATURE_SCHEMA_VERSION = 'nodeslide.signature/v1' as const;

export type SignatureSourceKind = 'pptx' | 'pdf' | 'screenshot' | 'taste_pack';
export type SignatureExtractionMethod = 'ooxml' | 'vision' | 'authored';
export type SignatureConfidence = 'high' | 'medium' | 'low';

export interface SignatureTokenEvidenceExtension {
  evidenceIds: string[];
  confidence: number; // finite, 0..1
  occurrences: number; // integer >= 0
  sourceRole: 'theme' | 'master' | 'layout' | 'slide' | 'inferred' | 'authored';
}

export interface SignatureEvidence {
  id: string;
  sourceKind: SignatureSourceKind;
  method: SignatureExtractionMethod;
  sourceDigest: string;
  locator: string;
  observedValue: string;
  confidence: number;
}

export interface SignatureProfile {
  schemaVersion: typeof NODESLIDE_SIGNATURE_SCHEMA_VERSION;
  id: string; // content-derived stable ID
  name: string;
  source: {
    kind: SignatureSourceKind;
    digest: string;
    fileName?: string;
  };
  tokens: {
    colors: Record<string, SignatureColorToken>;
    fontFamilies: Record<string, SignatureFontFamilyToken>;
    fontSizes: Record<string, SignatureDimensionToken>;
  };
  usage: {
    colors: SignatureUsage[];
    fonts: SignatureUsage[];
    fontSizes: SignatureNumericUsage[];
  };
  layout: SignatureLayoutTendencies;
  evidence: SignatureEvidence[];
  confidence: SignatureConfidence;
  warnings: SignatureWarning[];
}

export type SignatureExtractionResult =
  | { ok: true; profile: SignatureProfile; diagnostics: SignatureDiagnostics }
  | { ok: false; error: SignatureExtractionError; diagnostics: SignatureDiagnostics };
```

Concrete token/value interfaces must preserve DTCG semantics:

- color values use `colorSpace: 'srgb'`, three finite `components` in `0..1`, optional `alpha`, and a canonical uppercase `hex` convenience member;
- font-family values are a non-empty string or non-empty string array;
- font-size values are DTCG dimensions in `px`; PPTX points convert with `px = pt * 4 / 3` and retain the original point value in the NodeSlide extension;
- every token carries `$type`, `$value`, and `$extensions['com.nodeslide.signature']`;
- token keys are stable, ASCII-safe slugs. Collisions receive stable numeric suffixes.

The implementation exports:

```ts
extractSignature(input, options?): Promise<SignatureExtractionResult>
extractPptxSignature(bytes, options?): Promise<SignatureExtractionResult>
stableSerializeSignature(profile): string
```

`extractSignature` accepts PPTX bytes in revision 1. PDF and screenshot inputs return the typed `unsupported_input` error rather than inventing observations. A later vision adapter can produce the same contract, but inferred values must carry confidence below `1` and evidence with method `vision`.

## PPTX extraction behavior

Read only bounded OOXML parts required for signature evidence:

- `ppt/theme/theme*.xml`: color scheme and major/minor Latin fonts;
- `ppt/presentation.xml`: slide size and declared slide order;
- `ppt/slideMasters/*.xml` and `ppt/slideLayouts/*.xml`: master/layout counts and style observations;
- `ppt/slides/*.xml`: actual color, font, size, text-run, and shape usage;
- slide and layout relationship parts: layout/master usage frequencies;
- embedded-font declarations and `ppt/fonts/*`: record presence and relationship metadata only; never return or decode font binaries.

Theme aliases such as `+mj-lt`, `+mn-lt`, and scheme colors resolve through the active theme when possible. Unresolved aliases remain explicit warnings; they must not silently become guessed values.

Usage arrays are descending by occurrence count and then ascending by normalized value. Evidence, warnings, token keys, and layout usage are stably sorted. No extraction timestamp is part of the profile.

## Bounds and failure model

Defaults are part of the contract:

| Bound | Default | Behavior when exceeded |
|---|---:|---|
| compressed input | 64 MiB | `input_too_large` |
| ZIP entries | 5,000 | `archive_too_large` |
| slides processed | 200 | `slide_limit_exceeded` for 201+ |
| aggregate XML text | 64 MiB | `archive_too_large` |
| single XML part | 8 MiB | skip part, emit `part_too_large`; fail only if required |
| wall-clock budget | 10,000 ms | `timeout` |
| evidence records | 2,000 | deterministically retain highest-value evidence and emit `evidence_truncated` |
| usage values per category | 128 | retain highest frequency, stable tie-break, emit `usage_truncated` |

The timeout is cooperative and checked between ZIP inflation and part scans. Errors are typed and safe for display; they do not include raw XML, binary data, secrets, or full local paths.

An empty but structurally valid presentation succeeds with a low-confidence profile, zero slide/layout density, any recoverable theme tokens, and an `empty_deck` warning. A corrupt ZIP or package without required presentation metadata fails honestly.

## Layout tendencies

`SignatureLayoutTendencies` includes at minimum:

- slide width/height in inches and aspect ratio;
- slide, master, and layout counts;
- layout usage by stable OOXML part name;
- average and maximum shapes per slide;
- average text runs per slide;
- median observed font size in points when available;
- density classification: `sparse`, `balanced`, `dense`, or `unknown`;
- embedded-font presence and declared font-family names when available.

Classification thresholds must be documented in code and covered by tests. They are descriptive observations, not quality judgments.

## Scenario tests

All fixtures are generated in test code or are product-owned artifacts. No third-party deck is committed without its license and source recorded.

1. **Happy / theme plus usage** — a generated deck with a known theme, explicit slide overrides, two layouts, and known fonts recovers palette, theme fonts, usage counts, slide size, and layout frequencies.
2. **Determinism** — repeated extraction and alternate ZIP entry order produce identical stable serialization and stable IDs.
3. **Corrupt input** — random bytes and a truncated ZIP return `invalid_zip`; no throw escapes the public API.
4. **Not a PPTX** — a valid ZIP without `ppt/presentation.xml` returns `invalid_pptx`.
5. **Empty deck** — a zero-slide OOXML package returns `ok: true`, low confidence, and `empty_deck`.
6. **Bound at 200** — a generated 200-slide deck completes inside the 10-second budget on the test machine; a declared 201st slide returns `slide_limit_exceeded` before scanning it.
7. **Embedded fonts** — a fixture with embedded-font declarations reports presence/provenance but exposes no font bytes or relationship target outside the package.
8. **Theme aliases** — major/minor font and scheme-color aliases resolve; unknown aliases create warnings.
9. **Adversarial XML** — entity-like text, huge attributes, duplicate token names, path traversal entry names, and malformed optional parts remain bounded and deterministic.
10. **Degraded evidence** — missing optional theme/layout parts still returns observed slide usage with reduced confidence and explicit warnings.
11. **Clustering primitive** — two decks generated from the same theme produce equal canonical palette/font fingerprints even when slide content differs.
12. **Real-deck audit** — three product-owned decks have checked-in expected token manifests and each scores at least 0.90 for palette/fonts.

## Reliability review

| Check | Required proof |
|---|---|
| BOUND | archive, slide, XML, evidence, and usage caps have tests |
| HONEST_STATUS | unsupported/non-PPTX/corrupt routes return typed failures |
| HONEST_SCORES | deterministic theme evidence may be `1`; inferred or unresolved evidence may not |
| TIMEOUT | cooperative deadline and 200-slide timing receipt |
| SSRF | extractor performs no fetch and follows only normalized in-archive paths |
| BOUND_READ | compressed and inflated byte caps are enforced before parsing |
| ERROR_BOUNDARY | public API catches parser/ZIP failures and returns safe errors |
| DETERMINISTIC | stable ID, ordering, serialization, and ZIP-order test |

## Verification and dogfood

Required gates:

```text
pnpm exec tsc --noEmit
pnpm test -- --run <W1 test files>
pnpm exec biome check <W1 files>
```

Dogfood `docs/dogfood/nodeslide-domain-v1/nodeslide-golden.pptx` plus one hostile fixture. Extend `scripts/nodeslide-proof.mjs` or add a bounded companion proof command that writes `docs/dogfood/nodeslide-pillars/w1-signature-proof.json` with:

- input digest and extractor schema version;
- elapsed milliseconds and bound settings;
- recovered canonical palette/font tokens;
- layout summary and warning codes;
- deterministic replay equality;
- reliability checklist booleans.

## Non-goals

- No AI Fund or challenge prompt/material.
- No model call, OCR, PDF rendering, screenshot vision, font-binary extraction, or remote URL fetch in revision 1.
- No new deck mutation path.
- No npm publication in this workstream; packaging is a separate owner decision after in-repo proof.
- No subjective claim that an extracted signature is good design.

Any contract change requires revision 2 of this document before implementation changes.
