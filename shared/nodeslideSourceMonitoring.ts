export interface NodeSlideSourceRefreshSchedule {
  id: string;
  deckId: string;
  sourceId: string;
  enabled: boolean;
  intervalMinutes: number;
  nextRunAt: number;
  status: 'ready' | 'checking' | 'backoff' | 'disabled';
  failureCount: number;
  lastCheckedAt?: number;
  lastChangedAt?: number;
  lastError?: string;
  updatedAt: number;
}

export interface NodeSlideSourceRefreshProposal {
  id: string;
  deckId: string;
  sourceId: string;
  status: 'ready' | 'prepared' | 'dismissed' | 'converted' | 'stale';
  baseDeckVersion: number;
  planDigest: string;
  deckCiDigest: string;
  affectedSlideIds: string[];
  affectedElementIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface NodeSlideSourceRefreshState {
  schedules: NodeSlideSourceRefreshSchedule[];
  proposals: NodeSlideSourceRefreshProposal[];
}

export type NodeSlidePreparedSourceRefreshEdit =
  | { status: 'stale'; proposalId: string }
  | {
      status: 'prepared';
      proposalId: string;
      instruction: string;
      readContext: Array<{ id: string; kind: 'source'; label: string }>;
      affectedSlideIds: string[];
      affectedElementIds: string[];
      baseDeckVersion: number;
      baseSnapshotDigest: string;
    };
