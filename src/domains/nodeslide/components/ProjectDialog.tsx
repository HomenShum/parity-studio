import {
  ArrowRight,
  Check,
  Clock3,
  FolderOpen,
  Layers3,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import type { CreateDeckRequest } from '../../../../shared/nodeslide';
import { useModalDialog } from './useModalDialog';

export const NODESLIDE_OPENROUTER_BRIEF_CONSENT = 'openrouter_full_brief_v1' as const;

export type NodeSlideBriefProviderMode = 'deterministic' | 'openrouter_free';

export interface CreateDeckAdmissionRequest extends CreateDeckRequest {
  accessCode: string;
  providerMode: NodeSlideBriefProviderMode;
  providerConsent?: typeof NODESLIDE_OPENROUTER_BRIEF_CONSENT;
}

export interface RecentDeck {
  id: string;
  title: string;
  version: number;
  updatedAt: number;
}

interface ProjectDialogProps {
  open: boolean;
  clientSessionId: string;
  recentDecks: readonly RecentDeck[];
  creating: boolean;
  onClose: () => void;
  onCreate: (request: CreateDeckAdmissionRequest) => void;
  onOpenDeck: (deckId: string) => void;
}

const profiles = [
  {
    id: 'editorial-signal',
    name: 'Editorial signal',
    description: 'Warm paper, sharp data, restrained color.',
    colors: ['#f7f4ed', '#26221d', '#b44a2d'],
  },
  {
    id: 'quiet-precision',
    name: 'Quiet precision',
    description: 'Cool white, technical type, ocean accent.',
    colors: ['#f4f7f8', '#17242b', '#287a8d'],
  },
  {
    id: 'night-briefing',
    name: 'Night briefing',
    description: 'Ink canvas, luminous text, electric insight.',
    colors: ['#15171c', '#f4f1e9', '#b8e068'],
  },
];

export function ProjectDialog({
  open,
  clientSessionId,
  recentDecks,
  creating,
  onClose,
  onCreate,
  onOpenDeck,
}: ProjectDialogProps) {
  const [mode, setMode] = useState<'create' | 'open'>('create');
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [audience, setAudience] = useState('Executive decision-makers');
  const [purpose, setPurpose] = useState('Decision briefing');
  const [successCriteria, setSuccessCriteria] = useState('');
  const [themeId, setThemeId] = useState(profiles[0]?.id ?? 'editorial-signal');
  const [accessCode, setAccessCode] = useState('');
  const [providerMode, setProviderMode] = useState<NodeSlideBriefProviderMode>('deterministic');
  const [providerConsent, setProviderConsent] = useState(false);
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const createTabId = `${dialogId}-create-tab`;
  const createPanelId = `${dialogId}-create-panel`;
  const openTabId = `${dialogId}-open-tab`;
  const openPanelId = `${dialogId}-open-panel`;
  const profileHeadingId = `${dialogId}-profile-heading`;
  const providerHeadingId = `${dialogId}-provider-heading`;
  const accessCodeDescriptionId = `${dialogId}-access-code-description`;
  const initialFocusRef = useRef<HTMLInputElement>(null);
  const createTabRef = useRef<HTMLButtonElement>(null);
  const openTabRef = useRef<HTMLButtonElement>(null);
  const clearAdmissionAndClose = () => {
    setAccessCode('');
    setProviderMode('deterministic');
    setProviderConsent(false);
    onClose();
  };
  const { dialogRef, handleBackdropMouseDown, handleCancel, handleKeyDown } = useModalDialog({
    open,
    onClose: clearAdmissionAndClose,
    initialFocusRef,
  });

  useEffect(() => {
    if (open) return;
    setAccessCode('');
    setProviderMode('deterministic');
    setProviderConsent(false);
  }, [open]);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let nextMode: 'create' | 'open';
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
        nextMode = mode === 'create' ? 'open' : 'create';
        break;
      case 'Home':
        nextMode = 'create';
        break;
      case 'End':
        nextMode = 'open';
        break;
      default:
        return;
    }

    event.preventDefault();
    setMode(nextMode);
    const nextTab = nextMode === 'create' ? createTabRef.current : openTabRef.current;
    nextTab?.focus();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === 'open') return;
    const deckTitle = title.trim();
    const briefPrompt = prompt.trim();
    const previewAccessCode = accessCode.trim();
    if (
      !deckTitle ||
      !briefPrompt ||
      !audience.trim() ||
      !purpose.trim() ||
      !previewAccessCode ||
      (providerMode === 'openrouter_free' && !providerConsent)
    ) {
      return;
    }
    onCreate({
      accessCode: previewAccessCode,
      clientSessionId,
      title: deckTitle,
      brief: {
        prompt: briefPrompt,
        audience: audience.trim(),
        purpose: purpose.trim(),
        successCriteria: successCriteria
          .split('\n')
          .map((criterion) => criterion.trim())
          .filter(Boolean),
      },
      themeId,
      route: 'free',
      providerMode,
      ...(providerMode === 'openrouter_free'
        ? { providerConsent: NODESLIDE_OPENROUTER_BRIEF_CONSENT }
        : {}),
    });
    setAccessCode('');
  };

  if (!open) return null;

  return (
    <div
      className="ns-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) clearAdmissionAndClose();
      }}
    >
      <dialog
        ref={dialogRef}
        className="ns-project-dialog"
        aria-labelledby={titleId}
        aria-modal="true"
        data-testid="new-deck-modal"
        tabIndex={-1}
        onCancel={handleCancel}
        onKeyDown={handleKeyDown}
        onMouseDown={handleBackdropMouseDown}
      >
        <header>
          <div className="ns-project-mark">
            <Layers3 size={18} />
          </div>
          <div>
            <span className="ns-eyebrow">NodeSlide workspace</span>
            <h1 id={titleId}>{mode === 'create' ? 'Shape a new story' : 'Open a deck'}</h1>
          </div>
          <button
            className="ns-icon-button"
            type="button"
            onClick={clearAdmissionAndClose}
            aria-label="Close project dialog"
          >
            <X size={17} />
          </button>
        </header>
        <div className="ns-project-tabs" role="tablist" aria-label="Project dialog views">
          <button
            ref={createTabRef}
            id={createTabId}
            type="button"
            role="tab"
            aria-controls={createPanelId}
            aria-selected={mode === 'create'}
            tabIndex={mode === 'create' ? 0 : -1}
            className={mode === 'create' ? 'is-active' : ''}
            onClick={() => setMode('create')}
            onKeyDown={handleTabKeyDown}
          >
            <Plus size={14} /> New deck
          </button>
          <button
            ref={openTabRef}
            id={openTabId}
            type="button"
            role="tab"
            aria-controls={openPanelId}
            aria-selected={mode === 'open'}
            tabIndex={mode === 'open' ? 0 : -1}
            className={mode === 'open' ? 'is-active' : ''}
            onClick={() => setMode('open')}
            onKeyDown={handleTabKeyDown}
          >
            <FolderOpen size={14} /> Open
          </button>
        </div>

        {mode === 'create' ? (
          <form
            id={createPanelId}
            className="ns-project-form"
            role="tabpanel"
            aria-labelledby={createTabId}
            onSubmit={submit}
            data-testid="new-deck-form"
            aria-busy={creating}
          >
            <div className="ns-project-form-scroll">
              <section>
                <div className="ns-form-section-heading">
                  <span>01</span>
                  <div>
                    <strong>Brief</strong>
                    <small>Give the agent a clear editorial contract.</small>
                  </div>
                </div>
                <label>
                  <span>Deck title</span>
                  <input
                    ref={initialFocusRef}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Q3 market narrative"
                    maxLength={80}
                    required
                  />
                </label>
                <label>
                  <span>What should this deck accomplish?</span>
                  <textarea
                    rows={3}
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="Build an evidence-led story that explains…"
                    maxLength={4000}
                    required
                  />
                </label>
                <details className="ns-brief-details">
                  <summary>Improve the brief</summary>
                  <div className="ns-form-columns">
                    <label>
                      <span>Audience</span>
                      <input
                        value={audience}
                        onChange={(event) => setAudience(event.target.value)}
                        placeholder="Executive leadership"
                        maxLength={240}
                        required
                      />
                    </label>
                    <label>
                      <span>Purpose</span>
                      <input
                        value={purpose}
                        onChange={(event) => setPurpose(event.target.value)}
                        placeholder="Decision briefing"
                        maxLength={240}
                        required
                      />
                    </label>
                  </div>
                  <label>
                    <span>
                      Success criteria <small>one per line</small>
                    </span>
                    <textarea
                      rows={3}
                      value={successCriteria}
                      onChange={(event) => setSuccessCriteria(event.target.value)}
                      maxLength={2411}
                      placeholder={
                        'Decision is clear by slide 3\nEvery claim has a source\nEnds with one concrete ask'
                      }
                    />
                  </label>
                </details>
              </section>
              <section>
                <div className="ns-form-section-heading">
                  <span>02</span>
                  <div>
                    <strong id={providerHeadingId}>Generation and privacy</strong>
                    <small>Choose where this brief is processed.</small>
                  </div>
                </div>
                <fieldset
                  className="ns-profile-grid"
                  aria-labelledby={providerHeadingId}
                  style={{ border: 0, margin: 0, minInlineSize: 0, padding: 0 }}
                >
                  <button
                    type="button"
                    data-testid="provider-deterministic"
                    aria-pressed={providerMode === 'deterministic'}
                    className={providerMode === 'deterministic' ? 'is-active' : ''}
                    onClick={() => {
                      setProviderMode('deterministic');
                      setProviderConsent(false);
                    }}
                  >
                    <ShieldCheck size={20} aria-hidden="true" />
                    <span>
                      <strong>Keep the brief inside NodeSlide</strong>
                      <small>
                        Default. Uses NodeSlide’s deterministic generator; no part of this brief is
                        sent to OpenRouter.
                      </small>
                    </span>
                    {providerMode === 'deterministic' ? <Check size={14} /> : null}
                  </button>
                  <button
                    type="button"
                    data-testid="provider-openrouter"
                    aria-pressed={providerMode === 'openrouter_free'}
                    className={providerMode === 'openrouter_free' ? 'is-active' : ''}
                    onClick={() => {
                      setProviderMode('openrouter_free');
                      setProviderConsent(false);
                    }}
                  >
                    <Sparkles size={20} aria-hidden="true" />
                    <span>
                      <strong>Use OpenRouter’s free route</strong>
                      <small>
                        Sends the full brief—title, prompt, audience, purpose, and success
                        criteria—to OpenRouter, which may route it to a third-party model.
                      </small>
                    </span>
                    {providerMode === 'openrouter_free' ? <Check size={14} /> : null}
                  </button>
                </fieldset>
                <label
                  style={{
                    alignItems: 'start',
                    background: '#f3f3ef',
                    border: '1px solid var(--ns-line-soft)',
                    borderRadius: 9,
                    display: 'grid',
                    gap: 8,
                    gridTemplateColumns: 'auto 1fr',
                    opacity: providerMode === 'openrouter_free' ? 1 : 0.62,
                    padding: 10,
                  }}
                >
                  <input
                    type="checkbox"
                    data-testid="provider-consent"
                    checked={providerConsent}
                    disabled={providerMode !== 'openrouter_free'}
                    onChange={(event) => setProviderConsent(event.target.checked)}
                    style={{
                      accentColor: 'var(--ns-accent)',
                      marginTop: 2,
                      padding: 0,
                      width: 'auto',
                    }}
                  />
                  <span>
                    I consent to sending this full brief to OpenRouter
                    <small>
                      {' '}
                      Required for the OpenRouter option and applies to this deck only.
                    </small>
                  </span>
                </label>
                <label>
                  <span>
                    Private-preview access code
                    <small id={accessCodeDescriptionId}>
                      {' '}
                      Checked by the server for this request. NodeSlide does not save it.
                    </small>
                  </span>
                  <input
                    type="password"
                    name="nodeslide-preview-access-code"
                    data-testid="preview-access-code"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={256}
                    value={accessCode}
                    onChange={(event) => setAccessCode(event.target.value)}
                    aria-describedby={accessCodeDescriptionId}
                    required
                  />
                </label>

                <div className="ns-form-section-heading">
                  <span>03</span>
                  <div>
                    <strong id={profileHeadingId}>Design profile</strong>
                    <small>Start coherent; tune every token later.</small>
                  </div>
                </div>
                <fieldset
                  className="ns-profile-grid"
                  aria-labelledby={profileHeadingId}
                  style={{ border: 0, margin: 0, minInlineSize: 0, padding: 0 }}
                >
                  {profiles.map((profile) => (
                    <button
                      type="button"
                      key={profile.id}
                      aria-pressed={themeId === profile.id}
                      className={themeId === profile.id ? 'is-active' : ''}
                      onClick={() => setThemeId(profile.id)}
                    >
                      <span className="ns-profile-swatches">
                        {profile.colors.map((color) => (
                          <i key={color} style={{ background: color }} />
                        ))}
                      </span>
                      <span>
                        <strong>{profile.name}</strong>
                        <small>{profile.description}</small>
                      </span>
                      {themeId === profile.id ? <Check size={14} /> : null}
                    </button>
                  ))}
                </fieldset>
              </section>
            </div>
            <footer>
              {creating ? (
                <output aria-live="polite">
                  <LoaderCircle className="ns-spin" size={13} /> Planning, composing, and
                  validating…
                </output>
              ) : (
                <span>
                  {providerMode === 'deterministic' ? (
                    <>
                      <ShieldCheck size={13} /> Deterministic · brief stays inside NodeSlide
                    </>
                  ) : (
                    <>
                      <Sparkles size={13} /> OpenRouter free · will send full brief with consent
                    </>
                  )}
                </span>
              )}
              <button
                className="ns-button ns-button--accent"
                type="submit"
                disabled={
                  creating ||
                  !title.trim() ||
                  !prompt.trim() ||
                  !audience.trim() ||
                  !purpose.trim() ||
                  !accessCode.trim() ||
                  (providerMode === 'openrouter_free' && !providerConsent)
                }
              >
                {creating ? 'Creating deck…' : 'Create deck'} <ArrowRight size={14} />
              </button>
            </footer>
          </form>
        ) : (
          <div
            id={openPanelId}
            className="ns-open-project"
            role="tabpanel"
            aria-labelledby={openTabId}
          >
            <p className="ns-open-security">
              Only decks whose anonymous owner capability is stored in this browser appear here. A
              deck ID alone never grants access; shared presentations use read-only links.
            </p>
            <div className="ns-recent-decks">
              <div className="ns-section-heading">
                <span>Recent decks</span>
                <small>{recentDecks.length}</small>
              </div>
              {recentDecks.map((deck) => (
                <button type="button" key={deck.id} onClick={() => onOpenDeck(deck.id)}>
                  <span className="ns-recent-deck-icon">
                    <Layers3 size={16} />
                  </span>
                  <span>
                    <strong>{deck.title}</strong>
                    <small>
                      <Clock3 size={11} /> v{deck.version} · {relativeDate(deck.updatedAt)}
                    </small>
                  </span>
                  <ArrowRight size={14} />
                </button>
              ))}
              {recentDecks.length === 0 ? (
                <p>No owned decks are stored in this browser yet.</p>
              ) : null}
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}

function relativeDate(timestamp: number) {
  const days = Math.floor((Date.now() - timestamp) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}
