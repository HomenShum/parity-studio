import type { DeckPatch, DeckVersion, SlideElement } from '../../../shared/nodeslide';

export type EditorCandidateStatus =
  | 'ready'
  | 'validating'
  | 'warning'
  | 'invalid'
  | 'stale'
  | 'unavailable';

export interface EditorCandidateBinding {
  patchId: string;
  candidateDigest: string;
  receiptPatchId: string;
  receiptCandidateDigest: string;
}

export interface EditorCandidateReceipt {
  id?: string;
  status: EditorCandidateStatus;
  summary?: string;
  versionLabel?: string;
  binding?: EditorCandidateBinding;
}

export function editorCandidateReceiptForPatch(
  patch: DeckPatch,
  currentDeck: { id: string; version: number },
): EditorCandidateReceipt {
  if (
    patch.status === 'stale' ||
    patch.deckId !== currentDeck.id ||
    patch.scope.deckId !== currentDeck.id
  ) {
    return { id: patch.id, status: 'stale', summary: patch.summary };
  }
  if (patch.status === 'draft' || patch.status === 'validating') {
    return { id: patch.id, status: 'validating', summary: patch.summary };
  }
  if (patch.status !== 'ready') {
    return { id: patch.id, status: 'unavailable', summary: patch.summary };
  }

  const candidateDigest = patch.candidateDigest;
  const receipt = patch.candidateValidation;
  if (!candidateDigest || !receipt) {
    return {
      id: patch.id,
      status: 'unavailable',
      summary: 'The exact candidate validation receipt is unavailable.',
    };
  }

  const binding: EditorCandidateBinding = {
    patchId: patch.id,
    candidateDigest,
    receiptPatchId: receipt.patchId,
    receiptCandidateDigest: receipt.candidateDigest,
  };
  if (!candidateBindingMatches(binding) || receipt.deckId !== patch.deckId) {
    return {
      id: patch.id,
      status: 'invalid',
      summary: 'The validation receipt does not match this exact patch candidate.',
      binding,
    };
  }
  if (receipt.deckVersion !== currentDeck.version + 1) {
    return {
      id: patch.id,
      status: 'stale',
      summary: 'The exact candidate was validated against an older deck version.',
      binding,
    };
  }

  const hasErrors = receipt.issues.some((issue) => issue.severity === 'error');
  if (!receipt.ok || hasErrors) {
    return {
      id: patch.id,
      status: 'invalid',
      summary: patch.summary,
      versionLabel: `Candidate for deck v${receipt.deckVersion}`,
      binding,
    };
  }

  return {
    id: patch.id,
    status: receipt.issues.some((issue) => issue.severity === 'warning') ? 'warning' : 'ready',
    summary: patch.summary,
    versionLabel: `Candidate for deck v${receipt.deckVersion}`,
    binding,
  };
}

export function editorCandidateCanAccept(
  receipt: EditorCandidateReceipt | null | undefined,
): boolean {
  return Boolean(
    receipt &&
      (receipt.status === 'ready' || receipt.status === 'warning') &&
      receipt.binding &&
      candidateBindingMatches(receipt.binding),
  );
}

function candidateBindingMatches(binding: EditorCandidateBinding): boolean {
  return Boolean(
    binding.patchId &&
      binding.candidateDigest &&
      binding.patchId === binding.receiptPatchId &&
      binding.candidateDigest === binding.receiptCandidateDigest,
  );
}

export interface EditorRequestToken {
  deckId: string | null;
  lane: string;
  requestId: number;
  deckEpoch: number;
}

export interface EditorRequestGate {
  setActiveDeck: (deckId: string | null) => void;
  begin: (lane: string, deckId: string | null) => EditorRequestToken;
  isCurrent: (token: EditorRequestToken) => boolean;
  isDeckCurrent: (deckId: string | null) => boolean;
}

export function createEditorRequestGate(initialDeckId: string | null): EditorRequestGate {
  let activeDeckId = initialDeckId;
  let deckEpoch = 0;
  let nextRequestId = 0;
  const latestByLane = new Map<string, number>();

  return {
    setActiveDeck(deckId) {
      if (deckId === activeDeckId) return;
      activeDeckId = deckId;
      deckEpoch += 1;
      latestByLane.clear();
    },
    begin(lane, deckId) {
      const requestId = ++nextRequestId;
      latestByLane.set(lane, requestId);
      return { deckId, lane, requestId, deckEpoch };
    },
    isCurrent(token) {
      return (
        token.deckId === activeDeckId &&
        token.deckEpoch === deckEpoch &&
        latestByLane.get(token.lane) === token.requestId
      );
    },
    isDeckCurrent(deckId) {
      return deckId === activeDeckId;
    },
  };
}

export interface SerializedEditorWriteQueue {
  enqueue<Result>(write: () => Promise<Result> | Result): Promise<Result>;
}

export function createSerializedEditorWriteQueue(): SerializedEditorWriteQueue {
  let tail = Promise.resolve();
  return {
    enqueue<Result>(write: () => Promise<Result> | Result) {
      const result = tail.then(write, write);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

export function appendDistinctHistoryVersion(
  history: readonly string[],
  versionId: string,
): string[] {
  return history.at(-1) === versionId ? [...history] : [...history, versionId];
}

export interface InlineEditSession {
  elementId: string;
  baseElementVersion: number;
  initialValue: string;
}

export interface InlineEditCommit {
  elementId: string;
  baseElementVersion: number;
  text: string;
}

export function captureInlineEditSession(element: SlideElement): InlineEditSession {
  return {
    elementId: element.id,
    baseElementVersion: element.version,
    initialValue: element.content ?? '',
  };
}

export function inlineEditCommit(
  session: InlineEditSession,
  value: string,
): InlineEditCommit | null {
  return value === session.initialValue
    ? null
    : {
        elementId: session.elementId,
        baseElementVersion: session.baseElementVersion,
        text: value,
      };
}

export function applyExpectedElementVersions(
  currentVersions: Readonly<Record<string, number>>,
  expectedVersions: Readonly<Record<string, number>> | undefined,
): Record<string, number> {
  const boundVersions = { ...currentVersions };
  if (!expectedVersions) return boundVersions;
  for (const [elementId, version] of Object.entries(expectedVersions)) {
    if (elementId in boundVersions) boundVersions[elementId] = version;
  }
  return boundVersions;
}

export interface WorkspaceReceiptMarker {
  deckId: string;
  deckVersion: number;
  versionId?: string;
  patch?: {
    id: string;
    status: DeckPatch['status'];
    updatedAt: number;
  };
}

export interface WorkspaceIntegrityView {
  deck: { id: string; version: number };
  patches: readonly DeckPatch[];
  versions: readonly DeckVersion[];
}

/** Identifies the newest same-version state installed from an authoritative mutation receipt. */
export function workspaceReceiptMarker(workspace: WorkspaceIntegrityView): WorkspaceReceiptMarker {
  const latestPatch = [...workspace.patches].sort(
    (left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id),
  )[0];
  const currentVersion = workspace.versions.find(
    (version) => version.version === workspace.deck.version,
  );
  return {
    deckId: workspace.deck.id,
    deckVersion: workspace.deck.version,
    ...(currentVersion ? { versionId: currentVersion.id } : {}),
    ...(latestPatch
      ? {
          patch: {
            id: latestPatch.id,
            status: latestPatch.status,
            updatedAt: latestPatch.updatedAt,
          },
        }
      : {}),
  };
}

/** Keeps receipt state until the reactive query has causally caught up or advanced beyond it. */
export function workspaceSatisfiesReceiptMarker(
  workspace: WorkspaceIntegrityView,
  marker: WorkspaceReceiptMarker,
): boolean {
  if (workspace.deck.id !== marker.deckId || workspace.deck.version < marker.deckVersion) {
    return false;
  }
  if (workspace.deck.version > marker.deckVersion) return true;
  if (marker.versionId && !workspace.versions.some((version) => version.id === marker.versionId)) {
    return false;
  }
  const markerPatch = marker.patch;
  if (!markerPatch) return true;
  const matchingPatch = workspace.patches.find((patch) => patch.id === markerPatch.id);
  if (matchingPatch) {
    return (
      matchingPatch.status === markerPatch.status &&
      matchingPatch.updatedAt >= markerPatch.updatedAt
    );
  }
  return workspace.patches.some((patch) => patch.updatedAt > markerPatch.updatedAt);
}

/** Finds the exact full-snapshot version immediately before a committed resulting version. */
export function authoritativePredecessorVersion(
  workspace: WorkspaceIntegrityView,
  resultingVersion = workspace.deck.version,
): DeckVersion | undefined {
  return workspace.versions.find((version) => version.version === resultingVersion - 1);
}

export function classifyEditorVersionAdvance(
  previousVersion: number,
  currentVersion: number,
  localCommitVersions: ReadonlySet<number>,
): 'none' | 'local' | 'external' {
  if (currentVersion <= previousVersion) return 'none';
  return localCommitVersions.has(currentVersion) ? 'local' : 'external';
}
