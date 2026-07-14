import { spawnSync } from 'node:child_process';
import { resolveRuntimeSourceSha } from './runtime-source.mjs';

const run = (command, args) => {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const sourceSha = resolveRuntimeSourceSha();
process.env.PARITY_SOURCE_SHA = sourceSha;
const previewName = process.env.PARITY_CONVEX_PREVIEW_NAME?.trim();
if (previewName && !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(previewName)) {
  console.error('PARITY_CONVEX_PREVIEW_NAME is invalid.');
  process.exit(1);
}

if (process.env.CONVEX_DEPLOY_KEY) {
  const deployArgs = [
    'deploy',
    '--cmd',
    'tsc -b && vite build',
    '--cmd-url-env-var-name',
    'VITE_CONVEX_URL',
    '--typecheck',
    'disable',
    '--message',
    `source ${sourceSha.slice(0, 12)}`,
  ];
  if (previewName) deployArgs.push('--preview-name', previewName);
  run('convex', deployArgs);

  const sourceEnvArgs = ['env', 'set', 'RUNTIME_SOURCE_SHA', sourceSha];
  if (previewName) sourceEnvArgs.push('--preview-name', previewName);
  run('convex', sourceEnvArgs);
} else {
  console.log(
    'no CONVEX_DEPLOY_KEY - skipping backend deploy, building frontend with committed _generated/',
  );
  run('tsc', ['-b']);
  run('vite', ['build']);
}
