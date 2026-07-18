'use node';

import { v } from 'convex/values';
import {
  DEFAULT_PPTX_IMPORT_BOUNDS,
  importPptxSnapshot,
} from '../src/domains/nodeslide/slidelang/pptxImport';
import { internal } from './_generated/api';
import { action } from './_generated/server';
import { isOwnerAccessKey } from './lib/nodeslideAccess';
import { nodeslideContentDigest, nodeslideStableId } from './lib/nodeslideIds';
import { runNodeSlideLiveRenderRepair } from './lib/nodeslideLiveRenderRepair';

const MAX_PPTX_CREATE_BYTES = Math.min(8 * 1024 * 1024, DEFAULT_PPTX_IMPORT_BOUNDS.maxInputBytes);
const MAX_FIDELITY_NOTES = 12;

// Generated Convex references form a deliberate action -> mutation boundary.
// biome-ignore lint/suspicious/noExplicitAny: generated Convex self-reference boundary
const nodeslideInternal: any = (internal as any).nodeslide;

/**
 * D8 create=edit parity: a PPTX can seed a NEW deck, not only edit an existing
 * one. The archive is parsed server-side inside the importer's hostile-input
 * bounds; the imported snapshot then rides the exact same persistence,
 * validation, versioning, and trace path as a brief-created deck. Failures
 * return coded, fidelity-annotated results — never a silent fallback deck.
 */
export const importPptxAsNewDeck = action({
  args: {
    clientSessionId: v.string(),
    ownerAccessKey: v.string(),
    idempotencyKey: v.string(),
    fileName: v.string(),
    bytes: v.bytes(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; deckId: string; slideCount: number; fidelityNotes: string[] }
    | { ok: false; code: string; message: string; fidelityNotes: string[] }
  > => {
    if (!isOwnerAccessKey(args.ownerAccessKey)) {
      return invalid('invalid_owner_key', 'Invalid NodeSlide owner access key.');
    }
    const fileName = args.fileName.trim().slice(0, 180);
    const idempotencyKey = args.idempotencyKey.trim();
    if (!fileName.toLowerCase().endsWith('.pptx')) {
      return invalid('unsupported_format', 'Start-from-PowerPoint needs a .pptx file.');
    }
    if (!idempotencyKey || idempotencyKey.length > 160 || args.clientSessionId.length > 256) {
      return invalid('invalid_request', 'The import request identifiers are out of bounds.');
    }
    if (args.bytes.byteLength === 0 || args.bytes.byteLength > MAX_PPTX_CREATE_BYTES) {
      return invalid(
        'archive_too_large',
        `PPTX imports accept up to ${Math.floor(MAX_PPTX_CREATE_BYTES / (1024 * 1024))} MB.`,
      );
    }

    const contentDigest = nodeslideContentDigest(
      `${args.clientSessionId}:${idempotencyKey}:${args.bytes.byteLength}`,
    );
    const deckId = nodeslideStableId('deck_pptx_import', contentDigest);
    const projectId = nodeslideStableId('project_pptx_import', contentDigest);

    const imported = await importPptxSnapshot(args.bytes, {
      deckId,
      projectId,
      fileName,
      timestamp: Date.now(),
    });
    const fidelityNotes = fidelitySummaries(imported.fidelity);
    if (!imported.ok) {
      return {
        ok: false,
        code: imported.error.code,
        message: imported.error.message.slice(0, 300),
        fidelityNotes,
      };
    }

    // D1 x D8: the render-repair loop runs over the imported deck before it is
    // persisted, fixing the automatic classes (geometry clamps, text fit,
    // contrast). Whatever remains persists as visible findings — the import is
    // never refused for repairable layout, and never silently "cleaned".
    let candidate = imported.snapshot;
    const repairNotes: string[] = [];
    try {
      const repair = runNodeSlideLiveRenderRepair(imported.snapshot);
      candidate = repair.result.candidate;
      repairNotes.push(
        `Render repair: ${repair.summary.status} (${repair.summary.terminalReason}) after ${repair.summary.attempts} attempt${repair.summary.attempts === 1 ? '' : 's'}`,
        ...repair.summary.receipts.map(
          (receipt) => `Repair attempt ${receipt.attempt}: ${receipt.status}`,
        ),
      );
    } catch {
      repairNotes.push('Render repair: pass did not complete; importing as-is.');
    }

    await ctx.runMutation(nodeslideInternal.createImportedDeckInternal, {
      clientSessionId: args.clientSessionId,
      ownerAccessKey: args.ownerAccessKey,
      snapshot: candidate,
      fileName,
      fidelityNotes: [...fidelityNotes, ...repairNotes].slice(0, MAX_FIDELITY_NOTES * 2),
    });
    return {
      ok: true,
      deckId,
      slideCount: candidate.slides.length,
      fidelityNotes,
    };
  },
});

function invalid(
  code: string,
  message: string,
): { ok: false; code: string; message: string; fidelityNotes: string[] } {
  return { ok: false, code, message, fidelityNotes: [] };
}

function fidelitySummaries(
  report: { items?: readonly { feature?: string; reason?: string }[] } | undefined,
) {
  return (report?.items ?? [])
    .flatMap((item) =>
      item.reason ? [`${item.feature ?? 'import'}: ${item.reason}`.slice(0, 160)] : [],
    )
    .slice(0, MAX_FIDELITY_NOTES);
}
