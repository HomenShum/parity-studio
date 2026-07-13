export type NodeSlideDataAttachmentFormat = 'csv' | 'json' | 'txt';

export interface NodeSlideDataAttachment {
  title: string;
  format: NodeSlideDataAttachmentFormat;
  content: string;
}

export const NODESLIDE_DATA_ATTACHMENT_MAX_BYTES = 24_000;
export const NODESLIDE_CREATE_ATTACHMENT_MAX_FILES = 3;
export const NODESLIDE_CREATE_ATTACHMENT_MAX_TOTAL_BYTES = 60_000;

export function normalizeNodeSlideDataAttachment(
  value: string,
  format: NodeSlideDataAttachmentFormat,
  maxBytes = NODESLIDE_DATA_ATTACHMENT_MAX_BYTES,
): string {
  const normalized = value
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!normalized) throw new Error('Uploaded data file is empty.');
  if (normalized.includes('\u0000')) throw new Error('Uploaded data contains invalid NUL bytes.');
  if (normalized.length > maxBytes || new TextEncoder().encode(normalized).byteLength > maxBytes) {
    throw new Error(`Uploaded data exceeds ${maxBytes.toLocaleString()} bytes.`);
  }
  if (format === 'json') {
    try {
      JSON.parse(normalized);
    } catch {
      throw new Error('Uploaded JSON is malformed.');
    }
  }
  return normalized;
}

export function nodeSlideDataAttachmentShape(
  content: string,
  format: NodeSlideDataAttachmentFormat,
): { rowCount?: number; columns?: string[] } {
  if (format === 'csv') {
    const rows = content.split(/\r?\n/).filter((row) => row.trim().length > 0);
    const columns = (rows[0] ?? '')
      .split(',')
      .map((column) => column.replace(/^\s*["']|["']\s*$/g, '').trim())
      .filter(Boolean)
      .slice(0, 64);
    return { rowCount: Math.max(0, rows.length - 1), ...(columns.length ? { columns } : {}) };
  }
  if (format === 'json') {
    try {
      const parsed = JSON.parse(content) as unknown;
      const records = Array.isArray(parsed) ? parsed : [parsed];
      const columns = Array.from(
        new Set(
          records
            .slice(0, 100)
            .flatMap((record) =>
              record && typeof record === 'object' && !Array.isArray(record)
                ? Object.keys(record as Record<string, unknown>)
                : [],
            ),
        ),
      ).slice(0, 64);
      return { rowCount: records.length, ...(columns.length ? { columns } : {}) };
    } catch {
      return {};
    }
  }
  return { rowCount: content.split(/\r?\n/).filter((line) => line.trim().length > 0).length };
}
