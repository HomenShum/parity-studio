import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_JOB_JOURNAL_MAX_MODEL_ENTRIES,
  type NodeSlideJobJournalBinding,
  NodeSlideJobJournalError,
  type NodeSlideModelJournalInput,
  appendNodeSlideModelJournal,
  assertNodeSlideJobJournal,
  createNodeSlideJobJournal,
  reduceNodeSlideJobJournal,
} from './nodeslideJobJournal';

describe('NodeSlide binding-checked model/web journal', () => {
  it('keeps bounded metadata entries on the exact request/job/attempt/egress binding', () => {
    const binding = journalBinding();
    let journal = createNodeSlideJobJournal(binding);
    journal = reduceNodeSlideJobJournal(journal, {
      kind: 'model',
      binding,
      entry: modelEntry('m-1'),
    });
    journal = reduceNodeSlideJobJournal(journal, {
      kind: 'web',
      binding,
      entry: {
        id: 'w-1',
        provider: 'internal-web',
        operation: 'search',
        queryDigest: 'query-digest',
        urlDigest: 'url-digest',
        resultDigest: 'results-digest',
        resultCount: 2,
        createdAt: 11,
      },
    });
    assertNodeSlideJobJournal(journal);
    expect(journal).toMatchObject({
      nextSequence: 3,
      modelEntries: [{ sequence: 1 }],
      webEntries: [{ sequence: 2 }],
    });
    expect(journal.modelEntries[0]).not.toHaveProperty('prompt');
    expect(journal.webEntries[0]).not.toHaveProperty('url');
    expect(appendNodeSlideModelJournal(journal, { binding, entry: modelEntry('m-1') })).toBe(
      journal,
    );
  });

  it('refuses every binding substitution, including attempt and egress epoch', () => {
    const binding = journalBinding();
    const journal = createNodeSlideJobJournal(binding);
    const mismatch = { ...binding, attempt: 2 };
    expect(() =>
      appendNodeSlideModelJournal(journal, { binding: mismatch, entry: modelEntry('m-1') }),
    ).toThrowError(expect.objectContaining({ code: 'binding_mismatch' }));
    expect(() =>
      appendNodeSlideModelJournal(journal, {
        binding: { ...binding, egressEpoch: 2 },
        entry: modelEntry('m-1'),
      }),
    ).toThrowError(NodeSlideJobJournalError);
  });

  it('does not silently overwrite a reused entry id and enforces the model bound', () => {
    const binding = journalBinding();
    let journal = createNodeSlideJobJournal(binding);
    journal = appendNodeSlideModelJournal(journal, { binding, entry: modelEntry('duplicate') });
    expect(() =>
      appendNodeSlideModelJournal(journal, {
        binding,
        entry: { ...modelEntry('duplicate'), outputDigest: 'substituted-output' },
      }),
    ).toThrowError(expect.objectContaining({ code: 'entry_conflict' }));
    for (let index = 1; index < NODESLIDE_JOB_JOURNAL_MAX_MODEL_ENTRIES; index += 1) {
      journal = appendNodeSlideModelJournal(journal, { binding, entry: modelEntry(`m-${index}`) });
    }
    expect(journal.modelEntries).toHaveLength(NODESLIDE_JOB_JOURNAL_MAX_MODEL_ENTRIES);
    expect(() =>
      appendNodeSlideModelJournal(journal, { binding, entry: modelEntry('overflow') }),
    ).toThrowError(expect.objectContaining({ code: 'journal_capacity_exceeded' }));
  });
});

function journalBinding(): NodeSlideJobJournalBinding {
  return {
    schemaVersion: 'nodeslide.request-binding/v2',
    sessionId: 'session-1',
    jobId: 'job-1',
    requestDigest: 'sha256:request',
    capabilityDigest: 'sha256:capability',
    egressEpoch: 1,
    attempt: 1,
  };
}

function modelEntry(id: string): NodeSlideModelJournalInput {
  return {
    id,
    provider: 'nebius',
    model: 'glm',
    operation: 'plan',
    inputDigest: 'sha256:input',
    outputDigest: 'sha256:output',
    inputTokens: 10,
    outputTokens: 20,
    createdAt: 10,
  };
}
