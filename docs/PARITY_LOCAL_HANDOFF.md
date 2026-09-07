# Local Parity review handoff

A developer can import a canonical UI kit, inspect the failed and passing source content, read the verification report, comment on an element, and export the kit for another reviewer. This handoff covers that local Parity workflow and the narrow-screen repair. The older [engineer handoff](HANDOFF.md) and existing production/demo claims are historical; this work does not refresh them.

## Run the intended domain locally

NodeSlide remains the default domain. Parity requires both `?domain=parity` and `VITE_ENABLE_PARITY_DOMAIN=true` when Vite serves or builds the frontend. Without the flag, the existing explanatory notice is expected. This repair does not change that policy.

The observed toolchain was Node 22.22.2, pnpm 10.33.2 and the locked Convex 1.42.1 CLI. Use a fresh disposable checkout and a clean, isolated shell/profile with no inherited Convex/provider credentials or pre-existing environment/deployment files. The commands below do not themselves scrub a user's normal shell. Keep the generated anonymous deployment configuration and database private; never copy a production environment into this checkout.

From the repository root, install the existing lock and perform the initial anonymous bootstrap:

```powershell
$env:CI = '1'
corepack pnpm@10.33.2 install --frozen-lockfile
corepack pnpm@10.33.2 exec convex dev --once --local-cloud-port 54331 --local-site-port 54332 --local-backend-version precompiled-2026-08-25-7cce8fb
```

These example ports must be free. On the tested fresh, noninteractive, unconfigured profile, the normal CLI selected an anonymous local deployment without login. If the CLI instead requests a shared/cloud selection, stop and check the profile/configuration. The tested backend executable was SHA-256 `b1e2b0920a36aaa43b4daccfdc04368308148485cd5b327a6146b226fae827ae`. The backend listened on all interfaces in this local proof; the displayed localhost URL is not a loopback-only binding guarantee.

Keep the retained backend running in one terminal, with the same profile and ports:

```sh
corepack pnpm@10.33.2 exec convex dev --local-cloud-port 54331 --local-site-port 54332 --local-backend-version precompiled-2026-08-25-7cce8fb
```

In another isolated terminal, set these frontend values (PowerShell example), then build and serve:

```powershell
$env:VITE_CONVEX_URL = 'http://127.0.0.1:54331'
$env:VITE_CONVEX_SITE_URL = 'http://127.0.0.1:54332'
$env:VITE_ENABLE_PARITY_DOMAIN = 'true'
corepack pnpm@10.33.2 run build
corepack pnpm@10.33.2 exec vite preview --host 127.0.0.1 --port 54333 --strictPort
```

Open `http://127.0.0.1:54333/?domain=parity`. Both backend URLs are necessary for local websocket/query and HTTP/export traffic. Changing a build-time value requires another build. Stop both owned services when finished. For active source development, `dev:web` uses the same values instead of the compiled preview.

## Complete a review

1. Import a self-contained ZIP following [the canonical kit contract](CANONICAL_KIT.md). Keep an untouched copy and hashes of its authored files. The observed fictional kit contained five files, a failed sample and a passing retest, with no external assets.
2. Open Preview, Files and the deterministic Coach report. Preserve `failed`, `needs_iteration`, unavailable checks and generated export additions as their actual results; a self-comparison score is not an external design-quality grade.
3. Turn on **Comment on preview**. The compact **Review comments** disclosure exposes existing notes/region tools. Close it to expose the selected element. Mouse, native touch tap and keyboard activation can open the pending editor. Cancel returns to selection. Saving or auto-fixing is outside the final layout proof.
4. Export the ZIP, reopen its bytes and compare every authored input file with its exported counterpart. Inspect generated extras separately. Reload/reimport the exported artifact to check its content rather than treating a completed download as a rendered preview.

The observed keyless route used Balanced/default advice with no model/provider override and no authentication. The installed adapter rejected missing authentication before creating an external provider request; the automatic explanation used the local rule-based result. This is a conditional source-bound mode, not an application-wide network kill switch. Prompt generation, auto-fix, external capture, model overrides and provider controls were not used in this proof.

## What changed and what was verified

The compact shell now follows normal document flow with Canvas first in both DOM and reading order; Agent and Coach remain reachable below it. Header/workflow controls wrap, Files has usable editor space, collapsed panels retain complete controls, and the Coach's fixed-size ring and report no longer collapse. The comment helper handles real touch taps through the existing selection path, while movement/cancel/multitouch stop selection. The native comment disclosure avoids covering the entire phone heading. The pending editor fits its preview bounds and both text editors use visible native keyboard focus.

Final ordinary `npm test` passed **218 files, 1,843 tests, with five skipped**. The skips belong to the conditional real-trace cases in `scripts/tests/playwright-trace.test.mjs`; they are not passed browser tests. Six targeted domain cases, scoped Biome and normal TypeScript/Vite build also passed. The UI repair changed no dependencies, provider policy or backend behavior; the two generated API declaration lines came from the normal anonymous bootstrap.

The latest affected proof passed **671/671 assertions with 38 unique PNGs** at 320×800, 360×800, 390×844 and 1440×960. It covered pending text/actions, forward/reverse focus, Cancel/reselect, actual touch selection and separately hit-tested Coach outer/report wheel scrolling. Earlier source-bound evidence covers seven normal viewport pairs (those four plus 768×1024, 1024×768 and 1920×1080), Files/Save reachability, panel collapse and the native disclosure/tools. Those earlier runs remain partial historical reports, not fresh seven-cell results for the final popup correction.

One limitation remains explicit: the native touch-scroll gesture did not move either the application preview or an inert tall document in the identical touch-capable Chromium context. That control prevents blaming the app alone but does not isolate the cause or prove real-device scrolling. No additional preview swipe followed the failed control. Compatibility touch-click suppression was NOT_EXERCISED; the movement negative also emitted pointercancel. Full product and visual grades remain null. Local retained-fixture results do not establish deployment, multi-tenant, provider or arbitrary-input readiness.

## Dependency follow-up on 2026-09-07

The production audit failure was repaired with exact PDF.js 6.2.108 and DOMPurify 3.4.13. The parent-scoped `pptxgenjs@4.0.1>image-size: '-'` override removes an unused dependency from that exact release: every published JavaScript distribution lacks an image-size reference. Its orphan queue dependency also disappears. Reassess this exception when upgrading PptxGenJS; it is not an audit exclusion. The ordinary [pnpm removal mechanism](https://pnpm.io/10.x/settings#overrides) is used without package code patches.

Use a fresh checkout for the locked install above. An in-place pnpm install retained an old image-size junction even after lock resolution; the fresh owned install proved the dependency no longer resolves from PptxGenJS. The unchanged CI command `corepack pnpm@10.33.2 dlx pnpm@11.13.0 audit --prod` reported no known vulnerabilities. The final dependency tree passed 1,843 tests with the same five skips, 41 focused PDF/PPTX scenarios and the normal TypeScript/Vite build. Actual browser PDF parsing/rendering and unchanged-document save/reopen passed; both published PptxGenJS Node entrypoints embedded exact images and produced reopenable PPTX files. These are bounded library and regression checks, not a repeat of the Parity UI journey or a PDF-authoring claim.

## Evidence custody

The source proof began at `3fdbfc0f53f3ff97f51cecf8770aac20f34a5b49`. All 14 changed source owners were frozen before the final suite; the current documentation was added later. The dependency follow-up starts from the committed UI repair at d145949f and does not refresh those browser claims. The operator retains exact before/after source, native DOM/pixels, command logs, failures and closure receipts. These references identify private evidence; their raw files are not bundled or represented as portable links here.

| Operator receipt or artifact | SHA-256 | Scope |
|---|---|---|
| `parity-responsive-after-result-06/RECEIPT.json` | `86030ddf678f47a05c690ae4d036665303aa1fd6288ad2144a71510a2a3ab2c9` | Final four-size native readback, source/state/process closure and touch-scroll hold |
| `parity-final-full-regression-01/test/RECEIPT.json` | `a055fb3339e3a522d2095774657a4663837954a259f3e2df57901ae408ce8fa5` | Actual full suite on final source; 267 owned process identities closed |
| `parity-after05-independent-01/RECEIPT.json` | `5d3e9070e6bbee43e3790ad616031df79664011f7559532959ce68f50df01246` | Earlier disclosure/same-heading/tool/native-input judgment; 890/900 partial |
| `parity-responsive-run-02/.../after-export.zip` | `709b70e75aa4fedef3738adad1b620064021a442dcb0dc966359461d3c8fb016` | Earlier completed ZIP, valid CRC and all five authored bytes preserved; later layout proof did not export again |

Keep private profiles, environment/configuration, anonymous state, process details and raw logs out of commits and PR attachments. The existing historical source/evidence remains unchanged. Use the current diff and independent review before integrating this local repair.
