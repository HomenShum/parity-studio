const MAX_USER_ERROR_LENGTH = 420;

export function nodeSlideUserErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data;
    if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') {
      return sanitizeNodeSlideUserError(data.message, fallback);
    }
  }
  return sanitizeNodeSlideUserError(error instanceof Error ? error.message : '', fallback);
}

export function sanitizeNodeSlideUserError(message: string | undefined, fallback: string): string {
  const raw = message?.trim();
  if (!raw) return fallback;

  const structuredMessage = raw.match(/"message"\s*:\s*"((?:\\.|[^"\\])*)"/u)?.[1];
  if (structuredMessage) {
    try {
      const decoded = JSON.parse(`"${structuredMessage}"`) as unknown;
      if (typeof decoded === 'string' && decoded.trim()) {
        const publicMessage = decoded.trim();
        return isTechnicalTransportError(publicMessage) ? fallback : bound(publicMessage, fallback);
      }
    } catch {
      // Fall through to the bounded plain-text path.
    }
  }

  const firstLine =
    raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find(
        (line) =>
          line.length > 0 &&
          !/^\[CONVEX\s+[QMA]\(/iu.test(line) &&
          !/^\[Request ID:/iu.test(line) &&
          !/^Server Error$/iu.test(line) &&
          !/^at\s+/iu.test(line),
      ) ?? '';
  const withoutWrapper = firstLine
    .replace(/^(?:Error:\s*)?(?:Uncaught\s+)?ConvexError:\s*/iu, '')
    .replace(/^(?:Error:\s*)?(?:Uncaught\s+)?Error:\s*/iu, '')
    .replace(/\s+at\s+(?:async\s+)?[\w./<(].*$/u, '')
    .trim();

  if (
    !withoutWrapper ||
    isTechnicalTransportError(withoutWrapper) ||
    /^(?:\{|\[).*"kind"\s*:/u.test(withoutWrapper)
  ) {
    return fallback;
  }
  return bound(withoutWrapper, fallback);
}

function isTechnicalTransportError(message: string): boolean {
  return (
    /\b(?:convex\s+server\s+error|internal\s+server\s+error|server\s+error)\b/iu.test(message) ||
    /^\[CONVEX\s+[QMA]\(/u.test(message) ||
    /^\[Request ID:/iu.test(message)
  );
}

function bound(message: string, fallback: string): string {
  return message.length <= MAX_USER_ERROR_LENGTH ? message : fallback;
}
