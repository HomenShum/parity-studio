import { describe, expect, it } from 'vitest';
import { canonicalNodeSlideUploadDigest, extractNodeSlidePdfText } from './nodeslidePdfExtraction';

function minimalTextPdf(text: string): Uint8Array {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(new TextEncoder().encode(body).byteLength);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = new TextEncoder().encode(body).byteLength;
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

describe('NodeSlide PDF extraction', () => {
  it('normalizes bare Convex storage SHA-256 receipts for immutable source binding', () => {
    const hex = 'a'.repeat(64);
    expect(canonicalNodeSlideUploadDigest(hex)).toBe(`sha256:${hex}`);
    expect(canonicalNodeSlideUploadDigest(`sha256:${hex}`)).toBe(`sha256:${hex}`);
    expect(() => canonicalNodeSlideUploadDigest('not-a-digest')).toThrow(/SHA-256 receipt/i);
  });

  it('extracts page-bound text from exact PDF bytes', async () => {
    const result = await extractNodeSlidePdfText(minimalTextPdf('Verified market evidence'));
    expect(result).toEqual({
      preview: '[Page 1]\nVerified market evidence',
      truncated: false,
      pageCount: 1,
    });
  });

  it('fails closed for bytes without a PDF signature', async () => {
    await expect(extractNodeSlidePdfText(new TextEncoder().encode('not a pdf'))).rejects.toThrow(
      /valid PDF signature/i,
    );
  });
});
