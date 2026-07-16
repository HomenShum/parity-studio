export const NODESLIDE_OWNER_DATA_EXPORT_SCHEMA_VERSION = 'nodeslide.owner-data-export/v2' as const;
export const NODESLIDE_OWNER_DATA_EXPORT_REDACTION_VERSION =
  'nodeslide.secret-redaction/v1' as const;
export const NODESLIDE_OWNER_DATA_EXPORT_MEDIA_TYPE = 'application/json' as const;

export type NodeSlideDataExportValue =
  | null
  | boolean
  | number
  | string
  | NodeSlideDataExportValue[]
  | { [key: string]: NodeSlideDataExportValue };

export type NodeSlideDataExportRecord = Record<string, NodeSlideDataExportValue>;

export interface NodeSlideDataExportCollectionManifest {
  path: string;
  recordCount: number;
}

export interface NodeSlideOwnerDataExportManifest {
  schemaVersion: typeof NODESLIDE_OWNER_DATA_EXPORT_SCHEMA_VERSION;
  generatedAt: number;
  mediaType: typeof NODESLIDE_OWNER_DATA_EXPORT_MEDIA_TYPE;
  scope: {
    kind: 'deck_owner_capability';
    deckId: string;
    deckVersion: number;
  };
  completeness: {
    status: 'complete';
    truncated: false;
    recordCount: number;
  };
  collections: NodeSlideDataExportCollectionManifest[];
  redaction: {
    policyVersion: typeof NODESLIDE_OWNER_DATA_EXPORT_REDACTION_VERSION;
    removedFieldCount: number;
    redactedValueCount: number;
    excludedCollections: Array<{
      name: string;
      reason:
        | 'authentication_material'
        | 'binary_blob_contents'
        | 'computed_not_persisted'
        | 'cross_deck_profile'
        | 'ephemeral_runtime_state'
        | 'infrastructure_state'
        | 'provider_replay_payload';
      detail: string;
    }>;
  };
  determinism: {
    collectionOrder: 'schema_defined';
    recordOrder: 'creation_time_then_stable_id';
    objectKeyOrder: 'lexicographic';
    generatedAt: 'request_time_only_nondeterministic_field';
  };
  retention: {
    serverCopyCreated: false;
    bundlePersistence: 'client_download_only';
    sourceSnapshot: 'retained_records_at_export_time';
    expiredOrPrunedRecords: 'not_recoverable';
  };
  mutationPolicy: 'read_only_no_cas_or_proposal_state_changes';
}

export interface NodeSlideOwnerDataExport {
  manifest: NodeSlideOwnerDataExportManifest;
  data: {
    deckSpec: {
      deck: NodeSlideDataExportRecord;
      slides: NodeSlideDataExportRecord[];
      elements: NodeSlideDataExportRecord[];
    };
    versions: NodeSlideDataExportRecord[];
    proposals: {
      patches: NodeSlideDataExportRecord[];
      variationBatches: NodeSlideDataExportRecord[];
      variations: NodeSlideDataExportRecord[];
      variationDecisions: NodeSlideDataExportRecord[];
    };
    sources: NodeSlideDataExportRecord[];
    /** Present on complete v2 exports; optional only for stale in-memory test fixtures/clients. */
    sourceRevisions?: NodeSlideDataExportRecord[];
    evidence: {
      captures: NodeSlideDataExportRecord[];
      steps: NodeSlideDataExportRecord[];
      /** Present on complete v2 exports; optional only for stale in-memory test fixtures/clients. */
      claimReceipts?: NodeSlideDataExportRecord[];
    };
    memories: NodeSlideDataExportRecord[];
    activity: {
      jobs: NodeSlideDataExportRecord[];
      durableSessions: NodeSlideDataExportRecord[];
      durableSessionEvents: NodeSlideDataExportRecord[];
      durableJournalEntries: NodeSlideDataExportRecord[];
      runs: NodeSlideDataExportRecord[];
      messages: NodeSlideDataExportRecord[];
      spans: NodeSlideDataExportRecord[];
      events: NodeSlideDataExportRecord[];
      traces: NodeSlideDataExportRecord[];
      executionTraces: NodeSlideDataExportRecord[];
      shadowComparisons: NodeSlideDataExportRecord[];
      validations: NodeSlideDataExportRecord[];
    };
    budgets: {
      ledgers: NodeSlideDataExportRecord[];
      billableCalls: NodeSlideDataExportRecord[];
      events: NodeSlideDataExportRecord[];
    };
    sync: {
      connections: NodeSlideDataExportRecord[];
    };
    delegation: {
      grants: NodeSlideDataExportRecord[];
      uses: NodeSlideDataExportRecord[];
    };
    outputs: {
      exports: NodeSlideDataExportRecord[];
      publications: NodeSlideDataExportRecord[];
    };
    preferenceEvents: NodeSlideDataExportRecord[];
    comments: NodeSlideDataExportRecord[];
  };
}
