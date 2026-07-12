import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeckFromBrief } from '../nodeslideAgent';
import { callNodeSlideFreeJson } from './nodeslideProvider';
import {
  NODESLIDE_CREATE_DECK_LIMITS,
  NODESLIDE_OPENROUTER_BRIEF_CONSENT,
  invokeNodeSlideBriefProvider,
  validateNodeSlideBriefProviderChoice,
  validateNodeSlideCreateDeckFields,
  validateNodeSlidePreviewAdmission,
} from './nodeslideValidators';

vi.mock('./nodeslideProvider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./nodeslideProvider')>()),
  callNodeSlideFreeJson: vi.fn(),
}));

const PREVIEW_ACCESS_CODE = 'preview-code-7f21';
const PREVIEW_ADMISSION_SUBJECT = 'invite-cohort-2026-07';

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('NodeSlide private-preview admission', () => {
  const admission = {
    expectedAccessCode: PREVIEW_ACCESS_CODE,
    admissionSubject: PREVIEW_ADMISSION_SUBJECT,
  };

  it('returns the same safe failure for a missing or wrong access code', async () => {
    await expect(
      validateNodeSlidePreviewAdmission({ ...admission, providedAccessCode: undefined }),
    ).rejects.toMatchObject({
      data: { kind: 'nodeslide_create', code: 'admission_denied' },
    });
    await expect(
      validateNodeSlidePreviewAdmission({ ...admission, providedAccessCode: 'wrong-code' }),
    ).rejects.toMatchObject({
      data: { kind: 'nodeslide_create', code: 'admission_denied' },
    });
  });

  it('fails closed when server admission settings are incomplete', async () => {
    await expect(
      validateNodeSlidePreviewAdmission({
        providedAccessCode: admission.expectedAccessCode,
        expectedAccessCode: undefined,
        admissionSubject: admission.admissionSubject,
      }),
    ).rejects.toMatchObject({
      data: { kind: 'nodeslide_create', code: 'preview_not_configured' },
    });
  });

  it('derives a stable one-way quota subject without exposing admission values', async () => {
    const first = await validateNodeSlidePreviewAdmission({
      ...admission,
      providedAccessCode: admission.expectedAccessCode,
    });
    const second = await validateNodeSlidePreviewAdmission({
      ...admission,
      providedAccessCode: admission.expectedAccessCode,
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain(admission.expectedAccessCode);
    expect(first).not.toContain(admission.admissionSubject);
  });
});

describe('NodeSlide create action admission boundary', () => {
  it.each([
    ['missing', undefined],
    ['wrong', 'wrong-code'],
  ])('does no provider or database work for a %s access code', async (_label, accessCode) => {
    stubPreviewAdmission();
    const runMutation = vi.fn();

    await expect(
      createDeckHandler({ runMutation }, createActionArgs(accessCode)),
    ).rejects.toMatchObject({
      data: { kind: 'nodeslide_create', code: 'admission_denied' },
    });
    expect(runMutation).not.toHaveBeenCalled();
    expect(callNodeSlideFreeJson).not.toHaveBeenCalled();
  });

  it('keeps deterministic briefs out of the provider and access codes out of persistence', async () => {
    stubPreviewAdmission();
    const workspace = { deck: { id: 'deck-created' } };
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(workspace);

    await expect(
      createDeckHandler({ runMutation }, createActionArgs(PREVIEW_ACCESS_CODE)),
    ).resolves.toBe(workspace);

    expect(callNodeSlideFreeJson).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledTimes(2);
    const quotaArgs = runMutation.mock.calls[0]?.[1] as {
      buckets: Array<{ key: string }>;
    };
    expect(quotaArgs.buckets[0]?.key).toMatch(/^create:[a-f0-9]{64}$/);
    expect(quotaArgs.buckets[0]?.key).not.toContain(PREVIEW_ACCESS_CODE);
    expect(quotaArgs.buckets[0]?.key).not.toContain('rotatable-session');
    const persistenceArgs = runMutation.mock.calls[1]?.[1] as Record<string, unknown>;
    expect(persistenceArgs).not.toHaveProperty('accessCode');
    expect(persistenceArgs).not.toHaveProperty('providerConsent');
  });
});

describe('NodeSlide create-deck bounds', () => {
  it('accepts exact character/count boundaries', () => {
    const limits = NODESLIDE_CREATE_DECK_LIMITS;
    const result = validateNodeSlideCreateDeckFields({
      title: 't'.repeat(limits.title.maxCharacters),
      brief: {
        prompt: 'p'.repeat(limits.prompt.maxCharacters),
        audience: 'a'.repeat(limits.audience.maxCharacters),
        purpose: 'u'.repeat(limits.purpose.maxCharacters),
        successCriteria: Array.from({ length: 6 }, () =>
          'c'.repeat(limits.successCriteria.maxCharactersPerItem),
        ),
      },
    });

    expect(result.brief.successCriteria).toHaveLength(6);
  });

  it.each([
    ['title count', () => ({ ...validFields(), title: 't'.repeat(81) })],
    [
      'prompt count',
      () => ({
        ...validFields(),
        brief: { ...validFields().brief, prompt: 'p'.repeat(4_001) },
      }),
    ],
    [
      'audience count',
      () => ({
        ...validFields(),
        brief: { ...validFields().brief, audience: 'a'.repeat(241) },
      }),
    ],
    [
      'purpose count',
      () => ({
        ...validFields(),
        brief: { ...validFields().brief, purpose: 'u'.repeat(241) },
      }),
    ],
    [
      'successCriteria count',
      () => ({
        ...validFields(),
        brief: { ...validFields().brief, successCriteria: Array.from({ length: 13 }, () => 'ok') },
      }),
    ],
    [
      'successCriteria item count',
      () => ({
        ...validFields(),
        brief: { ...validFields().brief, successCriteria: ['c'.repeat(401)] },
      }),
    ],
    [
      'successCriteria total count',
      () => ({
        ...validFields(),
        brief: {
          ...validFields().brief,
          successCriteria: Array.from({ length: 7 }, () => 'c'.repeat(400)),
        },
      }),
    ],
  ])('rejects an over-limit %s', (_label, createFields) => {
    expectInvalidRequest(() => validateNodeSlideCreateDeckFields(createFields()));
  });

  it.each([
    ['title bytes', () => ({ ...validFields(), title: '😀'.repeat(61) })],
    [
      'prompt bytes',
      () => ({
        ...validFields(),
        brief: { ...validFields().brief, prompt: '😀'.repeat(2_049) },
      }),
    ],
    [
      'audience bytes',
      () => ({
        ...validFields(),
        brief: { ...validFields().brief, audience: '😀'.repeat(181) },
      }),
    ],
    [
      'purpose bytes',
      () => ({
        ...validFields(),
        brief: { ...validFields().brief, purpose: '😀'.repeat(181) },
      }),
    ],
    [
      'successCriteria item bytes',
      () => ({
        ...validFields(),
        brief: { ...validFields().brief, successCriteria: ['😀'.repeat(257)] },
      }),
    ],
  ])('rejects an over-limit %s', (_label, createFields) => {
    expectInvalidRequest(() => validateNodeSlideCreateDeckFields(createFields()));
  });
});

describe('NodeSlide provider consent contract', () => {
  it('defaults safely to a deterministic-only provider choice', () => {
    expect(validateNodeSlideBriefProviderChoice('deterministic', undefined)).toEqual({
      providerMode: 'deterministic',
    });
  });

  it('requires exact, mode-bound consent for OpenRouter', () => {
    expect(() => validateNodeSlideBriefProviderChoice('openrouter_free', undefined)).toThrow(
      ConvexError,
    );
    expect(() =>
      validateNodeSlideBriefProviderChoice('deterministic', NODESLIDE_OPENROUTER_BRIEF_CONSENT),
    ).toThrow(ConvexError);
    expect(
      validateNodeSlideBriefProviderChoice('openrouter_free', NODESLIDE_OPENROUTER_BRIEF_CONSENT),
    ).toEqual({
      providerMode: 'openrouter_free',
      providerConsent: NODESLIDE_OPENROUTER_BRIEF_CONSENT,
    });
  });

  it('never invokes the provider callback in deterministic mode', async () => {
    const invokeProvider = vi.fn(async () => ({ ok: true as const }));
    const result = await invokeNodeSlideBriefProvider(
      validateNodeSlideBriefProviderChoice('deterministic', undefined),
      invokeProvider,
    );

    expect(result).toBeNull();
    expect(invokeProvider).not.toHaveBeenCalled();
  });

  it('invokes the provider only after validated OpenRouter consent', async () => {
    const invokeProvider = vi.fn(async () => ({ ok: true as const }));
    const result = await invokeNodeSlideBriefProvider(
      validateNodeSlideBriefProviderChoice('openrouter_free', NODESLIDE_OPENROUTER_BRIEF_CONSENT),
      invokeProvider,
    );

    expect(result).toEqual({ ok: true });
    expect(invokeProvider).toHaveBeenCalledTimes(1);
  });
});

function validFields() {
  return {
    title: 'Private preview deck',
    brief: {
      prompt: 'Explain the decision clearly.',
      audience: 'Executive decision-makers',
      purpose: 'Decision briefing',
      successCriteria: ['Make the decision clear by slide three.'],
    },
  };
}

interface CreateActionArgs {
  accessCode?: string;
  clientSessionId: string;
  title: string;
  brief: {
    prompt: string;
    audience: string;
    purpose: string;
    successCriteria: string[];
  };
  themeId: string;
  route: 'free';
  providerMode: 'deterministic';
}

type CreateDeckHandler = (
  context: { runMutation: ReturnType<typeof vi.fn> },
  args: CreateActionArgs,
) => Promise<unknown>;

const createDeckHandler = (createDeckFromBrief as unknown as { _handler: CreateDeckHandler })
  ._handler;

function createActionArgs(accessCode: string | undefined): CreateActionArgs {
  return {
    ...(accessCode === undefined ? {} : { accessCode }),
    clientSessionId: 'rotatable-session',
    title: 'Private preview deck',
    brief: {
      prompt: 'Explain the decision clearly.',
      audience: 'Executive decision-makers',
      purpose: 'Decision briefing',
      successCriteria: ['Make the decision clear by slide three.'],
    },
    themeId: 'editorial-signal',
    route: 'free',
    providerMode: 'deterministic',
  };
}

function stubPreviewAdmission() {
  vi.stubEnv('NODESLIDE_PREVIEW_ACCESS_CODE', PREVIEW_ACCESS_CODE);
  vi.stubEnv('NODESLIDE_PREVIEW_ADMISSION_SUBJECT', PREVIEW_ADMISSION_SUBJECT);
}

function expectInvalidRequest(run: () => unknown) {
  try {
    run();
    throw new Error('Expected validation to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(ConvexError);
    expect(error).toMatchObject({
      data: { kind: 'nodeslide_create', code: 'invalid_request' },
    });
  }
}
