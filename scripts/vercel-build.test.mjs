import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { convexDeployKeyType, resolveVercelBuildPlan } from './vercel-build.mjs';

const sourceSha = 'a'.repeat(40);
const previewKey = 'preview:team-slug:project-slug|opaque-token=';
const productionKey = 'prod:production-deployment-123|opaque-token=';
const releaseWorkflow = readFileSync(
  new URL('../.github/workflows/quality.yml', import.meta.url),
  'utf8',
);
const playwrightConfig = readFileSync(new URL('../playwright.config.ts', import.meta.url), 'utf8');
const vercelBypassSetup = readFileSync(
  new URL('../tests/e2e/vercel-bypass.globalSetup.ts', import.meta.url),
  'utf8',
);

describe('Vercel build safety plan', () => {
  it('recognizes only shaped preview and production deploy keys', () => {
    expect(convexDeployKeyType(previewKey)).toBe('preview');
    expect(convexDeployKeyType(productionKey)).toBe('production');
    expect(convexDeployKeyType('')).toBe('missing');
    expect(convexDeployKeyType('preview:not-enough-segments')).toBe('invalid');
  });

  it.each([undefined, '', productionKey, 'preview:malformed'])(
    'fails closed for a preview build with key %s',
    (deployKey) => {
      expect(() =>
        resolveVercelBuildPlan({
          PARITY_SOURCE_SHA: sourceSha,
          PARITY_CONVEX_DEPLOY_MODE: 'preview',
          PARITY_CONVEX_PREVIEW_NAME: 'qa-123-1',
          ...(deployKey === undefined ? {} : { CONVEX_DEPLOY_KEY: deployKey }),
        }),
      ).toThrow(/nonempty Convex preview deploy key/);
    },
  );

  it('accepts an explicitly isolated preview plan', () => {
    expect(
      resolveVercelBuildPlan({
        PARITY_SOURCE_SHA: sourceSha,
        PARITY_CONVEX_DEPLOY_MODE: 'preview',
        PARITY_CONVEX_PREVIEW_NAME: 'qa-123-1',
        CONVEX_DEPLOY_KEY: previewKey,
      }),
    ).toEqual({
      mode: 'preview',
      sourceSha,
      previewName: 'qa-123-1',
      deployKey: previewKey,
    });
  });

  it('stages a bound frontend without authorizing a backend deployment', () => {
    expect(
      resolveVercelBuildPlan({
        PARITY_SOURCE_SHA: sourceSha,
        PARITY_CONVEX_DEPLOY_MODE: 'frontend-only',
        CONVEX_DEPLOY_KEY: productionKey,
        VITE_CONVEX_URL: 'https://production-deployment-123.convex.cloud',
      }),
    ).toEqual({ mode: 'frontend-only', sourceSha });
  });

  it('requires an explicit mode and a bound production frontend', () => {
    expect(() => resolveVercelBuildPlan({ PARITY_SOURCE_SHA: sourceSha })).toThrow(
      /PARITY_CONVEX_DEPLOY_MODE/,
    );
    expect(() =>
      resolveVercelBuildPlan({
        PARITY_SOURCE_SHA: sourceSha,
        PARITY_CONVEX_DEPLOY_MODE: 'frontend-only',
      }),
    ).toThrow(/HTTP binding is missing/);
  });
});

describe('release workflow safety invariants', () => {
  it('aligns an isolated preview before mutation-enabled E2E', () => {
    expect(releaseWorkflow).toContain('CONVEX_PREVIEW_DEPLOY_KEY');
    expect(releaseWorkflow).toContain('--build-env PARITY_CONVEX_DEPLOY_MODE=preview');
    expect(releaseWorkflow).toContain('needs: [deploy_preview, preview_source_alignment]');
    expect(releaseWorkflow.indexOf('preview_source_alignment:')).toBeLessThan(
      releaseWorkflow.indexOf('NODESLIDE_E2E_MUTATIONS: "1"'),
    );
  });

  it('keeps staging side-effect free and cutover ordered in one protected job', () => {
    expect(releaseWorkflow).toContain('cancel-in-progress: false');
    const stage = releaseWorkflow.slice(
      releaseWorkflow.indexOf('  stage_production:'),
      releaseWorkflow.indexOf('  final_cutover:'),
    );
    expect(stage).toContain('PARITY_CONVEX_DEPLOY_MODE=frontend-only');
    expect(stage).not.toContain('convex deploy');
    expect(stage).not.toContain('CONVEX_PRODUCTION_DEPLOY_KEY');

    const cutover = releaseWorkflow.slice(releaseWorkflow.indexOf('  final_cutover:'));
    expect(cutover).toContain('environment: production');
    const backendDeploy = cutover.indexOf('Deploy the approved source to live Convex');
    const stagedAlignment = cutover.indexOf('Verify staged frontend against the cut-over backend');
    const promotion = cutover.indexOf('Promote only the aligned staged frontend');
    const productionAlignment = cutover.indexOf('Verify canonical production alignment');
    expect(backendDeploy).toBeGreaterThanOrEqual(0);
    expect(backendDeploy).toBeLessThan(stagedAlignment);
    expect(stagedAlignment).toBeLessThan(promotion);
    expect(promotion).toBeLessThan(productionAlignment);
  });

  it('pins every Action reference to an immutable commit', () => {
    const actionReferences = [...releaseWorkflow.matchAll(/uses:\s+[^\s@]+@([^\s#]+)/g)].map(
      (match) => match[1],
    );
    expect(actionReferences.length).toBeGreaterThan(0);
    expect(actionReferences.every((reference) => /^[0-9a-f]{40}$/.test(reference ?? ''))).toBe(
      true,
    );
  });

  it('bootstraps protected Playwright sessions without leaking bypass credentials to traces', () => {
    expect(vercelBypassSetup).toContain("'x-vercel-protection-bypass': secret");
    expect(vercelBypassSetup).toContain("'x-vercel-set-bypass-cookie': 'true'");
    expect(vercelBypassSetup).toContain('storageState({ path: storageState })');
    expect(vercelBypassSetup).toContain('await rm(storageState, { force: true })');
    expect(playwrightConfig).toContain('storageState: bypassStorageState');
    expect(playwrightConfig).toContain("remoteBaseUrl && vercelBypassSecret ? 'off'");
    expect(playwrightConfig).not.toContain('extraHTTPHeaders');
  });
});
