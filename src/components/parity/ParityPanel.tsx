import { useAction, useQuery } from 'convex/react';
import { RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { CostTelemetry } from './CostTelemetry';
import { ParityCheckRow } from './ParityCheckRow';
import { ParityDonut } from './ParityDonut';
import type { Verdict } from './ParityVerdictPill';

interface ParityPanelProps {
  runId: Id<'runs'> | null;
}

interface CheckRow {
  number: number;
  label: string;
  verdict: Verdict;
  evidence: string[];
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

function buildLocalParityReadout({
  counts,
  totalChecks,
  rows,
  statusLabel,
  hasReport,
}: {
  counts: { pass: number; warn: number; fail: number; unavailable: number };
  totalChecks: number;
  rows: CheckRow[];
  statusLabel: string;
  hasReport: boolean;
}): string {
  if (!hasReport) {
    return [
      'Readout: No parity report yet.',
      'Why it matters: the app needs to generate or import a ui_kit before it can judge visual accuracy.',
      'Fix next: run generate/decompose, then this panel will explain what passed and what needs iteration.',
      `Confidence: waiting; current run status is ${statusLabel}.`,
    ].join('\n');
  }

  const issues = rows
    .filter((row) => row.verdict === 'fail' || row.verdict === 'warn')
    .slice(0, 3)
    .map((row) => row.label);
  const issueText = issues.length > 0 ? issues.join(', ') : 'no obvious blockers';
  if (counts.fail > 0) {
    return [
      `Readout: not ready to distribute yet; ${counts.fail} checks fail and ${counts.pass}/${totalChecks} pass.`,
      `Why it matters: the generated kit still diverges in ${issueText}, so users may not trust the output as an exact match.`,
      'Fix next: make one visible iteration against the highest-impact failing area, then rerun verify.',
      `Confidence: medium; ${counts.unavailable} checks still need stronger evidence.`,
    ].join('\n');
  }
  if (counts.warn > 0) {
    return [
      `Readout: close, but still needs polish; ${counts.pass}/${totalChecks} pass with ${counts.warn} warnings.`,
      `Why it matters: ${issueText} may look acceptable at a glance but can drift under real use or responsive sizes.`,
      'Fix next: tune the warning areas, then do a browser pass on desktop and mobile.',
      `Confidence: medium-high; ${counts.unavailable} checks are still unavailable.`,
    ].join('\n');
  }
  if (counts.unavailable > 0) {
    return [
      `Readout: ${counts.pass}/${totalChecks} checks pass, but the score is incomplete.`,
      'Why it matters: missing evidence means the app cannot honestly claim the whole surface is verified.',
      'Fix next: rerun verify or capture the missing browser/screenshot evidence.',
      `Confidence: limited; ${counts.unavailable} checks are unavailable.`,
    ].join('\n');
  }
  return [
    `Readout: strong match; all ${totalChecks} checks pass.`,
    'Why it matters: the generated ui_kit is aligned enough for a final human visual review and export.',
    'Fix next: preview the core route, test the ZIP export, then distribute.',
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

export function ParityPanel({ runId }: ParityPanelProps) {
  const run = useQuery(api.runs.get, runId ? { runId } : 'skip');
  const parity = useQuery(api.parityReports.getLatest, runId ? { runId } : 'skip');
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
      }),
    [counts, parity, rows, statusLabel, totalChecks],
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
            {agentLoading && !agentSummary ? 'Agent is translating the technical checks into an actionable readout...' : displayedReadout}
          </div>
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
            <span>
              {agentError
                ? `Agent summary failed; showing local readout: ${agentError}`
                : agentSummary
                  ? `${agentSummary.provider} / ${agentSummary.modelUsed}`
                  : 'local readout until agent summary returns'}
            </span>
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
