/**
 * ChatComposerSurface — wired from the platform-generated ui_kit at
 * `scripts/career/poc-headless-pipeline/runs/composer-dogfood/iter-0/ui_kits/nodebench-ai-dashboard/`
 * (gpt-image-2 source + claude-opus-4-1 decompose + claude-sonnet-4-5 judge,
 * parityScore 1.00 verified, $0.78, 305s).
 *
 * The HTML body + CSS class names are preserved from the platform output to
 * stay honest with the dogfood — this is what the platform thinks it should
 * look like. Interactive handlers + live data wiring (threads, tweaks state)
 * sit on top of the static structure.
 *
 * Static placeholder data is the same DISCO/Mercor/Everlaw/Turing/EU AI Act
 * thread set the platform-emitted ui_kit shipped with — represents a typical
 * power-user research session. Real per-design wiring (Convex `runs` table
 * → threads, parityReports → branches counter) is a follow-up.
 */

import { useState } from 'react';

type SurfaceTab = 'chat' | 'brief' | 'cards' | 'notebook' | 'sources' | 'map';
type ComposerMode = 'dock' | 'floating' | 'inline';
type CardsInspector = 'visible' | 'hidden';
type NotebookWidth = 'narrow' | 'wide';

interface Thread {
  id: string;
  title: string;
  meta: string;
}

const THREADS: ReadonlyArray<Thread> = [
  { id: 'disco', title: 'DISCO — worth reaching out? Fastest debrief.', meta: '2h • 24 src' },
  { id: 'mercor', title: 'Mercor — hiring velocity', meta: '1d • 18 src' },
  { id: 'everlaw', title: 'Everlaw — head-to-head', meta: '2d • 11 src' },
  { id: 'turing', title: 'Turing — contract YoY', meta: '1w • 12 src' },
  { id: 'eu-ai-act', title: 'EU AI Act • legal tech', meta: '2w • 9 src' },
];

const TABS: ReadonlyArray<{ id: SurfaceTab; label: string; count?: number }> = [
  { id: 'chat', label: 'Chat' },
  { id: 'brief', label: 'Brief' },
  { id: 'cards', label: 'Cards', count: 14 },
  { id: 'notebook', label: 'Notebook' },
  { id: 'sources', label: 'Sources', count: 24 },
  { id: 'map', label: 'Map' },
];

const ACCENT_SWATCHES: ReadonlyArray<string> = [
  '#ff6b35',
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#a855f7',
  '#06b6d4',
];

export function ChatComposerSurface() {
  const [activeThread, setActiveThread] = useState<string>('disco');
  const [activeTab, setActiveTab] = useState<SurfaceTab>('chat');
  const [composerMode, setComposerMode] = useState<ComposerMode>('dock');
  const [cardsInspector, setCardsInspector] = useState<CardsInspector>('visible');
  const [notebookWidth, setNotebookWidth] = useState<NotebookWidth>('wide');
  const [accent, setAccent] = useState<string>('#ff6b35');
  const [tweaksOpen, setTweaksOpen] = useState<boolean>(true);
  const [composerInput, setComposerInput] = useState<string>('');

  return (
    <div className="cc-container">
      {/* THREADS RAIL */}
      <aside className="cc-sidebar" aria-label="Threads">
        <div className="cc-brand">
          <div className="cc-brand-mark" aria-hidden="true">NB</div>
          <span className="cc-brand-name">NodeBench AI</span>
        </div>
        <div className="cc-section">
          <div className="cc-section-row">
            <span className="cc-section-label">THREADS</span>
            <button type="button" className="cc-section-add" aria-label="New thread">+</button>
          </div>
          {THREADS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`cc-thread-item${activeThread === t.id ? ' active' : ''}`}
              onClick={() => setActiveThread(t.id)}
            >
              <div className="cc-thread-title">{t.title}</div>
              <div className="cc-thread-meta">{t.meta}</div>
            </button>
          ))}
        </div>
      </aside>

      {/* MAIN COLUMN */}
      <div className="cc-main">
        {/* Header — entity chip + tab strip */}
        <div className="cc-header">
          <div className="cc-entity-chip">
            <span className="cc-entity-icon" aria-hidden="true">📊</span>
            DISCO
          </div>
          <span className="cc-entity-meta">2h • 24 SRC</span>
          <div className="cc-tabs" role="tablist" aria-label="Surface">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`cc-tab${activeTab === tab.id ? ' active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
                {tab.count !== undefined ? <span className="cc-tab-count">{tab.count}</span> : null}
              </button>
            ))}
          </div>
        </div>

        <div className="cc-content">
          {/* ANSWER SURFACE */}
          <div className="cc-content-main">
            {/* Question echo */}
            <div className="cc-question-block">
              <div className="cc-avatar" aria-hidden="true">HS</div>
              <div className="cc-question-text">DISCO — worth reaching out? Fastest debrief.</div>
              <div className="cc-status-strip">
                <span className="cc-badge cc-badge-verified">✓ verified</span>
                <span className="cc-badge cc-badge-muted">6 branches</span>
                <span className="cc-status-meta">kimi-k2.6 • 174s • llm-judge 9.6</span>
              </div>
            </div>

            {/* Answer hero */}
            <h2 className="cc-answer-headline">
              Yes — worth reaching out. DISCO is compounding above the legal-tech median.
            </h2>
            <p className="cc-answer-body">
              DISCO closed a $100M Series C <Citation n={1} />
              led by Greylock on Nov 14, 2025 <Citation n={1} />, putting ARR growth above the 2.5x
              legal-tech median <Citation n={2} />. The company serves 2,400+ firms including six of
              the AmLaw 10 <Citation n={4} />.
            </p>
            <p className="cc-answer-body">
              Two things to weigh before an intro: the EU AI Act <Citation n={3} /> integration tax
              over the next 6-9 months <Citation n={3} />, and Everlaw's <Citation n={7} />{' '}
              lower-midmarket pricing pressure <Citation n={7} />. Net: product velocity looks real;
              pricing discipline is the watch item.
            </p>

            {/* Recommendation callout */}
            <div className="cc-recommendation">
              <div className="cc-recommendation-head">
                <span className="cc-recommendation-icon" aria-hidden="true">⊙</span>
                <span className="cc-recommendation-label">RECOMMENDATION</span>
              </div>
              <p className="cc-recommendation-body">
                Reach out this quarter. Lead with AmLaw traction and the Greylock signal; ask how
                they plan to absorb the AI Act compliance load without raising effective price.
              </p>
            </div>

            {/* Top cards grid */}
            <div className="cc-cards-section">
              <div className="cc-cards-head">
                <span className="cc-cards-label">TOP CARDS • 3 OF 14</span>
                <a className="cc-cards-link" href="#cards">Open all →</a>
              </div>
              <div className="cc-cards-grid">
                <CompanyCard
                  letter="D"
                  name="DISCO"
                  tag="LAW"
                  subtitle="legal tech • series c"
                  metrics={[
                    { label: 'ARR', value: '$184M', delta: '↑', big: true },
                    { label: 'NRR', value: '122%', delta: '↑' },
                    { label: 'Growth', value: '2.8x', delta: '↑' },
                    { label: 'GM', value: '78%' },
                  ]}
                  footnote="● refreshed 2h ago • 24 sources"
                  footnoteColor="success"
                />
                <CompanyCard
                  letter="G"
                  name="Everlaw"
                  tag="competitor"
                  subtitle="legal tech • competitor"
                  metrics={[
                    { label: 'ARR', value: '$140M', delta: '↑', big: true },
                    { label: 'NRR', value: '108%', delta: '↑' },
                    { label: 'Growth', value: '1.9x', delta: '↑' },
                    { label: 'Pricing', value: '-18%', delta: '↓', danger: true },
                  ]}
                  footnote="● midmarket wedge"
                />
                <CompanyCard
                  letter="G"
                  name="Greylock"
                  tag="investor"
                  subtitle="investor • lead"
                  metrics={[
                    { label: 'Round', value: '$100M', big: true },
                    { label: 'Portfolio', value: '3 in legal' },
                    { label: 'Board', value: 'Grayson' },
                    { label: 'Since', value: '2025' },
                  ]}
                  footnote="● platform bets"
                />
              </div>
            </div>

            {/* Sources strip */}
            <div className="cc-sources-section">
              <div className="cc-sources-label">SOURCES →</div>
              <div className="cc-composer-input">
                <input
                  type="text"
                  value={composerInput}
                  onChange={(e) => setComposerInput(e.target.value)}
                  placeholder="Compare DISCO to Everlaw on AmLaw 100 coverage and blended ARPU."
                  aria-label="Ask a follow-up question"
                />
                <button
                  type="button"
                  className="cc-composer-send"
                  aria-label="Send"
                  disabled={composerInput.trim().length === 0}
                  style={{ background: accent }}
                >
                  ↑
                </button>
              </div>
            </div>

            {/* Composer chips */}
            <div className="cc-composer-chips">
              <button type="button" className="cc-chip">📎 Attach</button>
              <button type="button" className="cc-chip">🌐 Web</button>
              <button type="button" className="cc-chip">🔀 Branches • 6</button>
              <button type="button" className="cc-chip">📄 Use report</button>
            </div>
          </div>

          {/* TWEAKS PANEL */}
          {tweaksOpen ? (
            <aside className="cc-tweaks" aria-label="Tweaks">
              <div className="cc-tweaks-head">
                <span className="cc-tweaks-label">TWEAKS</span>
                <button
                  type="button"
                  className="cc-tweaks-close"
                  aria-label="Close tweaks"
                  onClick={() => setTweaksOpen(false)}
                >
                  ✕
                </button>
              </div>
              <SegmentedSection
                title="CHAT"
                option="Composer"
                value={composerMode}
                onChange={(v) => setComposerMode(v as ComposerMode)}
                options={['dock', 'floating', 'inline']}
                accent={accent}
              />
              <SegmentedSection
                title="CARDS"
                option="Inspector"
                value={cardsInspector}
                onChange={(v) => setCardsInspector(v as CardsInspector)}
                options={['visible', 'hidden']}
                accent={accent}
              />
              <SegmentedSection
                title="NOTEBOOK"
                option="Column width"
                value={notebookWidth}
                onChange={(v) => setNotebookWidth(v as NotebookWidth)}
                options={['narrow', 'wide']}
                accent={accent}
              />
              <div className="cc-tweaks-section">
                <div className="cc-tweaks-section-label">BRAND</div>
                <div className="cc-tweaks-option">Accent</div>
                <div className="cc-swatches">
                  {ACCENT_SWATCHES.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`cc-swatch${accent === color ? ' active' : ''}`}
                      style={{ background: color }}
                      onClick={() => setAccent(color)}
                      aria-label={`Set accent to ${color}`}
                      aria-pressed={accent === color}
                    />
                  ))}
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ───────── helpers ─────────

function Citation({ n }: { n: number }) {
  return <sup className="cc-citation">{n}</sup>;
}

interface MetricRow {
  label: string;
  value: string;
  delta?: string;
  big?: boolean;
  danger?: boolean;
}

function CompanyCard({
  letter,
  name,
  tag,
  subtitle,
  metrics,
  footnote,
  footnoteColor,
}: {
  letter: string;
  name: string;
  tag: string;
  subtitle: string;
  metrics: MetricRow[];
  footnote: string;
  footnoteColor?: 'success' | 'muted';
}) {
  return (
    <div className="cc-company-card">
      <div className="cc-card-head">
        <div className="cc-card-name">
          <span className="cc-card-letter">{letter}</span> {name}
        </div>
        <span className="cc-card-tag">{tag}</span>
      </div>
      <div className="cc-card-subtitle">{subtitle}</div>
      {metrics.map((m, i) => (
        <div key={`${m.label}-${i}`} className="cc-card-metric">
          <div className="cc-metric-label">{m.label}</div>
          <div
            className={`cc-metric-value${m.big ? ' big' : ''}${m.danger ? ' danger' : ''}`}
          >
            {m.value}
            {m.delta ? <span className="cc-metric-delta"> {m.delta}</span> : null}
          </div>
        </div>
      ))}
      <div className={`cc-card-footnote${footnoteColor === 'success' ? ' success' : ''}`}>
        {footnote}
      </div>
    </div>
  );
}

function SegmentedSection({
  title,
  option,
  value,
  onChange,
  options,
  accent,
}: {
  title: string;
  option: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  accent: string;
}) {
  return (
    <div className="cc-tweaks-section">
      <div className="cc-tweaks-section-label">{title}</div>
      <div className="cc-tweaks-option">{option}</div>
      <div className="cc-segmented">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            className={`cc-segment${value === opt ? ' active' : ''}`}
            style={value === opt ? { background: accent, borderColor: accent } : undefined}
            onClick={() => onChange(opt)}
            aria-pressed={value === opt}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
