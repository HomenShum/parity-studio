import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowRight,
  Check,
  Clock3,
  CopyPlus,
  FolderOpen,
  Layers3,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  type CreateDeckRequest,
  NODESLIDE_DEFAULT_AGENT_MODEL,
  NODESLIDE_REASONING_EFFORTS,
  type NodeSlideAgentModelId,
  type NodeSlideReasoningEffort,
  nodeSlideAgentModel,
  nodeSlideModelSupportsReasoningEffort,
  nodeSlideProviderModeForModel,
} from '../../../../shared/nodeslide';
import type { NodeSlideDataAttachment } from '../../../../shared/nodeslideAttachments';
import { nodeSlideRequestedSlideCountIssue } from '../../../../shared/nodeslideSlideCount';
import {
  NODESLIDE_COMPOSER_DEFAULT_REASONING_EFFORT,
  NodeSlidePromptComposer,
} from '../composer/NodeSlidePromptComposer';
import {
  createNodeSlideComposerAttachmentDraft,
  nodeSlideComposerSessionKey,
  useNodeSlideComposerSession,
} from '../composer/nodeSlideComposerSession';
import {
  createExternalProviderRequestKey,
  readSessionExternalConsent,
  useSessionExternalConsent,
} from '../externalProviderConsent';
import { readNodeSlideAttachmentFiles } from './nodeSlideAttachmentFiles';

export const NODESLIDE_OPENROUTER_BRIEF_CONSENT = 'openrouter_full_brief_v1' as const;
export const NODESLIDE_NEBIUS_BRIEF_CONSENT = 'nebius_full_brief_v1' as const;

export type NodeSlideBriefProviderMode = 'deterministic' | 'openrouter_free' | 'nebius';
export type NodeSlideBriefProviderConsent =
  | typeof NODESLIDE_OPENROUTER_BRIEF_CONSENT
  | typeof NODESLIDE_NEBIUS_BRIEF_CONSENT;

export interface CreateDeckAdmissionRequest extends CreateDeckRequest {
  accessCode?: string;
  providerMode: NodeSlideBriefProviderMode;
  providerModel?: NodeSlideAgentModelId;
  providerEffort?: NodeSlideReasoningEffort;
  providerConsent?: NodeSlideBriefProviderConsent;
}

export type CreateDeckProviderAdmission = Pick<
  CreateDeckAdmissionRequest,
  'providerMode' | 'providerModel' | 'providerEffort' | 'providerConsent'
>;

export function createDeckProviderAdmission(
  providerMode: NodeSlideBriefProviderMode,
  providerModel: NodeSlideAgentModelId,
  providerEffort: NodeSlideReasoningEffort,
  providerConsent: NodeSlideBriefProviderConsent | null,
): CreateDeckProviderAdmission | null {
  if (providerMode === 'deterministic') return { providerMode };
  if (providerConsent === null || providerConsent !== nodeSlideBriefProviderConsent(providerMode)) {
    return null;
  }
  return {
    providerMode,
    providerModel,
    providerEffort,
    providerConsent,
  };
}

export function nodeSlideBriefProviderConsent(
  providerMode: NodeSlideBriefProviderMode,
): NodeSlideBriefProviderConsent | null {
  if (providerMode === 'nebius') return NODESLIDE_NEBIUS_BRIEF_CONSENT;
  if (providerMode === 'openrouter_free') return NODESLIDE_OPENROUTER_BRIEF_CONSENT;
  return null;
}

export interface RecentDeck {
  id: string;
  title: string;
  version: number;
  updatedAt: number;
}

export interface SessionRunReceipt {
  jobId: string;
  kind: 'create_deck' | 'edit_proposal';
  status: string;
  updatedAt: number;
  error?: string;
  resultDeckId?: string;
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
  onDuplicateDeck?: (deckId: string) => void;
  onOpenDeck: (deckId: string) => void;
  /** Secret-free run receipts for the returning-user dashboard (D11). */
  sessionJobs?: readonly SessionRunReceipt[];
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
  onDuplicateDeck,
  onOpenDeck,
  sessionJobs,
  initialDraft = null,
  initialMode = 'create',
  createEnabled = true,
}: ProjectDialogProps) {
  const [mode, setMode] = useState<'create' | 'open'>(createEnabled ? initialMode : 'open');
  const [title, setTitle] = useState(initialDraft?.title ?? '');
  const composerSession = useNodeSlideComposerSession(
    nodeSlideComposerSessionKey('project', clientSessionId),
    {
      text: initialDraft?.prompt ?? '',
      attachments: composerAttachmentDrafts(initialDraft?.attachments ?? []),
    },
  );
  const { clear: clearComposerSession, reset: resetComposerSession } = composerSession;
  const prompt = composerSession.text;
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
    initialDraft?.providerEffort ?? NODESLIDE_COMPOSER_DEFAULT_REASONING_EFFORT,
  );
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [submissionPreparing, setSubmissionPreparing] = useState(false);
  const clearAttachmentError = useCallback(() => setAttachmentError(null), []);
  const externalConsent = useSessionExternalConsent();
  const providerConsent =
    providerMode === 'deterministic' || !externalConsent.granted
      ? null
      : nodeSlideBriefProviderConsent(providerMode);
  const submissionSignature = createExternalProviderRequestKey('project-create', {
    mode,
    title,
    prompt,
    audience,
    purpose,
    successCriteria,
    themeId,
    accessCode,
    attachments: composerSession.attachments,
    providerMode,
    providerModel,
    providerEffort,
    externalConsentGranted: externalConsent.granted,
  });
  const submissionTrackerRef = useRef({ signature: submissionSignature, revision: 0 });
  if (submissionTrackerRef.current.signature !== submissionSignature) {
    submissionTrackerRef.current = {
      signature: submissionSignature,
      revision: submissionTrackerRef.current.revision + 1,
    };
  }
  const dialogLifecycleRef = useRef({ open, revision: 0 });
  if (dialogLifecycleRef.current.open !== open) {
    dialogLifecycleRef.current = {
      open,
      revision: dialogLifecycleRef.current.revision + 1,
    };
  }
  const dialogId = useId();
  const createTabId = `${dialogId}-create-tab`;
  const createPanelId = `${dialogId}-create-panel`;
  const openTabId = `${dialogId}-open-tab`;
  const openPanelId = `${dialogId}-open-panel`;
  const profileHeadingId = `${dialogId}-profile-heading`;
  const providerHeadingId = `${dialogId}-provider-heading`;
  const accessCodeDescriptionId = `${dialogId}-access-code-description`;
  const createStatusId = `${dialogId}-create-status`;
  const createFormId = `${dialogId}-create-form`;
  const initialFocusRef = useRef<HTMLInputElement>(null);
  const wasOpenRef = useRef(false);
  const clearAdmissionAndClose = () => {
    setAccessCode('');
    setProviderMode(nodeSlideProviderModeForModel(NODESLIDE_DEFAULT_AGENT_MODEL));
    setProviderModel(NODESLIDE_DEFAULT_AGENT_MODEL);
    setProviderEffort(NODESLIDE_COMPOSER_DEFAULT_REASONING_EFFORT);
    clearComposerSession();
    setAttachmentError(null);
    onClose();
  };

  useEffect(
    () => () => {
      dialogLifecycleRef.current = {
        open: false,
        revision: dialogLifecycleRef.current.revision + 1,
      };
    },
    [],
  );

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setMode(createEnabled ? initialMode : 'open');
      setTitle(initialDraft?.title ?? '');
      resetComposerSession({
        text: initialDraft?.prompt ?? '',
        attachments: composerAttachmentDrafts(initialDraft?.attachments ?? []),
      });
      setProviderMode(
        initialDraft?.providerMode ?? nodeSlideProviderModeForModel(NODESLIDE_DEFAULT_AGENT_MODEL),
      );
      setProviderModel(initialDraft?.providerModel ?? NODESLIDE_DEFAULT_AGENT_MODEL);
      setProviderEffort(
        initialDraft?.providerEffort ?? NODESLIDE_COMPOSER_DEFAULT_REASONING_EFFORT,
      );
      setAttachmentError(null);
    }
    wasOpenRef.current = open;
    if (open) return;
    setAccessCode('');
    setProviderMode(nodeSlideProviderModeForModel(NODESLIDE_DEFAULT_AGENT_MODEL));
    setProviderModel(NODESLIDE_DEFAULT_AGENT_MODEL);
    setProviderEffort(NODESLIDE_COMPOSER_DEFAULT_REASONING_EFFORT);
    clearComposerSession();
    setAttachmentError(null);
  }, [clearComposerSession, createEnabled, initialDraft, initialMode, open, resetComposerSession]);

  const submit = async ({ text, files }: { text: string; files: File[] }) => {
    const submittedRevision = submissionTrackerRef.current.revision;
    const submittedLifecycleRevision = dialogLifecycleRef.current.revision;
    const requestChanged = () =>
      !dialogLifecycleRef.current.open ||
      dialogLifecycleRef.current.revision !== submittedLifecycleRevision ||
      submissionTrackerRef.current.revision !== submittedRevision;
    if (mode === 'open') return;
    const deckTitle = title.trim();
    const briefPrompt = text.trim();
    if (nodeSlideRequestedSlideCountIssue(briefPrompt, successCriteria)) return;
    const previewAccessCode = accessCode.trim();
    if (!deckTitle || !briefPrompt || !audience.trim() || !purpose.trim() || !previewAccessCode) {
      return;
    }
    if (providerMode !== 'deterministic' && !externalConsent.granted) {
      throw new Error(
        `Allow external AI for this browser tab once to create with ${providerDisplayName(providerMode)}.`,
      );
    }
    try {
      const attachments = await readNodeSlideAttachmentFiles(files, []);
      if (requestChanged() || (providerMode !== 'deterministic' && !readSessionExternalConsent())) {
        throw new Error(
          'The model, consent, or request changed while files were being prepared. Review and submit again.',
        );
      }
      const providerAdmission = createDeckProviderAdmission(
        providerMode,
        providerModel,
        providerEffort,
        providerConsent,
      );
      if (!providerAdmission) {
        throw new Error('The selected provider is no longer authorized. Review and submit again.');
      }
      setAttachmentError(null);
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
        attachments,
        ...providerAdmission,
      });
      setAccessCode('');
    } catch (fileError) {
      if (!requestChanged()) {
        setAttachmentError(
          fileError instanceof Error ? fileError.message : 'The file could not be attached.',
        );
      }
      throw fileError;
    }
  };

  const selectedModel = nodeSlideAgentModel(providerModel);
  const requestedSlideCountIssue = nodeSlideRequestedSlideCountIssue(prompt, successCriteria);

  const createBlocker = !title.trim()
    ? 'Add a deck title to continue.'
    : !prompt.trim()
      ? 'Describe what this deck should accomplish.'
      : requestedSlideCountIssue
        ? requestedSlideCountIssue
        : !audience.trim()
          ? 'Add the intended audience under Improve the brief.'
          : !purpose.trim()
            ? 'Add the deck purpose under Improve the brief.'
            : !accessCode.trim()
              ? 'Enter the private-preview access code to continue.'
              : null;

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) clearAdmissionAndClose();
      }}
    >
      <DialogContent
        className="ns-project-dialog"
        overlayClassName="nodeslide-studio ns-modal-backdrop"
        portalContainer={
          typeof document === 'undefined'
            ? null
            : document.querySelector<HTMLElement>('.nodeslide-studio:not(.ns-modal-backdrop)')
        }
        showCloseButton={false}
        data-testid="new-deck-modal"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          initialFocusRef.current?.focus();
        }}
      >
        <header>
          <div className="ns-project-mark">
            <Layers3 size={18} />
          </div>
          <div>
            <span className="ns-eyebrow">NodeSlide workspace</span>
            <DialogTitle asChild>
              <h1>{createEnabled && mode === 'create' ? 'Shape a new story' : 'Open a deck'}</h1>
            </DialogTitle>
            <DialogDescription className="ns-sr-only">
              Create a reviewable NodeSlide deck or reopen one owned by this browser.
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <button className="ns-icon-button" type="button" aria-label="Close project dialog">
              <X size={17} />
            </button>
          </DialogClose>
        </header>
        {createEnabled ? (
          <Tabs
            value={mode}
            onValueChange={(value) => setMode(value as 'create' | 'open')}
            unstyled
          >
            <TabsList className="ns-project-tabs" aria-label="Project dialog views" unstyled>
              <TabsTrigger
                value="create"
                id={createTabId}
                aria-controls={createPanelId}
                className={mode === 'create' ? 'is-active' : ''}
                unstyled
              >
                <Plus size={14} /> New deck
              </TabsTrigger>
              <TabsTrigger
                value="open"
                id={openTabId}
                aria-controls={openPanelId}
                className={mode === 'open' ? 'is-active' : ''}
                unstyled
              >
                <FolderOpen size={14} /> Open
              </TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}

        {createEnabled && mode === 'create' ? (
          <div
            id={createPanelId}
            className="ns-project-form"
            role="tabpanel"
            aria-labelledby={createTabId}
            onChangeCapture={error ? onClearError : undefined}
            data-testid="new-deck-form"
            aria-busy={creating || submissionPreparing}
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
                      composerSession.setText(WORLD_CUP_STARTER.prompt);
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
                    form={createFormId}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Q3 market narrative"
                    maxLength={80}
                    required
                  />
                </label>
                <div className="ns-create-attachments">
                  <NodeSlidePromptComposer
                    allowAttachments
                    attachmentInputTestId="create-file-input"
                    clearAttachmentsOnSubmit={false}
                    disabled={creating || submissionPreparing}
                    effort={providerEffort}
                    effortLabel="Reasoning effort"
                    effortOptions={NODESLIDE_REASONING_EFFORTS.filter((effort) =>
                      nodeSlideModelSupportsReasoningEffort(providerModel, effort.id),
                    )}
                    effortTestId="create-effort-select"
                    formId={createFormId}
                    model={providerMode === 'deterministic' ? 'deterministic' : providerModel}
                    modelLabel="Model and provider"
                    modelTestId="create-model-select"
                    onAttachmentError={setAttachmentError}
                    onAttachmentsChange={clearAttachmentError}
                    onSubmissionPreparingChange={setSubmissionPreparing}
                    onEffortChange={(effort) => {
                      setProviderEffort(effort);
                      onClearError?.();
                    }}
                    onModelChange={(model) => {
                      if (model === 'deterministic') {
                        setProviderMode('deterministic');
                        onClearError?.();
                        return;
                      }
                      setProviderModel(model);
                      setProviderMode(nodeSlideProviderModeForModel(model));
                      if (!nodeSlideModelSupportsReasoningEffort(model, providerEffort)) {
                        setProviderEffort('high');
                      }
                      onClearError?.();
                    }}
                    onSubmit={submit}
                    onTextChange={() => setAttachmentError(null)}
                    onTextareaKeyDown={(event) => {
                      if (
                        event.key === 'Enter' &&
                        !event.shiftKey &&
                        (creating || submissionPreparing || createBlocker)
                      ) {
                        event.preventDefault();
                      }
                    }}
                    placeholder="Build an evidence-led story that explains…"
                    session={composerSession}
                    submissionRevision={submissionTrackerRef.current.revision}
                    showSubmit={false}
                    submitLabel="Create deck"
                    textareaLabel="What should this deck accomplish?"
                    textareaMaxLength={4000}
                    textareaRows={3}
                  />
                  <small>CSV, JSON, TXT, or Markdown · up to 3 files</small>
                  {attachmentError ? <output role="alert">{attachmentError}</output> : null}
                </div>
                <Collapsible className="ns-brief-details">
                  <CollapsibleTrigger>Improve the brief</CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="ns-form-columns">
                      <label>
                        <span>Audience</span>
                        <input
                          form={createFormId}
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
                          form={createFormId}
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
                        form={createFormId}
                        rows={3}
                        value={successCriteria}
                        onChange={(event) => setSuccessCriteria(event.target.value)}
                        maxLength={2411}
                        placeholder={
                          'Decision is clear by slide 3\nEvery claim has a source\nEnds with one concrete ask'
                        }
                      />
                    </label>
                  </CollapsibleContent>
                </Collapsible>
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
                    }}
                  >
                    <Sparkles size={20} aria-hidden="true" />
                    <span>
                      <strong>
                        Use {providerDisplayName(nodeSlideProviderModeForModel(providerModel))} ·{' '}
                        {selectedModel.label}
                      </strong>
                      <small>
                        Sends the full brief
                        {composerSession.attachments.length > 0 ? ' and attached files' : ''} to the
                        selected named model through{' '}
                        {providerDisplayName(nodeSlideProviderModeForModel(providerModel))}.
                      </small>
                    </span>
                    {providerMode !== 'deterministic' ? <Check size={14} /> : null}
                  </button>
                </fieldset>
                <div
                  className={`ns-session-consent-pill ns-project-session-consent ${
                    externalConsent.granted ? 'is-ready' : ''
                  }`}
                  title="Allow selected external models and optional web research for this browser tab"
                >
                  <Checkbox
                    id="nodeslide-project-provider-consent"
                    type="button"
                    form={createFormId}
                    data-testid="provider-consent"
                    checked={externalConsent.granted}
                    onCheckedChange={(checked) => {
                      externalConsent.setGranted(checked === true);
                      setAttachmentError(null);
                    }}
                  />
                  <label htmlFor="nodeslide-project-provider-consent">
                    <ShieldCheck size={13} aria-hidden="true" />
                    <span>
                      {externalConsent.granted
                        ? 'External AI allowed this session'
                        : 'Allow external AI this session'}
                    </span>
                  </label>
                </div>
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
                    form={createFormId}
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
              ) : creating || submissionPreparing ? (
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
                      {composerSession.attachments.length > 0 ? ' and files' : ''} with consent
                    </>
                  )}
                </span>
              )}
              <button
                className="ns-button ns-button--accent"
                type="submit"
                form={createFormId}
                disabled={creating || submissionPreparing || createBlocker !== null}
                aria-describedby={createStatusId}
              >
                {creating || submissionPreparing ? 'Preparing deck…' : 'Create deck'}{' '}
                <ArrowRight size={14} />
              </button>
            </footer>
          </div>
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
                <div className="ns-recent-deck-row" key={deck.id}>
                  <button type="button" onClick={() => onOpenDeck(deck.id)}>
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
                  {onDuplicateDeck ? (
                    <button
                      type="button"
                      className="ns-recent-deck-duplicate"
                      aria-label={`Duplicate ${deck.title}`}
                      title="Duplicate this deck"
                      onClick={() => onDuplicateDeck(deck.id)}
                    >
                      <CopyPlus size={14} />
                    </button>
                  ) : null}
                </div>
              ))}
              {recentDecks.length === 0 ? (
                <p>No owned decks are stored in this browser yet.</p>
              ) : null}
            </div>
            {sessionJobs && sessionJobs.length > 0 ? (
              <div className="ns-recent-runs" data-testid="session-runs-dashboard">
                <div className="ns-form-section-heading">
                  <span>Recent agent runs</span>
                </div>
                <ul>
                  {sessionJobs.map((job) => (
                    <li key={job.jobId}>
                      <span className={`ns-run-status is-${job.status}`}>{job.status}</span>
                      <span className="ns-run-kind">
                        {job.kind === 'create_deck' ? 'Create deck' : 'Edit proposal'} ·{' '}
                        {relativeDate(job.updatedAt)}
                        {job.error ? <small className="ns-run-error"> — {job.error}</small> : null}
                      </span>
                      {job.resultDeckId ? (
                        <button type="button" onClick={() => onOpenDeck(job.resultDeckId as string)}>
                          Open deck
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function composerAttachmentDrafts(attachments: readonly NodeSlideDataAttachment[]) {
  return attachments.map((attachment) =>
    createNodeSlideComposerAttachmentDraft({
      name: attachment.title,
      mediaType:
        attachment.format === 'csv'
          ? 'text/csv'
          : attachment.format === 'json'
            ? 'application/json'
            : 'text/plain',
      content: attachment.content,
    }),
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
