import {
  Activity,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Code2,
  Cpu,
  ShieldCheck,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AgentTrace, ValidationResult } from '../../../../shared/nodeslide';

interface TraceInspectorProps {
  traces: readonly AgentTrace[];
  validations: readonly ValidationResult[];
}

export function TraceInspector({ traces, validations }: TraceInspectorProps) {
  const sorted = useMemo(() => [...traces].sort((a, b) => b.createdAt - a.createdAt), [traces]);
  const latestValidation = useMemo(
    () =>
      [...validations].sort(
        (left, right) => right.deckVersion - left.deckVersion || right.checkedAt - left.checkedAt,
      )[0],
    [validations],
  );
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const selected = sorted.find((trace) => trace.id === selectedTraceId) ?? sorted[0];
  const traceValidation =
    selected?.validation ??
    validations.find((candidate) => candidate.deckVersion === selected?.validation?.deckVersion) ??
    null;

  return (
    <div className="ns-inspector-scroll ns-trace-inspector">
      <section className="ns-inspector-section">
        <div className="ns-section-title-row">
          <div>
            <span className="ns-eyebrow">Accountability</span>
            <h2>Agent trace</h2>
          </div>
          <span className="ns-route-pill">
            <Activity size={11} /> Human view
          </span>
        </div>
        <p>
          Understand what the agent attempted, which guardrails applied, and how the result
          validated.
        </p>
      </section>

      {latestValidation ? (
        <ValidationSummary validation={latestValidation} label="Current deck validation" />
      ) : null}

      {sorted.length === 0 ? (
        <div className="ns-empty-state">
          <span>
            <Activity size={19} />
          </span>
          <strong>No agent activity yet</strong>
          <p>AI edit plans and tool calls will appear here after the first proposal.</p>
        </div>
      ) : (
        <>
          <label className="ns-trace-picker">
            <span>Trace</span>
            <select
              value={selected?.id ?? ''}
              onChange={(event) => setSelectedTraceId(event.target.value)}
            >
              {sorted.map((trace) => (
                <option key={trace.id} value={trace.id}>
                  {trace.summary}
                </option>
              ))}
            </select>
            <ChevronRight size={13} />
          </label>

          {selected ? (
            <article className="ns-trace-summary">
              <div className="ns-trace-status">
                <span className={`ns-status-dot ns-status-dot--${selected.status}`} />
                <span>
                  <strong>{selected.summary}</strong>
                  <small>
                    {humanize(selected.status)} · {formatDate(selected.createdAt)}
                  </small>
                </span>
              </div>
              <div className="ns-trace-stats">
                <span>
                  <Cpu size={12} /> {selected.model ?? 'Automatic model'}
                </span>
                <span>
                  <Clock3 size={12} /> {selected.patchId ? 'Review cycle' : 'Run'}{' '}
                  {duration(selected)}
                </span>
                {selected.costMicroUsd !== undefined ? (
                  <span>
                    <CircleDollarSign size={12} /> ${(selected.costMicroUsd / 1_000_000).toFixed(3)}
                  </span>
                ) : null}
              </div>
              <TraceList icon={<Bot size={13} />} title="Plan" items={selected.plan} numbered />
              <TraceList
                icon={<Wrench size={13} />}
                title="What it used"
                items={selected.toolCalls}
              />
              <TraceList
                icon={<ShieldCheck size={13} />}
                title="Guardrails"
                items={selected.guardrails}
              />
              {traceValidation && traceValidation.id !== latestValidation?.id ? (
                <ValidationSummary validation={traceValidation} label="Selected trace validation" />
              ) : null}
              <details className="ns-raw-trace">
                <summary>
                  <Code2 size={13} /> Raw JSON <span>collapsed</span>
                </summary>
                <pre>{JSON.stringify(selected, null, 2)}</pre>
              </details>
            </article>
          ) : null}
        </>
      )}
    </div>
  );
}

function TraceList({
  icon,
  title,
  items,
  numbered = false,
}: { icon: React.ReactNode; title: string; items: readonly string[]; numbered?: boolean }) {
  if (items.length === 0) return null;
  return (
    <section className="ns-trace-list">
      <h3>
        {icon}
        {title}
      </h3>
      <ol className={numbered ? 'is-numbered' : ''}>
        {items.map((item, index) => (
          <li key={item}>
            {numbered ? <span>{index + 1}</span> : null}
            {item}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ValidationSummary({
  validation,
  label,
}: {
  validation: ValidationResult;
  label: string;
}) {
  return (
    <section className={`ns-validation-summary ${validation.ok ? 'is-ok' : 'has-issues'}`}>
      <h3>
        {validation.ok ? <CheckCircle2 size={14} /> : <TriangleAlert size={14} />}
        {label}: {validation.ok ? 'passed' : `${validation.issues.length} issues`}
      </h3>
      <p>
        Deck v{validation.deckVersion} ·{' '}
        {validation.publishOk ? 'publish ready' : 'review before publishing'}
      </p>
      {validation.issues.length > 0 ? (
        <ul>
          {validation.issues.slice(0, 4).map((issue) => (
            <li key={issue.id}>
              <span>{issue.severity}</span>
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function duration(trace: AgentTrace) {
  if (!trace.completedAt) return humanize(trace.status);
  const seconds = Math.max(1, Math.round((trace.completedAt - trace.createdAt) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function humanize(value: string) {
  return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    timestamp,
  );
}
