/**
 * Pure deterministic parity checker, no LLM, no Convex deps.
 *
 * Pattern: pure-fn verifier that takes (sourceHtml, decomposedFiles)
 * and returns a ParityReport with passCount/totalChecks derived score.
 *
 * Prior art: ported from `feat/decompose-to-ui-kit` branch on
 * github.com/HomenShum/open-codesign (PR OpenCoworkAI/open-codesign#241),
 * specifically `packages/core/src/tools/verify-ui-kit-parity.ts`.
 *
 * Includes CodeQL js/bad-tag-filter fix (HIGH severity flagged on PR #241):
 * close-tag patterns use `\b[^>]*>` to match HTML5-tolerated end-tag
 * forms like `</script >` (trailing whitespace) and `</script foo="bar">`
 * (end-tag attrs, silently ignored by browsers per spec). Without this,
 * crafted source HTML could leak script bodies into the visible-text
 * coverage check.
 */

export interface ParityGap {
  kind: 'element' | 'text' | 'token' | 'missing-file' | 'manifest';
  severity?: 'low' | 'medium' | 'high';
  message: string;
}

export interface ParityReport {
  passCount: number;
  totalChecks: number;
  parityScore: number; // passCount / totalChecks
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
  /** Files in the ui_kit/<slug>/ tree, used for missing-file checks. */
  uiKitFiles: Record<string, string>;
}

const ELEMENT_TAGS = ['header', 'nav', 'main', 'section', 'article', 'aside', 'footer',
  'h1', 'h2', 'h3', 'table', 'form', 'ul', 'ol', 'button', 'input', 'select', 'textarea'];

function countTags(html: string, tag: string): number {
  // Open-tag count, ignores self-closing for simplicity. Word-boundary stops `<sectionx>`
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
  const score = Math.max(0, 1 - totalDelta / totalSource);
  return { score, gaps };
}

function stripTags(html: string): string {
  // Close-tag patterns mirror the opening pattern's `\b[^>]*` so we strip
  // the full `<script>...</script foo="bar" >` form. HTML5 parsers tolerate
  // attributes and trailing whitespace inside end tags (silently ignored).
  // CodeQL `js/bad-tag-filter` flags the literal `</script>` form because
  // it leaves bodies behind for `</script >` etc. The `\b` after the tag
  // name prevents over-matching like `</scripts>`.
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
): { score: number; matched: number; missing: string[] } {
  if (sourceWords.size === 0) return { score: 1, matched: 0, missing: [] };
  let matched = 0;
  const missing: string[] = [];
  for (const w of sourceWords) {
    if (decomposedWords.has(w)) {
      matched += 1;
    } else {
      missing.push(w);
    }
  }
  return { score: matched / sourceWords.size, matched, missing: missing.slice(0, 10) };
}

function extractTokenValues(text: string): Set<string> {
  // Hex colors, rem values, px values, percentages
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
  // For each value used in the decomposed HTML directly (not via var()), it
  // should also exist in the source — otherwise the decomposer fabricated it.
  const decomposedDirectValues = extractTokenValues(decomposedHtml);
  const fabricated: string[] = [];
  for (const v of decomposedDirectValues) {
    if (!sourceTokens.has(v) && !definedTokens.has(v)) {
      fabricated.push(v);
    }
  }
  const totalReferenced = decomposedDirectValues.size;
  const fabRate = totalReferenced === 0 ? 0 : fabricated.length / totalReferenced;
  const gaps: ParityGap[] = [];
  if (fabricated.length > 0) {
    gaps.push({
      kind: 'token',
      severity: fabRate > 0.3 ? 'high' : 'medium',
      message: `${fabricated.length} hardcoded value(s) in decomposed not present in source or tokens.css: ${fabricated
        .slice(0, 5)
        .join(', ')}${fabricated.length > 5 ? '...' : ''}`,
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

/**
 * Run the deterministic checks. Each signal contributes 4 boolean checks
 * (16 total), with passCount derived from threshold buckets:
 *   element parity  >= 0.95 -> 4 pass, >= 0.85 -> 3, >= 0.7 -> 2, >= 0.5 -> 1, else 0
 *   text coverage   >= 0.95 -> 4 pass, >= 0.85 -> 3, >= 0.7 -> 2, >= 0.5 -> 1, else 0
 *   token fidelity  >= 0.95 -> 4 pass, >= 0.85 -> 3, >= 0.7 -> 2, >= 0.5 -> 1, else 0
 *   file presence   each of 4 expected files present = 1 pass
 *
 * `parityScore = passCount / totalChecks` is a pure derivation, no LLM.
 */
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
      message: `missing visible words from source: ${text.missing.slice(0, 5).join(', ')}${
        text.missing.length > 5 ? `... (+${text.missing.length - 5})` : ''
      }`,
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

  const passCount = elemPass + textPass + tokenPass + filesPass;
  const totalChecks = 16;
  const status = statusFromBooleans(passCount, totalChecks);
  const parityScore = passCount / totalChecks;

  const summary =
    status === 'verified'
      ? 'Parity OK'
      : `${status} (${passCount}/${totalChecks})`;

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
