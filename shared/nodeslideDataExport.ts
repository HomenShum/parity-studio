export const NODESLIDE_OWNER_DATA_EXPORT_SCHEMA_VERSION = 'nodeslide.owner-data-export/v1' as const;
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
      reason: 'authentication_material' | 'ephemeral_runtime_state';
    }>;
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
    memories: NodeSlideDataExportRecord[];
    activity: {
      jobs: NodeSlideDataExportRecord[];
      runs: NodeSlideDataExportRecord[];
      messages: NodeSlideDataExportRecord[];
      spans: NodeSlideDataExportRecord[];
      events: NodeSlideDataExportRecord[];
      traces: NodeSlideDataExportRecord[];
      executionTraces: NodeSlideDataExportRecord[];
      validations: NodeSlideDataExportRecord[];
    };
    comments: NodeSlideDataExportRecord[];
  };
}
