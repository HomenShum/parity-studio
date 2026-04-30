export interface RedactionResult {
  text: string;
  count: number;
  applied: boolean;
}

const REDACTIONS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: '[redacted-email]',
  },
  {
    pattern: /\b(sk-ant-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9_-]{20,})\b/g,
    replacement: '[redacted-api-key]',
  },
  {
    pattern: /\b(AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[0-9A-Za-z-]{20,})\b/g,
    replacement: '[redacted-api-key]',
  },
  {
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi,
    replacement: 'Bearer [redacted-token]',
  },
  {
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: '[redacted-jwt]',
  },
  {
    pattern:
      /\b(api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|secret)(["']?\s*[:=]\s*["'])([^"'<>\s]{8,})/gi,
    replacement: '$1$2[redacted-secret]',
  },
];

export function redactSensitiveValues(input: string, enabled = true): RedactionResult {
  if (!enabled || input.length === 0) {
    return { text: input, count: 0, applied: false };
  }

  let text = input;
  let count = 0;
  for (const { pattern, replacement } of REDACTIONS) {
    const matches = text.match(pattern);
    if (matches) count += matches.length;
    text = text.replace(pattern, replacement);
  }

  return { text, count, applied: count > 0 };
}
