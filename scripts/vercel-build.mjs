import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveConvexRuntimeSourceUrl, resolveRuntimeSourceSha } from './runtime-source.mjs';

const PREVIEW_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const PREVIEW_DEPLOY_KEY_PATTERN = /^preview:[^\s:|]+:[^\s:|]+\|\S+$/;
const PRODUCTION_DEPLOY_KEY_PATTERN = /^prod:[^\s:|]+\|\S+$/;

export function convexDeployKeyType(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key) return 'missing';
  if (PREVIEW_DEPLOY_KEY_PATTERN.test(key)) return 'preview';
  if (PRODUCTION_DEPLOY_KEY_PATTERN.test(key)) return 'production';
  return 'invalid';
}

export function resolveVercelBuildPlan(env = process.env, cwd = process.cwd()) {
  const sourceSha = resolveRuntimeSourceSha(env, cwd);
  const mode = env.PARITY_CONVEX_DEPLOY_MODE?.trim();

  if (mode === 'preview') {
    if (convexDeployKeyType(env.CONVEX_DEPLOY_KEY) !== 'preview') {
      throw new Error(
        'Preview build refused: CONVEX_DEPLOY_KEY must be a nonempty Convex preview deploy key.',
      );
    }
    const previewName = env.PARITY_CONVEX_PREVIEW_NAME?.trim();
    if (!previewName || !PREVIEW_NAME_PATTERN.test(previewName)) {
      throw new Error('Preview build refused: PARITY_CONVEX_PREVIEW_NAME is required and invalid.');
    }
    return {
      mode,
      sourceSha,
      previewName,
      deployKey: env.CONVEX_DEPLOY_KEY.trim(),
    };
  }

  if (mode === 'frontend-only') {
    if (env.PARITY_CONVEX_PREVIEW_NAME?.trim()) {
      throw new Error('Frontend-only build refused a preview deployment name.');
    }
    if (!resolveConvexRuntimeSourceUrl(env)) {
      throw new Error(
        'Frontend-only build refused: the production Convex HTTP binding is missing.',
      );
    }
    return { mode, sourceSha };
  }

  throw new Error(
    'Vercel build refused: PARITY_CONVEX_DEPLOY_MODE must be preview or frontend-only.',
  );
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function main() {
  const plan = resolveVercelBuildPlan();
  process.env.PARITY_SOURCE_SHA = plan.sourceSha;

  if (plan.mode === 'preview') {
    process.env.CONVEX_DEPLOY_KEY = plan.deployKey;
    run('convex', [
      'deploy',
      '--cmd',
      'tsc -b && vite build',
      '--cmd-url-env-var-name',
      'VITE_CONVEX_URL',
      '--typecheck',
      'disable',
      '--message',
      `source ${plan.sourceSha.slice(0, 12)}`,
      '--preview-name',
      plan.previewName,
    ]);
    run('convex', [
      'env',
      'set',
      'RUNTIME_SOURCE_SHA',
      plan.sourceSha,
      '--preview-name',
      plan.previewName,
    ]);
    return;
  }

  // A staged production frontend is intentionally incapable of invoking an
  // authenticated Convex command, even if Vercel injects its production key.
  const frontendOnlyEnv = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => name !== 'CONVEX_DEPLOY_KEY' && name !== 'CONVEX_DEPLOYMENT',
      ),
    ),
    PARITY_SOURCE_SHA: plan.sourceSha,
  };
  run('tsc', ['-b'], frontendOnlyEnv);
  run('vite', ['build'], frontendOnlyEnv);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Vercel build configuration failed.');
    process.exitCode = 1;
  }
}
