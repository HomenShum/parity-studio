import { z } from 'zod';

export const operationModeSchema = z.enum(['copy', 'style', 'layout', 'unrestricted']);
export type OperationMode = z.infer<typeof operationModeSchema>;

export const inspectDeckInputSchema = z.object({
  deckId: z.string().min(1),
  slideId: z.string().min(1).optional(),
});
export type InspectDeckInput = z.infer<typeof inspectDeckInputSchema>;

export const proposeEditInputSchema = z.object({
  deckId: z.string().min(1),
  instruction: z.string().min(1).max(4000),
  scope: z.enum(['deck', 'slide', 'elements']).default('slide'),
  slideId: z.string().min(1).optional(),
  elementIds: z.array(z.string().min(1)).max(64).optional(),
  operationMode: operationModeSchema.default('unrestricted'),
  execution: z.enum(['hosted', 'deterministic']).default('deterministic'),
  model: z.string().min(1).optional(),
  consent: z.boolean().default(false),
  idempotencyKey: z.string().max(160).optional(),
});
export type ProposeEditInput = z.infer<typeof proposeEditInputSchema>;

export const reviewProposalInputSchema = z.object({
  deckId: z.string().min(1),
  patchId: z.string().min(1),
  expectedCandidateDigest: z.string().min(1),
  expectedBaseDeckVersion: z.number().int().nonnegative(),
  reviewSummary: z.string().min(1).max(500),
});
export type ReviewProposalInput = z.infer<typeof reviewProposalInputSchema>;

export type NodeSlideScope =
  | { kind: 'deck'; deckId: string; operationMode: OperationMode }
  | { kind: 'slide'; deckId: string; slideIds: string[]; operationMode: OperationMode }
  | {
      kind: 'elements';
      deckId: string;
      slideIds: string[];
      elementIds: string[];
      operationMode: OperationMode;
    };

export interface NodeSlideWorkspace {
  deck: { id: string; title: string; version: number; slideOrder: string[] };
  slides: Array<{ id: string; title: string; section?: string; version: number }>;
  elements: Array<{
    id: string;
    slideId: string;
    name: string;
    kind: string;
    role?: string;
    content?: string;
    bbox: unknown;
    style: unknown;
    sourceIds: string[];
    locked: boolean;
    version: number;
  }>;
  sources: Array<{ id: string; title: string; sourceType: string; url?: string }>;
  patches: Array<
    Record<string, unknown> & {
      id: string;
      status: string;
      baseDeckVersion?: number;
      candidateDigest?: string;
      candidateValidation?: unknown;
    }
  >;
  traces: Array<Record<string, unknown> & { id: string; createdAt: number; patchId?: string }>;
  versions: Array<Record<string, unknown> & { id: string; version: number; createdAt: number }>;
  validations: Array<Record<string, unknown>>;
}

export interface DeckInspection {
  deck: NodeSlideWorkspace['deck'];
  slides: Array<
    NodeSlideWorkspace['slides'][number] & {
      index: number;
      elements: NodeSlideWorkspace['elements'];
    }
  >;
  sources: NodeSlideWorkspace['sources'];
  pendingProposalCount: number;
  validation: Record<string, unknown> | null;
  receipt: {
    operation: 'inspect_deck';
    deckId: string;
    deckVersion: number;
    readOnly: true;
    recordedAt: string;
  };
}

export interface ProposalReceipt {
  proposal: NodeSlideWorkspace['patches'][number];
  candidateReceipt: unknown;
  applied: false;
  deckVersionBefore: number;
  deckVersionAfter: number;
}

export interface ReviewReceipt {
  decision: 'accepted' | 'rejected';
  patch: NodeSlideWorkspace['patches'][number];
  deckId: string;
  deckVersionBefore: number;
  deckVersionAfter: number;
  candidateDigest: string;
  reviewSummary: string;
}
