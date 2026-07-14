#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { convexDeployKeyType } from './vercel-build.mjs';

export const REQUIRED_NODESLIDE_OAUTH_ENV_NAMES = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'NODESLIDE_OAUTH_TOKEN_ENCRYPTION_KEY',
  'NODESLIDE_GOOGLE_REDIRECT_URI',
  'NODESLIDE_APP_ORIGINS',
];

const PRIVATE_PREVIEW_ENV_NAMES = [
  'NODESLIDE_PREVIEW_ACCESS_CODE',
  'NODESLIDE_PREVIEW_ADMISSION_SUBJECT',
];

export function verifyReleaseRuntimeEnvironment({ expectedCreationMode, readEnv }) {
  if (expectedCreationMode !== 'public' && expectedCreationMode !== 'private-preview') {
    throw new Error('Expected creation mode must be public or private-preview.');
  }

  for (const name of REQUIRED_NODESLIDE_OAUTH_ENV_NAMES) requiredValue(name, readEnv);
  const publicCreation = requiredValue('NODESLIDE_PUBLIC_CREATION', readEnv).toLowerCase();

  if (expectedCreationMode === 'public' && publicCreation !== 'true') {
    throw new Error(
      'Production creation-mode check failed: NODESLIDE_PUBLIC_CREATION is not enabled as intended.',
    );
  }
  if (expectedCreationMode === 'private-preview') {
    if (publicCreation !== 'false') {
      throw new Error(
        'Production creation-mode check failed: NODESLIDE_PUBLIC_CREATION is not explicitly disabled.',
      );
    }
    for (const name of PRIVATE_PREVIEW_ENV_NAMES) requiredValue(name, readEnv);
  }

  return {
    expectedCreationMode,
    checkedEnvNames: [
      ...REQUIRED_NODESLIDE_OAUTH_ENV_NAMES,
      'NODESLIDE_PUBLIC_CREATION',
      ...(expectedCreationMode === 'private-preview' ? PRIVATE_PREVIEW_ENV_NAMES : []),
    ],
  };
}

function requiredValue(name, readEnv) {
  let value;
  try {
    value = readEnv(name);
  } catch {
    throw new Error(`Required Convex environment variable ${name} is unavailable.`);
  }
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error(`Required Convex environment variable ${name} is unavailable.`);
  }
  return normalized;
}

function readConvexEnvironment(name) {
  const executable = process.platform === 'win32' ? 'convex.cmd' : 'convex';
  const result = spawnSync(executable, ['env', 'get', name], {
    encoding: 'utf8',
    env: process.env,
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Convex environment read failed for ${name}.`);
  }
  return result.stdout;
}

function flag(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function main() {
  if (convexDeployKeyType(process.env.CONVEX_DEPLOY_KEY) !== 'production') {
    throw new Error('Production runtime check requires a nonempty Convex production deploy key.');
  }
  const expectedCreationMode = flag(process.argv.slice(2), '--expected-creation-mode');
  const result = verifyReleaseRuntimeEnvironment({
    expectedCreationMode,
    readEnv: readConvexEnvironment,
  });
  console.log(
    `OK production runtime configuration names are present (${result.checkedEnvNames.join(', ')}).`,
  );
  console.log(`OK NodeSlide creation mode is ${result.expectedCreationMode}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Production runtime configuration check failed.',
    );
    process.exitCode = 1;
  }
}
