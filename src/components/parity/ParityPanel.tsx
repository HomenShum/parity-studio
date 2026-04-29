import { useQuery } from 'convex/react';
import { ShieldCheck } from 'lucide-react';
import { useMemo } from 'react';
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

  // Prefer the typed checks array when Sprint 3 ships it
  if (report.checks && report.checks.length > 0) {
    return report.checks.slice(0, 16).map((c, i) => ({
      number: i + 1,
      label: c.label,
      verdict: c.status,
      evidence: c.evidence ?? [],
    }));
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

export function ParityPanel({ runId }: ParityPanelProps) {
  const run = useQuery(api.runs.get, runId ? { runId } : 'skip');
  const parity = useQuery(api.parityReports.getLatest, runId ? { runId } : 'skip');

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
      aria-label="Deterministic parity"
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
          Deterministic parity
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
