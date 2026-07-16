import { nodeSlideDurableDigest } from './nodeslideDurableSession';

export const NODESLIDE_JOURNEY_PROOF_VERSION = 'nodeslide.journey-proof/v2' as const;

export const NODESLIDE_REQUIRED_JOURNEY_STEPS = [
  'brief_submitted',
  'deck_created',
  'edit_submitted',
  'validation_received',
  'edit_applied',
  'undo_verified',
  'redo_verified',
  'version_advanced',
  'export_downloaded',
] as const;

export type NodeSlideJourneyStepKind = (typeof NODESLIDE_REQUIRED_JOURNEY_STEPS)[number];

export interface NodeSlideJourneyStep {
  kind: NodeSlideJourneyStepKind;
  occurredAt: number;
  deckVersion?: number;
  receiptDigest?: string;
  runId?: string;
  patchId?: string;
  candidateDigest?: string;
  baseDeckVersion?: number;
  resultingDeckVersion?: number;
  contentDigest?: string;
  artifactPath?: string;
}

export interface NodeSlideJourneyArtifacts {
  rawRecordingPath?: string;
  gifPath?: string;
  finalScreenshotPath?: string;
  exportedDeckPath?: string;
  runManifestPath?: string;
}

export interface NodeSlideJourneyProof {
  schemaVersion: typeof NODESLIDE_JOURNEY_PROOF_VERSION;
  deckId: string;
  expectedCreationProvenance: 'brief_to_new_deck' | 'existing_deck_edit';
  actualCreationProvenance: 'brief_to_new_deck' | 'existing_deck_edit' | 'sample_fallback';
  baseVersion: number;
  appliedVersion: number;
  finalVersion: number;
  steps: NodeSlideJourneyStep[];
  artifacts: NodeSlideJourneyArtifacts;
  digest: string;
}

export interface LegacyNodeSlideJourneyProofV1 {
  schemaVersion: 'nodeslide.journey-proof/v1';
  deckId: string;
  expectedCreationProvenance: 'brief_to_new_deck' | 'existing_deck_edit';
  actualCreationProvenance: 'brief_to_new_deck' | 'existing_deck_edit' | 'sample_fallback';
  baseVersion: number;
  acceptedVersion: number;
  steps: Array<{
    kind: string;
    occurredAt: number;
    deckVersion?: number;
    receiptDigest?: string;
    artifactPath?: string;
  }>;
  artifacts: NodeSlideJourneyArtifacts;
  digest: string;
}

export type NodeSlideJourneyProofInput = NodeSlideJourneyProof | LegacyNodeSlideJourneyProofV1;

export interface NodeSlideJourneyProofFinding {
  code:
    | 'journey_digest_mismatch'
    | 'journey_step_missing'
    | 'journey_step_order_invalid'
    | 'journey_provenance_mismatch'
    | 'journey_version_delta_invalid'
    | 'journey_receipt_missing'
    | 'journey_artifact_missing';
  blocker: true;
  message: string;
}

export interface NodeSlideJourneyProofResult {
  ok: boolean;
  findings: NodeSlideJourneyProofFinding[];
}

export function createNodeSlideJourneyProof(
  input: Omit<NodeSlideJourneyProof, 'schemaVersion' | 'digest'>,
): NodeSlideJourneyProof {
  const partial = {
    schemaVersion: NODESLIDE_JOURNEY_PROOF_VERSION,
    ...structuredClone(input),
  };
  return { ...partial, digest: nodeSlideDurableDigest(partial) };
}

export function verifyNodeSlideJourneyProof(
  proof: NodeSlideJourneyProofInput,
): NodeSlideJourneyProofResult {
  const findings: NodeSlideJourneyProofFinding[] = [];
  const { digest, ...partial } = proof;
  if (digest !== nodeSlideDurableDigest(partial)) {
    findings.push(finding('journey_digest_mismatch', 'The journey proof digest is invalid.'));
  }

  if (proof.schemaVersion === 'nodeslide.journey-proof/v1') {
    return verifyLegacyProof(proof, findings);
  }

  if (proof.expectedCreationProvenance !== proof.actualCreationProvenance) {
    findings.push(
      finding(
        'journey_provenance_mismatch',
        `Requested ${proof.expectedCreationProvenance}, but the run produced ${proof.actualCreationProvenance}.`,
      ),
    );
  }

  if (
    !Number.isSafeInteger(proof.baseVersion) ||
    !Number.isSafeInteger(proof.appliedVersion) ||
    !Number.isSafeInteger(proof.finalVersion) ||
    proof.appliedVersion !== proof.baseVersion + 1 ||
    proof.finalVersion !== proof.appliedVersion + 2
  ) {
    findings.push(
      finding(
        'journey_version_delta_invalid',
        `The edit, Undo, and Redo receipts must advance exactly once each; received v${proof.baseVersion}, v${proof.appliedVersion}, and v${proof.finalVersion}.`,
      ),
    );
  }

  const byKind = new Map(proof.steps.map((step) => [step.kind, step]));
  for (const kind of NODESLIDE_REQUIRED_JOURNEY_STEPS) {
    if (!byKind.has(kind)) {
      findings.push(finding('journey_step_missing', `The ${kind} journey step is missing.`));
    }
  }

  const ordered = NODESLIDE_REQUIRED_JOURNEY_STEPS.flatMap((kind) => {
    const step = byKind.get(kind);
    return step ? [step] : [];
  });
  if (
    ordered.some(
      (step, index) => index > 0 && step.occurredAt < (ordered[index - 1]?.occurredAt ?? 0),
    )
  ) {
    findings.push(
      finding('journey_step_order_invalid', 'Journey steps are not in monotonic timestamp order.'),
    );
  }

  for (const kind of [
    'validation_received',
    'edit_applied',
    'undo_verified',
    'redo_verified',
  ] as const) {
    if (!isSha256Digest(byKind.get(kind)?.receiptDigest)) {
      findings.push(
        finding('journey_receipt_missing', `The ${kind} step is not bound to a receipt digest.`),
      );
    }
  }

  const validation = byKind.get('validation_received');
  const applied = byKind.get('edit_applied');
  const undone = byKind.get('undo_verified');
  const redone = byKind.get('redo_verified');
  const bindingMatches =
    validation?.runId &&
    validation.patchId &&
    validation.candidateDigest &&
    validation.runId === applied?.runId &&
    validation.patchId === applied?.patchId &&
    validation.candidateDigest === applied?.candidateDigest &&
    validation.baseDeckVersion === proof.baseVersion &&
    applied?.baseDeckVersion === proof.baseVersion &&
    applied.resultingDeckVersion === proof.appliedVersion &&
    applied.deckVersion === proof.appliedVersion &&
    undone?.patchId === applied.patchId &&
    undone.deckVersion === proof.appliedVersion + 1 &&
    isSha256Digest(undone.contentDigest) &&
    redone?.patchId === applied.patchId &&
    redone.deckVersion === proof.finalVersion &&
    isSha256Digest(redone.contentDigest) &&
    redone.contentDigest === applied.contentDigest;
  if (!bindingMatches) {
    findings.push(
      finding(
        'journey_receipt_missing',
        'Validation, apply, Undo, and Redo must bind the same durable run, patch, candidate, versions, and restored content.',
      ),
    );
  }

  const requiredArtifacts: Array<keyof NodeSlideJourneyArtifacts> = [
    'rawRecordingPath',
    'gifPath',
    'finalScreenshotPath',
    'exportedDeckPath',
    'runManifestPath',
  ];
  for (const key of requiredArtifacts) {
    if (!proof.artifacts[key]?.trim()) {
      findings.push(
        finding('journey_artifact_missing', `The required ${key} journey artifact is missing.`),
      );
    }
  }

  return { ok: findings.length === 0, findings };
}

function verifyLegacyProof(
  proof: LegacyNodeSlideJourneyProofV1,
  findings: NodeSlideJourneyProofFinding[],
): NodeSlideJourneyProofResult {
  if (proof.expectedCreationProvenance !== proof.actualCreationProvenance) {
    findings.push(
      finding('journey_provenance_mismatch', 'The legacy journey provenance does not match.'),
    );
  }
  if (
    !Number.isSafeInteger(proof.baseVersion) ||
    !Number.isSafeInteger(proof.acceptedVersion) ||
    proof.acceptedVersion !== proof.baseVersion + 1
  ) {
    findings.push(
      finding(
        'journey_version_delta_invalid',
        'The legacy Accept receipt is not exactly one version.',
      ),
    );
  }
  const required = [
    'brief_submitted',
    'deck_created',
    'proposal_ready',
    'compare_opened',
    'validation_received',
    'proposal_accepted',
    'version_advanced',
    'export_downloaded',
  ];
  const positions = required.map((kind) => proof.steps.findIndex((step) => step.kind === kind));
  if (positions.some((position) => position < 0)) {
    findings.push(finding('journey_step_missing', 'The legacy journey is incomplete.'));
  } else if (
    positions.some((position, index) => {
      const previousPosition = positions[index - 1];
      return index > 0 && previousPosition !== undefined && position <= previousPosition;
    })
  ) {
    findings.push(finding('journey_step_order_invalid', 'Legacy journey steps are out of order.'));
  }
  for (const kind of ['validation_received', 'proposal_accepted']) {
    const step = proof.steps.find((candidate) => candidate.kind === kind);
    if (!step?.receiptDigest) {
      findings.push(finding('journey_receipt_missing', `The legacy ${kind} receipt is missing.`));
    }
  }
  for (const key of [
    'rawRecordingPath',
    'gifPath',
    'finalScreenshotPath',
    'exportedDeckPath',
    'runManifestPath',
  ] as const) {
    if (!proof.artifacts[key]?.trim()) {
      findings.push(
        finding('journey_artifact_missing', `The required ${key} artifact is missing.`),
      );
    }
  }
  return { ok: findings.length === 0, findings };
}

function isSha256Digest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function finding(
  code: NodeSlideJourneyProofFinding['code'],
  message: string,
): NodeSlideJourneyProofFinding {
  return { code, blocker: true, message };
}
