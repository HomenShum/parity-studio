import { describe, expect, it } from 'vitest';
import {
  REQUIRED_NODESLIDE_OAUTH_ENV_NAMES,
  verifyReleaseRuntimeEnvironment,
} from './check-runtime-source-env.mjs';

const secretSentinel = 'must-never-appear-in-an-error';

function configuredEnvironment(overrides = {}) {
  return new Map([
    ...REQUIRED_NODESLIDE_OAUTH_ENV_NAMES.map((name) => [name, `${name}-${secretSentinel}`]),
    ['NODESLIDE_PUBLIC_CREATION', 'true'],
    ['NODESLIDE_PREVIEW_ACCESS_CODE', `access-${secretSentinel}`],
    ['NODESLIDE_PREVIEW_ADMISSION_SUBJECT', `subject-${secretSentinel}`],
    ...Object.entries(overrides),
  ]);
}

function reader(environment) {
  return (name) => environment.get(name);
}

describe('production runtime environment check', () => {
  it('accepts only the explicitly intended public mode', () => {
    expect(
      verifyReleaseRuntimeEnvironment({
        expectedCreationMode: 'public',
        readEnv: reader(configuredEnvironment()),
      }),
    ).toEqual(
      expect.objectContaining({
        expectedCreationMode: 'public',
        checkedEnvNames: expect.arrayContaining(REQUIRED_NODESLIDE_OAUTH_ENV_NAMES),
      }),
    );

    expect(() =>
      verifyReleaseRuntimeEnvironment({
        expectedCreationMode: 'private-preview',
        readEnv: reader(configuredEnvironment()),
      }),
    ).toThrow(/not explicitly disabled/);
  });

  it('requires explicit private-preview admission configuration', () => {
    const environment = configuredEnvironment({ NODESLIDE_PUBLIC_CREATION: 'false' });
    environment.delete('NODESLIDE_PREVIEW_ACCESS_CODE');

    expect(() =>
      verifyReleaseRuntimeEnvironment({
        expectedCreationMode: 'private-preview',
        readEnv: reader(environment),
      }),
    ).toThrow('NODESLIDE_PREVIEW_ACCESS_CODE');
  });

  it('declares every OAuth variable without leaking values in failures', () => {
    const environment = configuredEnvironment();
    environment.delete('GOOGLE_CLIENT_SECRET');

    try {
      verifyReleaseRuntimeEnvironment({
        expectedCreationMode: 'public',
        readEnv: reader(environment),
      });
      throw new Error('Expected the runtime environment check to fail.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('GOOGLE_CLIENT_SECRET');
      expect(message).not.toContain(secretSentinel);
    }
  });
});
