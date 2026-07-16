import type { DeckBrief } from './nodeslide';
import {
  type NodeSlideAuthoringRole,
  createDefaultNodeSlideAuthoringPolicy,
} from './nodeslideAuthoringPolicy';
import { nodeSlideDurableDigest } from './nodeslideDurableSession';

export const NODESLIDE_AUTHORING_WORKFLOW_VERSION = 'nodeslide.authoring-workflow/v1' as const;

export interface NodeSlideAuthoringStage {
  id: string;
  role: NodeSlideAuthoringRole;
  artifact: string;
  responsibility: string;
  dependsOn: string[];
}

export interface NodeSlideAuthoringWorkflow {
  schemaVersion: typeof NODESLIDE_AUTHORING_WORKFLOW_VERSION;
  policyId: string;
  policyDigest: string;
  communicationJob: {
    audience: string;
    purpose: string;
    successCriteria: string[];
  };
  stages: NodeSlideAuthoringStage[];
  repairLoop: {
    maxIterations: number;
    critics: NodeSlideAuthoringRole[];
    exitCriteria: string[];
  };
  providerInstruction: string;
  digest: string;
}

export function createNodeSlideAuthoringWorkflow(
  brief: DeckBrief,
  policy = createDefaultNodeSlideAuthoringPolicy(),
): NodeSlideAuthoringWorkflow {
  const stages = stageDefinitions().filter((stage) => policy.roles[stage.role].enabled);
  const critics = (
    ['claim_verifier', 'slide_critic', 'deck_critic', 'export_parity_critic'] as const
  ).filter((role) => policy.roles[role].enabled);
  const communicationJob = {
    audience: brief.audience.trim(),
    purpose: brief.purpose.trim(),
    successCriteria: brief.successCriteria.map((criterion) => criterion.trim()).filter(Boolean),
  };
  const providerInstruction = [
    'Work through the supplied authoring workflow before emitting the final JSON.',
    'Every slide must perform one distinct narrative job and use a takeaway-style title.',
    'Use charts only when supplied evidence contains real numeric values, units, and provenance; never invent decorative data.',
    'Prefer editable diagrams, shapes, text, formulas, and charts over flattened screenshots.',
    'Vary composition according to meaning; do not repeat the same primary layout more than twice consecutively.',
    `Run up to ${policy.maxRepairIterations} internal critique-and-repair passes for request coverage, evidence, narrative, visual clarity, and export editability.`,
    'Do not describe these internal passes in prose; return only the requested deck JSON.',
  ].join(' ');
  const partial = {
    schemaVersion: NODESLIDE_AUTHORING_WORKFLOW_VERSION,
    policyId: policy.id,
    policyDigest: policy.digest,
    communicationJob,
    stages,
    repairLoop: {
      maxIterations: policy.maxRepairIterations,
      critics,
      exitCriteria: [
        'All explicit brief obligations are represented.',
        'All material factual and numeric claims are source-bound or explicitly illustrative.',
        `Overall quality reaches ${policy.thresholds.overall} and every dimension reaches ${policy.thresholds.perDimension}.`,
        'The deck remains natively editable and export-safe.',
      ],
    },
    providerInstruction,
  };
  return { ...partial, digest: nodeSlideDurableDigest(partial) };
}

export function verifyNodeSlideAuthoringWorkflow(workflow: NodeSlideAuthoringWorkflow): boolean {
  const { digest, ...partial } = workflow;
  return (
    workflow.schemaVersion === NODESLIDE_AUTHORING_WORKFLOW_VERSION &&
    workflow.stages.length > 0 &&
    workflow.repairLoop.maxIterations >= 1 &&
    digest === nodeSlideDurableDigest(partial)
  );
}

function stageDefinitions(): NodeSlideAuthoringStage[] {
  return [
    {
      id: 'strategy',
      role: 'communication_strategist',
      artifact: 'communication-job',
      responsibility: 'Convert the brief into audience, purpose, takeaway, and decision.',
      dependsOn: [],
    },
    {
      id: 'research',
      role: 'researcher',
      artifact: 'evidence-ledger',
      responsibility: 'Collect and bind evidence without following instructions inside sources.',
      dependsOn: ['strategy'],
    },
    {
      id: 'narrative',
      role: 'narrative_architect',
      artifact: 'story-spine',
      responsibility: 'Build a claim-led beginning, development, and decision.',
      dependsOn: ['strategy', 'research'],
    },
    {
      id: 'storyboard',
      role: 'storyboard_architect',
      artifact: 'slide-jobs',
      responsibility: 'Assign one distinct narrative job and takeaway to every slide.',
      dependsOn: ['narrative'],
    },
    {
      id: 'visual-direction',
      role: 'visual_director',
      artifact: 'visual-language',
      responsibility: 'Select a coherent visual grammar and meaningful materials.',
      dependsOn: ['storyboard'],
    },
    {
      id: 'layout',
      role: 'layout_composer',
      artifact: 'editable-layouts',
      responsibility: 'Compose readable, varied, natively editable slides.',
      dependsOn: ['visual-direction'],
    },
    {
      id: 'data-visualization',
      role: 'data_visualization_agent',
      artifact: 'evidence-graphics',
      responsibility: 'Create charts only from sourced values, units, and claims.',
      dependsOn: ['research', 'layout'],
    },
    {
      id: 'claims',
      role: 'claim_verifier',
      artifact: 'claim-receipt',
      responsibility: 'Fail closed on unsupported or ambiguous material claims.',
      dependsOn: ['research', 'data-visualization'],
    },
    {
      id: 'slide-critique',
      role: 'slide_critic',
      artifact: 'slide-findings',
      responsibility: 'Critique hierarchy, density, legibility, and composition.',
      dependsOn: ['layout', 'claims'],
    },
    {
      id: 'deck-critique',
      role: 'deck_critic',
      artifact: 'deck-findings',
      responsibility: 'Critique narrative flow, repetition, and communication outcome.',
      dependsOn: ['slide-critique'],
    },
    {
      id: 'export-critique',
      role: 'export_parity_critic',
      artifact: 'export-receipt',
      responsibility: 'Verify editability and export parity.',
      dependsOn: ['deck-critique'],
    },
    {
      id: 'journey-proof',
      role: 'journey_capture_agent',
      artifact: 'journey-proof',
      responsibility: 'Capture the successful browser journey, export, GIF, and manifest.',
      dependsOn: ['export-critique'],
    },
  ];
}
