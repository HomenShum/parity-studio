import { nodeslideContentDigest } from './nodeslideIds';

export const NODESLIDE_CAPTURE_MAX_SCREENSHOT_BYTES = 4_000_000;
export const NODESLIDE_CAPTURE_TIMEOUT_MS = 15_000;
const FIRECRAWL_ENDPOINT = 'https://api.firecrawl.dev/v1/scrape';

export interface NodeSlideCapturedWebEvidence {
  ok: boolean;
  provider: 'firecrawl';
  url: string;
  title: string;
  markdown: string;
  contentDigest?: string;
  screenshot?: { bytes: Uint8Array; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' };
  error?: string;
  startedAt: number;
  completedAt: number;
}

interface FirecrawlResponse {
  success?: boolean;
  data?: {
    markdown?: string;
    screenshot?: string;
    metadata?: { title?: string; sourceURL?: string };
  };
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
  const url = safePublicCaptureUrl(args.url);
  const apiKey = args.apiKey.trim();
  if (!apiKey) {
    return failedCapture(
      url,
      'Visual capture is not configured on this deployment.',
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
        `Visual capture provider returned HTTP ${response.status}.`,
        startedAt,
        now(),
      );
    }
    const payload = (await response.json()) as FirecrawlResponse;
    if (!payload.success || !payload.data) {
      return failedCapture(url, 'Visual capture provider returned no evidence.', startedAt, now());
    }
    const markdown = cleanCaptureText(payload.data.markdown ?? '', 120_000);
    const title = cleanCaptureText(payload.data.metadata?.title ?? new URL(url).hostname, 180);
    let screenshot: NodeSlideCapturedWebEvidence['screenshot'];
    if (payload.data.screenshot) {
      const screenshotUrl = safeHttpsUrl(payload.data.screenshot);
      const screenshotResponse = await fetchImpl(screenshotUrl, { signal: controller.signal });
      if (screenshotResponse.ok) {
        const declaredLength = Number(screenshotResponse.headers.get('content-length') ?? 0);
        if (declaredLength > NODESLIDE_CAPTURE_MAX_SCREENSHOT_BYTES) {
          return failedCapture(
            url,
            'Visual capture exceeded the screenshot size limit.',
            startedAt,
            now(),
          );
        }
        const bytes = new Uint8Array(await screenshotResponse.arrayBuffer());
        if (bytes.byteLength > NODESLIDE_CAPTURE_MAX_SCREENSHOT_BYTES) {
          return failedCapture(
            url,
            'Visual capture exceeded the screenshot size limit.',
            startedAt,
            now(),
          );
        }
        if (bytes.byteLength > 0) {
          screenshot = {
            bytes,
            mimeType: captureMimeType(screenshotResponse.headers.get('content-type')),
          };
        }
      }
    }
    const completedAt = now();
    return {
      ok: true,
      provider: 'firecrawl',
      url,
      title,
      markdown,
      contentDigest: nodeslideContentDigest(markdown || `${url}\n${title}`),
      ...(screenshot ? { screenshot } : {}),
      startedAt,
      completedAt,
    };
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'Visual capture timed out.'
        : 'Visual capture failed safely.';
    return failedCapture(url, message, startedAt, now());
  } finally {
    clearTimeout(timeout);
  }
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
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:') throw new Error('Visual attachment URL must use HTTPS.');
  return parsed.toString();
}

function cleanCaptureText(value: string, max: number): string {
  return value.split('\0').join('').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

function captureMimeType(value: string | null): 'image/png' | 'image/jpeg' | 'image/webp' {
  const normalized = value?.split(';')[0]?.trim().toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/webp') return normalized;
  return 'image/png';
}

function failedCapture(
  url: string,
  error: string,
  startedAt: number,
  completedAt: number,
): NodeSlideCapturedWebEvidence {
  return {
    ok: false,
    provider: 'firecrawl',
    url,
    title: new URL(url).hostname,
    markdown: '',
    error,
    startedAt,
    completedAt,
  };
}
