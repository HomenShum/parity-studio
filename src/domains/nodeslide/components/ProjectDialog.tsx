import {
  ArrowRight,
  Check,
  Clock3,
  FileText,
  FolderOpen,
  Layers3,
  LoaderCircle,
  Paperclip,
  Plus,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import {
  type CreateDeckRequest,
  NODESLIDE_AGENT_MODELS,
  NODESLIDE_DEFAULT_AGENT_MODEL,
  NODESLIDE_DEFAULT_REASONING_EFFORT,
  NODESLIDE_REASONING_EFFORTS,
  type NodeSlideAgentModelId,
  type NodeSlideReasoningEffort,
  nodeSlideAgentModel,
  nodeSlideModelSupportsReasoningEffort,
  nodeSlideProviderModeForModel,
} from '../../../../shared/nodeslide';
import type { NodeSlideDataAttachment } from '../../../../shared/nodeslideAttachments';
import { readNodeSlideAttachmentFiles } from './nodeSlideAttachmentFiles';
import { useModalDialog } from './useModalDialog';

export const NODESLIDE_OPENROUTER_BRIEF_CONSENT = 'openrouter_full_brief_v1' as const;
export const NODESLIDE_NEBIUS_BRIEF_CONSENT = 'nebius_full_brief_v1' as const;

export type NodeSlideBriefProviderMode = 'deterministic' | 'openrouter_free' | 'nebius';

export interface CreateDeckAdmissionRequest extends CreateDeckRequest {
  accessCode?: string;
  providerMode: NodeSlideBriefProviderMode;
  providerModel?: NodeSlideAgentModelId;
  providerEffort?: NodeSlideReasoningEffort;
  providerConsent?:
    | typeof NODESLIDE_OPENROUTER_BRIEF_CONSENT
    | typeof NODESLIDE_NEBIUS_BRIEF_CONSENT;
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
  error?: string | null;
  onClearError?: () => void;
  onClose: () => void;
  onCreate: (request: CreateDeckAdmissionRequest) => void;
  onOpenDeck: (deckId: string) => void;
  initialDraft?: {
    title: string;
    prompt: string;
    providerMode: NodeSlideBriefProviderMode;
    providerModel?: NodeSlideAgentModelId;
    providerEffort?: NodeSlideReasoningEffort;
    attachments?: NodeSlideDataAttachment[];
  } | null;
  initialMode?: 'create' | 'open';
  createEnabled?: boolean;
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

const WORLD_CUP_STARTER = {
  title: 'World Cup 2022 — The Data Story',
  prompt:
    'Create a 7-slide evidence-led deck about the 2022 FIFA World Cup. Use only these supplied facts: Argentina won after a 3–3 final and 4–2 penalty shootout; the tournament produced 172 goals across 64 matches; top scorers were Kylian Mbappé 8, Lionel Messi 7, Julián Álvarez 4, and Olivier Giroud 4. Include an editable bar chart, an editable formula showing 172 ÷ 64 = 2.69 goals per match, and an editable Lusail Stadium image placeholder with a visible credit requirement. Cite https://www.fifa.com/en/tournaments/mens/worldcup/qatar2022 and https://www.fifa.com/en/articles/top-goalscorers-leading-marksmen-golden-boot-fifa-world-cup-qatar-2022. Separate supplied, derived, and unverified evidence, validate layout, and finish with three decision-ready takeaways.',
  audience: 'Build-challenge reviewers and football strategy leaders',
  purpose: 'Demonstrate a trustworthy, editable data story from prompt through publish',
  successCriteria: [
    'Exactly 7 coherent slides',
    'Chart, formula, and image are real structured primitives',
    'Every numeric claim has a linked source',
    'Validation passes and the deck can present, publish, and export',
  ],
} as const;

export function ProjectDialog({
  open,
  clientSessionId,
  recentDecks,
  creating,
  error = null,
  onClearError,
  onClose,
  onCreate,
  onOpenDeck,
  initialDraft = null,
  initialMode = 'create',
  createEnabled = true,
}: ProjectDialogProps) {
  const [mode, setMode] = useState<'create' | 'open'>(createEnabled ? initialMode : 'open');
  const [title, setTitle] = useState(initialDraft?.title ?? '');
  const [prompt, setPrompt] = useState(initialDraft?.prompt ?? '');
  const [audience, setAudience] = useState('Executive decision-makers');
  const [purpose, setPurpose] = useState('Decision briefing');
  const [successCriteria, setSuccessCriteria] = useState('');
  const [themeId, setThemeId] = useState(profiles[0]?.id ?? 'editorial-signal');
  const [accessCode, setAccessCode] = useState('');
  const [providerMode, setProviderMode] = useState<NodeSlideBriefProviderMode>(
    initialDraft?.providerMode ?? nodeSlideProviderModeForModel(NODESLIDE_DEFAULT_AGENT_MODEL),
  );
  const [providerModel, setProviderModel] = useState<NodeSlideAgentModelId>(
    initialDraft?.providerModel ?? NODESLIDE_DEFAULT_AGENT_MODEL,
  );
  const [providerEffort, setProviderEffort] = useState<NodeSlideReasoningEffort>(
    initialDraft?.providerEffort ?? NODESLIDE_DEFAULT_REASONING_EFFORT,
  );
  const [providerConsent, setProviderConsent] = useState(false);
  const [attachments, setAttachments] = useState<NodeSlideDataAttachment[]>(
    initialDraft?.attachments ?? [],
  );
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const createTabId = `${dialogId}-create-tab`;
  const createPanelId = `${dialogId}-create-panel`;
  const openTabId = `${dialogId}-open-tab`;
  const openPanelId = `${dialogId}-open-panel`;
  const profileHeadingId = `${dialogId}-profile-heading`;
  const providerHeadingId = `${dialogId}-provider-heading`;
  const accessCodeDescriptionId = `${dialogId}-access-code-description`;
  const createStatusId = `${dialogId}-create-status`;
  const initialFocusRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);
  const createTabRef = useRef<HTMLButtonElement>(null);
  const openTabRef = useRef<HTMLButtonElement>(null);
  const clearAdmissionAndClose = () => {
    setAccessCode('');
    setProviderMode(nodeSlideProviderModeForModel(NODESLIDE_DEFAULT_AGENT_MODEL));
    setProviderModel(NODESLIDE_DEFAULT_AGENT_MODEL);
    setProviderEffort(NODESLIDE_DEFAULT_REASONING_EFFORT);
    setProviderConsent(false);
    setAttachments([]);
    setAttachmentError(null);
    onClose();
  };
  const { dialogRef, handleBackdropMouseDown, handleCancel, handleKeyDown } = useModalDialog({
    open,
    onClose: clearAdmissionAndClose,
    initialFocusRef,
  });

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setMode(createEnabled ? initialMode : 'open');
      setTitle(initialDraft?.title ?? '');
      setPrompt(initialDraft?.prompt ?? '');
      setProviderMode(
        initialDraft?.providerMode ?? nodeSlideProviderModeForModel(NODESLIDE_DEFAULT_AGENT_MODEL),
      );
      setProviderModel(initialDraft?.providerModel ?? NODESLIDE_DEFAULT_AGENT_MODEL);
      setProviderEffort(initialDraft?.providerEffort ?? NODESLIDE_DEFAULT_REASONING_EFFORT);
      setAttachments(initialDraft?.attachments ?? []);
      setAttachmentError(null);
    }
    wasOpenRef.current = open;
    if (open) return;
    setAccessCode('');
    setProviderMode(nodeSlideProviderModeForModel(NODESLIDE_DEFAULT_AGENT_MODEL));
    setProviderModel(NODESLIDE_DEFAULT_AGENT_MODEL);
    setProviderEffort(NODESLIDE_DEFAULT_REASONING_EFFORT);
    setProviderConsent(false);
    setAttachments([]);
    setAttachmentError(null);
  }, [createEnabled, initialDraft, initialMode, open]);

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
      (providerMode !== 'deterministic' && !providerConsent)
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
      attachments,
      ...(providerMode !== 'deterministic'
        ? {
            providerModel,
            providerEffort,
            providerConsent:
              providerMode === 'nebius'
                ? NODESLIDE_NEBIUS_BRIEF_CONSENT
                : NODESLIDE_OPENROUTER_BRIEF_CONSENT,
          }
        : {}),
    });
    setAccessCode('');
  };

  const attachFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    if (!files.length) return;
    try {
      setAttachments(await readNodeSlideAttachmentFiles(files, attachments));
      setAttachmentError(null);
    } catch (fileError) {
      setAttachmentError(
        fileError instanceof Error ? fileError.message : 'The file could not be attached.',
      );
    }
  };

  const selectedModel = nodeSlideAgentModel(providerModel);

  const createBlocker = !title.trim()
    ? 'Add a deck title to continue.'
    : !prompt.trim()
      ? 'Describe what this deck should accomplish.'
      : !audience.trim()
        ? 'Add the intended audience under Improve the brief.'
        : !purpose.trim()
          ? 'Add the deck purpose under Improve the brief.'
          : !accessCode.trim()
            ? 'Enter the private-preview access code to continue.'
            : providerMode !== 'deterministic' && !providerConsent
              ? `Confirm consent before sending this brief to ${providerDisplayName(providerMode)}.`
              : null;

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
            <h1 id={titleId}>
              {createEnabled && mode === 'create' ? 'Shape a new story' : 'Open a deck'}
            </h1>
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
        {createEnabled ? (
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
        ) : null}

        {createEnabled && mode === 'create' ? (
          <form
            id={createPanelId}
            className="ns-project-form"
            role="tabpanel"
            aria-labelledby={createTabId}
            onSubmit={submit}
            onChangeCapture={error ? onClearError : undefined}
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
                <div className="ns-brief-starter">
                  <span>
                    <strong>Need a panel-ready starting point?</strong>
                    <small>
                      Prefill a sourced data story, then choose the GLM route below to compose its
                      chart, formula, and image primitives.
                    </small>
                  </span>
                  <button
                    type="button"
                    data-testid="world-cup-starter"
                    onClick={() => {
                      setTitle(WORLD_CUP_STARTER.title);
                      setPrompt(WORLD_CUP_STARTER.prompt);
                      setAudience(WORLD_CUP_STARTER.audience);
                      setPurpose(WORLD_CUP_STARTER.purpose);
                      setSuccessCriteria(WORLD_CUP_STARTER.successCriteria.join('\n'));
                      setThemeId('quiet-precision');
                    }}
                  >
                    Use World Cup data story <ArrowRight size={13} />
                  </button>
                </div>
                <label>
                  <span>Deck title</span>
                  <input
                    ref={initialFocusRef}
                    data-testid="new-deck-title"
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
                <div className="ns-create-attachments">
                  <input
                    ref={attachmentInputRef}
                    className="ns-sr-only"
                    data-testid="create-file-input"
                    type="file"
                    accept=".csv,.json,.txt,.md,text/csv,application/json,text/plain,text/markdown"
                    multiple
                    onChange={(event) => void attachFiles(event)}
                  />
                  <button
                    type="button"
                    className="ns-button ns-button--quiet"
                    onClick={() => attachmentInputRef.current?.click()}
                  >
                    <Paperclip size={13} /> Attach data files
                  </button>
                  <small>CSV, JSON, TXT, or Markdown · up to 3 files</small>
                  {attachmentError ? <output role="alert">{attachmentError}</output> : null}
                  {attachments.length > 0 ? (
                    <ul aria-label="Data files included in this deck">
                      {attachments.map((attachment) => (
                        <li key={attachment.title}>
                          <FileText size={13} aria-hidden="true" />
                          <span>
                            <strong>{attachment.title}</strong>
                            <small>
                              {attachment.format.toLocaleUpperCase()} · included as a source
                            </small>
                          </span>
                          <button
                            type="button"
                            aria-label={`Remove ${attachment.title}`}
                            onClick={() =>
                              setAttachments((current) =>
                                current.filter((item) => item.title !== attachment.title),
                              )
                            }
                          >
                            <X size={12} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
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
                        Uses NodeSlide’s deterministic generator; no part of this brief is sent to
                        an external model provider.
                      </small>
                    </span>
                    {providerMode === 'deterministic' ? <Check size={14} /> : null}
                  </button>
                  <button
                    type="button"
                    data-testid="provider-external"
                    aria-pressed={providerMode !== 'deterministic'}
                    className={providerMode !== 'deterministic' ? 'is-active' : ''}
                    onClick={() => {
                      setProviderMode(nodeSlideProviderModeForModel(providerModel));
                      setProviderConsent(false);
                    }}
                  >
                    <Sparkles size={20} aria-hidden="true" />
                    <span>
                      <strong>
                        Use {providerDisplayName(nodeSlideProviderModeForModel(providerModel))} ·{' '}
                        {selectedModel.label}
                      </strong>
                      <small>
                        Sends the full brief{attachments.length > 0 ? ' and attached files' : ''} to
                        the selected named model through{' '}
                        {providerDisplayName(nodeSlideProviderModeForModel(providerModel))}.
                      </small>
                    </span>
                    {providerMode !== 'deterministic' ? <Check size={14} /> : null}
                  </button>
                </fieldset>
                <label className="ns-provider-model-select">
                  <span>Model and provider</span>
                  <select
                    data-testid="create-model-select"
                    value={providerModel}
                    disabled={providerMode === 'deterministic'}
                    onChange={(event) => {
                      const model = event.target.value as NodeSlideAgentModelId;
                      setProviderModel(model);
                      setProviderMode(nodeSlideProviderModeForModel(model));
                      if (!nodeSlideModelSupportsReasoningEffort(model, providerEffort)) {
                        setProviderEffort('high');
                      }
                      setProviderConsent(false);
                    }}
                  >
                    {NODESLIDE_AGENT_MODELS.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.vendor} · {model.label} ·{' '}
                        {providerDisplayName(nodeSlideProviderModeForModel(model.id))}
                      </option>
                    ))}
                  </select>
                  <small>{selectedModel.description}</small>
                </label>
                <label className="ns-provider-model-select">
                  <span>Reasoning effort</span>
                  <select
                    aria-label="Reasoning effort"
                    data-testid="create-effort-select"
                    value={providerEffort}
                    disabled={providerMode === 'deterministic'}
                    onChange={(event) => {
                      setProviderEffort(event.target.value as NodeSlideReasoningEffort);
                      setProviderConsent(false);
                    }}
                  >
                    {NODESLIDE_REASONING_EFFORTS.filter((effort) =>
                      nodeSlideModelSupportsReasoningEffort(providerModel, effort.id),
                    ).map((effort) => (
                      <option key={effort.id} value={effort.id}>
                        {effort.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  className="ns-provider-consent"
                  style={{
                    alignItems: 'start',
                    background: '#f3f3ef',
                    border: '1px solid var(--ns-line-soft)',
                    borderRadius: 9,
                    display: 'grid',
                    gap: 8,
                    gridTemplateColumns: 'auto 1fr',
                    opacity: providerMode !== 'deterministic' ? 1 : 0.62,
                    padding: 10,
                  }}
                >
                  <input
                    type="checkbox"
                    data-testid="provider-consent"
                    checked={providerConsent}
                    disabled={providerMode === 'deterministic'}
                    onChange={(event) => setProviderConsent(event.target.checked)}
                    style={{
                      accentColor: 'var(--ns-accent)',
                      marginTop: 2,
                      padding: 0,
                      width: 'auto',
                    }}
                  />
                  <span>
                    I consent to sending this full brief
                    {attachments.length > 0
                      ? ` and ${attachments.length} attached file${attachments.length === 1 ? '' : 's'}`
                      : ''}{' '}
                    to {providerDisplayName(providerMode)}
                    <small> Required for {selectedModel.label}; applies to this deck only.</small>
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
              {error ? (
                <output className="ns-project-error" id={createStatusId} role="alert">
                  {error}
                </output>
              ) : creating ? (
                <output id={createStatusId} aria-live="polite">
                  <LoaderCircle className="ns-spin" size={13} /> Planning, composing, and
                  validating…
                </output>
              ) : createBlocker ? (
                <span className="ns-create-blocker" id={createStatusId} aria-live="polite">
                  {createBlocker}
                </span>
              ) : (
                <span id={createStatusId}>
                  {providerMode === 'deterministic' ? (
                    <>
                      <ShieldCheck size={13} /> Deterministic · brief stays inside NodeSlide
                    </>
                  ) : (
                    <>
                      <Sparkles size={13} /> {providerDisplayName(providerMode)} ·{' '}
                      {selectedModel.label} · will send the brief
                      {attachments.length > 0 ? ' and files' : ''} with consent
                    </>
                  )}
                </span>
              )}
              <button
                className="ns-button ns-button--accent"
                type="submit"
                disabled={creating || createBlocker !== null}
                aria-describedby={createStatusId}
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

function providerDisplayName(mode: NodeSlideBriefProviderMode): string {
  if (mode === 'nebius') return 'Nebius';
  if (mode === 'openrouter_free') return 'OpenRouter';
  return 'Private';
}
