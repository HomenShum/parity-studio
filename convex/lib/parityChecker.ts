/**
 * Pure deterministic parity checker, no LLM, no Convex deps.
 *
 * Sprint 3 (2026-04-28): rewritten from 3 score-buckets + file presence
 * into 16 individually-named, individually-evaluable checks per the
 * reference at docs/plans/2026-04-28-shell-revamp-from-reference.md §6.
 *
 * Each check returns its own honest verdict (`pass | warn | fail |
 * unavailable`) plus 1–2 evidence lines explaining what passed or failed.
 * Checks that the deterministic layer genuinely cannot evaluate
 * (visual regression, color delta) honestly mark `unavailable` rather
 * than collapsing into a fake pass — per `agentic_reliability` HONEST_SCORES.
 *
 * Back-compat shape: passCount / totalChecks / parityScore / status / gaps
 * still emitted, derived from `checks`. Old consumers keep working.
 *
 * Pattern: pure-fn verifier that takes (sourceHtml, decomposedFiles, tokensCss)
 * and returns a ParityReport.
 *
 * Includes CodeQL js/bad-tag-filter fix (HIGH severity flagged on PR #241):
 * close-tag patterns use `\b[^>]*>` to match HTML5-tolerated end-tag
 * forms like `</script >` (trailing whitespace) and `</script foo="bar">`.
 */

export type ParityVerdict = 'pass' | 'warn' | 'fail' | 'unavailable';

export interface ParityCheck {
  /** Stable id, used for stable client keys + analytics. */
  id: string;
  /** Display label, ≤ 32 chars. Matches the reference rubric. */
  label: string;
  /** Honest verdict — never round up. */
  status: ParityVerdict;
  /**
   * 1–2 short evidence lines. Each line is plain text (no markdown). The
   * UI renders them as a vertical stack under the row when expanded.
   * Empty array means "no evidence to surface" (typical for `pass`).
   */
  evidence: string[];
}

export interface ParityGap {
  kind:
    | 'element'
    | 'text'
    | 'token'
    | 'missing-file'
    | 'manifest'
    | 'structure'
    | 'spacing'
    | 'typography'
    | 'color'
    | 'radius'
    | 'shadow'
    | 'icon'
    | 'breakpoint'
    | 'interaction'
    | 'a11y'
    | 'semantic';
  severity?: 'low' | 'medium' | 'high';
  message: string;
}

export interface ParityReport {
  /** New typed checks (16 entries). */
  checks: ParityCheck[];
  /** Legacy aggregate. passCount = checks.filter(c => c.status === 'pass').length */
  passCount: number;
  /** Legacy aggregate. Always 16 in the new shape. */
  totalChecks: number;
  /** passCount / totalChecks. */
  parityScore: number;
  /** Run-level rollup, NOT per-check. Drives runs.status outcome. */
  status: 'verified' | 'needs_review' | 'needs_iteration' | 'failed' | 'unavailable';
  summary: string;
  /** Legacy gaps view, derived from failed/warn checks. */
  gaps: ParityGap[];
  /** Legacy 3-axis signals (kept for back-compat with charts). */
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

function countTags(html: string, tag: string): number {
  const re = new RegExp(`<${tag}\\b`, 'gi');
  return (html.match(re) ?? []).length;
}

function stripTags(html: string): string {
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

function extractCssValues(text: string, re: RegExp): string[] {
  return Array.from(text.match(re) ?? []).map((m) => m.toLowerCase());
}

function uniqueColors(text: string): Set<string> {
  return new Set(
    extractCssValues(text, /#[0-9a-f]{3,8}\b|oklch\([^)]*\)|rgb[a]?\([^)]*\)|hsl[a]?\([^)]*\)/gi),
  );
}

function uniquePxRem(text: string): Set<string> {
  return new Set(extractCssValues(text, /\d+(?:\.\d+)?(?:px|rem)\b/gi));
}

function pct(matched: number, total: number): number {
  if (total === 0) return 1;
  return matched / total;
}

function bucketPctToVerdict(p: number): ParityVerdict {
  if (p >= 0.95) return 'pass';
  if (p >= 0.85) return 'warn';
  return 'fail';
}

// ──────────────────────────────────────────────────────────────────────────
// Individual checks. Each returns ParityCheck.
// ──────────────────────────────────────────────────────────────────────────

function checkStructureParity(source: string, decomposed: string): ParityCheck {
  // Sectioning element delta — header/nav/main/footer/aside.
  const tags = ['header', 'nav', 'main', 'footer', 'aside'];
  let totalSrc = 0;
  let totalDelta = 0;
  const lines: string[] = [];
  for (const tag of tags) {
    const s = countTags(source, tag);
    const d = countTags(decomposed, tag);
    totalSrc += s;
    totalDelta += Math.abs(s - d);
    if (s > 0 && Math.abs(s - d) >= 1) {
      lines.push(`${s} <${tag}> in source, ${d} in decomposed`);
    }
  }
  if (totalSrc === 0) {
    return {
      id: 'structure',
      label: 'Structure parity',
      status: 'pass',
      evidence: [],
    };
  }
  const ratio = 1 - totalDelta / Math.max(1, totalSrc);
  const status = bucketPctToVerdict(ratio);
  return {
    id: 'structure',
    label: 'Structure parity',
    status,
    evidence: status === 'pass' ? [] : lines.slice(0, 2),
  };
}

function checkComponentCount(source: string, decomposed: string): ParityCheck {
  const s =
    countTags(source, 'section') + countTags(source, 'article') + countTags(source, 'div');
  const d =
    countTags(decomposed, 'section') + countTags(decomposed, 'article') + countTags(decomposed, 'div');
  if (s === 0) return { id: 'componentCount', label: 'Component count', status: 'pass', evidence: [] };
  const ratio = 1 - Math.min(1, Math.abs(s - d) / s);
  const status = bucketPctToVerdict(ratio);
  return {
    id: 'componentCount',
    label: 'Component count',
    status,
    evidence:
      status === 'pass'
        ? []
        : [`${s} block-level elements in source, ${d} in decomposed`],
  };
}

function checkLayoutGrid(decomposed: string, tokensCss: string | null): ParityCheck {
  const allCss = `${decomposed} ${tokensCss ?? ''}`;
  const gridDecls = (allCss.match(/grid-template-(columns|rows)\s*:/gi) ?? []).length;
  const flexDecls = (allCss.match(/display\s*:\s*flex/gi) ?? []).length;
  if (gridDecls + flexDecls === 0) {
    return {
      id: 'layoutGrid',
      label: 'Layout grid',
      status: 'warn',
      evidence: ['No grid-template or flex declarations found'],
    };
  }
  return { id: 'layoutGrid', label: 'Layout grid', status: 'pass', evidence: [] };
}

function checkSpacingSystem(decomposed: string, tokensCss: string | null): ParityCheck {
  const allCss = `${decomposed} ${tokensCss ?? ''}`;
  const values = uniquePxRem(allCss);
  // Heuristic: more than 18 distinct px/rem values implies an unrationalized
  // spacing scale. Healthy systems cluster on ~8–12 sizes.
  if (values.size === 0) {
    return {
      id: 'spacing',
      label: 'Spacing system',
      status: 'warn',
      evidence: ['No px/rem spacing values detected'],
    };
  }
  if (values.size > 24) {
    return {
      id: 'spacing',
      label: 'Spacing system',
      status: 'fail',
      evidence: [
        `${values.size} distinct px/rem values (target ≤ 24)`,
        'Healthy systems cluster on 8–12 sizes — too many ad-hoc values',
      ],
    };
  }
  if (values.size > 18) {
    return {
      id: 'spacing',
      label: 'Spacing system',
      status: 'warn',
      evidence: [`${values.size} distinct px/rem values (warn at >18)`],
    };
  }
  return { id: 'spacing', label: 'Spacing system', status: 'pass', evidence: [] };
}

function checkTypographyScale(decomposed: string, tokensCss: string | null): ParityCheck {
  const allCss = `${decomposed} ${tokensCss ?? ''}`;
  const sizes = new Set(
    extractCssValues(allCss, /font-size\s*:\s*[^;]+|--font-size[^:]*:\s*[^;]+/gi),
  );
  if (sizes.size === 0) {
    return {
      id: 'typography',
      label: 'Typography scale',
      status: 'warn',
      evidence: ['No font-size declarations'],
    };
  }
  if (sizes.size > 12) {
    return {
      id: 'typography',
      label: 'Typography scale',
      status: 'warn',
      evidence: [`${sizes.size} distinct font-size declarations (target ≤ 12)`],
    };
  }
  return { id: 'typography', label: 'Typography scale', status: 'pass', evidence: [] };
}

function checkFontFidelity(source: string, decomposed: string, tokensCss: string | null): ParityCheck {
  const re = /font-family\s*:\s*([^;}]+)/gi;
  const srcFonts = new Set(
    Array.from(source.matchAll(re)).map((m) => (m[1] ?? '').toLowerCase().trim()),
  );
  const decFonts = new Set(
    Array.from(`${decomposed} ${tokensCss ?? ''}`.matchAll(re)).map((m) =>
      (m[1] ?? '').toLowerCase().trim(),
    ),
  );
  if (srcFonts.size === 0 && decFonts.size === 0) {
    return {
      id: 'fontFidelity',
      label: 'Font fidelity',
      status: 'unavailable',
      evidence: ['No font-family declarations to compare'],
    };
  }
  if (srcFonts.size === 0) {
    return { id: 'fontFidelity', label: 'Font fidelity', status: 'pass', evidence: [] };
  }
  let matched = 0;
  for (const f of srcFonts) {
    for (const g of decFonts) {
      if (g.includes(f.split(',')[0]?.trim() ?? '')) {
        matched += 1;
        break;
      }
    }
  }
  const p = pct(matched, srcFonts.size);
  return {
    id: 'fontFidelity',
    label: 'Font fidelity',
    status: bucketPctToVerdict(p),
    evidence:
      p >= 0.95
        ? []
        : [`${matched}/${srcFonts.size} source font-family values present in decomposed`],
  };
}

function checkColorTokens(source: string, decomposed: string, tokensCss: string | null): ParityCheck {
  const srcColors = uniqueColors(source);
  const tokenColors = uniqueColors(tokensCss ?? '');
  const decColors = uniqueColors(decomposed);
  if (tokensCss === null || tokensCss.trim().length === 0) {
    return {
      id: 'colorTokens',
      label: 'Color tokens',
      status: 'warn',
      evidence: ['tokens.css missing — cannot verify token coverage'],
    };
  }
  if (srcColors.size === 0) {
    return { id: 'colorTokens', label: 'Color tokens', status: 'pass', evidence: [] };
  }
  // Fabricated = colors used in decomposed that are not in source AND not declared in tokens
  const fabricated: string[] = [];
  for (const c of decColors) {
    if (!srcColors.has(c) && !tokenColors.has(c)) fabricated.push(c);
  }
  const fabRate = decColors.size === 0 ? 0 : fabricated.length / decColors.size;
  if (fabRate <= 0.05) {
    return { id: 'colorTokens', label: 'Color tokens', status: 'pass', evidence: [] };
  }
  if (fabRate <= 0.2) {
    return {
      id: 'colorTokens',
      label: 'Color tokens',
      status: 'warn',
      evidence: [`${fabricated.length} hardcoded color(s) outside source and tokens.css`],
    };
  }
  return {
    id: 'colorTokens',
    label: 'Color tokens',
    status: 'fail',
    evidence: [
      `${fabricated.length} fabricated color(s): ${fabricated.slice(0, 4).join(', ')}${fabricated.length > 4 ? '…' : ''}`,
    ],
  };
}

function checkColorDelta(): ParityCheck {
  // Honest unavailable: requires a headless render of source + decomposed
  // and a per-pixel ΔE comparison. The deterministic layer cannot do this.
  return {
    id: 'colorDelta',
    label: 'Color delta',
    status: 'unavailable',
    evidence: ['Requires headless render — wired by visual verifier when ready'],
  };
}

function checkBorderRadius(decomposed: string, tokensCss: string | null): ParityCheck {
  const allCss = `${decomposed} ${tokensCss ?? ''}`;
  const radii = new Set(extractCssValues(allCss, /border-radius\s*:\s*[^;}]+/gi));
  if (radii.size === 0) {
    return { id: 'borderRadius', label: 'Border radius', status: 'pass', evidence: [] };
  }
  if (radii.size > 6) {
    return {
      id: 'borderRadius',
      label: 'Border radius',
      status: 'warn',
      evidence: [`${radii.size} distinct border-radius values (target ≤ 6)`],
    };
  }
  return { id: 'borderRadius', label: 'Border radius', status: 'pass', evidence: [] };
}

function checkShadows(decomposed: string, tokensCss: string | null): ParityCheck {
  const allCss = `${decomposed} ${tokensCss ?? ''}`;
  const shadows = new Set(extractCssValues(allCss, /box-shadow\s*:\s*[^;}]+/gi));
  if (shadows.size === 0) {
    return {
      id: 'shadows',
      label: 'Shadows & elevation',
      status: 'warn',
      evidence: ['No box-shadow declarations — depth system absent or flat by design'],
    };
  }
  return { id: 'shadows', label: 'Shadows & elevation', status: 'pass', evidence: [] };
}

function checkIconography(source: string, decomposed: string): ParityCheck {
  const s = countTags(source, 'svg');
  const d = countTags(decomposed, 'svg');
  if (s === 0) return { id: 'iconography', label: 'Iconography', status: 'pass', evidence: [] };
  const ratio = 1 - Math.min(1, Math.abs(s - d) / s);
  const v = bucketPctToVerdict(ratio);
  return {
    id: 'iconography',
    label: 'Iconography',
    status: v,
    evidence: v === 'pass' ? [] : [`${s} <svg> in source, ${d} in decomposed`],
  };
}

function checkResponsiveBreakpoints(decomposed: string, tokensCss: string | null): ParityCheck {
  const allCss = `${decomposed} ${tokensCss ?? ''}`;
  const mq = (allCss.match(/@media[^{]+/gi) ?? []).length;
  if (mq === 0) {
    return {
      id: 'breakpoints',
      label: 'Responsive breakpoints',
      status: 'warn',
      evidence: ['No @media rules — single-viewport layout'],
    };
  }
  return { id: 'breakpoints', label: 'Responsive breakpoints', status: 'pass', evidence: [] };
}

function checkInteractionStates(decomposed: string, tokensCss: string | null): ParityCheck {
  const allCss = `${decomposed} ${tokensCss ?? ''}`;
  const hover = (allCss.match(/:hover\b/gi) ?? []).length;
  const focus = (allCss.match(/:focus(?:-visible)?\b/gi) ?? []).length;
  const active = (allCss.match(/:active\b/gi) ?? []).length;
  if (hover + focus + active === 0) {
    return {
      id: 'interaction',
      label: 'Interaction states',
      status: 'fail',
      evidence: ['No :hover / :focus / :active selectors found'],
    };
  }
  if (focus === 0) {
    return {
      id: 'interaction',
      label: 'Interaction states',
      status: 'warn',
      evidence: ['No :focus selectors — keyboard a11y at risk'],
    };
  }
  return { id: 'interaction', label: 'Interaction states', status: 'pass', evidence: [] };
}

function checkAccessibility(decomposed: string): ParityCheck {
  const aria = (decomposed.match(/aria-[a-z]+\s*=/gi) ?? []).length;
  const alts = (decomposed.match(/<img\b[^>]*\salt\s*=/gi) ?? []).length;
  const imgs = countTags(decomposed, 'img');
  const labels = (decomposed.match(/<label\b/gi) ?? []).length;
  const inputs = countTags(decomposed, 'input');
  const issues: string[] = [];
  if (imgs > 0 && alts < imgs) issues.push(`${imgs - alts}/${imgs} <img> missing alt`);
  if (inputs > 0 && labels === 0)
    issues.push(`${inputs} <input> with no <label>`);
  if (aria + alts + labels === 0)
    return {
      id: 'a11y',
      label: 'Accessibility',
      status: 'fail',
      evidence: ['No aria-*, alt=, or <label> attributes detected'],
    };
  if (issues.length > 0) {
    return { id: 'a11y', label: 'Accessibility', status: 'warn', evidence: issues };
  }
  return { id: 'a11y', label: 'Accessibility', status: 'pass', evidence: [] };
}

function checkSemanticHtml(decomposed: string): ParityCheck {
  const semantic =
    countTags(decomposed, 'header') +
    countTags(decomposed, 'nav') +
    countTags(decomposed, 'main') +
    countTags(decomposed, 'section') +
    countTags(decomposed, 'article') +
    countTags(decomposed, 'aside') +
    countTags(decomposed, 'footer');
  const divs = countTags(decomposed, 'div');
  if (semantic === 0 && divs > 5) {
    return {
      id: 'semantic',
      label: 'Semantic HTML',
      status: 'fail',
      evidence: [`${divs} <div> elements with no semantic landmarks`],
    };
  }
  if (semantic < 3 && divs > 20) {
    return {
      id: 'semantic',
      label: 'Semantic HTML',
      status: 'warn',
      evidence: [`Only ${semantic} semantic landmarks across ${divs} divs`],
    };
  }
  return { id: 'semantic', label: 'Semantic HTML', status: 'pass', evidence: [] };
}

function checkVisualRegression(): ParityCheck {
  return {
    id: 'visualRegression',
    label: 'Visual regression',
    status: 'unavailable',
    evidence: ['Requires headless render baseline — wired by visual verifier'],
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Aggregator
// ──────────────────────────────────────────────────────────────────────────

const STATUS_FROM_PASS_RATIO = (passOnly: number, total: number): ParityReport['status'] => {
  if (total === 0) return 'unavailable';
  const p = passOnly / total;
  if (p >= 1.0) return 'verified';
  if (p >= 0.85) return 'needs_review';
  if (p >= 0.6) return 'needs_iteration';
  return 'failed';
};

export function checkDeterministic(input: DeterministicCheckInputs): ParityReport {
  if (input.decomposedHtml === null) {
    const placeholderChecks: ParityCheck[] = [
      {
        id: 'structure',
        label: 'Structure parity',
        status: 'fail',
        evidence: ['decomposed index.html missing'],
      },
    ];
    // Pad to 16 unavailable rows so the UI rubric is stable
    const labels = SIXTEEN_LABELS.slice(1);
    for (const [id, label] of labels) {
      placeholderChecks.push({ id, label, status: 'unavailable', evidence: [] });
    }
    return {
      checks: placeholderChecks,
      passCount: 0,
      totalChecks: 16,
      parityScore: 0,
      status: 'failed',
      summary: 'decomposed index.html missing',
      gaps: [{ kind: 'missing-file', severity: 'high', message: 'index.html not produced' }],
      signals: { elementCountScore: 0, visibleTextCoverage: 0, tokenCoverage: 0 },
    };
  }

  const src = input.sourceHtml;
  const dec = input.decomposedHtml;
  const tok = input.tokensCss;
  const files = input.uiKitFiles;

  const checks: ParityCheck[] = [
    checkStructureParity(src, dec),                          // 1
    checkComponentCount(src, dec),                           // 2
    checkLayoutGrid(dec, tok),                               // 3
    checkSpacingSystem(dec, tok),                            // 4
    checkTypographyScale(dec, tok),                          // 5
    checkFontFidelity(src, dec, tok),                        // 6
    checkColorTokens(src, dec, tok),                         // 7
    checkColorDelta(),                                       // 8 (honest unavailable)
    checkBorderRadius(dec, tok),                             // 9
    checkShadows(dec, tok),                                  // 10
    checkIconography(src, dec),                              // 11
    checkResponsiveBreakpoints(dec, tok),                    // 12
    checkInteractionStates(dec, tok),                        // 13
    checkAccessibility(dec),                                 // 14
    checkSemanticHtml(dec),                                  // 15
    checkVisualRegression(),                                 // 16 (honest unavailable)
  ];

  // File presence shows up as gaps, not as standalone checks (the 16
  // semantic checks are the rubric). Missing files weaken structure +
  // semantic + a11y individually because the upstream signals already
  // reflect what's there.
  const expectedFiles = ['index.html', 'tokens.css', 'manifest.json', 'README.md'];
  const gaps: ParityGap[] = [];
  for (const f of expectedFiles) {
    const found = Object.keys(files).some((k) => k.endsWith(`/${f}`) || k === f);
    if (!found) {
      gaps.push({
        kind: 'missing-file',
        severity: 'medium',
        message: `expected file missing: ${f}`,
      });
    }
  }
  const expectedContractFiles = [
    'parity.contract.json',
    'performance.budget.json',
    'api-wiring.plan.md',
    'qa.plan.md',
  ];
  for (const f of expectedContractFiles) {
    const found = Object.keys(files).some((k) => k.endsWith(`/${f}`) || k === f);
    if (!found) {
      gaps.push({
        kind: f.endsWith('.json') ? 'manifest' : 'missing-file',
        severity: 'medium',
        message: `expected operating contract file missing: ${f}`,
      });
    }
  }

  // Fold check evidence into legacy gaps shape for back-compat consumers
  for (const c of checks) {
    if (c.status === 'fail' || c.status === 'warn') {
      const kind: ParityGap['kind'] = mapIdToKind(c.id);
      gaps.push({
        kind,
        severity: c.status === 'fail' ? 'high' : 'medium',
        message: c.evidence.join(' · ') || `${c.label} below threshold`,
      });
    }
  }

  const passCount = checks.filter((c) => c.status === 'pass').length;
  const failCount = checks.filter((c) => c.status === 'fail').length;
  const totalChecks = checks.length;
  // Run-level rollup: a single 'fail' check pushes the run into needs_iteration
  // territory if pass ratio < 60%; otherwise a low score gates needs_review.
  const status: ParityReport['status'] =
    failCount >= 4
      ? 'needs_iteration'
      : passCount === totalChecks
        ? 'verified'
        : passCount >= Math.ceil(totalChecks * 0.85)
          ? 'needs_review'
          : passCount >= Math.ceil(totalChecks * 0.6)
            ? 'needs_iteration'
            : 'failed';

  const parityScore = passCount / totalChecks;
  const summary =
    status === 'verified'
      ? `Parity OK (${passCount}/${totalChecks})`
      : `${status} (${passCount}/${totalChecks})`;

  // Legacy 3-axis signals — reconstruct from the dedicated checks
  const elementCountScore =
    checks[0]?.status === 'pass' ? 1 : checks[0]?.status === 'warn' ? 0.85 : 0.5;
  const visibleTextCoverage = visibleTextCoverageFromChecks(src, dec);
  const tokenCoverage =
    checks[6]?.status === 'pass' ? 1 : checks[6]?.status === 'warn' ? 0.85 : 0.5;

  return {
    checks,
    passCount,
    totalChecks,
    parityScore,
    status,
    summary,
    gaps,
    signals: {
      elementCountScore,
      visibleTextCoverage,
      tokenCoverage,
    },
  };
}

// Static label mapping used as fallback when the source can't be inspected.
const SIXTEEN_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['structure', 'Structure parity'],
  ['componentCount', 'Component count'],
  ['layoutGrid', 'Layout grid'],
  ['spacing', 'Spacing system'],
  ['typography', 'Typography scale'],
  ['fontFidelity', 'Font fidelity'],
  ['colorTokens', 'Color tokens'],
  ['colorDelta', 'Color delta'],
  ['borderRadius', 'Border radius'],
  ['shadows', 'Shadows & elevation'],
  ['iconography', 'Iconography'],
  ['breakpoints', 'Responsive breakpoints'],
  ['interaction', 'Interaction states'],
  ['a11y', 'Accessibility'],
  ['semantic', 'Semantic HTML'],
  ['visualRegression', 'Visual regression'],
];

function mapIdToKind(id: string): ParityGap['kind'] {
  switch (id) {
    case 'structure':
    case 'componentCount':
    case 'layoutGrid':
      return 'structure';
    case 'spacing':
      return 'spacing';
    case 'typography':
    case 'fontFidelity':
      return 'typography';
    case 'colorTokens':
    case 'colorDelta':
      return 'color';
    case 'borderRadius':
      return 'radius';
    case 'shadows':
      return 'shadow';
    case 'iconography':
      return 'icon';
    case 'breakpoints':
      return 'breakpoint';
    case 'interaction':
      return 'interaction';
    case 'a11y':
      return 'a11y';
    case 'semantic':
      return 'semantic';
    default:
      return 'structure';
  }
}

function visibleTextCoverageFromChecks(source: string, decomposed: string): number {
  const s = visibleWords(source);
  const d = visibleWords(decomposed);
  if (s.size === 0) return 1;
  let matched = 0;
  for (const w of s) if (d.has(w)) matched += 1;
  return matched / s.size;
}

// Public legacy alias preserved for backward compat
export function statusFromBooleans(passCount: number, totalChecks: number): ParityReport['status'] {
  return STATUS_FROM_PASS_RATIO(passCount, totalChecks);
}
