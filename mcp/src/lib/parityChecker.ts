/**
 * Pure deterministic parity checker, no LLM, no MCP deps.
 * Lifted verbatim from convex/lib/parityChecker.ts (which itself was ported
 * from PR OpenCoworkAI/open-codesign#241).
 *
 * Includes the CodeQL js/bad-tag-filter (HIGH) fix: close-tag patterns use
 * `\b[^>]*>` to match HTML5-tolerated end-tag forms like `</script >` and
 * `</script foo="bar">`. Without this, crafted source HTML could leak script
 * bodies into the visible-text coverage check.
 */

export interface ParityGap {
  kind: 'element' | 'text' | 'token' | 'missing-file' | 'manifest';
  severity?: 'low' | 'medium' | 'high';
  message: string;
}

export interface ParityReport {
  passCount: number;
  totalChecks: number;
  parityScore: number;
  status: 'verified' | 'needs_review' | 'needs_iteration' | 'failed' | 'unavailable';
  summary: string;
  gaps: ParityGap[];
  signals: {
    elementCountScore: number;
    visibleTextCoverage: number;
    tokenCoverage: number;
  };
}

export interface DeterministicCheckInputs {
  sourceHtml: string;
  decomposedHtml: string | null;
  tokensCss: string | null;
  uiKitFiles: Record<string, string>;
}

const ELEMENT_TAGS = [
  'header', 'nav', 'main', 'section', 'article', 'aside', 'footer',
  'h1', 'h2', 'h3', 'table', 'form', 'ul', 'ol', 'button', 'input', 'select', 'textarea',
];

function countTags(html: string, tag: string): number {
  const re = new RegExp(`<${tag}\\b`, 'gi');
  return (html.match(re) ?? []).length;
}

function elementParity(source: string, decomposed: string): { score: number; gaps: ParityGap[] } {
  const gaps: ParityGap[] = [];
  let totalDelta = 0;
  let totalSource = 0;
  for (const tag of ELEMENT_TAGS) {
    const s = countTags(source, tag);
    const d = countTags(decomposed, tag);
    const delta = Math.abs(s - d);
    totalDelta += delta;
    totalSource += s;
    if (s > 0 && delta / Math.max(s, 1) > 0.5) {
      gaps.push({
        kind: 'element',
        severity: 'medium',
        message: `${s} <${tag}> in source, ${d} in decomposed (delta ${delta})`,
      });
    }
  }
  if (totalSource === 0) return { score: 1, gaps };
  return { score: Math.max(0, 1 - totalDelta / totalSource), gaps };
}

function stripTags(html: string): string {
  // Close-tag patterns mirror the opening pattern's `\b[^>]*` so we strip
  // the full `<script>...</script foo="bar" >` form. CodeQL js/bad-tag-filter
  // fix: literal `</script>` would leave bodies behind for `</script >` etc.
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function visibleWords(html: string): Set<string> {
  const text = stripTags(html).toLowerCase();
  const words = text.match(/[a-z][a-z0-9]{2,}/g) ?? [];
  return new Set(words);
}

function textCoverage(
  sourceWords: Set<string>,
  decomposedWords: Set<string>,
): { score: number; missing: string[] } {
  if (sourceWords.size === 0) return { score: 1, missing: [] };
  let matched = 0;
  const missing: string[] = [];
  for (const w of sourceWords) {
    if (decomposedWords.has(w)) matched += 1;
    else missing.push(w);
  }
  return { score: matched / sourceWords.size, missing: missing.slice(0, 10) };
}

function extractTokenValues(text: string): Set<string> {
  const matches = text.match(/#[0-9a-f]{3,8}|\d+(?:\.\d+)?(?:px|rem|em|%)/gi) ?? [];
  return new Set(matches.map((m) => m.toLowerCase()));
}

function tokenCoverage(
  sourceHtml: string,
  tokensCss: string | null,
  decomposedHtml: string,
): { score: number; gaps: ParityGap[] } {
  if (tokensCss === null || tokensCss.trim().length === 0) {
    return {
      score: 0.5,
      gaps: [{ kind: 'token', severity: 'low', message: 'tokens.css missing or empty' }],
    };
  }
  const sourceTokens = extractTokenValues(sourceHtml);
  const definedTokens = extractTokenValues(tokensCss);
  const decomposedDirectValues = extractTokenValues(decomposedHtml);
  const fabricated: string[] = [];
  for (const v of decomposedDirectValues) {
    if (!sourceTokens.has(v) && !definedTokens.has(v)) fabricated.push(v);
  }
  const totalReferenced = decomposedDirectValues.size;
  const fabRate = totalReferenced === 0 ? 0 : fabricated.length / totalReferenced;
  const gaps: ParityGap[] = [];
  if (fabricated.length > 0) {
    gaps.push({
      kind: 'token',
      severity: fabRate > 0.3 ? 'high' : 'medium',
      message: `${fabricated.length} hardcoded value(s) in decomposed not in source or tokens.css: ${fabricated.slice(0, 5).join(', ')}${fabricated.length > 5 ? '...' : ''}`,
    });
  }
  return { score: Math.max(0, 1 - fabRate), gaps };
}

export function statusFromBooleans(passCount: number, totalChecks: number): ParityReport['status'] {
  if (totalChecks === 0) return 'unavailable';
  const pct = passCount / totalChecks;
  if (pct >= 1.0) return 'verified';
  if (pct >= 0.85) return 'needs_review';
  if (pct >= 0.6) return 'needs_iteration';
  return 'failed';
}

export function checkDeterministic(input: DeterministicCheckInputs): ParityReport {
  const gaps: ParityGap[] = [];

  if (input.decomposedHtml === null) {
    return {
      passCount: 0,
      totalChecks: 16,
      parityScore: 0,
      status: 'failed',
      summary: 'decomposed index.html missing',
      gaps: [{ kind: 'missing-file', severity: 'high', message: 'index.html not produced' }],
      signals: { elementCountScore: 0, visibleTextCoverage: 0, tokenCoverage: 0 },
    };
  }

  const elem = elementParity(input.sourceHtml, input.decomposedHtml);
  gaps.push(...elem.gaps);

  const sourceWords = visibleWords(input.sourceHtml);
  const decomposedWords = visibleWords(input.decomposedHtml);
  const text = textCoverage(sourceWords, decomposedWords);
  if (text.missing.length > 0) {
    gaps.push({
      kind: 'text',
      severity: text.score < 0.7 ? 'high' : 'medium',
      message: `missing visible words: ${text.missing.slice(0, 5).join(', ')}${text.missing.length > 5 ? `... (+${text.missing.length - 5})` : ''}`,
    });
  }

  const token = tokenCoverage(input.sourceHtml, input.tokensCss, input.decomposedHtml);
  gaps.push(...token.gaps);

  function bucket(score: number): number {
    if (score >= 0.95) return 4;
    if (score >= 0.85) return 3;
    if (score >= 0.7) return 2;
    if (score >= 0.5) return 1;
    return 0;
  }

  const elemPass = bucket(elem.score);
  const textPass = bucket(text.score);
  const tokenPass = bucket(token.score);

  const expectedFiles = ['index.html', 'tokens.css', 'manifest.json', 'README.md'];
  let filesPass = 0;
  for (const f of expectedFiles) {
    const found = Object.keys(input.uiKitFiles).some((k) => k.endsWith(`/${f}`) || k === f);
    if (found) filesPass += 1;
    else gaps.push({ kind: 'missing-file', severity: 'medium', message: `expected file missing: ${f}` });
  }

  for (const f of ['parity.contract.json', 'performance.budget.json', 'api-wiring.plan.md', 'qa.plan.md']) {
    const found = Object.keys(input.uiKitFiles).some((k) => k.endsWith(`/${f}`) || k === f);
    if (!found) {
      gaps.push({
        kind: f.endsWith('.json') ? 'manifest' : 'missing-file',
        severity: 'medium',
        message: `expected operating contract file missing: ${f}`,
      });
    }
  }

  const passCount = elemPass + textPass + tokenPass + filesPass;
  const totalChecks = 16;
  const status = statusFromBooleans(passCount, totalChecks);
  const parityScore = passCount / totalChecks;
  const summary = status === 'verified' ? 'Parity OK' : `${status} (${passCount}/${totalChecks})`;

  return {
    passCount,
    totalChecks,
    parityScore,
    status,
    summary,
    gaps,
    signals: {
      elementCountScore: elem.score,
      visibleTextCoverage: text.score,
      tokenCoverage: token.score,
    },
  };
}
