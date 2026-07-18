import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Globe2,
  Layers3,
  LoaderCircle,
  PlugZap,
  ShieldCheck,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  NODESLIDE_DEFAULT_AGENT_MODEL,
  NODESLIDE_REASONING_EFFORTS,
  nodeSlideModelSupportsReasoningEffort,
  nodeSlideProviderModeForModel,
} from '../../../../shared/nodeslide';
import {
  inferNodeSlideRequestedSlideCount,
  nodeSlideRequestedSlideCountIssue,
} from '../../../../shared/nodeslideSlideCount';
import { NodeSlidePromptComposer } from '../composer/NodeSlidePromptComposer';
import {
  nodeSlideComposerSessionKey,
  useNodeSlideComposerSession,
} from '../composer/nodeSlideComposerSession';
import {
  createExternalProviderRequestKey,
  readSessionExternalConsent,
  useSessionExternalConsent,
} from '../externalProviderConsent';
import { useAgentSession } from '../session/AgentSessionProvider';
import { publishNodeSlideUiContract, resolveNodeSlideInitialTheme } from '../uiContract';
import { NodeSlideConnectionsDialog } from './NodeSlideConnectionsDialog';
import {
  type CreateDeckAdmissionRequest,
  type NodeSlideBriefProviderMode,
  type RecentDeck,
  createDeckProviderAdmission,
  nodeSlideBriefProviderConsent,
} from './ProjectDialog';
import { readNodeSlideAttachmentFiles } from './nodeSlideAttachmentFiles';

interface NodeSlideLandingProps {
  clientSessionId: string;
  recentDecks: readonly RecentDeck[];
  creating: boolean;
  error?: string | null;
  onClearError?: () => void;
  onCancelCreate?: () => void;
  onCreate: (request: CreateDeckAdmissionRequest) => void;
  onExploreSample: () => void;
  onOpenDeck: (deckId: string) => void;
}

const starters = [
  {
    title: 'World Cup 2022 — The Data Story',
    label: 'World Cup data story',
    prompt:
      'Create an evidence-led presentation about the 2022 FIFA World Cup with an editable chart, a goals-per-match formula, source-linked claims, and a clear executive takeaway.',
  },
  {
    title: 'AI 2027 — Scenarios and Decisions',
    label: 'AI 2027 scenario',
    prompt:
      'Build a scenario presentation about AI through 2027. Separate evidence from assumptions, visualize the major inflection points, and end with decisions leaders should make now.',
  },
  {
    title: 'AI Fund — Product Opportunity',
    label: 'AI Fund product narrative',
    prompt:
      'Create a concise product narrative for AI Fund reviewers: customer problem, agentic workflow, technical trust model, product wedge, validation plan, and next milestones.',
  },
] as const;

export function NodeSlideLanding({
  clientSessionId,
  recentDecks,
  creating,
  error = null,
  onClearError,
  onCancelCreate,
  onCreate,
  onExploreSample,
  onOpenDeck,
}: NodeSlideLandingProps) {
  const agentSession = useAgentSession();
  const composerSession = useNodeSlideComposerSession(
    nodeSlideComposerSessionKey('landing', clientSessionId),
  );
  const prompt = composerSession.text;
  const [starterTitle, setStarterTitle] = useState<string | null>(null);
  const generation = agentSession.state.controls.model;
  const reasoningEffort = agentSession.state.controls.effort;
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentsSyncing, setAttachmentsSyncing] = useState(false);
  const [submissionPreparing, setSubmissionPreparing] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  // Canon §0.5: the landing themes through the same data-ns-theme attribute as
  // the studio (stored preference, then OS preference) — never a media query.
  const [landingTheme] = useState<'light' | 'dark'>(() => resolveNodeSlideInitialTheme());
  // Agent-native UI contract: the landing is its own publishable phase.
  useEffect(() => {
    publishNodeSlideUiContract({ phase: 'landing', connection: 'ready', theme: landingTheme });
  }, [landingTheme]);
  const [recentDecksExpanded, setRecentDecksExpanded] = useState(false);
  const handleAttachmentsChange = useCallback(() => {
    setAttachmentError(null);
    onClearError?.();
  }, [onClearError]);
  const requestedSlideCountIssue = nodeSlideRequestedSlideCountIssue(prompt);
  const providerMode: NodeSlideBriefProviderMode =
    generation === 'deterministic' ? 'deterministic' : nodeSlideProviderModeForModel(generation);
  const externalConsent = useSessionExternalConsent();
  const providerConsent =
    providerMode === 'deterministic' || !externalConsent.granted
      ? null
      : nodeSlideBriefProviderConsent(providerMode);
  const submissionSignature = createExternalProviderRequestKey('landing-create', {
    prompt,
    attachments: composerSession.attachments,
    providerMode,
    generation,
    reasoningEffort,
    externalConsentGranted: externalConsent.granted,
  });
  const submissionTrackerRef = useRef({ signature: submissionSignature, revision: 0 });
  if (submissionTrackerRef.current.signature !== submissionSignature) {
    submissionTrackerRef.current = {
      signature: submissionSignature,
      revision: submissionTrackerRef.current.revision + 1,
    };
  }
  const lifecycleRevisionRef = useRef(0);
  const activeCreateJob =
    agentSession.state.activeJob?.kind === 'create_deck' ? agentSession.state.activeJob : null;
  const { setSurface } = agentSession;

  useEffect(() => {
    setSurface('landing');
    return () => {
      lifecycleRevisionRef.current += 1;
    };
  }, [setSurface]);

  const start = async (submittedPrompt: string, files: readonly File[]) => {
    const submittedRevision = submissionTrackerRef.current.revision;
    const submittedLifecycleRevision = lifecycleRevisionRef.current;
    const requestChanged = () =>
      lifecycleRevisionRef.current !== submittedLifecycleRevision ||
      submissionTrackerRef.current.revision !== submittedRevision;
    const nextPrompt = submittedPrompt.trim();
    if (!nextPrompt) return;
    if (nodeSlideRequestedSlideCountIssue(nextPrompt)) return;
    if (providerMode !== 'deterministic' && !externalConsent.granted) {
      throw new Error(
        `Allow external AI for this browser tab once to create with ${providerDisplayName(providerMode)}.`,
      );
    }
    const requestedSlideCount = inferNodeSlideRequestedSlideCount(nextPrompt);
    try {
      const attachments = await readNodeSlideAttachmentFiles(files, []);
      if (requestChanged() || (providerMode !== 'deterministic' && !readSessionExternalConsent())) {
        throw new Error(
          'The model, consent, or request changed while files were being prepared. Review and submit again.',
        );
      }
      const providerAdmission = createDeckProviderAdmission(
        providerMode,
        generation === 'deterministic' ? NODESLIDE_DEFAULT_AGENT_MODEL : generation,
        reasoningEffort,
        providerConsent,
      );
      if (!providerAdmission) {
        throw new Error('The selected provider is no longer authorized. Review and submit again.');
      }
      setAttachmentError(null);
      onCreate({
        clientSessionId,
        title:
          starterTitle ??
          starters.find((starter) => starter.prompt === nextPrompt)?.title ??
          titleFromPrompt(nextPrompt),
        brief: {
          prompt: nextPrompt,
          audience: 'Decision-makers described in the brief',
          purpose: 'Create an editable, reviewable presentation from this idea',
          successCriteria: [
            requestedSlideCount
              ? `Exactly ${requestedSlideCount} slides in the requested narrative`
              : 'A coherent 6–8 slide narrative',
            'Structured chart, formula, and image primitives where relevant',
            'Validation passes before presentation or export',
          ],
        },
        themeId: 'editorial-signal',
        route: 'free',
        attachments,
        ...providerAdmission,
      });
    } catch (fileError) {
      const message =
        fileError instanceof Error ? fileError.message : 'The file could not be attached.';
      if (!requestChanged()) setAttachmentError(message);
      throw fileError;
    }
  };

  const applyStarter = (starter: (typeof starters)[number]) => {
    composerSession.setText(starter.prompt);
    setStarterTitle(starter.title);
    onClearError?.();
  };

  const canCreate =
    Boolean(prompt.trim()) &&
    !creating &&
    !attachmentsSyncing &&
    !submissionPreparing &&
    requestedSlideCountIssue === null;
  const recentDeckLimit = 4;
  const visibleRecentDecks = recentDecksExpanded
    ? recentDecks
    : recentDecks.slice(0, recentDeckLimit);
  const hiddenRecentDeckCount = Math.max(0, recentDecks.length - recentDeckLimit);

  return (
    <main
      className="nodeslide-studio ns-landing"
      data-testid="nodeslide-landing"
      data-app-id="nodeslide"
      data-agent-surface="prompt-first-deck-authoring"
      data-mcp-compat="stdio webmcp"
      data-ns-theme={landingTheme}
    >
      <header className="ns-landing-header">
        <a className="ns-landing-brand" href="/" aria-label="NodeSlide home">
          <span aria-hidden="true">N</span>
          <strong>NodeSlide</strong>
        </a>
        <div className="ns-landing-header-actions">
          <button
            className="ns-landing-connect"
            type="button"
            onClick={() => setConnectionsOpen(true)}
          >
            <PlugZap size={14} /> Connections
          </button>
        </div>
      </header>

      <section className="ns-landing-main" aria-labelledby="nodeslide-landing-title">
        <div className="ns-landing-work">
          <div className="ns-landing-intro">
            <span className="ns-eyebrow">Decks that stay editable</span>
            <h1 id="nodeslide-landing-title">
              What presentation should we <em className="ns-hl">build</em>?
            </h1>
            <p>
              Start with an idea, a structured spec, or evidence. NodeSlide turns it into a
              reviewable deck—not a stack of static images.
            </p>
          </div>

          <NodeSlidePromptComposer
            attachmentInputTestId="landing-file-input"
            attachLabel="Attach data"
            clearAttachmentsOnSubmit={false}
            composerClassName="ns-landing-composer"
            disabled={!canCreate}
            effort={reasoningEffort}
            effortLabel="Reasoning effort"
            effortOptions={NODESLIDE_REASONING_EFFORTS.filter(
              (effort) =>
                generation !== 'deterministic' &&
                nodeSlideModelSupportsReasoningEffort(generation, effort.id),
            )}
            effortTestId="landing-effort-select"
            model={generation}
            modelLabel="Generation model"
            modelTestId="landing-model-select"
            onAttachmentError={setAttachmentError}
            onAttachmentSyncingChange={setAttachmentsSyncing}
            onAttachmentsChange={handleAttachmentsChange}
            onSubmissionPreparingChange={setSubmissionPreparing}
            onEffortChange={(effort) => {
              agentSession.updateControls({ effort });
              onClearError?.();
            }}
            onModelChange={(model) => {
              agentSession.updateControls({ model });
              if (
                model !== 'deterministic' &&
                !nodeSlideModelSupportsReasoningEffort(model, reasoningEffort)
              ) {
                agentSession.updateControls({ effort: 'high' });
              }
              onClearError?.();
            }}
            onSubmit={({ text, files }) => start(text, files)}
            onTextChange={() => {
              setStarterTitle(null);
              setAttachmentError(null);
              onClearError?.();
            }}
            placeholder="Describe the presentation you want to make…"
            session={composerSession}
            submissionRevision={submissionTrackerRef.current.revision}
            status={
              creating || submissionPreparing
                ? 'submitted'
                : error || attachmentError || requestedSlideCountIssue
                  ? 'error'
                  : 'ready'
            }
            submitContent={
              creating ? <LoaderCircle className="ns-spin" size={18} /> : <ArrowRight size={18} />
            }
            submitLabel="Create presentation"
            textareaId="nodeslide-landing-prompt"
            textareaLabel="Presentation brief"
            textareaMaxLength={4000}
            textareaRows={4}
            tools={
              <>
                <span className="ns-landing-web" data-active={providerMode !== 'deterministic'}>
                  <Globe2 size={13} aria-hidden="true" />
                  {providerDisplayName(providerMode)}
                </span>
                {providerMode !== 'deterministic' || externalConsent.granted ? (
                  <label
                    className={`ns-session-consent-pill ${externalConsent.granted ? 'is-ready' : ''}`}
                    htmlFor="nodeslide-landing-provider-consent"
                    title="Allow selected external models and optional web research for this browser tab"
                  >
                    <input
                      id="nodeslide-landing-provider-consent"
                      type="checkbox"
                      aria-label="Allow prompt and files for this browser tab"
                      data-testid="landing-provider-consent"
                      checked={externalConsent.granted}
                      onChange={(event) => {
                        externalConsent.setGranted(event.currentTarget.checked);
                        setAttachmentError(null);
                      }}
                    />
                    <span>
                      <ShieldCheck size={13} aria-hidden="true" />
                      <span>
                        {externalConsent.granted
                          ? 'AI allowed this session'
                          : 'Allow prompt + files'}
                      </span>
                    </span>
                  </label>
                ) : null}
              </>
            }
          />
          {creating ? (
            <output
              className="ns-landing-create-status"
              aria-live="polite"
              style={{ alignItems: 'center', display: 'flex', gap: 8 }}
            >
              <LoaderCircle className="ns-spin" size={13} /> Planning, composing, and validating
              your editable deck…
              {activeCreateJob?.jobId ? (
                <small>
                  {activeCreateJob.phase} · {activeCreateJob.progress}%
                </small>
              ) : null}
              {activeCreateJob?.jobId && onCancelCreate ? (
                <button
                  className="ns-button"
                  type="button"
                  onClick={onCancelCreate}
                  style={{ marginLeft: 'auto', minHeight: 28 }}
                >
                  Cancel
                </button>
              ) : null}
            </output>
          ) : error ? (
            <output className="ns-landing-create-error" role="alert">
              {error}
            </output>
          ) : requestedSlideCountIssue ? (
            <output className="ns-landing-create-error" role="alert">
              {requestedSlideCountIssue}
            </output>
          ) : null}
          {attachmentError ? (
            <output className="ns-landing-file-error" role="alert">
              {attachmentError}
            </output>
          ) : null}

          <div className="ns-landing-starters" aria-label="Presentation starters">
            <span>Try an idea</span>
            {starters.map((starter) => (
              <button key={starter.label} type="button" onClick={() => applyStarter(starter)}>
                {starter.label}
              </button>
            ))}
          </div>

          <button className="ns-landing-sample" type="button" onClick={onExploreSample}>
            <Layers3 size={15} /> Explore the editable sample workspace
          </button>

          {recentDecks.length > 0 ? (
            <section className="ns-landing-recents" aria-labelledby="nodeslide-recent-title">
              <div>
                <span className="ns-eyebrow" id="nodeslide-recent-title">
                  Recent decks
                </span>
              </div>
              <ul>
                {visibleRecentDecks.map((deck) => (
                  <li key={deck.id}>
                    <button type="button" onClick={() => onOpenDeck(deck.id)}>
                      <span>
                        <strong>{deck.title}</strong>
                        <small>Version {deck.version}</small>
                      </span>
                      <ArrowRight size={14} />
                    </button>
                  </li>
                ))}
              </ul>
              {hiddenRecentDeckCount > 0 ? (
                <button
                  aria-expanded={recentDecksExpanded}
                  className="ns-landing-recents-toggle"
                  type="button"
                  onClick={() => setRecentDecksExpanded((expanded) => !expanded)}
                >
                  {recentDecksExpanded ? (
                    <>
                      <ChevronUp size={14} /> Show fewer
                    </>
                  ) : (
                    <>
                      <ChevronDown size={14} /> Show {hiddenRecentDeckCount} more
                    </>
                  )}
                </button>
              ) : null}
            </section>
          ) : null}
        </div>

        {/* Signature moment: the brief assembling itself into a governed deck.
            Purely presentational; motion collapses to the settled final state
            under prefers-reduced-motion. */}
        <div className="ns-landing-stage" aria-hidden="true">
          <div className="ns-stage-frame ns-stage-frame--past">
            <span className="ns-stage-kicker" />
            <span className="ns-stage-headline ns-stage-headline--short" />
            <span className="ns-stage-line" />
            <span className="ns-stage-line ns-stage-line--short" />
            <span className="ns-stage-seal">✓ validated</span>
          </div>
          <div className="ns-stage-frame ns-stage-frame--chart">
            <span className="ns-stage-kicker" />
            <span className="ns-stage-headline" />
            <span className="ns-stage-bars">
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className="ns-stage-seal">✓ validated</span>
          </div>
          <div className="ns-stage-frame ns-stage-frame--front">
            <span className="ns-stage-kicker" />
            <span className="ns-stage-headline" />
            <span className="ns-stage-media" />
            <span className="ns-stage-line" />
            <span className="ns-stage-seal">✓ validated</span>
          </div>
          <span className="ns-stage-chip">v1 · Deck CI passed</span>
        </div>
      </section>

      <footer className="ns-landing-footer">
        Editable primitives · scoped AI changes · validation before publish
      </footer>
      <NodeSlideConnectionsDialog
        open={connectionsOpen}
        onClose={() => setConnectionsOpen(false)}
      />
    </main>
  );
}

function titleFromPrompt(prompt: string): string {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  const sentence = compact.split(/[.!?]/, 1)[0]?.trim() || compact;
  return sentence.length <= 72 ? sentence : `${sentence.slice(0, 69).trimEnd()}…`;
}

function providerDisplayName(mode: NodeSlideBriefProviderMode): string {
  if (mode === 'nebius') return 'Nebius';
  if (mode === 'openrouter_free') return 'OpenRouter';
  return 'Private';
}
