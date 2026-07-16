import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mutationSource = readFileSync(new URL('./nodeslide.ts', import.meta.url), 'utf8');
const schemaSource = readFileSync(new URL('./schema.ts', import.meta.url), 'utf8');
const exportSource = readFileSync(new URL('./lib/nodeslideDataExport.ts', import.meta.url), 'utf8');
const deletionSource = readFileSync(
  new URL('./lib/nodeslideDeckDeletion.ts', import.meta.url),
  'utf8',
);

describe('NodeSlide immutable evidence binding integration', () => {
  it('persists owner/deck indexed append-only source revisions and claim receipts', () => {
    expect(schemaSource).toContain('nodeslide_source_revisions: defineTable');
    expect(schemaSource).toContain(".index('by_owner_created', ['ownerDigest', 'createdAt'])");
    expect(schemaSource).toContain(
      ".index('by_source_content_digest', ['sourceId', 'contentDigest'])",
    );
    expect(schemaSource).toContain('nodeslide_claim_evidence_receipts: defineTable');
    expect(schemaSource).toContain(".index('by_patch_created', ['patchId', 'createdAt'])");
    expect(schemaSource).toContain(
      ".index('by_source_revision_created', ['sourceRevisionId', 'createdAt'])",
    );
  });

  it('binds every new source/capture to an immutable revision without overwriting revisions', () => {
    const helperStart = mutationSource.indexOf('async function ensureNodeSlideSourceRevision');
    const helperEnd = mutationSource.indexOf(
      'async function persistNodeSlideClaimEvidenceReceipts',
    );
    const helper = mutationSource.slice(helperStart, helperEnd);
    expect(helper).toContain(".query('nodeslide_source_revisions')");
    expect(helper).toContain(".withIndex('by_source_content_digest'");
    expect(helper).toContain(".withIndex('by_source_created'");
    expect(helper).toContain("ctx.db.insert('nodeslide_source_revisions'");
    expect(helper).not.toContain('ctx.db.patch(');

    const attachmentStart = mutationSource.indexOf('export const attachDataSource');
    const captureStart = mutationSource.indexOf('export const recordEvidenceCaptureInternal');
    const webStart = mutationSource.indexOf('export const attachWebSourcesInternal');
    expect(mutationSource.slice(attachmentStart, captureStart)).toContain(
      'await ensureNodeSlideSourceRevision',
    );
    expect(mutationSource.slice(captureStart, webStart)).toContain(
      'sourceRevisionId: sourceRevision.id',
    );
    expect(mutationSource.slice(webStart)).toContain('await ensureNodeSlideSourceRevision');
  });

  it('creates digest-bound claim receipts at proposal and acceptance only from exact geometry', () => {
    const helperStart = mutationSource.indexOf(
      'async function persistNodeSlideClaimEvidenceReceipts',
    );
    const helperEnd = mutationSource.indexOf(
      '// biome-ignore lint/suspicious/noExplicitAny',
      helperStart,
    );
    const helper = mutationSource.slice(helperStart, helperEnd);
    expect(helper).toContain('buildNodeSlideClaimEvidenceReceipt');
    expect(helper).toContain('!candidate.box');
    expect(helper).toContain("candidate.regionScope !== 'claim'");
    expect(helper).toContain("candidate.attachmentKind === 'screenshot'");
    expect(helper).toContain('Number.isInteger(candidate.box.pageCount)');
    expect(helper).not.toMatch(/pageCount:\s*\d+/u);
    expect(helper).toContain("ctx.db.insert('nodeslide_claim_evidence_receipts'");

    const proposalStart = mutationSource.indexOf('export const proposeAgentPatchInternal');
    const commitStart = mutationSource.indexOf('async function commitPatch');
    expect(mutationSource.slice(proposalStart, commitStart)).toContain(
      'await persistNodeSlideClaimEvidenceReceipts',
    );
    expect(mutationSource.slice(commitStart)).toContain(
      'await persistNodeSlideClaimEvidenceReceipts',
    );
  });

  it('keeps signed storage URLs out of summaries and resolves only selected capture detail', () => {
    const summaryStart = mutationSource.indexOf('export const listEvidenceCaptureSummaries');
    const detailStart = mutationSource.indexOf('export const getEvidenceCaptureDetail');
    const detailEnd = mutationSource.indexOf('export const cancelAgentRun', detailStart);
    const summaryQuery = mutationSource.slice(summaryStart, detailStart);
    const detailQuery = mutationSource.slice(detailStart, detailEnd);

    expect(summaryQuery).not.toContain('ctx.storage.getUrl');
    expect(summaryQuery).not.toContain('screenshotStorageId');
    expect(summaryQuery).not.toContain('pdfStorageId');
    expect(detailQuery).toContain('ctx.storage.getUrl(screenshotStorageId)');
    expect(detailQuery).toContain('ctx.storage.getUrl(pdfStorageId)');
    expect(detailQuery).toContain("query.eq('id', args.captureId)");
  });

  it('exports and erases both immutable custody collections', () => {
    for (const table of ['nodeslide_source_revisions', 'nodeslide_claim_evidence_receipts']) {
      expect(exportSource).toContain(`.query('${table}')`);
      expect(deletionSource).toContain(`'${table}'`);
      expect(deletionSource).toContain(`.query('${table}')`);
    }
    expect(exportSource).toContain('sourceRevisions: redactRows');
    expect(exportSource).toContain('claimReceipts: redactRows');
    expect(exportSource).toContain('claim evidence receipt custody binding is inconsistent');
  });
});
