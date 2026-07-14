import type { DeckSnapshot } from '../../../../shared/nodeslide';
import { renderDeckHtml } from './html';
import { buildPptx } from './pptx';
import type { PptxBinary } from './types';

function safeFileStem(value: string): string {
  const stem = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return stem || 'nodeslide-deck';
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadPptxBinary(binary: PptxBinary, fileName: string): void {
  const blobPart = binary instanceof ArrayBuffer ? binary : Uint8Array.from(binary).buffer;
  downloadBlob(
    new Blob([blobPart], {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    }),
    fileName,
  );
}

export async function downloadPptx(snapshot: DeckSnapshot, fileName?: string): Promise<void> {
  const binary = await buildPptx(snapshot);
  downloadPptxBinary(binary, fileName ?? `${safeFileStem(snapshot.deck.title)}.pptx`);
}

export function downloadDeckHtml(snapshot: DeckSnapshot, fileName?: string): void {
  downloadBlob(
    new Blob([renderDeckHtml(snapshot)], { type: 'text/html;charset=utf-8' }),
    fileName ?? `${safeFileStem(snapshot.deck.title)}.html`,
  );
}

export function downloadDeckJson(snapshot: DeckSnapshot, fileName?: string): void {
  downloadBlob(
    new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json;charset=utf-8' }),
    fileName ?? `${safeFileStem(snapshot.deck.title)}.json`,
  );
}
