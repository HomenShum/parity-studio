# NodeSlide release gates

Production is released only by `.github/workflows/quality.yml`. `vercel.json` disables Vercel's
automatic Git deployments, and main-branch release workflows queue instead of cancelling one
another so a newer push cannot interrupt an active final cutover.

## Enforced order

1. **Quality** runs unit tests, Convex and frontend typechecks, lint, a bound frontend build, the
   built runtime-manifest check, and the production dependency audit.
2. **Deploy isolated preview** requires a nonempty `preview:` Convex deploy key and a unique preview
   name. The Vercel build fails closed if the key is absent, malformed, or production-scoped; there
   is no production fallback.
3. **Preview runtime identity** checks that the frontend manifest, its named Convex HTTP endpoint,
   and the workflow all report the same full Git SHA. The Vercel protection bypass is sent only to
   the frontend request and is never forwarded to Convex.
4. **E2E / UI QA** starts mutation-enabled Playwright coverage only after runtime identity is green.
   A Playwright setup request sends the protected-preview headers to the Vercel origin, stores the
   redirect cookie in a temp-only state file, and removes that file after the run. Browser contexts
   load the cookie but never carry the secret header to Convex or other origins. Trace capture is
   disabled for protected runs so the bypass cookie cannot enter uploaded trace artifacts.
5. **Stage production frontend** creates a production-environment Vercel deployment with
   `--skip-domain` and explicit `frontend-only` mode. The build process removes any inherited Convex
   deploy key before running TypeScript or Vite, so this stage cannot deploy or mutate live Convex.
6. **Approve and cut over production** is one protected `production` environment job. After human
   approval it checks production OAuth/admission configuration by name, deploys the approved source
   to live Convex, sets its source marker, verifies the staged frontend against that backend, and
   immediately promotes that exact frontend. There is no approval or cancellable follow-on job
   between the backend deploy and frontend promotion.
7. **Post-cutover verification** checks the canonical production URL against Convex and reruns the
   OAuth/admission smoke check.

All third-party Actions used by the workflow are pinned to immutable commit SHAs.

## Required GitHub configuration

Store values as secrets; never commit or print them:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`
- `VERCEL_AUTOMATION_BYPASS_SECRET`
- Preview environment secret `CONVEX_PREVIEW_DEPLOY_KEY`, whose value must be a Convex Preview
  Deploy Key beginning with `preview:`.
- Production environment secret `CONVEX_PRODUCTION_DEPLOY_KEY`, whose value must be a production
  deploy key beginning with `prod:`.

Define these production environment variables (they are configuration, not credentials):

- `PRODUCTION_FRONTEND_URL`: canonical HTTPS production origin.
- `NODESLIDE_EXPECTED_CREATION_MODE`: exactly `public` or `private-preview`.

The Vercel production environment must provide `VITE_CONVEX_URL` for the intended production
deployment. When that is a standard `*.convex.cloud` URL, both the browser and
`runtime-source.json` derive the matching `*.convex.site` endpoint from it; stale
`VITE_CONVEX_SITE_URL` or `VITE_CONVEX_HTTP_URL` values cannot override the deployment identity.

## Required live Convex environment names

The final-cutover preflight reads each value into captured process memory only and reports names,
never values. These names must be nonempty:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NODESLIDE_OAUTH_TOKEN_ENCRYPTION_KEY`
- `NODESLIDE_GOOGLE_REDIRECT_URI`
- `NODESLIDE_APP_ORIGINS`
- `NODESLIDE_PUBLIC_CREATION`

For expected `public` mode, `NODESLIDE_PUBLIC_CREATION` must normalize to `true`. For expected
`private-preview` mode it must normalize to exactly `false`, and both
`NODESLIDE_PREVIEW_ACCESS_CODE` and `NODESLIDE_PREVIEW_ADMISSION_SUBJECT` must be nonempty. This
prevents a release from silently becoming either publicly writable or unusable.

## Cutover and rollback truth

Convex deployment and Vercel promotion are separate external systems and do not offer a distributed
transaction. The workflow minimizes the skew window and prevents automatic cancellation, but a
runner failure, operator cancellation, or provider outage can still occur after Convex changes and
before frontend promotion. Backend changes released through this path must therefore remain
compatible with the currently promoted frontend.

If the final job stops after the Convex deploy, do not claim rollback merely because Vercel still
serves the prior frontend. Inspect the completed steps and Convex deployment history. If the staged
frontend and backend are healthy, rerun the same approved cutover. Otherwise deploy a reviewed,
compatible backend revision and re-run source alignment before changing the production domain.
Vercel rollback alone cannot undo Convex schema or data changes.

The post-cutover source check detects persistent frontend/backend skew; it cannot prove that no
request observed the unavoidable cross-system transition interval.

## Deck-erasure limit

Deck erasure is atomic only when the complete deck/project deletion set is at most 4,000 records and
4 MiB by Convex value size. Every relationship and child query is bounded, the full set is measured
before the first write, and an oversized deck is rejected with no application writes. This release
does **not** claim universal large-deck deletion. Supporting larger decks requires a schema-backed
tombstone plus durable, resumable scheduled batches and a completion state; that expansion is not
present in this release.

## Local checks

```sh
pnpm check:runtime-source -- --frontend https://preview.example --expected-sha <full-git-sha>
pnpm exec node scripts/check-runtime-source-env.mjs --expected-creation-mode private-preview
```

The second command requires a production `CONVEX_DEPLOY_KEY` in the environment and intentionally
prints only checked variable names and the expected mode.
