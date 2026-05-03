import { useAction, useMutation, useQuery } from 'convex/react';
import {
  ArrowRight,
  ExternalLink,
  Film,
  ImageIcon,
  Link,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { useT } from '../../lib/i18n';

interface InspirationViewProps {
  runId: Id<'runs'> | null;
}

type MediaPreference = 'auto' | 'images' | 'videos' | 'mixed';

interface InspirationReference {
  id: string;
  product: string;
  title: string;
  sourceUrl: string;
  mediaType: 'image' | 'video' | 'website' | 'case-study';
  thumbnailTone: 'dark' | 'slate' | 'warm' | 'cream' | 'mist' | 'blue' | 'graphite';
  tags: string[];
  patterns: string[];
  useFor: string;
  avoid: string;
  confidence: 'high' | 'medium' | 'low';
  licenseNote: string;
}

interface InspirationPlanItem {
  title: string;
  rationale: string;
  impact: 'High' | 'Medium' | 'Low';
  sourceReferenceIds: string[];
}

interface InspirationReport {
  _id: Id<'inspiration_reports'>;
  query: string;
  mediaPreference: MediaPreference;
  status: 'ready' | 'failed';
  tags: string[];
  diagnosis: string;
  references: InspirationReference[];
  plan: InspirationPlanItem[];
  beforeAfter: {
    currentBullets: string[];
    directionBullets: string[];
  };
  safetyNotes: string[];
  providerMode: 'curated' | 'curated-plus-urls' | 'external-ready';
  appliedAt?: number;
  updatedAt: number;
}

export function InspirationView({ runId }: InspirationViewProps) {
  const t = useT();
  const run = useQuery(api.runs.get, runId ? { runId } : 'skip');
  const latestReport = useQuery(api.inspiration.getLatest, runId ? { runId } : 'skip') as
    | InspirationReport
    | null
    | undefined;
  const runCuratedSearch = useMutation(api.inspiration.runSearch);
  const runLiveSearch = useAction(api.inspirationSearch.runLiveSearch);
  const markApplied = useMutation(api.inspiration.markApplied);
  const startAdviseLoop = useMutation(api.chat.startAdviseLoop);
  const [query, setQuery] = useState('');
  const [referenceUrls, setReferenceUrls] = useState('');
  const [mediaPreference, setMediaPreference] = useState<MediaPreference>('mixed');
  const [selectedReferenceId, setSelectedReferenceId] = useState<string | null>(null);
  const [autoSeededRunId, setAutoSeededRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'search' | 'apply' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const title = run?.title ?? run?.prompt ?? t('app.defaultRunTitle');
  const report = latestReport ?? null;
  const selectedReference = useMemo(() => {
    if (!report) return null;
    return (
      report.references.find((reference) => reference.id === selectedReferenceId) ??
      report.references[0] ??
      null
    );
  }, [report, selectedReferenceId]);

  useEffect(() => {
    if (!runId || latestReport !== null || autoSeededRunId === String(runId)) return;
    setAutoSeededRunId(String(runId));
    void runLiveSearch({ runId, mediaPreference: 'mixed' }).catch(() => {
      void runCuratedSearch({ runId, mediaPreference: 'mixed' }).catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
    });
  }, [runId, latestReport, autoSeededRunId, runLiveSearch, runCuratedSearch]);

  async function handleSearch(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!runId) return;
    setBusy('search');
    setError(null);
    setMessage(null);
    const urls = referenceUrls
      .split(/[\n,]/)
      .map((url) => url.trim())
      .filter(Boolean);
    const searchArgs: {
      runId: Id<'runs'>;
      query?: string;
      referenceUrls?: string[];
      mediaPreference: MediaPreference;
    } = {
      runId,
      mediaPreference,
    };
    const trimmedQuery = query.trim();
    if (trimmedQuery.length > 0) searchArgs.query = trimmedQuery;
    if (urls.length > 0) searchArgs.referenceUrls = urls;
    try {
      const result = await runLiveSearch(searchArgs);
      const providerText =
        result.providersUsed.length > 0
          ? ` Live providers: ${result.providersUsed.join(', ')}.`
          : result.providersConfigured.length > 0
            ? ' Live providers were configured but returned no usable results; curated fallback is included.'
            : ' No live provider keys are configured in Convex env; curated fallback is included.';
      setMessage(
        `Search refreshed. ${result.liveReferenceCount} live references saved.${providerText}`,
      );
    } catch (err) {
      try {
        await runCuratedSearch(searchArgs);
        setMessage(
          'Search refreshed with curated fallback because live provider search was unavailable.',
        );
      } catch {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleApply() {
    if (!runId || !report) return;
    setBusy('apply');
    setError(null);
    setMessage(null);
    try {
      await markApplied({ reportId: report._id });
      await startAdviseLoop({
        runId,
        kind: 'manual',
        prompt: buildApplyPrompt(report, title),
      });
      setMessage(
        'Applied. The agent stream now has a scoped inspiration brief and safety constraints.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        padding: 'var(--space-7)',
        boxSizing: 'border-box',
        background:
          'radial-gradient(circle at 18% 8%, color-mix(in srgb, var(--color-accent) 9%, transparent), transparent 28%), var(--color-background)',
      }}
    >
      <div style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gap: 22 }}>
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 18,
          }}
        >
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', minWidth: 0 }}>
            <span aria-hidden style={heroIconStyle}>
              <Sparkles size={20} />
            </span>
            <div style={{ minWidth: 0 }}>
              <h2 style={titleStyle}>Inspiration workflow</h2>
              <p style={subtitleStyle}>
                Search references, attach image/video URLs, extract reusable patterns, then send a
                safe plan to the agent.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleSearch()}
            disabled={!runId || busy === 'search'}
            style={ghostButtonStyle}
          >
            <RefreshCw
              size={14}
              style={{
                animation: busy === 'search' ? 'pipeline-pulse 1s ease-in-out infinite' : 'none',
              }}
            />
            Re-run search
          </button>
        </header>

        <form onSubmit={handleSearch} style={searchPanelStyle}>
          <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
            <label style={labelStyle} htmlFor="inspiration-query">
              What should Parity look for?
            </label>
            <div style={{ display: 'flex', gap: 10, minWidth: 0 }}>
              <span style={inputIconStyle}>
                <Search size={14} />
              </span>
              <input
                id="inspiration-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="ex: calm dashboard, open-codesign comments, premium left sidebar, Ableton product hero"
                style={inputStyle}
              />
            </div>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) 150px auto',
              gap: 10,
              alignItems: 'end',
            }}
          >
            <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
              <label style={labelStyle} htmlFor="reference-urls">
                Optional reference URLs, image URLs, or video URLs
              </label>
              <textarea
                id="reference-urls"
                value={referenceUrls}
                onChange={(event) => setReferenceUrls(event.target.value)}
                placeholder="Paste one per line. Parity stores provenance but does not hot-load arbitrary private thumbnails."
                style={{ ...inputStyle, minHeight: 54, resize: 'vertical', paddingTop: 10 }}
              />
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <label style={labelStyle} htmlFor="media-preference">
                Media
              </label>
              <select
                id="media-preference"
                value={mediaPreference}
                onChange={(event) => setMediaPreference(event.target.value as MediaPreference)}
                style={selectStyle}
              >
                <option value="mixed">Mixed</option>
                <option value="images">Images</option>
                <option value="videos">Videos</option>
                <option value="auto">Auto</option>
              </select>
            </div>
            <button type="submit" disabled={!runId || busy === 'search'} style={primaryButtonStyle}>
              <Search size={14} />
              Search
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <CapabilityChip icon={<ShieldCheck size={12} />} label="Curated product library" />
            <CapabilityChip icon={<ImageIcon size={12} />} label="Image URL provenance" />
            <CapabilityChip icon={<Film size={12} />} label="Video URL provenance" />
            <CapabilityChip icon={<Link size={12} />} label="External provider adapter-ready" />
          </div>
        </form>

        {error ? <div style={errorStyle}>{error}</div> : null}
        {message ? <div style={messageStyle}>{message}</div> : null}

        {!runId ? (
          <EmptyState
            title="Start or select a run"
            body="Inspiration search is scoped to one generated ui_kit so the references can become a useful agent brief."
          />
        ) : latestReport === undefined ? (
          <EmptyState
            title="Loading inspiration context"
            body="Reading the current run, ui_kit files, and latest parity report."
          />
        ) : report === null ? (
          <EmptyState
            title="Preparing first search"
            body="Parity is creating a default reference brief for this run."
          />
        ) : (
          <>
            <section style={{ display: 'grid', gap: 14 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 18,
                }}
              >
                <div>
                  <div style={sectionTitleStyle}>
                    Page diagnosis{' '}
                    <span style={tagStyle}>{providerLabel(report.providerMode)}</span>
                  </div>
                  <p style={diagnosisStyle}>{report.diagnosis}</p>
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'flex-end',
                    gap: 8,
                    maxWidth: 430,
                  }}
                >
                  {report.tags.slice(0, 6).map((chip) => (
                    <span key={chip} style={chipStyle}>
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
            </section>

            <section style={{ display: 'grid', gap: 14 }}>
              <div
                style={{
                  ...sectionTitleStyle,
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <span>Top reference products ({report.references.length})</span>
                <span style={mutedMonoStyle}>saved {formatTime(report.updatedAt)}</span>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(174px, 1fr))',
                  gap: 14,
                  minWidth: 0,
                }}
              >
                {report.references.map((reference) => (
                  <ReferenceCard
                    key={reference.id}
                    reference={reference}
                    selected={selectedReference?.id === reference.id}
                    onSelect={() => setSelectedReferenceId(reference.id)}
                  />
                ))}
              </div>
            </section>

            <section
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(320px, 1.05fr) minmax(300px, 0.95fr)',
                gap: 18,
                minWidth: 0,
              }}
            >
              <div style={panelStyle}>
                <div style={sectionTitleStyle}>
                  Recommended redesign plan <span style={tagStyle}>Safe to apply</span>
                </div>
                <div style={{ display: 'grid', gap: 14, marginTop: 12 }}>
                  {report.plan.map((item, index) => (
                    <PlanRow
                      key={`${item.title}-${index}`}
                      item={item}
                      index={index}
                      references={report.references}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => void handleApply()}
                  disabled={busy === 'apply'}
                  style={{ ...primaryButtonStyle, marginTop: 18 }}
                >
                  <Sparkles size={14} />
                  {busy === 'apply'
                    ? 'Applying...'
                    : report.appliedAt
                      ? 'Apply again to agent'
                      : 'Apply plan to agent'}
                </button>
              </div>

              <div style={panelStyle}>
                <div
                  style={{
                    ...sectionTitleStyle,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span>Selected reference</span>
                  {selectedReference ? (
                    <a
                      href={selectedReference.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={externalLinkStyle}
                    >
                      Source <ExternalLink size={12} />
                    </a>
                  ) : null}
                </div>
                {selectedReference ? <ReferenceDetail reference={selectedReference} /> : null}
              </div>
            </section>

            <section
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: 18,
                minWidth: 0,
              }}
            >
              <div style={panelStyle}>
                <div style={sectionTitleStyle}>Before vs. after</div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 14,
                    marginTop: 18,
                  }}
                >
                  <ComparisonBlock
                    title="Current page"
                    variant="before"
                    bullets={report.beforeAfter.currentBullets}
                  />
                  <ComparisonBlock
                    title="Reimagined direction"
                    variant="after"
                    bullets={report.beforeAfter.directionBullets}
                  />
                </div>
              </div>
              <div style={panelStyle}>
                <div style={sectionTitleStyle}>Safety and provenance</div>
                <ul style={safetyListStyle}>
                  {report.safetyNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function buildApplyPrompt(report: InspirationReport, title: string): string {
  const references = report.references
    .slice(0, 5)
    .map(
      (reference) =>
        `- ${reference.product}: ${reference.title}. Use for ${reference.useFor}. Avoid: ${reference.avoid}. Source: ${reference.sourceUrl}`,
    )
    .join('\n');
  const plan = report.plan
    .map((item, index) => `${index + 1}. ${item.title} (${item.impact}): ${item.rationale}`)
    .join('\n');
  return `Use the Parity Studio inspiration workflow to improve "${title}".

Diagnosis:
${report.diagnosis}

Reference sources:
${references}

Recommended plan:
${plan}

Safety constraints:
${report.safetyNotes.map((note) => `- ${note}`).join('\n')}

Execute the plan against the current ui_kit. Do not copy proprietary product identity, logos, screenshots, or exact styling. Extract layout, hierarchy, interaction, and accessibility patterns only. After edits, call done and summarize the visible end-user impact.`;
}

function CapabilityChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span style={capabilityChipStyle}>
      {icon}
      {label}
    </span>
  );
}

function ReferenceCard({
  reference,
  selected,
  onSelect,
}: {
  reference: InspirationReference;
  selected: boolean;
  onSelect: () => void;
}) {
  const MediaIcon =
    reference.mediaType === 'video' ? Film : reference.mediaType === 'image' ? ImageIcon : Link;
  return (
    <article
      style={{
        ...referenceCardStyle,
        borderColor: selected ? 'var(--color-accent)' : 'var(--color-border-subtle)',
      }}
    >
      <button type="button" onClick={onSelect} style={thumbnailStyle(reference.thumbnailTone)}>
        <span style={mediaBadgeStyle}>
          <MediaIcon size={12} />
          {reference.mediaType}
        </span>
        <div
          style={{
            width: '78%',
            height: 8,
            borderRadius: 99,
            background: 'currentColor',
            opacity: 0.42,
          }}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, width: '86%' }}>
          <span style={miniLineStyle} />
          <span style={miniLineStyle} />
          <span style={miniLineStyle} />
          <span style={miniLineStyle} />
        </div>
      </button>
      <div style={{ display: 'grid', gap: 4 }}>
        <strong style={{ fontFamily: 'var(--font-sans)', fontSize: 13 }}>
          {reference.product}
        </strong>
        <span style={{ color: 'var(--color-text-secondary)', fontSize: 12, lineHeight: 1.35 }}>
          {reference.title}
        </span>
      </div>
      <ul
        style={{
          margin: '0 0 4px',
          paddingLeft: 16,
          display: 'grid',
          gap: 4,
          color: 'var(--color-text-secondary)',
          fontSize: 12,
        }}
      >
        {reference.patterns.slice(0, 3).map((pattern) => (
          <li key={pattern}>{pattern}</li>
        ))}
      </ul>
      <button type="button" onClick={onSelect} style={viewPatternsStyle}>
        View patterns
        <ArrowRight size={11} />
      </button>
    </article>
  );
}

function ReferenceDetail({ reference }: { reference: InspirationReference }) {
  return (
    <div style={{ display: 'grid', gap: 14, marginTop: 14 }}>
      <div style={thumbnailStyle(reference.thumbnailTone)}>
        <span style={mediaBadgeStyle}>{reference.mediaType} reference</span>
        <div
          style={{
            width: '72%',
            height: 12,
            borderRadius: 99,
            background: 'currentColor',
            opacity: 0.48,
          }}
        />
        <div
          style={{
            width: '52%',
            height: 12,
            borderRadius: 99,
            background: 'currentColor',
            opacity: 0.22,
          }}
        />
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <InfoBlock label="Use for" body={reference.useFor} />
        <InfoBlock label="Do not copy" body={reference.avoid} />
        <InfoBlock label="License note" body={reference.licenseNote} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {reference.tags.slice(0, 8).map((tag) => (
          <span key={tag} style={chipStyle}>
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

function InfoBlock({ label, body }: { label: string; body: string }) {
  return (
    <div style={{ display: 'grid', gap: 3 }}>
      <span style={mutedMonoStyle}>{label}</span>
      <span style={{ color: 'var(--color-text-secondary)', fontSize: 13, lineHeight: 1.45 }}>
        {body}
      </span>
    </div>
  );
}

function PlanRow({
  item,
  index,
  references,
}: {
  item: InspirationPlanItem;
  index: number;
  references: InspirationReference[];
}) {
  const linked = references.filter((reference) => item.sourceReferenceIds.includes(reference.id));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '30px minmax(0, 1fr) auto', gap: 12 }}>
      <span style={numberBadgeStyle}>{index + 1}</span>
      <span style={{ minWidth: 0 }}>
        <strong style={{ display: 'block', fontFamily: 'var(--font-sans)', fontSize: 13 }}>
          {item.title}
        </strong>
        <span
          style={{
            display: 'block',
            color: 'var(--color-text-secondary)',
            fontSize: 12,
            marginTop: 2,
          }}
        >
          {item.rationale}
        </span>
        {linked.length > 0 ? (
          <span
            style={{
              display: 'block',
              color: 'var(--color-text-faint)',
              fontSize: 11,
              marginTop: 5,
            }}
          >
            From: {linked.map((reference) => reference.product).join(', ')}
          </span>
        ) : null}
      </span>
      <span
        style={
          item.impact === 'High'
            ? highImpactStyle
            : item.impact === 'Medium'
              ? mediumImpactStyle
              : lowImpactStyle
        }
      >
        {item.impact}
      </span>
    </div>
  );
}

function ComparisonBlock({
  title,
  variant,
  bullets,
}: { title: string; variant: 'before' | 'after'; bullets: string[] }) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          color: 'var(--color-text-secondary)',
        }}
      >
        {title}
      </div>
      <div style={comparisonPreviewStyle(variant)}>
        <span
          style={{
            width: '82%',
            height: 9,
            borderRadius: 99,
            background: 'currentColor',
            opacity: 0.42,
          }}
        />
        <span
          style={{
            width: '58%',
            height: 9,
            borderRadius: 99,
            background: 'currentColor',
            opacity: 0.28,
          }}
        />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: variant === 'before' ? '1fr 1fr 1fr' : '1fr',
            gap: 7,
            width: '100%',
          }}
        >
          <span
            style={{ height: 20, borderRadius: 7, background: 'currentColor', opacity: 0.18 }}
          />
          <span
            style={{ height: 20, borderRadius: 7, background: 'currentColor', opacity: 0.18 }}
          />
          {variant === 'before' ? (
            <span
              style={{ height: 20, borderRadius: 7, background: 'currentColor', opacity: 0.18 }}
            />
          ) : null}
        </div>
      </div>
      <ul
        style={{
          margin: 0,
          paddingLeft: 16,
          display: 'grid',
          gap: 5,
          color: 'var(--color-text-secondary)',
          fontSize: 12,
        }}
      >
        {bullets.map((bullet) => (
          <li key={bullet}>{bullet}</li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        ...panelStyle,
        minHeight: 220,
        display: 'grid',
        placeItems: 'center',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 420 }}>
        <Sparkles size={24} style={{ color: 'var(--color-accent)', marginBottom: 12 }} />
        <div style={sectionTitleStyle}>{title}</div>
        <p style={{ ...diagnosisStyle, margin: '8px auto 0' }}>{body}</p>
      </div>
    </div>
  );
}

function providerLabel(mode: InspirationReport['providerMode']): string {
  if (mode === 'curated-plus-urls') return 'Curated + URLs';
  if (mode === 'external-ready') return 'External-ready';
  return 'Curated search';
}

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 29,
  fontWeight: 540,
  color: 'var(--color-text-primary)',
  letterSpacing: '-0.02em',
};

const subtitleStyle: React.CSSProperties = {
  margin: '6px 0 0',
  color: 'var(--color-text-secondary)',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--font-size-body)',
};

const heroIconStyle: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 'var(--radius-lg)',
  display: 'grid',
  placeItems: 'center',
  color: 'var(--color-accent)',
  background: 'var(--color-accent-soft)',
  flex: '0 0 auto',
};

const searchPanelStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-xl)',
  border: '1px solid var(--color-border-subtle)',
  background: 'linear-gradient(135deg, var(--color-surface), var(--color-accent-tint))',
  boxShadow: 'var(--shadow-soft)',
  padding: 16,
  display: 'grid',
  gap: 12,
};

const sectionTitleStyle: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 16,
  fontWeight: 780,
  color: 'var(--color-text-primary)',
};

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--color-text-faint)',
};

const diagnosisStyle: React.CSSProperties = {
  maxWidth: 820,
  margin: '10px 0 0',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--font-size-body)',
  lineHeight: 1.55,
  color: 'var(--color-text-secondary)',
};

const tagStyle: React.CSSProperties = {
  marginLeft: 8,
  padding: '3px 8px',
  borderRadius: 'var(--radius-pill)',
  background: 'var(--color-surface-hover)',
  color: 'var(--color-text-secondary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fontWeight: 500,
};

const chipStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 'var(--radius-pill)',
  background: 'var(--color-accent-soft)',
  color: 'var(--color-text-secondary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
};

const capabilityChipStyle: React.CSSProperties = {
  ...chipStyle,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  background: 'var(--color-surface)',
};

const inputIconStyle: React.CSSProperties = {
  width: 38,
  minHeight: 38,
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border-subtle)',
  background: 'var(--color-surface)',
  color: 'var(--color-text-faint)',
  display: 'grid',
  placeItems: 'center',
  flex: '0 0 auto',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  minHeight: 38,
  boxSizing: 'border-box',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border-subtle)',
  background: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  padding: '0 12px',
  outline: 'none',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
};

const ghostButtonStyle: React.CSSProperties = {
  height: 42,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 14px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border-subtle)',
  background: 'var(--color-surface)',
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--font-size-body-sm)',
  cursor: 'pointer',
  boxShadow: 'var(--shadow-soft)',
};

const primaryButtonStyle: React.CSSProperties = {
  height: 42,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '0 14px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-accent)',
  background: 'var(--color-accent)',
  color: 'var(--color-on-accent)',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--font-size-body-sm)',
  fontWeight: 700,
  cursor: 'pointer',
  boxShadow: 'var(--shadow-soft)',
};

const referenceCardStyle: React.CSSProperties = {
  minWidth: 0,
  borderRadius: 'var(--radius-lg)',
  border: '1px solid var(--color-border-subtle)',
  background: 'var(--color-surface)',
  boxShadow: 'var(--shadow-soft)',
  padding: 12,
  display: 'grid',
  gap: 10,
};

function thumbnailStyle(tone: InspirationReference['thumbnailTone']): React.CSSProperties {
  const background =
    tone === 'dark'
      ? 'linear-gradient(135deg, #111827, #1f2937)'
      : tone === 'slate'
        ? 'linear-gradient(135deg, #172033, #2b3856)'
        : tone === 'warm'
          ? 'linear-gradient(135deg, #f7e9dc, #ffffff)'
          : tone === 'cream'
            ? 'linear-gradient(135deg, #fff7ed, #f3e8d7)'
            : tone === 'blue'
              ? 'linear-gradient(135deg, #eaf3ff, #ffffff)'
              : tone === 'graphite'
                ? 'linear-gradient(135deg, #18181b, #3f3f46)'
                : 'linear-gradient(135deg, #f4f7fb, #ffffff)';
  const color =
    tone === 'dark' || tone === 'slate' || tone === 'graphite' ? '#ffffff' : 'var(--color-accent)';
  return {
    position: 'relative',
    width: '100%',
    height: 122,
    borderRadius: 'var(--radius-md)',
    background,
    color,
    border: '1px solid var(--color-border-subtle)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    overflow: 'hidden',
    cursor: 'pointer',
  };
}

const mediaBadgeStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  left: 8,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '4px 7px',
  borderRadius: 'var(--radius-pill)',
  background: 'rgba(255,255,255,0.72)',
  color: '#3b2d27',
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  textTransform: 'uppercase',
};

const miniLineStyle: React.CSSProperties = {
  height: 22,
  borderRadius: 8,
  background: 'currentColor',
  opacity: 0.18,
};

const viewPatternsStyle: React.CSSProperties = {
  height: 32,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border-subtle)',
  background: 'transparent',
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-sans)',
  fontSize: 12,
  cursor: 'pointer',
};

const panelStyle: React.CSSProperties = {
  borderRadius: 'var(--radius-xl)',
  border: '1px solid var(--color-border-subtle)',
  background: 'var(--color-surface)',
  boxShadow: 'var(--shadow-soft)',
  padding: 20,
};

const numberBadgeStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: '50%',
  display: 'grid',
  placeItems: 'center',
  background: 'var(--color-surface-hover)',
  color: 'var(--color-text-secondary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  fontWeight: 700,
};

const highImpactStyle: React.CSSProperties = {
  ...tagStyle,
  marginLeft: 0,
  background: 'color-mix(in srgb, var(--color-error) 10%, var(--color-surface))',
  color: 'var(--color-error)',
};

const mediumImpactStyle: React.CSSProperties = {
  ...tagStyle,
  marginLeft: 0,
  background: 'color-mix(in srgb, var(--color-warning) 12%, var(--color-surface))',
  color: 'var(--color-warning)',
};

const lowImpactStyle: React.CSSProperties = {
  ...tagStyle,
  marginLeft: 0,
  background: 'color-mix(in srgb, var(--color-success) 10%, var(--color-surface))',
  color: 'var(--color-success)',
};

const mutedMonoStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  color: 'var(--color-text-faint)',
};

const externalLinkStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  color: 'var(--color-accent)',
  textDecoration: 'none',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
};

const safetyListStyle: React.CSSProperties = {
  margin: '12px 0 0',
  paddingLeft: 18,
  display: 'grid',
  gap: 9,
  color: 'var(--color-text-secondary)',
  fontSize: 13,
  lineHeight: 1.45,
};

const errorStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid color-mix(in srgb, var(--color-error) 30%, var(--color-border-subtle))',
  background: 'color-mix(in srgb, var(--color-error) 9%, var(--color-surface))',
  color: 'var(--color-error)',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
};

const messageStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid color-mix(in srgb, var(--color-success) 30%, var(--color-border-subtle))',
  background: 'color-mix(in srgb, var(--color-success) 9%, var(--color-surface))',
  color: 'var(--color-success)',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
};

function comparisonPreviewStyle(variant: 'before' | 'after'): React.CSSProperties {
  return {
    minHeight: 132,
    borderRadius: 'var(--radius-md)',
    background:
      variant === 'before'
        ? 'linear-gradient(135deg, #111827, #25314b)'
        : 'linear-gradient(135deg, #fff8f0, #ffffff)',
    color: variant === 'before' ? '#ffffff' : 'var(--color-accent)',
    border: '1px solid var(--color-border-subtle)',
    padding: 18,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 10,
  };
}
