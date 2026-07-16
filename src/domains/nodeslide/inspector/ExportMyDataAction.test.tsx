// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeSlideOwnerDataExport } from '../../../../shared/nodeslideDataExport';
import { createNodeSlideDataExportDownloadPayload } from '../export/nodeSlideDataExportDownload';
import { ExportMyDataButton } from './ExportMyDataAction';

const bundle: NodeSlideOwnerDataExport = {
  manifest: {
    schemaVersion: 'nodeslide.owner-data-export/v2',
    generatedAt: Date.UTC(2026, 6, 14, 12),
    mediaType: 'application/json',
    scope: { kind: 'deck_owner_capability', deckId: 'deck:owner', deckVersion: 4 },
    completeness: { status: 'complete', truncated: false, recordCount: 2 },
    collections: [
      { path: 'data.deckSpec.deck', recordCount: 1 },
      { path: 'data.sources', recordCount: 1 },
    ],
    redaction: {
      policyVersion: 'nodeslide.secret-redaction/v1',
      removedFieldCount: 1,
      redactedValueCount: 0,
      excludedCollections: [
        {
          name: 'nodeslide_oauth_credentials',
          reason: 'authentication_material',
          detail: 'Provider credentials are omitted.',
        },
      ],
    },
    determinism: {
      collectionOrder: 'schema_defined',
      recordOrder: 'creation_time_then_stable_id',
      objectKeyOrder: 'lexicographic',
      generatedAt: 'request_time_only_nondeterministic_field',
    },
    retention: {
      serverCopyCreated: false,
      bundlePersistence: 'client_download_only',
      sourceSnapshot: 'retained_records_at_export_time',
      expiredOrPrunedRecords: 'not_recoverable',
    },
    mutationPolicy: 'read_only_no_cas_or_proposal_state_changes',
  },
  data: {
    deckSpec: { deck: { id: 'deck:owner', title: 'Q3 / Board Plan' }, slides: [], elements: [] },
    versions: [],
    proposals: { patches: [], variationBatches: [], variations: [], variationDecisions: [] },
    sources: [{ id: 'source:one', citation: 'Owner evidence' }],
    evidence: { captures: [], steps: [] },
    memories: [],
    activity: {
      jobs: [],
      durableSessions: [],
      durableSessionEvents: [],
      durableJournalEntries: [],
      runs: [],
      messages: [],
      spans: [],
      events: [],
      traces: [],
      executionTraces: [],
      shadowComparisons: [],
      validations: [],
    },
    budgets: { ledgers: [], billableCalls: [], events: [] },
    sync: { connections: [] },
    delegation: { grants: [], uses: [] },
    outputs: { exports: [], publications: [] },
    preferenceEvents: [],
    comments: [],
  },
};

afterEach(cleanup);

describe('ExportMyDataAction', () => {
  it('creates a parseable, dated JSON download payload', () => {
    const payload = createNodeSlideDataExportDownloadPayload(bundle, 'Q3 / Board Plan');

    expect(payload.fileName).toBe('q3-board-plan-nodeslide-data-2026-07-14.json');
    expect(payload.mediaType).toBe('application/json;charset=utf-8');
    expect(payload.text.endsWith('\n')).toBe(true);
    expect(JSON.parse(payload.text)).toEqual(bundle);
  });

  it('requests the owner-scoped bundle and passes that exact payload to the downloader', async () => {
    const requestExport = vi.fn().mockResolvedValue(bundle);
    const saveExport = vi.fn();

    render(
      <ExportMyDataButton
        deckId="deck:owner"
        deckTitle="Q3 / Board Plan"
        ownerAccessKey="owner-capability"
        requestExport={requestExport}
        saveExport={saveExport}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export my data' }));

    await waitFor(() => expect(saveExport).toHaveBeenCalledWith(bundle, 'Q3 / Board Plan'));
    expect(requestExport).toHaveBeenCalledWith({
      deckId: 'deck:owner',
      ownerAccessKey: 'owner-capability',
    });
    expect(screen.getByText('Your complete redacted JSON archive was downloaded.')).toBeTruthy();
  });

  it('does not create a download when authorization fails', async () => {
    const requestExport = vi.fn().mockRejectedValue(new Error('NodeSlide owner access denied.'));
    const saveExport = vi.fn();

    render(
      <ExportMyDataButton
        deckId="deck:owner"
        deckTitle="Owner deck"
        ownerAccessKey="wrong-capability"
        requestExport={requestExport}
        saveExport={saveExport}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export my data' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('NodeSlide owner access denied.');
    expect(saveExport).not.toHaveBeenCalled();
  });

  it('fails closed when the server returns a complete bundle for another deck', async () => {
    const requestExport = vi.fn().mockResolvedValue({
      ...bundle,
      manifest: {
        ...bundle.manifest,
        scope: { ...bundle.manifest.scope, deckId: 'deck:other' },
      },
    });
    const saveExport = vi.fn();

    render(
      <ExportMyDataButton
        deckId="deck:owner"
        deckTitle="Owner deck"
        ownerAccessKey="owner-capability"
        requestExport={requestExport}
        saveExport={saveExport}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export my data' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'NodeSlide data export failed closed: the returned bundle scope is invalid.',
    );
    expect(saveExport).not.toHaveBeenCalled();
  });
});
