import {
  Activity,
  Bot,
  Braces,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Code2,
  Cpu,
  Eye,
  Fingerprint,
  Gauge,
  ShieldCheck,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import type {
  AgentTrace,
  CandidateValidationReceipt,
  DeckPatch,
  ValidationResult,
} from '../../../../shared/nodeslide';

type TraceDensity = 'human' | 'pro' | 'tech';
type TraceValidation = ValidationResult | CandidateValidationReceipt;

interface TraceInspectorProps {
  traces: readonly AgentTrace[];
  validations: readonly ValidationResult[];
  patches?: readonly DeckPatch[];
}

export function TraceInspector({ traces, validations, patches = [] }: TraceInspectorProps) {
  const sorted = useMemo(() => [...traces].sort((a, b) => b.createdAt - a.createdAt), [traces]);
  const latestValidation = useMemo(
    () =>
      [...validations].sort(
        (left, right) => right.deckVersion - left.deckVersion || right.checkedAt - left.checkedAt,
      )[0],
    [validations],
  );
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [density, setDensity] = useState<TraceDensity>('human');
  const selected = sorted.find((trace) => trace.id === selectedTraceId) ?? sorted[0];
  const patch = selected?.patchId
    ? patches.find((candidate) => candidate.id === selected.patchId)
    : undefined;
  const traceValidation: TraceValidation | null =
    selected?.validation ?? patch?.candidateValidation ?? null;

  return (
    <div className="ns-inspector-scroll ns-trace-inspector">
      <section className="ns-inspector-section ns-trace-intro">
        <div className="ns-section-title-row">
          <div>
            <span className="ns-eyebrow">Accountability</span>
            <h2>Agent trace</h2>
          </div>
          <div className="ns-trace-density" role="tablist" aria-label="Trace detail level">
            <DensityButton
              active={density === 'human'}
              icon={<Eye size={11} />}
              label="Human"
              onClick={() => setDensity('human')}
            />
            <DensityButton
              active={density === 'pro'}
              icon={<Gauge size={11} />}
              label="Pro"
              onClick={() => setDensity('pro')}
            />
            <DensityButton
              active={density === 'tech'}
              icon={<Braces size={11} />}
              label="Tech"
              onClick={() => setDensity('tech')}
            />
          </div>
        </div>
        <p>Follow the chain from model intent to validation and the human commit boundary.</p>
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
          <p>AI edit plans, receipts, and tool calls will appear after the first proposal.</p>
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
            <article
              className={`ns-trace-summary ${isFallbackTrace(selected) ? 'is-fallback' : ''}`}
            >
              <TraceHeader trace={selected} patch={patch} validation={traceValidation} />

              {density === 'human' ? (
                <HumanReceipt trace={selected} patch={patch} validation={traceValidation} />
              ) : null}

              {density === 'pro' ? (
                <ProReceipt trace={selected} patch={patch} validation={traceValidation} />
              ) : null}

              {density === 'tech' ? (
                <TechReceipt trace={selected} patch={patch} validation={traceValidation} />
              ) : null}

              {traceValidation && traceValidation.id !== latestValidation?.id ? (
                <ValidationSummary validation={traceValidation} label="Selected trace validation" />
              ) : null}
            </article>
          ) : null}
        </>
      )}
    </div>
  );
}

function DensityButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? 'is-active' : ''}
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function TraceHeader({
  trace,
  patch,
  validation,
}: {
  trace: AgentTrace;
  patch: DeckPatch | undefined;
  validation: TraceValidation | null;
}) {
  const fallback = isFallbackTrace(trace);
  return (
    <header className="ns-trace-receipt-head">
      <div className="ns-trace-status">
        <span className={`ns-status-dot ns-status-dot--${trace.status}`} />
        <span>
          <strong>{trace.summary}</strong>
          <small>
            {humanize(trace.status)} · {formatDate(trace.createdAt)}
          </small>
        </span>
      </div>
      <div className="ns-trace-state-strip" aria-label="Trace status">
        <StateBadge tone={fallback ? 'warning' : 'agent'}>
          {fallback ? 'Provisional fallback' : 'Agent run'}
        </StateBadge>
        <StateBadge tone={validation?.ok ? 'success' : validation ? 'danger' : 'neutral'}>
          {validation?.ok ? 'Validated' : validation ? 'Issues found' : 'Not validated'}
        </StateBadge>
        <StateBadge tone={patchTone(patch)}>{patchDecision(patch)}</StateBadge>
      </div>
      <div className="ns-trace-stats">
        <span title="Provider and model">
          <Cpu size={12} /> {modelAttribution(trace)}
        </span>
        <span>
          <Clock3 size={12} /> {trace.patchId ? 'Review cycle' : 'Run'} {duration(trace)}
        </span>
        {trace.costMicroUsd !== undefined ? (
          <span>
            <CircleDollarSign size={12} /> {formatCost(trace.costMicroUsd)}
          </span>
        ) : null}
      </div>
    </header>
  );
}

function HumanReceipt({
  trace,
  patch,
  validation,
}: {
  trace: AgentTrace;
  patch: DeckPatch | undefined;
  validation: TraceValidation | null;
}) {
  return (
    <>
      <section className="ns-trace-signers" aria-label="Countersigned receipt">
        <Signer
          tone={isFallbackTrace(trace) ? 'warning' : 'agent'}
          label="Agent"
          value={isFallbackTrace(trace) ? 'Fallback disclosed' : (trace.model ?? 'Model recorded')}
          detail={trace.candidateDigest ? shortDigest(trace.candidateDigest) : 'Candidate prepared'}
        />
        <Signer
          tone={validation?.ok ? 'success' : validation ? 'danger' : 'neutral'}
          label="Validator"
          value={validation ? validationFlags(validation) : 'No receipt'}
          detail={validation?.toolchainVersion ?? 'Awaiting validation'}
        />
        <Signer
          tone={patchTone(patch)}
          label="Human"
          value={patchDecision(patch)}
          detail={patch ? `Patch ${shortDigest(patch.id)}` : 'No mutation attached'}
        />
      </section>

      <section className="ns-custody-chain">
        <h3>Chain of custody</h3>
        <CustodyStep
          index="01"
          label="Read"
          value={
            trace.context.length > 0
              ? `${trace.context.length} bounded context reference${trace.context.length === 1 ? '' : 's'}`
              : 'No additional context recorded'
          }
          tone="agent"
        />
        <CustodyStep
          index="02"
          label="Plan"
          value={`${trace.plan.length} explicit step${trace.plan.length === 1 ? '' : 's'}`}
          tone="agent"
        />
        <CustodyStep
          index="03"
          label="Candidate"
          value={
            patch
              ? `${patch.operations.length} scoped operation${patch.operations.length === 1 ? '' : 's'}`
              : 'Run produced no mutable patch'
          }
          tone={isFallbackTrace(trace) ? 'warning' : 'agent'}
        />
        <CustodyStep
          index="04"
          label="Validate"
          value={validation ? validationFlags(validation) : 'Validation receipt unavailable'}
          tone={validation?.ok ? 'success' : validation ? 'danger' : 'neutral'}
        />
        <CustodyStep
          index="05"
          label="Human decision"
          value={patchDecision(patch)}
          tone={patchTone(patch)}
          last
        />
      </section>
    </>
  );
}

function ProReceipt({
  trace,
  patch,
  validation,
}: {
  trace: AgentTrace;
  patch: DeckPatch | undefined;
  validation: TraceValidation | null;
}) {
  return (
    <>
      <div className="ns-trace-token-grid">
        <Metric label="Input" value={formatInteger(trace.inputTokens)} suffix="tokens" />
        <Metric label="Output" value={formatInteger(trace.outputTokens)} suffix="tokens" />
        <Metric label="Cost" value={formatCost(trace.costMicroUsd)} />
        <Metric label="Ops" value={String(patch?.operations.length ?? 0)} />
      </div>
      <TraceList icon={<Eye size={13} />} title="Context read" items={trace.context} />
      <TraceList icon={<Bot size={13} />} title="Plan" items={trace.plan} numbered />
      <TraceList icon={<Wrench size={13} />} title="Tools" items={trace.toolCalls} />
      <TraceList icon={<ShieldCheck size={13} />} title="Guardrails" items={trace.guardrails} />
      {validation ? (
        <div className="ns-trace-proof-line">
          <CheckCircle2 size={14} />
          <span>
            <strong>{validationFlags(validation)}</strong>
            <small>{validation.toolchainVersion}</small>
          </span>
        </div>
      ) : null}
    </>
  );
}

function TechReceipt({
  trace,
  patch,
  validation,
}: {
  trace: AgentTrace;
  patch: DeckPatch | undefined;
  validation: TraceValidation | null;
}) {
  return (
    <>
      <section className="ns-trace-attributes">
        <h3>
          <Fingerprint size={13} /> Provenance attributes
        </h3>
        <dl>
          <ReceiptRow label="trace.id" value={trace.id} />
          <ReceiptRow label="patch.id" value={patch?.id ?? trace.patchId} />
          <ReceiptRow label="provider" value={trace.provider} />
          <ReceiptRow label="model" value={trace.model} />
          <ReceiptRow label="usage.input_tokens" value={formatInteger(trace.inputTokens)} />
          <ReceiptRow label="usage.output_tokens" value={formatInteger(trace.outputTokens)} />
          <ReceiptRow label="usage.cost" value={formatCost(trace.costMicroUsd)} />
          <ReceiptRow
            label="candidate.digest"
            value={trace.candidateDigest ?? patch?.candidateDigest}
          />
          <ReceiptRow label="planning.input_digest" value={trace.planningInputDigest} />
          <ReceiptRow label="planning.snapshot_digest" value={trace.planningSnapshotDigest} />
          <ReceiptRow
            label="shadow.expected"
            value={formatBoolean(trace.shadowComparisonExpected)}
          />
          <ReceiptRow label="shadow.controls_digest" value={trace.shadowControlsDigest} />
          <ReceiptRow label="validation.id" value={validation?.id} />
          <ReceiptRow label="validation.toolchain" value={validation?.toolchainVersion} />
          <ReceiptRow label="human.decision" value={patchDecision(patch)} />
        </dl>
      </section>
      <details className="ns-raw-trace">
        <summary>
          <Code2 size={13} /> Raw JSON <span>trace + patch</span>
        </summary>
        <pre>{JSON.stringify({ trace, patch: patch ?? null }, null, 2)}</pre>
      </details>
    </>
  );
}

function StateBadge({
  tone,
  children,
}: {
  tone: 'agent' | 'success' | 'warning' | 'danger' | 'human' | 'neutral';
  children: ReactNode;
}) {
  return <span className={`ns-trace-badge is-${tone}`}>{children}</span>;
}

function Signer({
  tone,
  label,
  value,
  detail,
}: {
  tone: 'agent' | 'success' | 'warning' | 'danger' | 'human' | 'neutral';
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className={`ns-trace-signer is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function CustodyStep({
  index,
  label,
  value,
  tone,
  last = false,
}: {
  index: string;
  label: string;
  value: string;
  tone: 'agent' | 'success' | 'warning' | 'danger' | 'human' | 'neutral';
  last?: boolean;
}) {
  return (
    <div className={`ns-custody-step is-${tone} ${last ? 'is-last' : ''}`}>
      <span className="ns-custody-node">{index}</span>
      <span>
        <strong>{label}</strong>
        <small>{value}</small>
      </span>
    </div>
  );
}

function Metric({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
      {suffix ? <small>{suffix}</small> : null}
    </div>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd title={value}>{value || 'not recorded'}</dd>
    </div>
  );
}

function TraceList({
  icon,
  title,
  items,
  numbered = false,
}: {
  icon: ReactNode;
  title: string;
  items: readonly string[];
  numbered?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <section className="ns-trace-list">
      <h3>
        {icon}
        {title}
      </h3>
      <ol className={numbered ? 'is-numbered' : ''}>
        {items.map((item, index) => (
          <li key={`${index}-${item}`}>
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
  validation: TraceValidation;
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

function isFallbackTrace(trace: AgentTrace): boolean {
  return /fallback|deterministic/i.test(`${trace.provider ?? ''} ${trace.model ?? ''}`);
}

function modelAttribution(trace: AgentTrace): string {
  const model = trace.model ?? 'Automatic model';
  return trace.provider ? `${trace.provider} · ${model}` : model;
}

function patchDecision(patch: DeckPatch | undefined): string {
  if (!patch) return 'No mutation';
  if (patch.status === 'accepted') return 'Applied';
  if (patch.status === 'rejected') return 'Rejected';
  if (patch.status === 'stale') return 'Stale · not applied';
  return 'Awaiting review · not applied';
}

function patchTone(
  patch: DeckPatch | undefined,
): 'agent' | 'success' | 'warning' | 'danger' | 'human' | 'neutral' {
  if (!patch) return 'neutral';
  if (patch.status === 'accepted') return 'success';
  if (patch.status === 'rejected' || patch.status === 'stale') return 'danger';
  return 'human';
}

function validationFlags(validation: TraceValidation): string {
  return `ok ${flag(validation.ok)} · publish ${flag(validation.publishOk)} · clean ${flag(validation.cleanOk)}`;
}

function flag(value: boolean): string {
  return value ? '✓' : '×';
}

function shortDigest(value: string): string {
  return value.length <= 22 ? value : `${value.slice(0, 13)}…${value.slice(-7)}`;
}

function formatInteger(value: number | undefined): string {
  return value === undefined ? 'not recorded' : new Intl.NumberFormat().format(value);
}

function formatBoolean(value: boolean | undefined): string {
  return value === undefined ? 'not recorded' : value ? 'true' : 'false';
}

function formatCost(value: number | undefined): string {
  if (value === undefined) return 'not recorded';
  if (value === 0) return '$0.0000';
  return `$${(value / 1_000_000).toFixed(4)}`;
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
