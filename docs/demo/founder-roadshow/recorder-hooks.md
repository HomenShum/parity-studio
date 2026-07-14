# Founder-roadshow recorder hook contract

The recorder is intentionally fail-closed. A live run starts only when every required
storyboard scene has an implemented, visible UI hook and every required input exists.
`--dry-run` validates the contract without opening a browser.

## Current selector readiness

- Implemented: canonical landing, evidence attachments, named model selection, explicit
  model consent, six-slide creation, primitive discovery, element/slide proposals,
  Compare/Accept, chart/math/layout/image controls, Trace/source evidence, deck memory,
  presenter/share, and PPTX/JSON downloads.
- Pending product selector: `bounded_multi_slide_edit`. Current consolidation HEAD has
  element multi-select but no stable UI selector for a bounded set of slide IDs. The
  recorder will name this scene and stop before a live capture; it will never substitute
  whole-deck scope.
- Required runtime input: `NODESLIDE_DEMO_IMAGE_PATH` must point to a rights-cleared local
  image. The script records only the file name and SHA-256, never a credential or secret.
- Required measured input: `prototype-metrics.csv` is deliberately absent until final
  release gates finish. Live recording is blocked until that measured file exists.

## Commands

```powershell
node scripts/record-nodeslide-founder-roadshow.mjs --dry-run
node scripts/record-nodeslide-founder-roadshow.mjs --target-url https://parity-studio.vercel.app/
node scripts/verify-nodeslide-founder-roadshow.mjs --evidence <run-dir>/evidence.json
```

The live command is headless by default and uses a fresh incognito Playwright context, so
it does not take over the foreground desktop or reuse the operator's browser profile.
Set `NODESLIDE_RECORDER_HEADED=1` only for an intentional local debugging pass.
