# NodeSlide release gates

Production is promoted only by `.github/workflows/quality.yml`. `vercel.json` disables Vercel's
automatic Git deployments so a main-branch push cannot race ahead of repository checks.

The enforced order is:

1. **Quality** — unit tests, Convex and frontend typechecks, lint, build, source-manifest check,
   and production dependency audit.
2. **Deploy isolated preview** — Vercel Preview plus a commit-scoped Convex preview deployment.
3. **E2E / UI QA** — the Playwright journey manifest and interaction suite run against that live
   preview. Screenshots and reports are uploaded as CI artifacts; PNGs are never committed.
4. **Stage production (no domain)** — a production-environment build is created with
   `--skip-domain`, after preview QA is green.
5. **Runtime source alignment** — `/runtime-source.json` and Convex `/api/runtime-source` must
   report the same full Git SHA, and it must equal the workflow SHA.
6. **Promote production** — only the verified staged URL is assigned to production domains.

## Required configuration

Store these as GitHub environment or repository secrets; never add values to the repository:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

In the Vercel project, configure `CONVEX_DEPLOY_KEY` separately by environment:

- **Preview:** a Convex Preview Deploy Key so every QA run receives isolated functions and data.
- **Production:** the production deployment key.

The Convex key must be allowed to deploy and update deployment environment variables. The build
sets only the non-secret `RUNTIME_SOURCE_SHA`; runtime endpoints expose no environment values
other than that SHA.

Protect `main` with the `Quality` and `E2E / UI QA` checks. A protected GitHub `production`
environment can add human approval without changing the deterministic gate order.

For a local postdeploy check:

```sh
pnpm check:runtime-source -- --frontend https://preview.example --expected-sha <full-git-sha>
```
