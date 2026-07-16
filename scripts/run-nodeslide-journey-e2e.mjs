import { spawnSync } from 'node:child_process';

const executable = process.platform === 'win32' ? process.execPath : 'pnpm';
const prefix =
  process.platform === 'win32' ? ['C:/nvm4w/nodejs/node_modules/corepack/dist/pnpm.js'] : [];
const result = spawnSync(
  executable,
  [
    ...prefix,
    'exec',
    'playwright',
    'test',
    'tests/e2e/nodeslide-authoring-journey-proof.live.spec.ts',
    '--workers=1',
    '--retries=0',
    ...process.argv.slice(2),
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, NODESLIDE_JOURNEY_PROOF: '1' },
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
