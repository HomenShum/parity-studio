/**
 * Pure-fn static lint for kit files. Powers the chat agent's `done`
 * self-check tool — agent calls this before declaring an edit complete,
 * gets a structured verdict, and can self-heal if errors are surfaced.
 *
 * Patterns adopted from OCD's `done` tool (packages/core/src/tools/done.ts):
 * - Structural balance (every opening tag has a closing match)
 * - Duplicate `id` attributes
 * - `<img>` missing `alt`
 * - `<button>` missing accessible name
 * - `<a>` without href
 * - JSX brace balance
 * - Console / debugger leftovers
 *
 * No LLM call. Pure regex over file content. Runs in V8.
 */

export type LintSeverity = 'error' | 'warn';

export interface LintFinding {
  rule: string;
  severity: LintSeverity;
  path: string;
  line: number;
  message: string;
}

export interface LintReport {
  status: 'ok' | 'has_errors' | 'has_warnings';
  errorCount: number;
  warnCount: number;
  filesChecked: number;
  findings: LintFinding[];
  summary: string;
}

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

interface RuleCtx {
  path: string;
  content: string;
  findings: LintFinding[];
}

function lineOf(content: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx && i < content.length; i += 1) {
    if (content[i] === '\n') line += 1;
  }
  return line;
}

function isJsxOrTsx(path: string): boolean {
  return /\.(tsx|jsx)$/i.test(path);
}

function isHtml(path: string): boolean {
  return /\.html?$/i.test(path);
}

function isCss(path: string): boolean {
  return /\.css$/i.test(path);
}

function isJson(path: string): boolean {
  return /\.json$/i.test(path);
}

function isSvg(path: string): boolean {
  return /\.svg$/i.test(path);
}

// ── Rules ──────────────────────────────────────────────────────────────

function ruleStructuralBalance({ path, content, findings }: RuleCtx) {
  if (!isHtml(path) && !isJsxOrTsx(path) && !isSvg(path)) return;
  // Stack-based check: every opening tag has a matching closing tag.
  // We tolerate self-closed tags and void tags. Strip strings + comments
  // to avoid false positives inside attributes.
  const stripped = content
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  const stack: Array<{ tag: string; idx: number }> = [];
  const tagRe = /<\/?([A-Za-z][A-Za-z0-9.-]*)([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(stripped)) !== null) {
    const full = m[0];
    const tag = (m[1] ?? '').toLowerCase();
    const isClose = full.startsWith('</');
    const selfClose = full.endsWith('/>');
    if (selfClose || VOID_TAGS.has(tag)) continue;
    if (isClose) {
      const top = stack.pop();
      if (!top) {
        findings.push({
          rule: 'structural-balance',
          severity: 'error',
          path,
          line: lineOf(content, m.index),
          message: `closing </${tag}> with no matching opener`,
        });
      } else if (top.tag !== tag) {
        findings.push({
          rule: 'structural-balance',
          severity: 'error',
          path,
          line: lineOf(content, m.index),
          message: `closing </${tag}> does not match opener <${top.tag}> (line ${lineOf(content, top.idx)})`,
        });
      }
    } else {
      stack.push({ tag, idx: m.index });
    }
  }
  for (const remaining of stack) {
    findings.push({
      rule: 'structural-balance',
      severity: 'error',
      path,
      line: lineOf(content, remaining.idx),
      message: `unclosed <${remaining.tag}>`,
    });
  }
}

function ruleDuplicateIds({ path, content, findings }: RuleCtx) {
  if (!isHtml(path) && !isJsxOrTsx(path) && !isSvg(path)) return;
  const seen = new Map<string, number>();
  const re = /\bid\s*=\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const id = m[1] ?? '';
    if (seen.has(id)) {
      findings.push({
        rule: 'duplicate-id',
        severity: 'error',
        path,
        line: lineOf(content, m.index),
        message: `duplicate id="${id}" (first declared line ${lineOf(content, seen.get(id) as number)})`,
      });
    } else {
      seen.set(id, m.index);
    }
  }
}

function ruleImgAlt({ path, content, findings }: RuleCtx) {
  if (!isHtml(path) && !isJsxOrTsx(path)) return;
  const re = /<img\b([^>]*?)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const attrs = m[1] ?? '';
    if (!/\balt\s*=/.test(attrs)) {
      findings.push({
        rule: 'img-missing-alt',
        severity: 'warn',
        path,
        line: lineOf(content, m.index),
        message: '<img> missing alt attribute (a11y)',
      });
    }
  }
}

function ruleButtonAccessibleName({ path, content, findings }: RuleCtx) {
  if (!isHtml(path) && !isJsxOrTsx(path)) return;
  // Match <button …>…</button> blocks; flag those with empty/whitespace
  // content AND no aria-label/aria-labelledby/title.
  const re = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const attrs = m[1] ?? '';
    const inner = (m[2] ?? '').replace(/<[^>]+>/g, '').trim();
    const hasAriaName = /\b(aria-label|aria-labelledby|title)\s*=/.test(attrs);
    if (inner.length === 0 && !hasAriaName) {
      findings.push({
        rule: 'button-no-name',
        severity: 'warn',
        path,
        line: lineOf(content, m.index),
        message: '<button> has no text content and no aria-label/aria-labelledby/title',
      });
    }
  }
}

function ruleAnchorHref({ path, content, findings }: RuleCtx) {
  if (!isHtml(path) && !isJsxOrTsx(path)) return;
  const re = /<a\b([^>]*?)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const attrs = m[1] ?? '';
    if (!/\bhref\s*=/.test(attrs) && !/\bto\s*=/.test(attrs)) {
      findings.push({
        rule: 'a-no-href',
        severity: 'warn',
        path,
        line: lineOf(content, m.index),
        message: '<a> without href (or `to` for routers)',
      });
    }
  }
}

function ruleBraceBalance({ path, content, findings }: RuleCtx) {
  if (!isJsxOrTsx(path) && !isJson(path)) return;
  // Strip strings + comments + template literals so braces inside don't count.
  const stripped = content
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/(['"])(?:\\.|(?!\1)[^\n\\])*?\1/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, ' ');
  let open = 0;
  let openIdx = -1;
  for (let i = 0; i < stripped.length; i += 1) {
    const c = stripped[i];
    if (c === '{') {
      if (openIdx < 0) openIdx = i;
      open += 1;
    } else if (c === '}') {
      open -= 1;
      if (open < 0) {
        findings.push({
          rule: 'brace-balance',
          severity: 'error',
          path,
          line: lineOf(content, i),
          message: 'unmatched `}`',
        });
        open = 0;
        openIdx = -1;
      }
    }
  }
  if (open > 0) {
    findings.push({
      rule: 'brace-balance',
      severity: 'error',
      path,
      line: lineOf(content, openIdx),
      message: `${open} unclosed \`{\``,
    });
  }
}

function ruleConsoleLeftover({ path, content, findings }: RuleCtx) {
  if (!isJsxOrTsx(path)) return;
  const re = /(console\.(log|debug|warn|error|info)|debugger)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    findings.push({
      rule: 'leftover-debug',
      severity: 'warn',
      path,
      line: lineOf(content, m.index),
      message: `${m[0]} left in shipped code`,
    });
  }
}

function ruleJsonValid({ path, content, findings }: RuleCtx) {
  if (!isJson(path)) return;
  if (content.trim().length === 0) return;
  try {
    JSON.parse(content);
  } catch (err) {
    findings.push({
      rule: 'json-parse',
      severity: 'error',
      path,
      line: 1,
      message: `JSON.parse failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

function ruleSuspiciouslyEmpty({ path, content, findings }: RuleCtx) {
  if (isCss(path) || isJson(path)) return; // CSS/JSON can be legitimately tiny
  if (content.trim().length < 16) {
    findings.push({
      rule: 'suspiciously-empty',
      severity: 'warn',
      path,
      line: 1,
      message: `file is suspiciously short (${content.trim().length} chars)`,
    });
  }
}

const ALL_RULES = [
  ruleStructuralBalance,
  ruleDuplicateIds,
  ruleImgAlt,
  ruleButtonAccessibleName,
  ruleAnchorHref,
  ruleBraceBalance,
  ruleConsoleLeftover,
  ruleJsonValid,
  ruleSuspiciouslyEmpty,
];

/**
 * Lint a subset of the kit's files (or all of them when paths is empty).
 * Returns a structured report the chat agent can act on.
 */
export function lintKit(
  files: Record<string, string>,
  paths?: readonly string[],
): LintReport {
  const findings: LintFinding[] = [];
  const targets =
    paths && paths.length > 0
      ? paths.filter((p) => p in files).map((p) => [p, files[p] ?? ''] as const)
      : Object.entries(files);

  for (const [path, content] of targets) {
    const ctx: RuleCtx = { path, content, findings };
    for (const rule of ALL_RULES) {
      try {
        rule(ctx);
      } catch {
        // never let a rule crash the whole lint
      }
    }
  }

  if (!paths || paths.length === 0) {
    for (const required of [
      'parity.contract.json',
      'performance.budget.json',
      'api-wiring.plan.md',
      'qa.plan.md',
    ]) {
      const found = Object.keys(files).some((path) => path.endsWith(`/${required}`) || path === required);
      if (!found) {
        findings.push({
          rule: 'operating-contract-missing',
          severity: 'warn',
          path: required,
          line: 1,
          message: `missing ${required}; every kit should carry operating contract/API/QA/performance guidance`,
        });
      }
    }
  }

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warnCount = findings.filter((f) => f.severity === 'warn').length;
  const status: LintReport['status'] =
    errorCount > 0 ? 'has_errors' : warnCount > 0 ? 'has_warnings' : 'ok';
  const summary =
    status === 'ok'
      ? `${targets.length} file${targets.length === 1 ? '' : 's'} clean — no issues found`
      : `${errorCount} error${errorCount === 1 ? '' : 's'}, ${warnCount} warning${warnCount === 1 ? '' : 's'} across ${targets.length} file${targets.length === 1 ? '' : 's'}`;

  return { status, errorCount, warnCount, filesChecked: targets.length, findings, summary };
}
