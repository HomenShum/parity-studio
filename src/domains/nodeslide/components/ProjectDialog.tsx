import {
  ArrowRight,
  Check,
  Clock3,
  FolderOpen,
  Layers3,
  LoaderCircle,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useId, useRef, useState } from 'react';
import type { CreateDeckRequest } from '../../../../shared/nodeslide';
import { useModalDialog } from './useModalDialog';

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
  onCreate: (request: CreateDeckRequest) => void;
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
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const createTabId = `${dialogId}-create-tab`;
  const createPanelId = `${dialogId}-create-panel`;
  const openTabId = `${dialogId}-open-tab`;
  const openPanelId = `${dialogId}-open-panel`;
  const profileHeadingId = `${dialogId}-profile-heading`;
  const initialFocusRef = useRef<HTMLInputElement>(null);
  const createTabRef = useRef<HTMLButtonElement>(null);
  const openTabRef = useRef<HTMLButtonElement>(null);
  const { dialogRef, handleBackdropMouseDown, handleCancel, handleKeyDown } = useModalDialog({
    open,
    onClose,
    initialFocusRef,
  });

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
    if (!deckTitle || !briefPrompt || !audience.trim() || !purpose.trim()) return;
    onCreate({
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
    });
  };

  if (!open) return null;

  return (
    <div
      className="ns-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
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
            onClick={onClose}
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
                        required
                      />
                    </label>
                    <label>
                      <span>Purpose</span>
                      <input
                        value={purpose}
                        onChange={(event) => setPurpose(event.target.value)}
                        placeholder="Decision briefing"
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
                    <strong id={profileHeadingId}>Design profile</strong>
                    <small>Start coherent; tune every token later.</small>
                  </div>
                </div>
                <div className="ns-profile-grid">
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
                </div>
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
                  <Sparkles size={13} /> Free beta route · deterministic fallback available
                </span>
              )}
              <button
                className="ns-button ns-button--accent"
                type="submit"
                disabled={
                  creating || !title.trim() || !prompt.trim() || !audience.trim() || !purpose.trim()
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
