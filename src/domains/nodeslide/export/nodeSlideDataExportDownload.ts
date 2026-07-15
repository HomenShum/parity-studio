import {
  NODESLIDE_OWNER_DATA_EXPORT_MEDIA_TYPE,
  type NodeSlideOwnerDataExport,
} from '../../../../shared/nodeslideDataExport';

export interface NodeSlideDataExportDownloadPayload {
  fileName: string;
  mediaType: `${typeof NODESLIDE_OWNER_DATA_EXPORT_MEDIA_TYPE};charset=utf-8`;
  text: string;
}

export function createNodeSlideDataExportDownloadPayload(
  bundle: NodeSlideOwnerDataExport,
  deckTitle: string,
): NodeSlideDataExportDownloadPayload {
  return {
    fileName: `${safeFileStem(deckTitle)}-nodeslide-data-${exportDate(bundle.manifest.generatedAt)}.json`,
    mediaType: `${NODESLIDE_OWNER_DATA_EXPORT_MEDIA_TYPE};charset=utf-8`,
    text: `${JSON.stringify(bundle, null, 2)}\n`,
  };
}

/** Saves the already owner-authorized bundle locally without uploading a copy. */
export function downloadNodeSlideDataExport(
  bundle: NodeSlideOwnerDataExport,
  deckTitle: string,
): NodeSlideDataExportDownloadPayload {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('Data export downloads are available only in a browser.');
  }
  const payload = createNodeSlideDataExportDownloadPayload(bundle, deckTitle);
  const href = URL.createObjectURL(new Blob([payload.text], { type: payload.mediaType }));
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = payload.fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
  }
  return payload;
}

function safeFileStem(title: string): string {
  const stem = title
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return stem || 'nodeslide-deck';
}

function exportDate(generatedAt: number): string {
  const date = new Date(generatedAt);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : 'export';
}
