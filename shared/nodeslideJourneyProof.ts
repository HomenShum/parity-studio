import { nodeSlideDurableDigest } from './nodeslideDurableSession';

export const NODESLIDE_JOURNEY_PROOF_VERSION = 'nodeslide.journey-proof/v1' as const;

export const NODESLIDE_REQUIRED_JOURNEY_STEPS = [
  'brief_submitted',
  'deck_created',
  'proposal_ready',
  'compare_opened',
  'validation_received',
  'proposal_accepted',
  'version_advanced',
  'export_downloaded',
] as const;

export type NodeSlideJourneyStepKind = (typeof NODESLIDE_REQUIRED_JOURNEY_STEPS)[number];

export interface NodeSlideJourneyStep {
  kind: NodeSlideJourneyStepKind;
  occurredAt: number;
  deckVersion?: number;
  receiptDigest?: string;
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
  acceptedVersion: number;
  steps: NodeSlideJourneyStep[];
  artifacts: NodeSlideJourneyArtifacts;
  digest: string;
}

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
  proof: NodeSlideJourneyProof,
): NodeSlideJourneyProofResult {
  const findings: NodeSlideJourneyProofFinding[] = [];
  const { digest, ...partial } = proof;
  if (
    proof.schemaVersion !== NODESLIDE_JOURNEY_PROOF_VERSION ||
    digest !== nodeSlideDurableDigest(partial)
  ) {
    findings.push(finding('journey_digest_mismatch', 'The journey proof digest is invalid.'));
  }

  if (proof.expectedCreationProvenance !== proof.actualCreationProvenance) {
    findings.push(
      finding(
        'journey_provenance_mismatch',
        `Requested ${proof.expectedCreationProvenance}, but the run produced ${proof.actualCreationProvenance}.`,
      ),
    );
  }

  if (proof.acceptedVersion !== proof.baseVersion + 1) {
    findings.push(
      finding(
        'journey_version_delta_invalid',
        `Accept must advance exactly once; received v${proof.baseVersion} to v${proof.acceptedVersion}.`,
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

  for (const kind of ['validation_received', 'proposal_accepted'] as const) {
    if (!byKind.get(kind)?.receiptDigest) {
      findings.push(
        finding('journey_receipt_missing', `The ${kind} step is not bound to a receipt digest.`),
      );
    }
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

function finding(
  code: NodeSlideJourneyProofFinding['code'],
  message: string,
): NodeSlideJourneyProofFinding {
  return { code, blocker: true, message };
}
