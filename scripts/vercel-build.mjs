import { spawnSync } from 'node:child_process';

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

if (process.env.CONVEX_DEPLOY_KEY) {
  run('convex', ['deploy', '--cmd', 'tsc -b && vite build', '--typecheck', 'disable']);
} else {
  console.log(
    'no CONVEX_DEPLOY_KEY - skipping backend deploy, building frontend with committed _generated/',
  );
  run('tsc', ['-b']);
  run('vite', ['build']);
}
