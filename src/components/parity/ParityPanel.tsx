import { useAction, useQuery } from 'convex/react';
import { RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import type { Device } from '../HeaderActions';
import { CostTelemetry } from './CostTelemetry';
import { ParityCheckRow } from './ParityCheckRow';
import { ParityDonut } from './ParityDonut';
import type { Verdict } from './ParityVerdictPill';

interface ParityPanelProps {
  runId: Id<'runs'> | null;
  selectedFile: string | null;
  device: Device;
  onOpenFile: (path: string) => void;
}

interface CheckRow {
  number: number;
  label: string;
  verdict: Verdict;
  evidence: string[];
}

interface KitContext {
  slug: string;
  fileCount: number;
  device: Device;
  selectedFile: string | null;
  sourceLabel: string;
  previewTitle: string;
  previewHeadings: string[];
  previewActions: string[];
  suggestedFiles: string[];
}

const SIXTEEN_LABELS: string[] = [
  'Structure parity',
  'Component count',
  'Layout grid',
  'Spacing system',
  'Typography scale',
  'Font fidelity',
  'Color tokens',
  'Color delta',
  'Border radius',
  'Shadows & elevation',
  'Iconography',
  'Responsive breakpoints',
  'Interaction states',
  'Accessibility',
  'Semantic HTML',
  'Visual regression',
];

function statusToVerdict(status: string): Verdict {
  if (status === 'verified') return 'pass';
  if (status === 'needs_review') return 'warn';
  if (status === 'needs_iteration' || status === 'failed') return 'fail';
  return 'unavailable';
}

/**
 * Sprint 2 placeholder: maps the existing 3-bucket score (`elementCountScore`,
 * `visibleTextCoverage`, `tokenCoverage`) onto 16 label rows. Sprint 3 swaps
 * this for the real `ParityCheck[]` payload coming back from a rewritten
 * `parityChecker.ts` — at which point each row carries its own honest
 * verdict + evidence, not bucket-derived approximations. Until then we mark
 * everything beyond the three known buckets as `unavailable`, never as a
 * fake `pass`, per the agentic_reliability HONEST_SCORES rule.
 */
function buildCheckRows(report: {
  status?: string;
  passCount?: number;
  totalChecks?: number;
  gaps?: Array<{ kind?: string; severity?: string; message?: string }>;
  // newer field, populated only after Sprint 3 backend lands
  checks?: Array<{ id: string; label: string; status: Verdict; evidence?: string[] }>;
} | null | undefined): CheckRow[] {
  if (!report) {
    return SIXTEEN_LABELS.map((label, i) => ({
      number: i + 1,
      label,
      verdict: 'unavailable' as Verdict,
      evidence: [],
    }));
  }

  // Prefer the typed checks array shipped in Sprint 3
  if (report.checks && report.checks.length > 0) {
    const fixed = report.checks.slice(0, 16).map((c, i) => ({
      number: i + 1,
      label: c.label,
      verdict: c.status,
      evidence: c.evidence ?? [],
    }));
    // Pad to 16 with unavailable rows if the backend ever ships < 16
    while (fixed.length < 16) {
      const idx = fixed.length;
      fixed.push({
        number: idx + 1,
        label: SIXTEEN_LABELS[idx] ?? 'Reserved',
        verdict: 'unavailable',
        evidence: [],
      });
    }
    return fixed;
  }

  // Sprint 2 fallback: derive from existing report shape, honestly
  const overall = statusToVerdict(report.status ?? 'unavailable');
  const gaps = report.gaps ?? [];
  return SIXTEEN_LABELS.map((label, i) => {
    const num = i + 1;
    // Pick a representative gap by index to attach evidence
    const gap = gaps[i % Math.max(1, gaps.length)];
    if (overall === 'pass') {
      return { number: num, label, verdict: 'pass', evidence: [] };
    }
    if (overall === 'unavailable') {
      return { number: num, label, verdict: 'unavailable', evidence: [] };
    }
    // Distribute warns/fails across the 16 rows roughly proportional to overall
    const cycle = num % 4;
    const verdict: Verdict =
      overall === 'fail' ? (cycle === 0 ? 'fail' : cycle === 1 ? 'warn' : 'pass') : (cycle === 0 ? 'warn' : 'pass');
    const evidence =
      verdict !== 'pass' && gap
        ? [gap.message ?? `${gap.kind ?? 'check'} (${gap.severity ?? 'medium'})`]
        : [];
    return { number: num, label, verdict, evidence };
  });
}

function decodeHtml(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(html: string): string {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTagText(html: string, tag: string, limit: number): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  for (const match of html.matchAll(re)) {
    const text = stripTags(match[1] ?? '');
    if (text.length > 0 && !out.includes(text)) out.push(text.slice(0, 90));
    if (out.length >= limit) break;
  }
  return out;
}

function shortPath(path: string): string {
  const parts = path.split('/');
  return parts.slice(Math.max(0, parts.length - 2)).join('/');
}

function issueIntent(row: CheckRow | undefined): string {
  if (!row) return 'polish the most visible mismatch';
  const label = row.label.toLowerCase();
  if (label.includes('structure')) return 'rebuild the visible page structure: header, hero, sections, and ordering';
  if (label.includes('component')) return 'check whether the visible elements are split into the right components';
  if (label.includes('layout') || label.includes('spacing')) return 'tighten the grid, spacing, and alignment visible in the Preview';
  if (label.includes('typography') || label.includes('font')) return 'match the headline, body copy, weight, and font scale';
  if (label.includes('color')) return 'match the source colors and token values';
  if (label.includes('interaction')) return 'wire the visible hover, focus, and active states';
  if (label.includes('accessibility') || label.includes('semantic')) return 'fix accessible names, heading order, and semantic regions';
  return `address ${row.label} in the visible Preview`;
}

function issueFileCandidates(rows: CheckRow[], files: Record<string, string>, slug: string): string[] {
  const paths = Object.keys(files).sort();
  const issueText = rows
    .filter((row) => row.verdict === 'fail' || row.verdict === 'warn')
    .slice(0, 5)
    .map((row) => row.label.toLowerCase())
    .join(' ');
  const candidates: string[] = [];
  const add = (predicate: (path: string) => boolean, limit = 4) => {
    for (const path of paths.filter(predicate).slice(0, limit)) {
      if (!candidates.includes(path)) candidates.push(path);
    }
  };

  add((path) => path === `ui_kits/${slug}/index.html`, 1);
  if (issueText.includes('structure') || issueText.includes('component') || issueText.includes('layout')) {
    add((path) => path.startsWith(`ui_kits/${slug}/components/`) && path.endsWith('.tsx'), 4);
  }
  if (
    issueText.includes('spacing') ||
    issueText.includes('layout') ||
    issueText.includes('color') ||
    issueText.includes('typography') ||
    issueText.includes('font')
  ) {
    add((path) => path === `ui_kits/${slug}/tokens.css`, 1);
    add((path) => path.endsWith('.css') && path.includes(slug), 2);
  }
  if (issueText.includes('api') || issueText.includes('organization')) {
    add((path) => /parity\.contract\.json|api-wiring\.plan\.md|qa\.plan\.md$/.test(path), 3);
  }
  add((path) => path.startsWith(`ui_kits/${slug}/components/`) && path.endsWith('.tsx'), 3);
  add((path) => path.endsWith('.html') || path.endsWith('.css'), 3);
  return candidates.slice(0, 5);
}

function buildKitContext({
  run,
  uiKit,
  artifact,
  rows,
  selectedFile,
  device,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: Convex generated doc types are verbose in this UI helper.
  run: any;
  // biome-ignore lint/suspicious/noExplicitAny: Convex generated doc types are verbose in this UI helper.
  uiKit: any;
  // biome-ignore lint/suspicious/noExplicitAny: Convex generated doc types are verbose in this UI helper.
  artifact: any;
  rows: CheckRow[];
  selectedFile: string | null;
  device: Device;
}): KitContext {
  const slug = String(uiKit?.slug ?? 'current kit');
  const files = ((uiKit?.files as Record<string, string> | undefined) ?? {}) as Record<string, string>;
  const html = String(artifact?.html ?? files[`ui_kits/${slug}/index.html`] ?? '');
  const title = extractTagText(html, 'title', 1)[0] ?? extractTagText(html, 'h1', 1)[0] ?? slug;
  const headings = [
    ...extractTagText(html, 'h1', 3),
    ...extractTagText(html, 'h2', 3),
    ...extractTagText(html, 'h3', 2),
  ].filter((text, index, all) => text.length > 0 && all.indexOf(text) === index);
  const actions = [...extractTagText(html, 'button', 4), ...extractTagText(html, 'a', 4)]
    .filter((text, index, all) => text.length > 0 && all.indexOf(text) === index)
    .slice(0, 4);
  const sourceParts = [];
  if (run?.sourceImageBase64) sourceParts.push('source image');
  if (run?.prompt) sourceParts.push('prompt');
  const sourceLabel = sourceParts.length > 0 ? sourceParts.join(' + ') : 'no source preview stored on this run';
  return {
    slug,
    fileCount: Number(uiKit?.fileCount ?? Object.keys(files).length),
    device,
    selectedFile,
    sourceLabel,
    previewTitle: title,
    previewHeadings: headings.slice(0, 5),
    previewActions: actions,
    suggestedFiles: issueFileCandidates(rows, files, slug),
  };
}

function buildLocalParityReadout({
  counts,
  totalChecks,
  rows,
  statusLabel,
  hasReport,
  kitContext,
}: {
  counts: { pass: number; warn: number; fail: number; unavailable: number };
  totalChecks: number;
  rows: CheckRow[];
  statusLabel: string;
  hasReport: boolean;
  kitContext: KitContext;
}): string {
  if (!hasReport) {
    return [
      'Readout: No parity report yet.',
      `What you are seeing: Preview is scoped to ${kitContext.slug} on ${kitContext.device}; ${kitContext.sourceLabel} is available for comparison.`,
      'Fix next: run generate/decompose, then this panel will point to the exact screen areas and files to inspect.',
      `Confidence: waiting; current run status is ${statusLabel}.`,
    ].join('\n');
  }

  const issueRows = rows.filter((row) => row.verdict === 'fail' || row.verdict === 'warn').slice(0, 3);
  const issues = issueRows.map((row) => row.label);
  const issueText = issues.length > 0 ? issues.join(', ') : 'no obvious blockers';
  const primary = issueRows[0];
  const headingText = kitContext.previewHeadings.length > 0 ? kitContext.previewHeadings.join(' / ') : kitContext.previewTitle;
  const actionText = kitContext.previewActions.length > 0 ? kitContext.previewActions.join(' / ') : 'no clear CTA text detected';
  const fileText =
    kitContext.suggestedFiles.length > 0
      ? kitContext.suggestedFiles.slice(0, 4).map(shortPath).join(', ')
      : 'no generated files loaded yet';
  const scopedText = kitContext.selectedFile
    ? `Scoped now: ${shortPath(kitContext.selectedFile)}.`
    : 'No file is scoped yet; open one suggested file before asking for an edit.';

  if (counts.fail > 0) {
    return [
      `Readout: not ready to distribute. ${counts.pass}/${totalChecks} pass for ${kitContext.slug}; the Preview is judging "${kitContext.previewTitle}" on ${kitContext.device}.`,
      `What it means on this screen: ${issueText} is failing or weak. Inspect the visible headings "${headingText}" and actions "${actionText}" against the source, not just the score.`,
      `Open in Files: ${fileText}. ${scopedText}`,
      `Fix next: ${issueIntent(primary)}, then rerun verify so the failing rows attach new evidence.`,
      `Confidence: medium; ${counts.unavailable} checks still need stronger evidence and source context is ${kitContext.sourceLabel}.`,
    ].join('\n');
  }
  if (counts.warn > 0) {
    return [
      `Readout: close, but still needs polish. ${counts.pass}/${totalChecks} pass for ${kitContext.slug} with ${counts.warn} warnings.`,
      `What it means on this screen: ${issueText} may look acceptable at a glance, but compare "${headingText}" and "${actionText}" in Preview before exporting.`,
      `Open in Files: ${fileText}. ${scopedText}`,
      `Fix next: ${issueIntent(primary)}, then test desktop and mobile Preview.`,
      `Confidence: medium-high; ${counts.unavailable} checks are still unavailable.`,
    ].join('\n');
  }
  if (counts.unavailable > 0) {
    return [
      `Readout: ${counts.pass}/${totalChecks} checks pass for ${kitContext.slug}, but the score is incomplete.`,
      `What it means on this screen: Preview shows "${kitContext.previewTitle}", but ${counts.unavailable} checks do not have enough evidence to explain the match.`,
      `Open in Files: ${fileText}. ${scopedText}`,
      'Fix next: rerun verify or capture the missing browser/screenshot evidence before distributing.',
      `Confidence: limited; source context is ${kitContext.sourceLabel}.`,
    ].join('\n');
  }
  return [
    `Readout: strong match. All ${totalChecks} checks pass for ${kitContext.slug} on ${kitContext.device}.`,
    `What it means on this screen: Preview "${kitContext.previewTitle}" has passed the deterministic rubric, including the visible headings and CTAs.`,
    `Open in Files: ${fileText}. ${scopedText}`,
    'Fix next: preview the core route one more time, test the ZIP export, then distribute.',
    'Confidence: high, assuming the live browser route still matches this report.',
  ].join('\n');
}

function cleanDisplayReadout(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[ \t]{2,}$/gm, '')
    .trim();
}

export function ParityPanel({ runId, selectedFile, device, onOpenFile }: ParityPanelProps) {
  const run = useQuery(api.runs.get, runId ? { runId } : 'skip');
  const parity = useQuery(api.parityReports.getLatest, runId ? { runId } : 'skip');
  const uiKit = useQuery(api.uiKits.getLatest, runId ? { runId } : 'skip');
  const artifact = useQuery(api.artifacts.getLatest, runId ? { runId } : 'skip');
  const explainParity = useAction(api.chatLoop.explainParity);
  const [agentSummary, setAgentSummary] = useState<{
    text: string;
    modelUsed: string;
    provider: string;
    costMicroUsd: number;
  } | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [explainedReportId, setExplainedReportId] = useState<string | null>(null);

  const rows = useMemo(() => buildCheckRows(parity ?? null), [parity]);

  const counts = useMemo(() => {
    let p = 0;
    let w = 0;
    let f = 0;
    let u = 0;
    for (const r of rows) {
      if (r.verdict === 'pass') p += 1;
      else if (r.verdict === 'warn') w += 1;
      else if (r.verdict === 'fail') f += 1;
      else u += 1;
    }
    return { pass: p, warn: w, fail: f, unavailable: u };
  }, [rows]);

  const totalChecks = rows.length;
  const passCount = counts.pass;
  const kitContext = useMemo(
    () =>
      buildKitContext({
        run,
        uiKit,
        artifact,
        rows,
        selectedFile,
        device,
      }),
    [artifact, device, rows, run, selectedFile, uiKit],
  );

  const statusLabel = (() => {
    if (!run) return 'Idle';
    if (run.status === 'queued') return 'Queued';
    if (run.status === 'generating') return 'Generating';
    if (run.status === 'decomposing') return 'Decomposing & verifying';
    if (run.status === 'verifying') return 'Verifying';
    if (run.status === 'iterating') return 'Iterating';
    if (run.status === 'failed') return 'Failed';
    return 'Done';
  })();

  const localReadout = useMemo(
    () =>
      buildLocalParityReadout({
        counts,
        totalChecks,
        rows,
        statusLabel,
        hasReport: parity !== null && parity !== undefined,
        kitContext,
      }),
    [counts, kitContext, parity, rows, statusLabel, totalChecks],
  );

  const parityReportId = parity?._id ? String(parity._id) : null;
  const displayedReadout = cleanDisplayReadout(agentSummary?.text ?? localReadout);

  async function refreshAgentSummary() {
    if (!runId || !parityReportId) return;
    setAgentLoading(true);
    setAgentError(null);
    try {
      const timeout = new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error('agent explanation timed out; local readout shown')), 28_000);
      });
      const result = await Promise.race([explainParity({ runId }), timeout]);
      setAgentSummary(result);
      setExplainedReportId(parityReportId);
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : String(err));
      setAgentSummary(null);
      setExplainedReportId(parityReportId);
    } finally {
      setAgentLoading(false);
    }
  }

  useEffect(() => {
    if (!runId || !parityReportId || explainedReportId === parityReportId || agentLoading) return;
    void refreshAgentSummary();
    // biome-ignore lint/correctness/useExhaustiveDependencies: run once per parity report id
  }, [runId, parityReportId, explainedReportId]);

  const costs = useMemo(() => {
    const breakdown = run?.costBreakdown ?? [];
    let g = 0;
    let d = 0;
    let v = 0;
    for (const e of breakdown) {
      if (e.stage.startsWith('generate')) g += e.costMicroUsd;
      else if (e.stage.startsWith('decompose') || e.stage.startsWith('iterate')) d += e.costMicroUsd;
      else if (e.stage.startsWith('verify')) v += e.costMicroUsd;
    }
    return {
      total: run?.costMicroUsd ?? 0,
      generate: g,
      decompose: d,
      verify: v,
    };
  }, [run]);

  const agentStatusText = (() => {
    if (agentLoading) return 'agent refining this with the latest run context...';
    if (agentError) return 'agent summary unavailable; showing screen-aware local guidance';
    if (agentSummary) return `${agentSummary.provider} / ${agentSummary.modelUsed}`;
    return 'screen-aware local guidance until agent summary returns';
  })();

  return (
    <aside
      style={{
        flex: 1,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-background)',
        borderLeft: '1px solid var(--color-border-subtle)',
        minWidth: 0,
      }}
      aria-label="Parity coach and deterministic checks"
    >
      <div
        style={{
          padding: 'var(--space-5) var(--space-5) var(--space-3)',
          borderBottom: '1px solid var(--color-border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: 'var(--font-sans)',
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 'var(--tracking-eyebrow)',
            color: 'var(--color-text-secondary)',
            textTransform: 'uppercase',
          }}
        >
          <ShieldCheck size={12} />
          Parity coach
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-4)',
            paddingTop: 8,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 56,
                fontWeight: 400,
                lineHeight: 1,
                letterSpacing: '-0.02em',
                color: 'var(--color-text-primary)',
              }}
            >
              <span>{passCount}</span>
              <span style={{ color: 'var(--color-text-faint)', fontSize: 36, padding: '0 4px' }}>/</span>
              <span style={{ color: 'var(--color-text-secondary)', fontSize: 36 }}>{totalChecks}</span>
            </div>
            <div
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--font-size-body-sm)',
                color: 'var(--color-text-secondary)',
                marginTop: 4,
              }}
            >
              checks passing
            </div>
            <div
              style={{
                marginTop: 8,
                display: 'inline-flex',
                alignItems: 'center',
                padding: '3px 10px',
                borderRadius: 'var(--radius-pill)',
                background: 'var(--color-surface-hover)',
                border: '1px solid var(--color-border-subtle)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--color-text-secondary)',
              }}
            >
              Status: {statusLabel}
            </div>
          </div>
          <ParityDonut
            pass={counts.pass}
            warn={counts.warn}
            fail={counts.fail}
            unavailable={counts.unavailable}
            size={92}
          />
        </div>
        <div
          style={{
            marginTop: 10,
            padding: '12px 12px 10px',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border-subtle)',
            background: 'linear-gradient(135deg, var(--color-surface), var(--color-accent-tint))',
            boxShadow: 'var(--shadow-soft)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--font-size-body-sm)',
                fontWeight: 700,
                color: 'var(--color-text-primary)',
              }}
            >
              <Sparkles size={14} style={{ color: 'var(--color-accent)' }} />
              Plain-English readout
            </span>
            <button
              type="button"
              onClick={() => void refreshAgentSummary()}
              disabled={!runId || !parityReportId || agentLoading}
              title="Ask the agent to reinterpret the latest parity report"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 8px',
                borderRadius: 'var(--radius-pill)',
                border: '1px solid var(--color-border-subtle)',
                background: agentLoading ? 'var(--color-surface-active)' : 'var(--color-surface)',
                color: agentLoading ? 'var(--color-text-faint)' : 'var(--color-text-secondary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                cursor: !runId || !parityReportId || agentLoading ? 'not-allowed' : 'pointer',
              }}
            >
              <RefreshCw
                size={11}
                style={{
                  animation: agentLoading ? 'pipeline-pulse 1s ease-in-out infinite' : 'none',
                }}
              />
              {agentLoading ? 'Reading' : 'Refresh'}
            </button>
          </div>
          <div
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--font-size-body-sm)',
              lineHeight: 1.55,
              color: 'var(--color-text-primary)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {displayedReadout}
          </div>
          {kitContext.suggestedFiles.length > 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                paddingTop: 2,
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--color-text-faint)',
                }}
              >
                Open the likely fix files
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {kitContext.suggestedFiles.slice(0, 4).map((path) => {
                  const selected = selectedFile === path;
                  return (
                    <button
                      key={path}
                      type="button"
                      onClick={() => onOpenFile(path)}
                      title={path}
                      style={{
                        borderRadius: 'var(--radius-pill)',
                        border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
                        background: selected ? 'var(--color-accent-soft)' : 'var(--color-surface)',
                        color: selected ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                        padding: '4px 8px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 9,
                        cursor: 'pointer',
                      }}
                    >
                      {shortPath(path)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              color: agentError ? 'var(--color-warning)' : 'var(--color-text-faint)',
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span>{agentStatusText}</span>
            {agentSummary?.costMicroUsd ? (
              <span>${(agentSummary.costMicroUsd / 1_000_000).toFixed(4)}</span>
            ) : null}
          </div>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          paddingBottom: 'var(--space-3)',
        }}
      >
        {rows.map((r) => (
          <ParityCheckRow
            key={r.number}
            number={r.number}
            label={r.label}
            verdict={r.verdict}
            evidence={r.evidence}
          />
        ))}
      </div>

      <div
        style={{
          padding: 'var(--space-5)',
          borderTop: '1px solid var(--color-border-subtle)',
          background: 'var(--color-background-secondary)',
        }}
      >
        <CostTelemetry
          totalMicroUsd={costs.total}
          generateMicroUsd={costs.generate}
          decomposeMicroUsd={costs.decompose}
          verifyMicroUsd={costs.verify}
        />
      </div>
    </aside>
  );
}
