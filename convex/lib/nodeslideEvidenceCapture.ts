import { nodeslideContentDigest } from './nodeslideIds';

export const NODESLIDE_CAPTURE_MAX_SCREENSHOT_BYTES = 4_000_000;
export const NODESLIDE_CAPTURE_MAX_PROVIDER_BYTES = 512_000;
export const NODESLIDE_CAPTURE_TIMEOUT_MS = 15_000;
const FIRECRAWL_ENDPOINT = 'https://api.firecrawl.dev/v1/scrape';

export type NodeSlideEvidenceCaptureIssueCode =
  | 'configuration_missing'
  | 'source_url_invalid'
  | 'source_url_blocked'
  | 'provider_http_error'
  | 'provider_response_too_large'
  | 'provider_response_invalid'
  | 'provider_evidence_missing'
  | 'screenshot_url_invalid'
  | 'screenshot_http_error'
  | 'screenshot_too_large'
  | 'screenshot_empty'
  | 'timeout'
  | 'network_error';

export interface NodeSlideEvidenceCaptureIssue {
  code: NodeSlideEvidenceCaptureIssueCode;
  stage: 'configuration' | 'source' | 'provider' | 'screenshot' | 'network';
  message: string;
}

export interface NodeSlideCapturedWebEvidence {
  ok: boolean;
  status: 'captured' | 'degraded' | 'failed';
  provider: 'firecrawl';
  url: string;
  title: string;
  markdown: string;
  contentDigest?: string;
  screenshot?: {
    bytes: Uint8Array;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    /** Exact encoded-image dimensions, present only when verified from the attachment bytes. */
    viewport?: { width: number; height: number };
  };
  error?: string;
  issue?: NodeSlideEvidenceCaptureIssue;
  startedAt: number;
  completedAt: number;
}

export interface NodeSlideWebEvidenceTarget {
  sourceId: string;
  url: string;
}

export interface NodeSlideMappedWebEvidenceCapture {
  sourceId: string;
  sourceIndex: number;
  requestedUrl: string;
  capture: NodeSlideCapturedWebEvidence;
}

export interface NodeSlideSourceSnapshotPdf {
  bytes: Uint8Array;
  contentDigest: string;
  box: { x: number; y: number; w: number; h: number; page: 1 };
  viewport: { width: 612; height: 792 };
}

/**
 * Produces an owner-only PDF from the exact search-provider record already retained by NodeSlide.
 * It is deliberately labeled as a source snapshot, never as a screenshot of the source webpage.
 */
export function createNodeSlideSourceSnapshotPdf(args: {
  title: string;
  url: string;
  excerpt: string;
  provider: string;
  retrievedAt: number;
}): NodeSlideSourceSnapshotPdf {
  const url = safePublicCaptureUrl(args.url);
  const title = cleanPdfText(args.title, 180) || new URL(url).hostname;
  const excerpt = cleanPdfText(args.excerpt, 2_400) || 'No excerpt was returned.';
  const provider = cleanPdfText(args.provider, 80) || 'search provider';
  const retrievedAt = new Date(args.retrievedAt).toISOString();
  const excerptLines = wrapPdfText(excerpt, 82).slice(0, 24);
  const lines = [
    'NodeSlide evidence snapshot',
    `Title: ${title}`,
    ...wrapPdfText(`URL: ${url}`, 82).slice(0, 4),
    `Retrieved: ${retrievedAt}`,
    `Search provider: ${provider}`,
    '',
    'Bound source excerpt:',
    ...excerptLines,
  ];
  const excerptLabelIndex = lines.indexOf('Bound source excerpt:');
  const excerptRegionTop = pdfTextBaseline(excerptLabelIndex) + 14;
  const excerptRegionBottom = pdfTextBaseline(lines.length - 1) - 6;
  const excerptRegionHeight = excerptRegionTop - excerptRegionBottom;
  const content = [
    'q',
    '0.96 g',
    `48 ${excerptRegionBottom} 516 ${excerptRegionHeight} re f`,
    '0.72 G',
    `48 ${excerptRegionBottom} 516 ${excerptRegionHeight} re S`,
    'Q',
    'BT',
    '/F1 11 Tf',
    '54 738 Td',
    ...lines.flatMap((line, index) => [
      ...(index === 0 ? ['/F1 16 Tf'] : index === 1 ? ['/F1 11 Tf'] : []),
      `(${escapePdfString(line)}) Tj`,
      `0 -${index === 0 ? 28 : 18} Td`,
    ]),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n%NodeSlide\n';
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  const bytes = new TextEncoder().encode(pdf);
  return {
    bytes,
    contentDigest: nodeslideContentDigest(bytes),
    box: {
      x: 48 / 612,
      y: (792 - excerptRegionTop) / 792,
      w: 516 / 612,
      h: excerptRegionHeight / 792,
      page: 1,
    },
    viewport: { width: 612, height: 792 },
  };
}

function pdfTextBaseline(index: number): number {
  return index === 0 ? 738 : 738 - 28 - (index - 1) * 18;
}

interface FirecrawlResponse {
  success?: boolean;
  data?: {
    markdown?: string;
    screenshot?: string;
    metadata?: { title?: string; sourceURL?: string };
  };
}

class NodeSlideCaptureIssueError extends Error {
  constructor(readonly issue: NodeSlideEvidenceCaptureIssue) {
    super(issue.message);
    this.name = 'NodeSlideCaptureIssueError';
  }
}

/**
 * Captures targets without ever dropping or reindexing a source. Invalid URLs resolve to a typed
 * failure at their original index, so downstream custody records can bind by sourceId deterministically.
 */
export async function captureNodeSlideWebEvidenceBatch(args: {
  targets: readonly NodeSlideWebEvidenceTarget[];
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}): Promise<NodeSlideMappedWebEvidenceCapture[]> {
  return Promise.all(
    args.targets.map(async (target, sourceIndex) => ({
      sourceId: target.sourceId,
      sourceIndex,
      requestedUrl: redactCaptureUrl(target.url),
      capture: await captureNodeSlideWebEvidence({
        url: target.url,
        apiKey: args.apiKey,
        ...(args.fetchImpl ? { fetchImpl: args.fetchImpl } : {}),
        ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
        ...(args.now ? { now: args.now } : {}),
      }),
    })),
  );
}

export async function captureNodeSlideWebEvidence(args: {
  url: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}): Promise<NodeSlideCapturedWebEvidence> {
  const now = args.now ?? Date.now;
  const startedAt = now();
  const fetchImpl = args.fetchImpl ?? fetch;
  let url: string;
  try {
    url = safePublicCaptureUrl(args.url);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Visual evidence source is invalid.';
    const code: NodeSlideEvidenceCaptureIssueCode = message.includes('private network')
      ? 'source_url_blocked'
      : 'source_url_invalid';
    return failedCapture(
      redactCaptureUrl(args.url),
      issue(code, 'source', message),
      startedAt,
      now(),
    );
  }
  const apiKey = args.apiKey.trim();
  if (!apiKey) {
    return failedCapture(
      url,
      issue(
        'configuration_missing',
        'configuration',
        'Visual capture is not configured on this deployment.',
      ),
      startedAt,
      now(),
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1_000, Math.min(30_000, args.timeoutMs ?? NODESLIDE_CAPTURE_TIMEOUT_MS)),
  );
  try {
    const response = await fetchImpl(FIRECRAWL_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ['markdown', 'screenshot'],
        onlyMainContent: true,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return failedCapture(
        url,
        issue(
          'provider_http_error',
          'provider',
          `Visual capture provider returned HTTP ${response.status}.`,
        ),
        startedAt,
        now(),
      );
    }
    const payload = await readBoundedJsonResponse(response, NODESLIDE_CAPTURE_MAX_PROVIDER_BYTES);
    if (!payload.success || !payload.data) {
      return failedCapture(
        url,
        issue(
          'provider_evidence_missing',
          'provider',
          'Visual capture provider returned no evidence.',
        ),
        startedAt,
        now(),
      );
    }
    const markdown = cleanCaptureText(payload.data.markdown ?? '', 120_000);
    const title = cleanCaptureText(payload.data.metadata?.title ?? new URL(url).hostname, 180);
    let screenshot: NodeSlideCapturedWebEvidence['screenshot'];
    let degradation: NodeSlideEvidenceCaptureIssue | undefined;
    if (payload.data.screenshot) {
      let screenshotUrl: string;
      try {
        screenshotUrl = safeHttpsUrl(payload.data.screenshot);
      } catch {
        throw new NodeSlideCaptureIssueError(
          issue(
            'screenshot_url_invalid',
            'screenshot',
            'Visual attachment URL was invalid or did not use HTTPS.',
          ),
        );
      }
      const screenshotResponse = await fetchImpl(screenshotUrl, { signal: controller.signal });
      if (!screenshotResponse.ok) {
        degradation = issue(
          'screenshot_http_error',
          'screenshot',
          `Visual attachment provider returned HTTP ${screenshotResponse.status}.`,
        );
      } else {
        const bytes = await readBoundedResponseBytes(
          screenshotResponse,
          NODESLIDE_CAPTURE_MAX_SCREENSHOT_BYTES,
          issue(
            'screenshot_too_large',
            'screenshot',
            'Visual capture exceeded the screenshot size limit.',
          ),
        );
        if (bytes.byteLength === 0) {
          degradation = issue(
            'screenshot_empty',
            'screenshot',
            'Visual attachment provider returned an empty screenshot.',
          );
        } else {
          const viewport = readRasterImageDimensions(bytes);
          screenshot = {
            bytes,
            mimeType: captureMimeType(screenshotResponse.headers.get('content-type')),
            ...(viewport ? { viewport } : {}),
          };
        }
      }
    } else {
      degradation = issue(
        'provider_evidence_missing',
        'screenshot',
        'Visual capture provider returned text without a screenshot.',
      );
    }
    const completedAt = now();
    return {
      ok: true,
      status: degradation ? 'degraded' : 'captured',
      provider: 'firecrawl',
      url,
      title,
      markdown,
      contentDigest: nodeslideContentDigest(
        screenshot?.bytes ?? new TextEncoder().encode(markdown || `${url}\n${title}`),
      ),
      ...(screenshot ? { screenshot } : {}),
      ...(degradation ? { issue: degradation } : {}),
      startedAt,
      completedAt,
    };
  } catch (error) {
    if (error instanceof NodeSlideCaptureIssueError) {
      return failedCapture(url, error.issue, startedAt, now());
    }
    const captureIssue =
      error instanceof Error && error.name === 'AbortError'
        ? issue('timeout', 'network', 'Visual capture timed out.')
        : issue('network_error', 'network', 'Visual capture failed safely.');
    return failedCapture(url, captureIssue, startedAt, now());
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedJsonResponse(
  response: Response,
  maxBytes: number,
): Promise<FirecrawlResponse> {
  const bytes = await readBoundedResponseBytes(
    response,
    maxBytes,
    issue(
      'provider_response_too_large',
      'provider',
      'Visual capture provider response exceeded the size limit.',
    ),
  );
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isFirecrawlResponse(parsed)) throw new Error('Unexpected response shape.');
    return parsed;
  } catch {
    throw new NodeSlideCaptureIssueError(
      issue(
        'provider_response_invalid',
        'provider',
        'Visual capture provider returned invalid JSON.',
      ),
    );
  }
}

async function readBoundedResponseBytes(
  response: Response,
  maxBytes: number,
  tooLargeIssue: NodeSlideEvidenceCaptureIssue,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    try {
      await response.body?.cancel();
    } catch {
      // The typed size failure is authoritative even if the transport cannot be cancelled.
    }
    throw new NodeSlideCaptureIssueError(tooLargeIssue);
  }

  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The typed size failure is authoritative even if cancellation itself fails.
        }
        throw new NodeSlideCaptureIssueError(tooLargeIssue);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function isFirecrawlResponse(value: unknown): value is FirecrawlResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const data = Reflect.get(value, 'data');
  return data === undefined || (typeof data === 'object' && data !== null && !Array.isArray(data));
}

export function safePublicCaptureUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Visual evidence capture requires an HTTP or HTTPS source.');
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '::1' ||
    (host.includes(':') &&
      (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd'))) ||
    /^::ffff:(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error('Visual evidence capture cannot access private network addresses.');
  }
  parsed.hash = '';
  return parsed.toString();
}

function safeHttpsUrl(value: string): string {
  const parsed = new URL(safePublicCaptureUrl(value));
  if (parsed.protocol !== 'https:') throw new Error('Visual attachment URL must use HTTPS.');
  return parsed.toString();
}

function redactCaptureUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.username = '';
    parsed.password = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return 'invalid-source-url';
  }
}

function cleanCaptureText(value: string, max: number): string {
  return value.split('\0').join('').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

function cleanPdfText(value: string, max: number): string {
  return value
    .normalize('NFKD')
    .replace(/[^\x20-\x7E\n]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function wrapPdfText(value: string, width: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (word.length > width) {
      if (line) lines.push(line);
      for (let offset = 0; offset < word.length; offset += width) {
        lines.push(word.slice(offset, offset + width));
      }
      line = '';
    } else if (!line) {
      line = word;
    } else if (line.length + word.length + 1 <= width) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function escapePdfString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function captureMimeType(value: string | null): 'image/png' | 'image/jpeg' | 'image/webp' {
  const normalized = value?.split(';')[0]?.trim().toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/webp') return normalized;
  return 'image/png';
}

/** Reads encoded raster dimensions without decoding or trusting provider metadata. */
export function readRasterImageDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | undefined {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[12] === 0x49 &&
    bytes[13] === 0x48 &&
    bytes[14] === 0x44 &&
    bytes[15] === 0x52
  ) {
    return validRasterDimensions(readUint32Be(bytes, 16), readUint32Be(bytes, 20));
  }
  if (bytes.length >= 10 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset++];
      if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (offset + 1 >= bytes.length) break;
      const segmentLength = readUint16Be(bytes, offset);
      if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
      if (JPEG_START_OF_FRAME_MARKERS.has(marker) && segmentLength >= 7) {
        return validRasterDimensions(
          readUint16Be(bytes, offset + 5),
          readUint16Be(bytes, offset + 3),
        );
      }
      offset += segmentLength;
    }
  }
  if (bytes.length >= 30 && asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WEBP')) {
    if (asciiAt(bytes, 12, 'VP8X')) {
      return validRasterDimensions(readUint24Le(bytes, 24) + 1, readUint24Le(bytes, 27) + 1);
    }
    if (asciiAt(bytes, 12, 'VP8L') && bytes[20] === 0x2f) {
      const b21 = bytes[21] ?? 0;
      const b22 = bytes[22] ?? 0;
      const b23 = bytes[23] ?? 0;
      const b24 = bytes[24] ?? 0;
      return validRasterDimensions(
        1 + b21 + ((b22 & 0x3f) << 8),
        1 + (b22 >> 6) + (b23 << 2) + ((b24 & 0x0f) << 10),
      );
    }
    if (
      asciiAt(bytes, 12, 'VP8 ') &&
      bytes[23] === 0x9d &&
      bytes[24] === 0x01 &&
      bytes[25] === 0x2a
    ) {
      return validRasterDimensions(
        (((bytes[27] ?? 0) << 8) | (bytes[26] ?? 0)) & 0x3fff,
        (((bytes[29] ?? 0) << 8) | (bytes[28] ?? 0)) & 0x3fff,
      );
    }
  }
  return undefined;
}

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function validRasterDimensions(width: number, height: number) {
  return Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= 100_000 &&
    height <= 100_000
    ? { width, height }
    : undefined;
}

function readUint16Be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readUint24Le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) * 0x1000000 +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)
  );
}

function asciiAt(bytes: Uint8Array, offset: number, value: string): boolean {
  return [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

function failedCapture(
  url: string,
  captureIssue: NodeSlideEvidenceCaptureIssue,
  startedAt: number,
  completedAt: number,
): NodeSlideCapturedWebEvidence {
  return {
    ok: false,
    status: 'failed',
    provider: 'firecrawl',
    url,
    title: captureHostname(url),
    markdown: '',
    error: captureIssue.message,
    issue: captureIssue,
    startedAt,
    completedAt,
  };
}

function issue(
  code: NodeSlideEvidenceCaptureIssueCode,
  stage: NodeSlideEvidenceCaptureIssue['stage'],
  message: string,
): NodeSlideEvidenceCaptureIssue {
  return { code, stage, message };
}

function captureHostname(url: string): string {
  try {
    return new URL(url).hostname || 'invalid source';
  } catch {
    return 'invalid source';
  }
}
