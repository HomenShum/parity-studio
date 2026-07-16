import { describe, expect, it } from 'vitest';
import type { PatchOperation } from '../../../../shared/nodeslide';
import {
  EXTERNAL_CHANGE_SET_V1_SCHEMA,
  type ExternalChangeSetV1Input,
  type ExternalChangeSourceSystemV1,
  assertExternalChangeSetBaseVersion,
  assertExternalChangeSetBaselineBinding,
  assertExternalChangeSetDigest,
  assertExternalChangeSetOutboundExecutable,
  externalChangeSetToPatchProposal,
  normalizeExternalChangeSetV1,
} from './externalChangeSet';

const operation: PatchOperation = {
  op: 'replace_text',
  slideId: 'slide-1',
  elementId: 'element-1',
  text: 'Reconciled copy',
};

function input(
  sourceSystem: ExternalChangeSourceSystemV1,
  overrides: Partial<ExternalChangeSetV1Input> = {},
): ExternalChangeSetV1Input {
  return {
    sourceSystem,
    direction: 'inbound',
    remote: {
      objectId: `${sourceSystem}:deck-remote`,
      versionId: `${sourceSystem}:version-17`,
      baselineId: `${sourceSystem}:baseline-9`,
    },
    localBase: {
      deckId: 'deck-local',
      deckVersion: 12,
      slideVersions: { 'slide-1': 7 },
      elementVersions: { 'element-1': 4 },
    },
    mapping: [
      { kind: 'element', localId: 'element-1', remoteId: 'remote-element-1' },
      { kind: 'slide', localId: 'slide-1', remoteId: 'remote-slide-1' },
    ],
    operations: [operation],
    ...overrides,
  };
}

describe('ExternalChangeSetV1', () => {
  it.each<ExternalChangeSourceSystemV1>(['pptx', 'google_slides', 'json', 'mcp'])(
    'normalizes %s reconciliation into the canonical typed patch contract',
    (sourceSystem) => {
      const changeSet = normalizeExternalChangeSetV1(input(sourceSystem));

      expect(changeSet).toMatchObject({
        schemaVersion: EXTERNAL_CHANGE_SET_V1_SCHEMA,
        sourceSystem,
        direction: 'inbound',
        remote: {
          objectId: `${sourceSystem}:deck-remote`,
          versionId: `${sourceSystem}:version-17`,
          baselineId: `${sourceSystem}:baseline-9`,
        },
        operations: [operation],
        conflicts: [],
        postWriteVerification: null,
      });
      expect(changeSet.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    },
  );

  it('normalizes unordered metadata deterministically without reordering patch operations', () => {
    const conflicts = [
      {
        code: 'z-conflict',
        path: 'slides.z',
        message: '  Resolved   remotely ',
        status: 'resolved' as const,
        resolution: 'Keep remote',
      },
      {
        code: 'a-conflict',
        path: 'slides.a',
        message: 'Needs review',
      },
    ];
    const secondOperation: PatchOperation = {
      op: 'move',
      elementId: 'element-1',
      slideId: 'slide-1',
      y: 0.3,
      x: 0.2,
    };
    const first = normalizeExternalChangeSetV1(
      input('mcp', {
        localBase: {
          deckId: 'deck-local',
          deckVersion: 12,
          slideVersions: { 'slide-b': 8, 'slide-1': 7 },
          elementVersions: { 'element-z': 5, 'element-1': 4 },
        },
        mapping: [
          { kind: 'slide', localId: 'slide-b', remoteId: 'remote-slide-b' },
          { kind: 'element', localId: 'element-1', remoteId: 'remote-element-1' },
        ],
        operations: [operation, secondOperation],
        conflicts,
      }),
    );
    const second = normalizeExternalChangeSetV1(
      input('mcp', {
        localBase: {
          deckId: 'deck-local',
          deckVersion: 12,
          slideVersions: { 'slide-1': 7, 'slide-b': 8 },
          elementVersions: { 'element-1': 4, 'element-z': 5 },
        },
        mapping: [
          { remoteId: 'remote-element-1', localId: 'element-1', kind: 'element' },
          { remoteId: 'remote-slide-b', localId: 'slide-b', kind: 'slide' },
        ],
        operations: [
          {
            text: 'Reconciled copy',
            elementId: 'element-1',
            slideId: 'slide-1',
            op: 'replace_text',
          },
          { y: 0.3, x: 0.2, slideId: 'slide-1', elementId: 'element-1', op: 'move' },
        ],
        conflicts: [...conflicts].reverse(),
      }),
    );

    expect(second).toEqual(first);
    expect(first.operations.map((entry) => entry.op)).toEqual(['replace_text', 'move']);
  });

  it('blocks outbound execution for unresolved conflicts and absent verification intent', () => {
    const verification = {
      strategy: 'read_after_write' as const,
      remoteObjectId: 'google_slides:deck-remote',
      compareAgainstVersionId: 'google_slides:version-17',
    };
    const conflicted = normalizeExternalChangeSetV1(
      input('google_slides', {
        direction: 'outbound',
        postWriteVerification: verification,
        conflicts: [
          {
            code: 'concurrent_change',
            path: 'elements.element-1.content',
            message: 'Both systems changed this text.',
          },
        ],
      }),
    );
    expect(() => assertExternalChangeSetOutboundExecutable(conflicted)).toThrow(
      'Outbound execution is forbidden with 1 unresolved conflict.',
    );

    const unverified = normalizeExternalChangeSetV1(
      input('google_slides', { direction: 'outbound' }),
    );
    expect(() => assertExternalChangeSetOutboundExecutable(unverified)).toThrow(
      'Outbound execution is forbidden without post-write verification intent.',
    );

    const executable = normalizeExternalChangeSetV1(
      input('google_slides', {
        direction: 'outbound',
        postWriteVerification: verification,
        conflicts: [
          {
            code: 'concurrent_change',
            path: 'elements.element-1.content',
            message: 'The reviewer selected the local value.',
            status: 'resolved',
            resolution: 'Keep local',
          },
        ],
      }),
    );
    expect(() => assertExternalChangeSetOutboundExecutable(executable)).not.toThrow();
  });

  it('binds proposals to the exact captured NodeSlide base version and clocks', () => {
    const changeSet = normalizeExternalChangeSetV1(input('json'));
    const proposal = externalChangeSetToPatchProposal(changeSet);

    expect(proposal).toMatchObject({
      kind: 'candidate_patch',
      authority: 'nodeslide.proposePatch',
      usesCompareAndSwap: true,
      requiresHumanAcceptance: true,
      deckId: 'deck-local',
      baseDeckVersion: 12,
      baseSlideVersions: { 'slide-1': 7 },
      baseElementVersions: { 'element-1': 4 },
      operations: [operation],
      externalChangeSetDigest: changeSet.digest,
    });
    expect(() =>
      assertExternalChangeSetBaseVersion(changeSet, { deckId: 'deck-local', deckVersion: 12 }),
    ).not.toThrow();
    expect(() =>
      assertExternalChangeSetBaseVersion(changeSet, { deckId: 'deck-local', deckVersion: 13 }),
    ).toThrow('bound to deck-local at deck version 12');
    expect(() =>
      normalizeExternalChangeSetV1(
        input('json', {
          localBase: {
            deckId: 'deck-local',
            deckVersion: '12' as unknown as number,
            slideVersions: {},
            elementVersions: {},
          },
        }),
      ),
    ).toThrow('localBase.deckVersion must be a non-negative safe integer.');
  });

  it('rejects stale exact baseline witnesses and digest mutation', () => {
    const changeSet = normalizeExternalChangeSetV1(input('google_slides'));
    const exact = {
      remote: changeSet.remote,
      localBase: changeSet.localBase,
    };

    expect(() => assertExternalChangeSetBaselineBinding(changeSet, exact)).not.toThrow();
    expect(() =>
      assertExternalChangeSetBaselineBinding(changeSet, {
        ...exact,
        remote: { ...exact.remote, versionId: 'google_slides:version-18' },
      }),
    ).toThrow('baseline is stale');
    expect(() =>
      assertExternalChangeSetBaselineBinding(changeSet, {
        ...exact,
        localBase: {
          ...exact.localBase,
          elementVersions: { 'element-1': 5 },
        },
      }),
    ).toThrow('baseline is stale');

    const mutated = clone(changeSet);
    mutated.operations[0] = { ...operation, text: 'Mutated after digesting' };
    expect(() => assertExternalChangeSetDigest(mutated)).toThrow('digest mismatch');
    expect(() => externalChangeSetToPatchProposal(mutated)).toThrow('digest mismatch');
  });
});

function clone<T>(value: T): T {
  return structuredClone(value);
}
