import { CheckCircle2, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { PreferenceSignal, TasteProfile } from '../../../../shared/nodeslidePreference';

interface TasteProfileCardProps {
  profile: TasteProfile | null;
  loading: boolean;
  onEvictSignal: (signalId: string) => void;
  onOpenEvidence: ((eventId: string) => void) | undefined;
}

export function TasteProfileCard({
  profile,
  loading,
  onEvictSignal,
  onOpenEvidence,
}: TasteProfileCardProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const signals = profile?.signals ?? [];
  return (
    <section className="ns-inspector-section ns-taste-profile" data-testid="taste-profile-card">
      <div className="ns-section-title-row">
        <div>
          <span className="ns-eyebrow">Evidence-backed memory</span>
          <h2>Your taste ledger</h2>
        </div>
        <span className="ns-kind-pill">{signals.length} signals</span>
      </div>
      {loading ? <p>Loading tenant-local preference evidence…</p> : null}
      {!loading && signals.length === 0 ? (
        <p>
          NodeSlide hasn&apos;t learned your taste yet — it learns only from what you select,
          accept, decline, and export.
        </p>
      ) : null}
      {signals.length > 0 ? (
        <div className="ns-taste-signal-list">
          {signals.map((signal) => (
            <TasteSignalRow
              key={signal.id}
              signal={signal}
              expanded={expandedId === signal.id}
              confirming={confirmId === signal.id}
              onToggle={() =>
                setExpandedId((current) => (current === signal.id ? null : signal.id))
              }
              onRequestEvict={() => setConfirmId(signal.id)}
              onCancelEvict={() => setConfirmId(null)}
              onConfirmEvict={() => {
                setConfirmId(null);
                onEvictSignal(signal.id);
              }}
              onOpenEvidence={onOpenEvidence}
            />
          ))}
        </div>
      ) : null}
      <p className="ns-taste-profile__scope">
        Private to this project and owner capability. No cross-tenant pooling or training export.
      </p>
    </section>
  );
}

function TasteSignalRow({
  signal,
  expanded,
  confirming,
  onToggle,
  onRequestEvict,
  onCancelEvict,
  onConfirmEvict,
  onOpenEvidence,
}: {
  signal: PreferenceSignal;
  expanded: boolean;
  confirming: boolean;
  onToggle: () => void;
  onRequestEvict: () => void;
  onCancelEvict: () => void;
  onConfirmEvict: () => void;
  onOpenEvidence: ((eventId: string) => void) | undefined;
}) {
  return (
    <article className="ns-taste-signal">
      <button
        type="button"
        className="ns-taste-signal__summary"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span aria-label={signal.polarity}>{signal.polarity === 'positive' ? '＋' : '−'}</span>
        <strong>{signal.value}</strong>
        <small>{signal.dimension.replaceAll('_', ' ')}</small>
        <code>{signal.confidence.toFixed(2)}</code>
      </button>
      {expanded ? (
        <div className="ns-taste-signal__detail">
          <span className="ns-eyebrow">Evaluator receipt</span>
          <div className="ns-taste-checks">
            {Object.entries(signal.evaluator.checks).map(([name, check]) => (
              <span key={name}>
                <CheckCircle2 size={11} /> {name} · {check.passed ? 'passed' : 'failed'}
              </span>
            ))}
          </div>
          <small>{signal.evaluator.evaluatorVersion}</small>
          <div className="ns-taste-evidence">
            {signal.evidenceEventIds.map((eventId) => (
              <button key={eventId} type="button" onClick={() => onOpenEvidence?.(eventId)}>
                {eventId}
              </button>
            ))}
          </div>
          {confirming ? (
            <div className="ns-taste-evict-confirm">
              <span>Remove this learned belief?</span>
              <button type="button" onClick={onConfirmEvict}>
                Remove
              </button>
              <button type="button" onClick={onCancelEvict}>
                Keep
              </button>
            </div>
          ) : (
            <button type="button" className="ns-taste-evict" onClick={onRequestEvict}>
              <Trash2 size={11} /> Remove belief
            </button>
          )}
        </div>
      ) : null}
    </article>
  );
}
