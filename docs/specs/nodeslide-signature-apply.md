# W2 — NodeSlide signature application and on-brand validation

Status: **FROZEN — revision 1**
Frozen: 2026-07-10
Depends on: W1 `nodeslide.signature/v1`
Owner: NodeSlide product work; prompt-independent prior art

## Outcome

Turn a valid `SignatureProfile` into a reviewable plan composed only of NodeSlide's existing patch operations, then validate the resulting deck against that same profile without changing the validation receipt shape.

```text
planSignatureApplication(snapshot, profile, options?) -> SignatureApplicationResult
validateNodeSlideSnapshot(snapshot, checkedAt, id?, { signatureProfile? }) -> ValidationResult
```

Binary metric: the same golden-deck content applied under two intentionally different profiles is visibly distinct, passes structural validation, and has zero on-brand error/warning issues after application.

## Existing contracts that remain fixed

- Signature application continues to use the shared typed `PatchOperation` union; it does not add a signature-specific write path.
- Signature application uses only `update_slide` and `update_style` in revision 1.
- Application never writes a snapshot directly; callers submit the plan through the existing patch/CAS path.
- `ValidationResult` remains `{id, deckId, deckVersion, ok, publishOk, cleanOk, issues, checkedAt, toolchainVersion}`.
- Existing validation codes and their severity behavior remain compatible.

## Public contract

Add `shared/nodeslideSignatureApply.ts`:

```ts
export const NODESLIDE_SIGNATURE_APPLY_VERSION = 'nodeslide.signature-apply/v1' as const;
export const NODESLIDE_SIGNATURE_OPERATION_LIMIT = 512 as const;

export interface ResolvedSignatureTheme {
  colors: {
    canvas: string;
    ink: string;
    muted: string;
    accent: string;
    accentSoft: string;
    border: string;
    data: string[];
  };
  typography: {
    display: string;
    body: string;
    data: string;
    titlePt: number;
    bodyPt: number;
    dataPt: number;
  };
}

export interface SignatureApplicationPlan {
  version: typeof NODESLIDE_SIGNATURE_APPLY_VERSION;
  id: string;
  deckId: string;
  profileId: string;
  baseDeckVersion: number;
  baseSlideVersions: Record<string, number>;
  baseElementVersions: Record<string, number>;
  scope: PatchScope;
  operations: PatchOperation[];
  skippedLockedElementIds: string[];
  unchangedElementIds: string[];
  resolvedTheme: ResolvedSignatureTheme;
  warnings: SignatureApplicationWarning[];
}

export type SignatureApplicationResult =
  | { ok: true; plan: SignatureApplicationPlan }
  | { ok: false; error: SignatureApplicationError };
```

Exports:

```ts
resolveSignatureTheme(profile): ResolvedSignatureThemeResult
planSignatureApplication(snapshot, profile, options?): SignatureApplicationResult
onBrandIssues(snapshot, profile, options?): Omit<ValidationIssue, 'id'>[]
```

## Semantic fallback chain

Profiles from arbitrary PPTX files are observed tokens, not guaranteed semantic themes. Resolve deterministically:

1. explicit semantic token names/extensions when present;
2. known OOXML roles (`lt1`, `dk1`, `accent1..6`, major/minor Latin font);
3. most-used observed tokens with contrast-aware light/dark assignment;
4. the current deck theme for a missing role;
5. NodeSlide safe defaults only if both profile and deck role are absent/invalid.

Every fallback after step 1 emits a stable warning with the chosen evidence IDs. Resolution never labels a guessed role as extracted certainty.

## Application mapping

- Slide backgrounds receive `canvas` through `update_slide` unless the slide is excluded by scope.
- Text roles matching title/headline/display receive display family, ink, and title size only when the source role already represents a title.
- Body/caption/footer text receives body family and the nearest profile size that does not reduce it below NodeSlide's 12pt floor.
- Chart/data labels receive data family; chart containers receive safe background/border styling. Revision 1 does not mutate chart series data because no existing operation supports that.
- Shapes receive accent, accent-soft, border, or canvas according to existing element role and luminance. Unknown roles preserve fill and receive only safe border/typography changes.
- Images and connectors are not recolored unless they already expose an applicable style property.
- Locked elements are always skipped and reported; no operation may target them.
- No-op style updates are omitted. Ordering is slide order, then element order, then operation kind.

The default scope is the full deck with `operationMode: 'unrestricted'`. Optional slide/element scope must be honored exactly. More than 512 required operations returns `operation_limit_exceeded`; the planner does not silently truncate a brand application.

## On-brand validation codes

Extend `ValidationIssue['code']` additively with:

```text
on_brand_color
on_brand_font
on_brand_type_scale
on_brand_background
```

Rules:

- compare canonical uppercase sRGB hex values and normalized, case-insensitive font-family names;
- recognize resolved fallback values as allowed and include the resolution warning in the message;
- only evaluate properties the profile can resolve honestly;
- skip locked elements by default and emit at most one `info` issue per slide summarizing skipped locked content;
- unlocked mismatches are warnings and therefore set `cleanOk: false`; when a signature profile is explicitly active they also set `publishOk: false`;
- malformed profile data returns a schema error from the application API and is never treated as a perfect match;
- issue IDs and ordering are deterministic.

## Concurrency and history

The plan captures exact deck/slide/element clocks. Submission uses the existing patch mutation:

- unrelated concurrent edits may rebase under existing rules;
- overlapping style/background edits become stale and do not overwrite;
- accepted patches create normal deck versions and keep comments/version history intact;
- a signature swap is another normal patch, never destructive history replacement;
- replaying the same plan after acceptance is either a no-op plan or stale; it must not duplicate versions silently.

## Scenario tests

1. **Two signatures** — dark/high-contrast and light/restrained profiles create visibly different operation sets and validation-clean candidate snapshots.
2. **Existing patch path** — applying a plan through `applyDeckPatch` changes only declared fields and increments normal versions.
3. **Missing tokens** — semantic fallback chain uses observed/current/safe defaults with explicit warnings.
4. **Locked elements** — planner emits no operation for locked elements; validation summarizes skips without a blocker.
5. **No-op profile** — matching profile yields zero operations and a typed `already_applied` result rather than an invalid empty patch.
6. **Malformed profile** — bad colors, empty fonts, invalid dimensions, unknown schema, or confidence outside bounds fails safely.
7. **Scope** — selected slide/elements change; all others remain byte-equivalent.
8. **Comments/versions** — signature swap preserves comments, linked patches, and prior snapshots.
9. **Concurrent non-overlap** — a human copy edit can rebase with style-only application.
10. **Concurrent overlap** — a human style edit on the same element makes application stale.
11. **Operation bound** — 513 required operations fail without truncation or mutation.
12. **Validation receipt** — receipt keys are unchanged; new codes are additive and deterministic.
13. **Contrast guard** — chosen ink/canvas and accent-soft/ink combinations meet existing thresholds.
14. **Idempotent resolution** — token/evidence order does not change resolved theme, plan ID, or issue IDs.

## Reliability review

| Check | Required proof |
|---|---|
| BOUND | 512-op hard cap and bounded issue emission |
| HONEST_STATUS | already-applied, malformed, missing-role, and stale states explicit |
| HONEST_SCORES | no confidence upgrade during semantic resolution |
| TIMEOUT | pure planning/validation completes inside 1 second on golden deck |
| SSRF | no fetch; source URLs/citations are data only |
| BOUND_READ | only supplied snapshot/profile, capped token/evidence arrays |
| ERROR_BOUNDARY | malformed profile/operation returns typed safe errors |
| DETERMINISTIC | stable mapping, order, plan IDs, and validation IDs |

## Verification and dogfood

Required gates are TypeScript, targeted Vitest, and Biome. Dogfood writes `docs/dogfood/nodeslide-pillars/w2-signature-apply-proof.json` with both profile IDs, resolved roles/evidence, operation counts, locked skips, pre/post validation summaries, visual-distinction fingerprint, CAS/history proof, and reliability booleans.

## Non-goals

- No new operation name, direct database mutation, chart-data rewrite, image recoloring, font download, or remote asset fetch.
- No claim of perfect brand compliance from incomplete profile evidence.
- No challenge-specific material.

Any contract change requires revision 2 before implementation changes.
