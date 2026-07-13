export type NodeSlideDataAttachmentFormat = 'csv' | 'json' | 'txt';

export const NODESLIDE_DATA_ATTACHMENT_MAX_BYTES = 24_000;

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
