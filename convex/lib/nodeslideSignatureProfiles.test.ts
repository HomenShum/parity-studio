import { describe, expect, it } from 'vitest';
import { applyDeckPatch } from '../../shared/nodeslidePatch';
import { planSignatureApplication } from '../../shared/nodeslideSignatureApply';
import { financeIbcsTastePack } from '../../src/domains/nodeslide/signature/packs/index';
import { buildGoldenNodeSlide } from './nodeslideSeed';
import {
  NODESLIDE_SIGNATURE_PROFILE_LIST_BYTES,
  NODESLIDE_SIGNATURE_PROFILE_LIST_LIMIT,
  parseSignatureProfileFromStorage,
  serializeSignatureProfileForStorage,
  signatureProfileRowId,
  validateSignatureProfileForStorage,
} from './nodeslideSignatureProfiles';
import { validateNodeSlideSnapshot } from './nodeslideValidation';

describe('NodeSlide durable signature profiles', () => {
  it('accepts a bounded valid profile and rejects oversized storage payloads', () => {
    const stored = validateSignatureProfileForStorage(financeIbcsTastePack);
    expect(stored).toEqual(financeIbcsTastePack);
    expect(stored).not.toBe(financeIbcsTastePack);

    const oversized = structuredClone(financeIbcsTastePack);
    oversized.name = 'x'.repeat(1_000_001);
    expect(() => validateSignatureProfileForStorage(oversized)).toThrow(/storage limit/i);
  });

  it('round-trips DTCG dollar-prefixed keys through a bounded JSON wire format', () => {
    const serialized = serializeSignatureProfileForStorage(financeIbcsTastePack);
    expect(serialized).toContain('"$value"');
    expect(parseSignatureProfileFromStorage(serialized)).toEqual(financeIbcsTastePack);
    expect(() => parseSignatureProfileFromStorage('{not-json')).toThrow(/JSON is invalid/i);
    expect(NODESLIDE_SIGNATURE_PROFILE_LIST_LIMIT).toBe(8);
    expect(NODESLIDE_SIGNATURE_PROFILE_LIST_BYTES).toBe(4_000_000);
  });

  it('derives tenant-scoped row IDs and receipt-time-independent validation IDs', () => {
    expect(
      signatureProfileRowId(
        'tenant:a',
        financeIbcsTastePack.id,
        financeIbcsTastePack.source.digest,
      ),
    ).toMatch(new RegExp(`${financeIbcsTastePack.source.digest.slice(7)}$`));
    expect(
      signatureProfileRowId(
        'tenant:a',
        financeIbcsTastePack.id,
        financeIbcsTastePack.source.digest,
      ),
    ).toBe(
      signatureProfileRowId(
        'tenant:a',
        financeIbcsTastePack.id,
        financeIbcsTastePack.source.digest,
      ),
    );
    expect(
      signatureProfileRowId(
        'tenant:a',
        financeIbcsTastePack.id,
        financeIbcsTastePack.source.digest,
      ),
    ).not.toBe(
      signatureProfileRowId(
        'tenant:b',
        financeIbcsTastePack.id,
        financeIbcsTastePack.source.digest,
      ),
    );
    expect(
      signatureProfileRowId(
        'tenant:a',
        financeIbcsTastePack.id,
        financeIbcsTastePack.source.digest,
      ),
    ).not.toBe(
      signatureProfileRowId('tenant:a', financeIbcsTastePack.id, `sha256:${'f'.repeat(64)}`),
    );

    const source = buildGoldenNodeSlide('signature-profile-test', 1_000).snapshot;
    const plan = planSignatureApplication(source, financeIbcsTastePack);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const candidate = applyDeckPatch(source, {
      baseDeckVersion: plan.plan.baseDeckVersion,
      operations: plan.plan.operations,
      scope: plan.plan.scope,
    }).snapshot;
    const first = validateNodeSlideSnapshot(candidate, 2_000, undefined, {
      signatureProfile: financeIbcsTastePack,
    });
    const second = validateNodeSlideSnapshot(candidate, 9_000, undefined, {
      signatureProfile: financeIbcsTastePack,
    });
    expect(second.id).toBe(first.id);
    expect(second.issues.map((issue) => issue.id)).toEqual(first.issues.map((issue) => issue.id));
    expect(second.checkedAt).not.toBe(first.checkedAt);
  });
});
