# Three-deck launch recorder

`scripts/record-nodeslide-three-deck-launch.mjs` records one continuous, full-browser NodeSlide guide. It types three new briefs from the canonical landing page and refuses deck IDs as inputs.

Dry contract and syntax checks:

```powershell
node --check scripts/record-nodeslide-three-deck-launch.mjs
node scripts/record-nodeslide-three-deck-launch.mjs --dry-run
```

Live local example:

```powershell
node scripts/record-nodeslide-three-deck-launch.mjs `
  --target-url http://127.0.0.1:5193/ `
  --world-cup-data C:\path\to\world-cup.csv `
  --ai-fund-image C:\path\to\rights-cleared-ai-fund-photo.jpg
```

The live run requires a World Cup CSV and a rights-cleared AI Fund image. It records their hashes in `evidence.json`; it never embeds private credentials. Use `--probe-through-checkpoint <id>` to stop after a named checkpoint while hardening selectors. Every completed checkpoint writes a screenshot plus a partial evidence manifest, so failures remain diagnosable.

Optional flags:

- `--target-url URL` — canonical NodeSlide root; any query string is rejected.
- `--output-dir PATH` — artifact directory.
- `--world-cup-data PATH` — CSV/TSV/JSON used in the third fresh deck.
- `--ai-fund-image PATH` — PNG/JPEG/WebP/GIF uploaded in the second fresh deck.
- `--image-credit TEXT` — visible credit stored with the uploaded image.
- `--typing-delay-ms N` — visible per-character delay.
- `--headed` — foreground debugging; headless recording is the default.
- `--probe-through-checkpoint ID` — stop after a specific successful checkpoint.
- `--google-sync` — require an already authorized Google Slides connection and exercise its visible sync workbench. The recorder does not fabricate OAuth consent.

Output includes the raw WebM, an MP4 when `ffmpeg` is available, checkpoint PNGs, downloads, input hashes, unique new deck IDs, browser/page errors, and the per-checkpoint evidence ledger.
