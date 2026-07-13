import {
  Activity,
  BookOpen,
  Braces,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleDollarSign,
  Clock3,
  Copy,
  Cpu,
  Eye,
  Fingerprint,
  Gauge,
  ListTree,
  type LucideIcon,
  Pencil,
  Receipt,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react';
import { type CSSProperties, type ReactNode, useMemo, useState } from 'react';
import {
  type AgentTrace,
  type CandidateValidationReceipt,
  type DeckPatch,
  type NodeSlideAgentMessage,
  type NodeSlideAgentRun,
  type ValidationIssue,
  type ValidationResult,
  nodeSlideReasoningEffort,
} from '../../../../shared/nodeslide';

/*
 * NodeSlide Trace tab — chain-of-custody rail + Countersigned tri-signature seal.
 * Presentational refactor over the existing AgentTrace / ValidationResult /
 * CandidateValidationReceipt / DeckPatch props. No schema or backend change.
 * Visual language (rail spine, typed badges, color-handoff) is inspired by
 * Agent Prism by Evil Martians (MIT) — referenced, not imported; re-anchored to
 * NodeSlide's own --ns-* V3 tokens.
 */

export type TraceDensity = 'human' | 'pro' | 'tech';
type TraceValidation = ValidationResult | CandidateValidationReceipt;
type ToneName = 'agent' | 'success' | 'warning' | 'danger' | 'human' | 'neutral';
export type TraceNodeId = 'consent' | 'read' | 'plan' | 'edits' | 'validate' | 'receipt';
type NodeInk = 'human' | 'agent';

interface TraceInspectorProps {
  traces: readonly AgentTrace[];
  validations: readonly ValidationResult[];
  patches?: readonly DeckPatch[];
  agentRuns?: readonly NodeSlideAgentRun[];
  agentMessages?: readonly NodeSlideAgentMessage[];
}

const DENSITY_KEY = 'ns-trace-density';

const NODE_ORDER: TraceNodeId[] = ['consent', 'read', 'plan', 'edits', 'validate', 'receipt'];
const NODE_META: Record<TraceNodeId, { label: string; ink: NodeInk; Icon: LucideIcon }> = {
  consent: { label: 'Consent', ink: 'human', Icon: CheckCircle2 },
  read: { label: 'Read', ink: 'agent', Icon: BookOpen },
  plan: { label: 'Plan', ink: 'agent', Icon: ListTree },
  edits: { label: 'Edits', ink: 'agent', Icon: Pencil },
  validate: { label: 'Validate', ink: 'human', Icon: ShieldCheck },
  receipt: { label: 'Receipt', ink: 'human', Icon: Receipt },
};

// ---------------------------------------------------------------------------
// Top-level inspector
// ---------------------------------------------------------------------------

export function TraceInspector({
  traces,
  validations,
  patches = [],
  agentRuns = [],
  agentMessages = [],
}: TraceInspectorProps) {
  const sorted = useMemo(() => [...traces].sort((a, b) => b.createdAt - a.createdAt), [traces]);
  const latestValidation = useMemo(
    () =>
      [...validations].sort(
        (left, right) => right.deckVersion - left.deckVersion || right.checkedAt - left.checkedAt,
      )[0],
    [validations],
  );
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [density, setDensityState] = useState<TraceDensity>(() => readDensity());
  const [openByTrace, setOpenByTrace] = useState<Record<string, TraceNodeId | null>>({});

  const setDensity = (next: TraceDensity) => {
    setDensityState(next);
    persistDensity(next);
  };

  const selected = sorted.find((trace) => trace.id === selectedTraceId) ?? sorted[0];
  const patch = selected?.patchId
    ? patches.find((candidate) => candidate.id === selected.patchId)
    : undefined;
  const traceValidation: TraceValidation | null =
    selected?.validation ?? patch?.candidateValidation ?? null;

  const openNode: TraceNodeId | null = selected ? (openByTrace[selected.id] ?? null) : null;
  const toggleNode = (id: TraceNodeId) => {
    if (!selected) return;
    setOpenByTrace((prev) => {
      const current = prev[selected.id] ?? null;
      return { ...prev, [selected.id]: current === id ? null : id };
    });
  };

  return (
    <div className="ns-inspector-scroll ns-trace-inspector">
      <section className="ns-inspector-section ns-trace-intro">
        <div className="ns-section-title-row">
          <div>
            <span className="ns-eyebrow">Run trace</span>
            <h2>What happened</h2>
          </div>
          <div className="ns-trace-density" role="tablist" aria-label="Trace detail level">
            <DensityButton
              active={density === 'human'}
              icon={<Eye size={11} />}
              label="Summary"
              onClick={() => setDensity('human')}
            />
            <DensityButton
              active={density === 'pro'}
              icon={<Gauge size={11} />}
              label="Details"
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
        <p>
          Follow one chain of custody — who authorized, what the agent read, planned and wrote, and
          the human-owned proof that binds it. A degraded link never hides.
        </p>
      </section>

      {latestValidation ? (
        <ValidationSummary validation={latestValidation} label="Current deck validation" />
      ) : null}

      {agentRuns.length > 0 ? (
        <details className="ns-run-journal" aria-label="Durable agent run journal">
          <summary className="ns-section-heading">
            <span>
              <Activity size={13} /> Run journal
            </span>
            <small>{agentRuns.length} server persisted</small>
            <ChevronRight size={13} />
          </summary>
          <div className="ns-run-journal-list">
            {[...agentRuns].slice(0, 6).map((run) => {
              const tools = agentMessages.filter(
                (message) => message.runId === run.id && message.role === 'tool',
              );
              return (
                <article key={run.id} className={`ns-run-journal-row is-${run.status}`}>
                  <div>
                    <span className={`ns-status-dot ns-status-dot--${run.status}`} />
                    <strong>{humanize(run.status)}</strong>
                    <time dateTime={new Date(run.updatedAt).toISOString()}>
                      {formatRunTime(run.updatedAt)}
                    </time>
                  </div>
                  <p>{run.instruction}</p>
                  <div className="ns-run-journal-meta">
                    <span>
                      {run.provider} · {run.model}
                    </span>
                    <span>{run.webResearch ? 'Web consented' : 'No web egress'}</span>
                    <span>
                      {tools.length} tool event{tools.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {tools.length > 0 ? (
                    <ul>
                      {tools.map((message) => (
                        <li key={message.id}>
                          {message.toolName ?? 'tool'} · {message.content}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </article>
              );
            })}
          </div>
        </details>
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
            <span>Run</span>
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
              <TraceBanner trace={selected} validation={traceValidation} />
              <CustodyRail
                trace={selected}
                patch={patch}
                validation={traceValidation}
                density={density}
                openNode={openNode}
                onToggle={toggleNode}
              />
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

// ---------------------------------------------------------------------------
// Banner (run masthead)
// ---------------------------------------------------------------------------

function TraceBanner({
  trace,
  validation,
}: {
  trace: AgentTrace;
  validation: TraceValidation | null;
}) {
  const fallback = isFallbackTrace(trace);
  const billedAttempt = hasProviderAttemptTelemetry(trace);
  return (
    <header className="ns-trace-banner">
      <div className="ns-trace-banner-top">
        <span className={`ns-status-dot ns-status-dot--${trace.status}`} />
        <span className="ns-trace-banner-title">{statusLabel(trace.status)}</span>
        <span className="ns-trace-banner-ver">
          deck {validation ? `v${validation.deckVersion}` : 'unversioned'}
        </span>
      </div>
      <div className="ns-trace-banner-meta">
        <span className="ns-metanum">
          <Clock3 size={11} />
          <b>{duration(trace)}</b> {trace.patchId ? 'Review cycle' : 'Run'}
        </span>
        <span className="ns-metanum">
          <CircleDollarSign size={11} />
          <b>{formatCost(trace.costMicroUsd)}</b>
          {fallback
            ? billedAttempt
              ? ' · provider attempt billed'
              : ' · no provider billing recorded'
            : ''}
        </span>
      </div>
      <div
        className={`ns-trace-attrib ${fallback ? 'is-fallback' : 'is-live'}`}
        title="provider · model · reasoning effort attribution"
      >
        <span className="ns-trace-attrib-dot" />
        <Cpu size={11} />
        <span>{modelAttribution(trace)}</span>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Custody rail
// ---------------------------------------------------------------------------

export function CustodyRail({
  trace,
  patch,
  validation,
  density,
  openNode,
  onToggle,
}: {
  trace: AgentTrace;
  patch: DeckPatch | undefined;
  validation: TraceValidation | null;
  density: TraceDensity;
  openNode: TraceNodeId | null;
  onToggle: (id: TraceNodeId) => void;
}) {
  const fallback = isFallbackTrace(trace);
  return (
    <div className="ns-custody-rail" aria-label="Chain of custody">
      {NODE_ORDER.map((node, index) => (
        <RailNode
          key={node}
          node={node}
          index={index}
          trace={trace}
          patch={patch}
          validation={validation}
          density={density}
          fallback={fallback}
          open={openNode === node}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

function RailNode({
  node,
  index,
  trace,
  patch,
  validation,
  density,
  fallback,
  open,
  onToggle,
}: {
  node: TraceNodeId;
  index: number;
  trace: AgentTrace;
  patch: DeckPatch | undefined;
  validation: TraceValidation | null;
  density: TraceDensity;
  fallback: boolean;
  open: boolean;
  onToggle: (id: TraceNodeId) => void;
}) {
  const meta = NODE_META[node];
  const previousNode = index > 0 ? NODE_ORDER[index - 1] : undefined;
  const prevMeta = previousNode ? NODE_META[previousNode] : null;
  const isLast = index === NODE_ORDER.length - 1;
  const broken = fallback && node === 'read';
  const showChips = density !== 'human';

  const markerClasses = ['ns-rail-marker', `is-${meta.ink}`];
  if (node === 'receipt') {
    markerClasses.push('is-terminal');
    if (trace.status === 'awaiting_review') markerClasses.push('is-outline');
  }

  const chip = showChips ? railSealChip(node, trace) : null;

  return (
    <div className={`ns-rail-node ${open ? 'is-open' : ''}`} data-node={node}>
      <button
        type="button"
        className="ns-railnode-toggle"
        aria-expanded={open}
        aria-label={`${meta.label} — ${open ? 'collapse' : 'expand'}`}
        onClick={() => onToggle(node)}
      >
        <span className="ns-rail-line">
          {index > 0 ? (
            <span
              className={`ns-rail-seg is-top ${broken ? 'is-broken' : ''}`}
              style={segStyle(prevMeta?.ink ?? 'human')}
            />
          ) : null}
          {!isLast ? <span className="ns-rail-seg is-bot" style={segStyle(meta.ink)} /> : null}
          <span className={markerClasses.join(' ')} style={segStyle(meta.ink)} />
        </span>
        <span className="ns-rail-content">
          <span className="ns-rail-head">
            <span className={`ns-rail-badge is-${meta.ink}`}>
              <meta.Icon size={12} />
              {meta.label}
            </span>
            {chip ? (
              chip.value ? (
                <span className="ns-rail-chip" title={`${chip.label}: ${chip.value}`}>
                  {shortDigest(chip.value)}
                </span>
              ) : (
                <span className="ns-rail-chip is-empty" title={`${chip.label} — not sealed`}>
                  — unsealed
                </span>
              )
            ) : null}
            <ChevronRight className="ns-rail-chevron" size={14} />
          </span>
          <span className="ns-rail-summary">
            {nodeSummary(node, trace, patch, validation, fallback)}
          </span>
        </span>
      </button>
      {open ? (
        <div className="ns-rail-detail">
          <NodeDetail
            node={node}
            trace={trace}
            patch={patch}
            validation={validation}
            density={density}
          />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-node detail tables
// ---------------------------------------------------------------------------

function NodeDetail({
  node,
  trace,
  patch,
  validation,
  density,
}: {
  node: TraceNodeId;
  trace: AgentTrace;
  patch: DeckPatch | undefined;
  validation: TraceValidation | null;
  density: TraceDensity;
}) {
  const pro = density !== 'human';
  const tech = density === 'tech';

  if (node === 'consent') {
    const consent = consentSentence(trace);
    return (
      <div className="ns-attr-table">
        <AttrRow label="status" value={humanize(trace.status)} mono />
        <AttrRow
          label={consent.verbatim ? 'consent (recorded)' : 'consent'}
          stacked
          valueNode={
            consent.verbatim ? (
              <p className="ns-consent-quote">“{consent.text}”</p>
            ) : (
              <div>
                <p className="ns-consent-derived">{consent.text}</p>
                <span className="ns-attr-note">
                  derived from status · no named signer on record
                </span>
              </div>
            )
          }
        />
      </div>
    );
  }

  if (node === 'read') {
    return (
      <div className="ns-attr-table">
        <AttrRow
          label="context[]"
          stacked
          valueNode={<BulletList items={trace.context} empty="No context recorded" />}
        />
        {pro ? (
          <AttrRow
            label="planningInputDigest"
            mono
            valueNode={
              trace.planningInputDigest ? (
                <span>{trace.planningInputDigest}</span>
              ) : (
                <span className="ns-attr-faint">— not sealed (route degraded)</span>
              )
            }
          />
        ) : null}
      </div>
    );
  }

  if (node === 'plan') {
    return (
      <div className="ns-attr-table">
        <AttrRow
          label="plan[]"
          stacked
          valueNode={<NumberedList items={trace.plan} empty="No plan recorded" />}
        />
        {pro && trace.planningSnapshotDigest ? (
          <AttrRow label="planningSnapshotDigest" mono value={trace.planningSnapshotDigest} />
        ) : null}
      </div>
    );
  }

  if (node === 'edits') {
    return (
      <div className="ns-attr-table">
        <AttrRow
          label="toolCalls[]"
          stacked
          valueNode={<BulletList items={trace.toolCalls} empty="No tool calls recorded" />}
        />
        <AttrRow
          label="guardrails[]"
          stacked
          valueNode={
            <BulletList items={trace.guardrails} empty="No guardrails recorded" tone="success" />
          }
        />
        <AttrRow
          label="patchId"
          mono
          valueNode={
            trace.patchId ? (
              <span>{trace.patchId}</span>
            ) : (
              <span className="ns-attr-faint">— none (creation run)</span>
            )
          }
        />
      </div>
    );
  }

  if (node === 'validate') {
    return (
      <div className="ns-attr-table">
        <AttrRow
          label="validation"
          stacked
          valueNode={
            validation ? (
              <div className="ns-attr-pills">
                <FlagPill ok={validation.ok} label="ok" />
                <FlagPill ok={validation.publishOk} label="publishOk" />
                <FlagPill ok={validation.cleanOk} label="cleanOk" />
              </div>
            ) : (
              <span className="ns-attr-faint">no validation receipt</span>
            )
          }
        />
        {validation && validation.issues.length > 0 ? (
          <AttrRow
            label="issues[]"
            stacked
            valueNode={
              <ul className="ns-issue-list">
                {validation.issues.map((issue) => (
                  <li key={issue.id}>
                    <span className={`ns-issue-chip is-${issue.severity}`}>{issue.severity}</span>
                    <span>
                      {issue.message}
                      {issue.slideId ? <em className="ns-attr-faint"> ({issue.slideId})</em> : null}
                    </span>
                  </li>
                ))}
              </ul>
            }
          />
        ) : null}
        {validation ? (
          <AttrRow label="deckVersion" mono value={`v${validation.deckVersion}`} />
        ) : null}
        {tech && validation ? (
          <AttrRow label="toolchainVersion" mono value={validation.toolchainVersion} />
        ) : null}
      </div>
    );
  }

  // receipt
  return (
    <div className="ns-attr-table ns-receipt-detail">
      <AttrRow
        label="receipt"
        stacked
        valueNode={<Invoice trace={trace} fallback={isFallbackTrace(trace)} />}
      />
      <CountersignSeal trace={trace} patch={patch} validation={validation} density={density} />
      {tech ? <ProvenanceDrawer trace={trace} /> : null}
    </div>
  );
}

function Invoice({ trace, fallback }: { trace: AgentTrace; fallback: boolean }) {
  const billedAttempt = hasProviderAttemptTelemetry(trace);
  return (
    <div className="ns-invoice">
      <span className="ns-invoice-k">tokens</span>
      <span className="ns-invoice-v">{tokenFlow(trace)}</span>
      <span className="ns-invoice-k">cost</span>
      <span className={`ns-invoice-v ${fallback ? 'is-warn' : 'is-live'}`}>
        {fallback
          ? billedAttempt
            ? `${formatCost(trace.costMicroUsd)} · provider attempt before fallback`
            : '$0.0000 · no provider billing recorded'
          : formatCost(trace.costMicroUsd)}
      </span>
      <span className="ns-invoice-k">duration</span>
      <span className="ns-invoice-v">{duration(trace)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The seal — the one loud object
// ---------------------------------------------------------------------------

export function CountersignSeal({
  trace,
  patch,
  validation,
  density,
}: {
  trace: AgentTrace;
  patch: DeckPatch | undefined;
  validation: TraceValidation | null;
  density: TraceDensity;
}) {
  const model = buildSealModel(trace, patch, validation, density);
  const [announce, setAnnounce] = useState('');

  return (
    <section className={`ns-seal is-${model.variant}`} aria-label="Countersigned receipt">
      <div className="ns-seal-title">
        <span>{model.title}</span>
        {model.stamp ? (
          <span
            className="ns-seal-stamp"
            title="Interpretation of run state, not a stored status enum"
          >
            <TriangleAlert size={11} />
            {model.stamp}
          </span>
        ) : null}
      </div>

      <div className="ns-seal-signer is-agent">
        <span className="ns-seal-glyph ns-seal-diamond" aria-hidden="true" />
        <div className="ns-seal-body">
          <div className="ns-seal-role">Agent</div>
          <div className="ns-seal-value">{model.agent.value}</div>
          {model.agent.digestFull ? (
            <div className="ns-seal-digest">
              <span className="ns-seal-hash" title={model.agent.digestFull}>
                {model.agent.digestShort}
              </span>
              <CopyButton
                value={model.agent.digestFull}
                onCopied={() => announceCopy(setAnnounce)}
              />
            </div>
          ) : model.agent.annotation ? (
            <div className="ns-seal-sub is-annot">{model.agent.annotation}</div>
          ) : null}
        </div>
      </div>

      <div className="ns-seal-signer is-validator">
        <span className="ns-seal-glyph">
          {model.validator.kind === 'failed' ? <X size={15} /> : <Check size={15} />}
        </span>
        <div className="ns-seal-body">
          <div className="ns-seal-role">Validator</div>
          {model.validator.kind === 'ok' ? (
            <>
              <div className="ns-seal-ticks">
                <span className="ns-seal-tick">
                  <Check size={11} /> ok
                </span>
                <span className={`ns-seal-tick ${model.validator.publishOk ? '' : 'is-off'}`}>
                  {model.validator.publishOk ? <Check size={11} /> : <X size={11} />} publish
                </span>
                <span className={`ns-seal-tick ${model.validator.cleanOk ? '' : 'is-off'}`}>
                  {model.validator.cleanOk ? <Check size={11} /> : <X size={11} />} clean
                </span>
              </div>
              <div className="ns-seal-sub">deck v{model.validator.deckVersion}</div>
              {model.validator.toolchainVersion ? (
                <div className="ns-seal-sub is-mono">{model.validator.toolchainVersion}</div>
              ) : null}
            </>
          ) : model.validator.kind === 'failed' ? (
            <>
              <div className="ns-seal-sub">
                {model.validator.issueCount} issue(s) · deck v{model.validator.deckVersion}
              </div>
              <ul className="ns-seal-issues">
                {model.validator.issues.map((issue) => (
                  <li key={issue.id}>
                    <span className={`ns-issue-chip is-${issue.severity}`}>{issue.severity}</span>
                    <span>
                      {issue.message}
                      {issue.slideId ? <em className="ns-attr-faint"> ({issue.slideId})</em> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="ns-seal-sub is-annot">no validation receipt attached</div>
          )}
        </div>
      </div>

      <div className="ns-seal-signer is-human">
        <span className="ns-seal-glyph">
          <Circle size={14} />
        </span>
        <div className="ns-seal-body">
          <div className="ns-seal-role">Human</div>
          <div className="ns-seal-value">{model.human.value}</div>
          {model.human.sub ? <div className="ns-seal-sub is-annot">{model.human.sub}</div> : null}
        </div>
      </div>

      <div className="ns-seal-edge" aria-hidden="true" />
      <output className="ns-sr-only" aria-live="polite">
        {announce}
      </output>
    </section>
  );
}

function CopyButton({ value, onCopied }: { value: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`ns-seal-copy ${copied ? 'is-copied' : ''}`}
      data-copy={value}
      title="Copy full digest"
      aria-label="Copy full digest"
      onClick={(event) =>
        copyDigest(event, value, (ok) => {
          if (!ok) return;
          setCopied(true);
          onCopied?.();
          setTimeout(() => setCopied(false), 1200);
        })
      }
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

function ProvenanceDrawer({ trace }: { trace: AgentTrace }) {
  const rows: Array<[string, string]> = [];
  if (trace.candidateDigest) rows.push(['candidate', trace.candidateDigest]);
  if (trace.planningInputDigest) rows.push(['plan.input', trace.planningInputDigest]);
  if (trace.planningSnapshotDigest) rows.push(['plan.snap', trace.planningSnapshotDigest]);
  if (trace.shadowControlsDigest) rows.push(['shadow.ctl', trace.shadowControlsDigest]);

  return (
    <div className="ns-provbox">
      <div className="ns-provbox-label">
        <Fingerprint size={12} /> Provenance <span className="ns-provbox-count">{rows.length}</span>
      </div>
      {trace.shadowComparisonExpected !== undefined ? (
        <div className="ns-prov-row is-flag">
          <span className="ns-prov-k">shadow.expected</span>
          <span className="ns-prov-v">{String(trace.shadowComparisonExpected)}</span>
        </div>
      ) : null}
      {rows.length > 0 ? (
        rows.map(([key, value]) => (
          <div className="ns-prov-row" key={key}>
            <span className="ns-prov-k">{key}</span>
            <span className="ns-prov-v" title={value}>
              {shortDigest(value)}
            </span>
            <CopyButton value={value} />
          </div>
        ))
      ) : (
        <p className="ns-prov-empty">
          No standalone provenance digests recorded for this
          {isFallbackTrace(trace)
            ? ' fallback run — the deterministic build produced no candidate receipt.'
            : ' trace.'}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Seal model — PURE function of (trace, patch, validation, density).
// This is the state-honest matrix; the truth-table tests bind to it directly.
// ---------------------------------------------------------------------------

export type SealVariant = 'live' | 'fallback' | 'failed';

export interface SealModel {
  variant: SealVariant;
  title: string;
  stamp: 'provisional' | 'blocked' | null;
  agent: { value: string; digestFull?: string; digestShort?: string; annotation?: string };
  validator:
    | {
        kind: 'ok';
        publishOk: boolean;
        cleanOk: boolean;
        deckVersion: number;
        toolchainVersion?: string;
      }
    | { kind: 'failed'; issueCount: number; deckVersion: number; issues: ValidationIssue[] }
    | { kind: 'none' };
  human: { value: string; sub?: string };
}

export function buildSealModel(
  trace: AgentTrace,
  patch: DeckPatch | undefined,
  validation: TraceValidation | null,
  density: TraceDensity,
): SealModel {
  const fallback = isFallbackTrace(trace);
  const failed = !!validation && !validation.ok;
  const variant: SealVariant = failed ? 'failed' : fallback ? 'fallback' : 'live';
  const revealDigest = density !== 'human';
  const showToolchain = density === 'tech';

  // AGENT — bound to trace.model + candidateDigest; never invents a hash.
  let agent: SealModel['agent'];
  if (fallback) {
    agent = {
      value: 'deterministic fallback',
      annotation: 'no candidate receipt — hash not invented',
    };
  } else if (failed) {
    // A rejected candidate must not present a sealed hash (spec §4a Failed row).
    agent = { value: trace.model ?? 'Model recorded' };
  } else {
    const digest = trace.candidateDigest ?? patch?.candidateDigest;
    agent = { value: trace.model ?? 'Model recorded' };
    if (digest) {
      if (revealDigest) {
        agent.digestFull = digest;
        agent.digestShort = shortDigest(digest);
      } else {
        agent.annotation = 'candidateDigest sealed · raise depth to reveal';
      }
    }
  }

  // VALIDATOR — honestly green even on fallback (deterministic validation genuinely ran).
  let validator: SealModel['validator'];
  if (!validation) {
    validator = { kind: 'none' };
  } else if (failed) {
    validator = {
      kind: 'failed',
      issueCount: validation.issues.length,
      deckVersion: validation.deckVersion,
      issues: validation.issues,
    };
  } else {
    validator = {
      kind: 'ok',
      publishOk: validation.publishOk,
      cleanOk: validation.cleanOk,
      deckVersion: validation.deckVersion,
      ...(showToolchain && validation.toolchainVersion
        ? { toolchainVersion: validation.toolchainVersion }
        : {}),
    };
  }

  // HUMAN — derived strictly from patch.status (or trace.status when no patch).
  let human: SealModel['human'];
  if (failed) {
    human = { value: 'Blocked — not signable' };
  } else if (fallback) {
    human = { value: 'Not yet signable', sub: 'no candidate to countersign' };
  } else if (!patch) {
    human = { value: 'No review cycle — full generation', sub: 'no human sign-off on record' };
  } else if (patch.status === 'accepted') {
    human = { value: 'Applied' };
  } else if (patch.status === 'rejected') {
    human = { value: 'Rejected' };
  } else if (patch.status === 'stale') {
    human = { value: 'Stale · not applied' };
  } else {
    human = { value: 'Awaiting your review', sub: 'machine countersigned · human has not' };
  }

  return {
    variant,
    title: failed ? 'Validation failed' : 'Countersigned receipt',
    stamp: failed ? 'blocked' : fallback ? 'provisional' : null,
    agent,
    validator,
    human,
  };
}

// ---------------------------------------------------------------------------
// Node summaries — bound to real fields
// ---------------------------------------------------------------------------

export function nodeSummary(
  node: TraceNodeId,
  trace: AgentTrace,
  patch: DeckPatch | undefined,
  validation: TraceValidation | null,
  fallback: boolean,
): string {
  switch (node) {
    case 'consent':
      return consentSentence(trace).text;
    case 'read':
      return `${plural(trace.context.length, 'context reference')} read${
        fallback ? ' — attribution route degraded' : ''
      }`;
    case 'plan':
      return `${trace.plan.length}-step plan drafted`;
    case 'edits': {
      if (fallback)
        return `Deck built deterministically (${plural(trace.toolCalls.length, 'tool call')})`;
      const base = `${plural(trace.toolCalls.length, 'tool call')} · ${plural(
        trace.guardrails.length,
        'guardrail',
      )}`;
      return patch ? `${base} · ${plural(patch.operations.length, 'op')}` : base;
    }
    case 'validate':
      if (!validation) return 'Validation receipt unavailable';
      return validation.ok
        ? `Deterministic validation passed (v${validation.deckVersion})`
        : `${plural(validation.issues.length, 'validation issue')} — candidate rejected`;
    case 'receipt':
      if (fallback) return 'Provisional seal — machine only, not signable';
      if (validation && !validation.ok) return 'Validation failed — blocked, not signable';
      if (trace.status === 'awaiting_review')
        return 'Countersigned by machine — awaiting your signature';
      if (patch?.status === 'accepted') return 'Signed';
      return 'Countersigned';
  }
}

/** Consent is DERIVED — a verbatim consent line from toolCalls if present, else a status phrase. */
export function consentSentence(trace: AgentTrace): { text: string; verbatim: boolean } {
  const line = trace.toolCalls.find((call) => /consent|authoriz/i.test(call));
  if (line) return { text: line, verbatim: true };
  const route = `${trace.provider ?? ''} ${trace.model ?? ''}`;
  if (/deterministic/i.test(route) && !/openrouter/i.test(route)) {
    return { text: 'Consent not required — no external egress', verbatim: false };
  }
  if (/openrouter/i.test(route)) {
    return { text: 'Consent evidence missing', verbatim: false };
  }
  return { text: 'Consent requirement not recorded', verbatim: false };
}

function railSealChip(
  node: TraceNodeId,
  trace: AgentTrace,
): { value?: string; label: string } | null {
  if (node === 'read') return optionalValueChip(trace.planningInputDigest, 'planningInputDigest');
  if (node === 'plan') {
    return optionalValueChip(trace.planningSnapshotDigest, 'planningSnapshotDigest');
  }
  if (node === 'receipt') return optionalValueChip(trace.candidateDigest, 'candidateDigest');
  return null;
}

function optionalValueChip(
  value: string | undefined,
  label: string,
): { value?: string; label: string } {
  return { ...(value ? { value } : {}), label };
}

// ---------------------------------------------------------------------------
// Shared presentational helpers
// ---------------------------------------------------------------------------

function AttrRow({
  label,
  value,
  valueNode,
  mono = false,
  stacked = false,
}: {
  label: string;
  value?: string;
  valueNode?: ReactNode;
  mono?: boolean;
  stacked?: boolean;
}) {
  return (
    <div className={`ns-attr-row ${stacked ? 'is-stacked' : ''}`}>
      <div className="ns-attr-key">{label}</div>
      <div className={`ns-attr-val ${mono ? 'is-mono' : ''}`}>
        {valueNode ?? value ?? 'not recorded'}
      </div>
    </div>
  );
}

function BulletList({
  items,
  empty,
  tone,
}: {
  items: readonly string[];
  empty: string;
  tone?: 'success';
}) {
  if (items.length === 0) return <span className="ns-attr-faint">{empty}</span>;
  return (
    <ul className={`ns-detail-list is-dot ${tone === 'success' ? 'is-success' : ''}`}>
      {items.map((item, index) => (
        <li key={`${index}-${item}`}>{item}</li>
      ))}
    </ul>
  );
}

function NumberedList({ items, empty }: { items: readonly string[]; empty: string }) {
  if (items.length === 0) return <span className="ns-attr-faint">{empty}</span>;
  return (
    <ol className="ns-detail-list is-ordered">
      {items.map((item, index) => (
        <li key={`${index}-${item}`}>{item}</li>
      ))}
    </ol>
  );
}

function FlagPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`ns-flag-pill ${ok ? 'is-ok' : 'is-err'}`}>
      {ok ? <Check size={11} /> : <TriangleAlert size={11} />} {label}
    </span>
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

// ---------------------------------------------------------------------------
// Pure logic + formatters
// ---------------------------------------------------------------------------

/**
 * A degraded run must never render as a live success. `isFallbackTrace` fails
 * CLOSED: any ambiguity resolves to provisional, never live.
 */
export function isFallbackTrace(trace: AgentTrace): boolean {
  // 1. the marker the pipeline writes into the provider/model label.
  if (/fallback|deterministic/i.test(`${trace.provider ?? ''} ${trace.model ?? ''}`)) return true;
  // 2. Any external run presented as completed/awaiting review must carry the
  //    complete live receipt. Missing cost, token flow, or candidate binding is
  //    ambiguous and therefore degrades closed rather than wearing a live badge.
  const external = /openrouter/i.test(`${trace.provider ?? ''} ${trace.model ?? ''}`);
  if (
    external &&
    (trace.status === 'completed' || trace.status === 'awaiting_review') &&
    (!hasProviderAttemptTelemetry(trace) || !trace.candidateDigest)
  ) {
    return true;
  }
  return false;
}

function hasProviderAttemptTelemetry(trace: AgentTrace): boolean {
  return (
    (trace.costMicroUsd ?? 0) > 0 && (trace.inputTokens ?? 0) > 0 && (trace.outputTokens ?? 0) > 0
  );
}

/** Session-persisted trace density; SSR/storage-safe (falls back to 'human'). */
export function readDensity(): TraceDensity {
  try {
    const value =
      typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(DENSITY_KEY) : null;
    return value === 'human' || value === 'pro' || value === 'tech' ? value : 'human';
  } catch {
    return 'human';
  }
}

export function persistDensity(density: TraceDensity): void {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(DENSITY_KEY, density);
  } catch {
    /* storage unavailable — density stays in-memory only */
  }
}

/** Copy the FULL digest and stop the click from toggling the enclosing node. */
export function copyDigest(
  event: { stopPropagation: () => void },
  value: string,
  onDone?: (ok: boolean) => void,
): void {
  event.stopPropagation();
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav?.clipboard?.writeText) {
    nav.clipboard.writeText(value).then(
      () => onDone?.(true),
      () => onDone?.(false),
    );
  } else {
    onDone?.(false);
  }
}

/** Node keydown toggles only when the event target is the node itself. */
export function isSelfToggleKey(event: {
  key: string;
  target: EventTarget | null;
  currentTarget: EventTarget | null;
}): boolean {
  return (event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget;
}

function announceCopy(setAnnounce: (value: string) => void): void {
  setAnnounce('Digest copied to clipboard');
  setTimeout(() => setAnnounce(''), 1500);
}

function segStyle(ink: NodeInk): CSSProperties {
  return {
    ['--ns-seg' as string]: ink === 'human' ? 'var(--ns-trace-human)' : 'var(--ns-trace-agent)',
  } as CSSProperties;
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function statusLabel(status: AgentTrace['status']): string {
  const map: Record<AgentTrace['status'], string> = {
    planning: 'Planning',
    working: 'Working',
    awaiting_review: 'Awaiting review',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };
  return map[status] ?? humanize(status);
}

export function modelAttribution(trace: AgentTrace): string {
  const model = trace.model ?? 'Automatic model';
  const attribution = trace.provider ? `${trace.provider} · ${model}` : model;
  return trace.reasoningEffort
    ? `${attribution} · ${nodeSlideReasoningEffort(trace.reasoningEffort).label} effort`
    : attribution;
}

// Kept from the prior component — real sign-off derivation, honest and reused.
export function patchDecision(patch: DeckPatch | undefined): string {
  if (!patch) return 'No mutation';
  if (patch.status === 'accepted') return 'Applied';
  if (patch.status === 'rejected') return 'Rejected';
  if (patch.status === 'stale') return 'Stale · not applied';
  return 'Awaiting review · not applied';
}

export function patchTone(patch: DeckPatch | undefined): ToneName {
  if (!patch) return 'neutral';
  if (patch.status === 'accepted') return 'success';
  if (patch.status === 'rejected' || patch.status === 'stale') return 'danger';
  return 'human';
}

export function validationFlags(validation: TraceValidation): string {
  return `ok ${flag(validation.ok)} · publish ${flag(validation.publishOk)} · clean ${flag(
    validation.cleanOk,
  )}`;
}

function flag(value: boolean): string {
  return value ? '✓' : '×';
}

export function shortDigest(value: string): string {
  return value.length <= 22 ? value : `${value.slice(0, 13)}…${value.slice(-7)}`;
}

export function formatInteger(value: number | undefined): string {
  return value === undefined ? 'not recorded' : new Intl.NumberFormat().format(value);
}

function tokenFlow(trace: AgentTrace): string {
  if (trace.inputTokens === undefined && trace.outputTokens === undefined) return '— → —';
  return `${formatInteger(trace.inputTokens)} → ${formatInteger(trace.outputTokens)}`;
}

export function formatCost(value: number | undefined): string {
  if (value === undefined) return 'not recorded';
  if (value === 0) return '$0.0000';
  return `$${(value / 1_000_000).toFixed(4)}`;
}

function duration(trace: AgentTrace): string {
  if (!trace.completedAt) return humanize(trace.status);
  const seconds = Math.max(1, Math.round((trace.completedAt - trace.createdAt) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function formatRunTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    timestamp,
  );
}
