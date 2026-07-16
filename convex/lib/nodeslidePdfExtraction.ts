const PDF_PREVIEW_BYTES = 7_200;
const PDF_MAX_PAGES = 80;
const PDF_EXTRACTION_DEADLINE_MS = 8_000;

export type NodeSlidePdfExtraction = {
  preview: string;
  truncated: boolean;
  pageCount: number;
};

export function canonicalNodeSlideUploadDigest(value: string): string {
  const normalized = value.trim().toLowerCase();
  const hex = normalized.startsWith('sha256:') ? normalized.slice('sha256:'.length) : normalized;
  if (!/^[0-9a-f]{64}$/u.test(hex)) {
    throw new Error('Approved upload digest is not a valid SHA-256 receipt.');
  }
  return `sha256:${hex}`;
}

/**
 * Extracts a bounded, model-readable text preview from exact PDF bytes. The
 * caller retains and binds the digest of the original binary; this function
 * never treats client-supplied text as evidence for that binary.
 */
export async function extractNodeSlidePdfText(
  bytes: Uint8Array,
  now: () => number = Date.now,
): Promise<NodeSlidePdfExtraction> {
  if (bytes.byteLength < 8 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') {
    throw new Error('Stored PDF does not have a valid PDF signature.');
  }
  installTextExtractionDomMatrix();
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const startedAt = now();
  const task = getDocument({
    data: bytes.slice(),
    useSystemFonts: true,
    verbosity: 0,
  });
  try {
    const document = await task.promise;
    if (document.numPages < 1 || document.numPages > PDF_MAX_PAGES) {
      throw new Error(`Stored PDF must contain between 1 and ${PDF_MAX_PAGES} pages.`);
    }
    const sections: string[] = [];
    let truncated = false;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (now() - startedAt > PDF_EXTRACTION_DEADLINE_MS) {
        throw new Error('Stored PDF text extraction exceeded its bounded deadline.');
      }
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item && typeof item.str === 'string' ? item.str.trim() : ''))
        .filter(Boolean)
        .join(' ');
      if (text) sections.push(`[Page ${pageNumber}]\n${text}`);
      const candidate = sections.join('\n\n');
      if (new TextEncoder().encode(candidate).byteLength > PDF_PREVIEW_BYTES) {
        truncated = true;
        break;
      }
    }
    const joined = sections.join('\n\n').trim();
    if (!joined) throw new Error('Stored PDF contains no extractable text.');
    const preview = boundedUtf8Prefix(joined, PDF_PREVIEW_BYTES);
    return {
      preview,
      truncated: truncated || preview.length < joined.length,
      pageCount: document.numPages,
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Stored PDF')) throw error;
    throw new Error('Stored PDF could not be parsed safely.');
  } finally {
    await task.destroy();
  }
}

/**
 * PDF.js initializes display helpers even when callers only request text.
 * Convex's Node runtime intentionally has no browser DOMMatrix, so provide the
 * bounded 2D matrix surface PDF.js needs before loading it. No canvas or image
 * rendering is enabled by this text-only extractor.
 */
function installTextExtractionDomMatrix(): void {
  const runtime = globalThis as unknown as { DOMMatrix?: unknown };
  if (runtime.DOMMatrix) return;
  runtime.DOMMatrix = class TextExtractionDomMatrix {
    a = 1;
    b = 0;
    c = 0;
    d = 1;
    e = 0;
    f = 0;

    constructor(init?: readonly number[]) {
      if (init && init.length >= 6) {
        this.a = init[0] ?? 1;
        this.b = init[1] ?? 0;
        this.c = init[2] ?? 0;
        this.d = init[3] ?? 1;
        this.e = init[4] ?? 0;
        this.f = init[5] ?? 0;
      }
    }

    get is2D() {
      return true;
    }

    get isIdentity() {
      return (
        this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0
      );
    }

    multiplySelf(other: TextExtractionDomMatrix) {
      const { a, b, c, d, e, f } = this;
      this.a = a * other.a + c * other.b;
      this.b = b * other.a + d * other.b;
      this.c = a * other.c + c * other.d;
      this.d = b * other.c + d * other.d;
      this.e = a * other.e + c * other.f + e;
      this.f = b * other.e + d * other.f + f;
      return this;
    }

    preMultiplySelf(other: TextExtractionDomMatrix) {
      const result = new TextExtractionDomMatrix([
        other.a,
        other.b,
        other.c,
        other.d,
        other.e,
        other.f,
      ]).multiplySelf(this);
      Object.assign(this, result);
      return this;
    }

    translate(x = 0, y = 0) {
      return this.clone().translateSelf(x, y);
    }

    translateSelf(x = 0, y = 0) {
      return this.multiplySelf(new TextExtractionDomMatrix([1, 0, 0, 1, x, y]));
    }

    scale(scaleX = 1, scaleY = scaleX) {
      return this.clone().scaleSelf(scaleX, scaleY);
    }

    scaleSelf(scaleX = 1, scaleY = scaleX) {
      return this.multiplySelf(new TextExtractionDomMatrix([scaleX, 0, 0, scaleY, 0, 0]));
    }

    invertSelf() {
      const determinant = this.a * this.d - this.b * this.c;
      if (determinant === 0) throw new Error('PDF matrix is not invertible.');
      const { a, b, c, d, e, f } = this;
      this.a = d / determinant;
      this.b = -b / determinant;
      this.c = -c / determinant;
      this.d = a / determinant;
      this.e = (c * f - d * e) / determinant;
      this.f = (b * e - a * f) / determinant;
      return this;
    }

    inverse() {
      return this.clone().invertSelf();
    }

    clone() {
      return new TextExtractionDomMatrix([this.a, this.b, this.c, this.d, this.e, this.f]);
    }
  };
}

function boundedUtf8Prefix(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encoder.encode(value.slice(0, middle)).byteLength <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return value.slice(0, low).trimEnd();
}
