import {
  ArrowRight,
  FolderOpen,
  Globe2,
  Layers3,
  LoaderCircle,
  PlugZap,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  NODESLIDE_DEFAULT_AGENT_MODEL,
  NODESLIDE_REASONING_EFFORTS,
  nodeSlideAgentModel,
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
import { createExternalProviderRequestKey, usePerRequestConsent } from '../externalProviderConsent';
import { useAgentSession } from '../session/AgentSessionProvider';
import { NodeSlideConnectionsDialog } from './NodeSlideConnectionsDialog';
import {
  type CreateDeckAdmissionRequest,
  type NodeSlideBriefProviderConsent,
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
  onOpenProjects: () => void;
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
  onOpenProjects,
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
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const requestedSlideCountIssue = nodeSlideRequestedSlideCountIssue(prompt);
  const providerMode: NodeSlideBriefProviderMode =
    generation === 'deterministic' ? 'deterministic' : nodeSlideProviderModeForModel(generation);
  const selectedModel = generation === 'deterministic' ? null : nodeSlideAgentModel(generation);
  const providerConsentRequestKey = createExternalProviderRequestKey('landing-create', {
    clientSessionId,
    prompt,
    starterTitle,
    generation,
    providerMode,
    reasoningEffort,
    attachments: composerSession.attachments,
  });
  const {
    consent: providerConsent,
    setConsent: setProviderConsent,
    consumeConsent: consumeProviderConsent,
    clearConsent: clearProviderConsent,
  } = usePerRequestConsent<NodeSlideBriefProviderConsent>(providerConsentRequestKey);
  const activeCreateJob =
    agentSession.state.activeJob?.kind === 'create_deck' ? agentSession.state.activeJob : null;
  const { setSurface } = agentSession;

  useEffect(() => {
    setSurface('landing');
  }, [setSurface]);

  const start = async (submittedPrompt: string, files: readonly File[]) => {
    const nextPrompt = submittedPrompt.trim();
    if (!nextPrompt) return;
    if (nodeSlideRequestedSlideCountIssue(nextPrompt)) return;
    const requestedSlideCount = inferNodeSlideRequestedSlideCount(nextPrompt);
    const providerAdmission = createDeckProviderAdmission(
      providerMode,
      generation === 'deterministic' ? NODESLIDE_DEFAULT_AGENT_MODEL : generation,
      reasoningEffort,
      providerMode === 'deterministic' ? null : consumeProviderConsent(),
    );
    if (!providerAdmission) return;
    try {
      const attachments = await readNodeSlideAttachmentFiles(files, []);
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
      setAttachmentError(message);
      throw fileError;
    }
  };

  const applyStarter = (starter: (typeof starters)[number]) => {
    clearProviderConsent();
    composerSession.setText(starter.prompt);
    setStarterTitle(starter.title);
    onClearError?.();
  };

  const canCreate =
    Boolean(prompt.trim()) &&
    !creating &&
    !attachmentsSyncing &&
    requestedSlideCountIssue === null &&
    (providerMode === 'deterministic' || providerConsent !== null);

  return (
    <main
      className="nodeslide-studio ns-landing"
      data-testid="nodeslide-landing"
      data-app-id="nodeslide"
      data-agent-surface="prompt-first-deck-authoring"
      data-mcp-compat="stdio webmcp"
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
            <PlugZap size={14} /> BYOK / Agents
          </button>
          <button className="ns-landing-open" type="button" onClick={onOpenProjects}>
            <FolderOpen size={15} /> Open deck
          </button>
        </div>
      </header>

      <section className="ns-landing-main" aria-labelledby="nodeslide-landing-title">
        <div className="ns-landing-intro">
          <span className="ns-eyebrow">Decks that stay editable</span>
          <h1 id="nodeslide-landing-title">What presentation should we build?</h1>
          <p>
            Start with an idea, a structured spec, or evidence. NodeSlide turns it into a reviewable
            deck—not a stack of static images.
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
          onAttachmentsChange={clearProviderConsent}
          onEffortChange={(effort) => {
            agentSession.updateControls({ effort });
            clearProviderConsent();
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
            clearProviderConsent();
            onClearError?.();
          }}
          onSubmit={({ text, files }) => start(text, files)}
          onTextChange={() => {
            clearProviderConsent();
            setStarterTitle(null);
            onClearError?.();
          }}
          placeholder="Describe the presentation you want to make…"
          session={composerSession}
          status={
            creating
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
            <span className="ns-landing-web" data-active={providerMode !== 'deterministic'}>
              <Globe2 size={13} aria-hidden="true" />
              {providerDisplayName(providerMode)}
            </span>
          }
        />
        {providerMode !== 'deterministic' ? (
          <label className="ns-provider-consent ns-landing-consent">
            <input
              type="checkbox"
              data-testid="landing-provider-consent"
              checked={providerConsent !== null}
              disabled={attachmentsSyncing}
              onChange={(event) =>
                setProviderConsent(
                  event.target.checked ? nodeSlideBriefProviderConsent(providerMode) : null,
                )
              }
            />
            <span>
              I consent to sending this full brief
              {composerSession.attachments.length > 0
                ? ` and ${composerSession.attachments.length} attached file${composerSession.attachments.length === 1 ? '' : 's'}`
                : ''}{' '}
              to {providerDisplayName(providerMode)} for this creation request.
              <small> Consent resets immediately after submission.</small>
            </span>
          </label>
        ) : null}
        {creating ? (
          <output
            className="ns-landing-create-status"
            aria-live="polite"
            style={{ alignItems: 'center', display: 'flex', gap: 8 }}
          >
            <LoaderCircle className="ns-spin" size={13} /> Planning, composing, and validating your
            editable deck…
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

        <p className="ns-landing-privacy" aria-live="polite">
          {providerMode === 'deterministic' ? (
            <>
              <ShieldCheck size={13} /> Private deterministic generation. No external model egress.
            </>
          ) : (
            <>
              <Sparkles size={13} /> Recommended: {selectedModel?.label ?? 'the selected model'} via{' '}
              {providerDisplayName(providerMode)}
              {composerSession.attachments.length > 0
                ? ` + ${composerSession.attachments.length} file${composerSession.attachments.length === 1 ? '' : 's'}`
                : ''}
              . Check consent for this request before creation; route, tokens, and cost are recorded
              in Trace.
            </>
          )}
        </p>

        <div className="ns-landing-starters" aria-label="Presentation starters">
          <span>Try an idea</span>
          {starters.map((starter) => (
            <button key={starter.label} type="button" onClick={() => applyStarter(starter)}>
              {starter.label}
            </button>
          ))}
        </div>

        <button
          className="ns-landing-sample"
          type="button"
          onClick={() => {
            clearProviderConsent();
            onExploreSample();
          }}
        >
          <Layers3 size={15} /> Explore the editable sample workspace
        </button>

        {recentDecks.length > 0 ? (
          <section className="ns-landing-recents" aria-labelledby="nodeslide-recent-title">
            <div>
              <span className="ns-eyebrow" id="nodeslide-recent-title">
                Recent decks
              </span>
              <button type="button" onClick={onOpenProjects}>
                View all
              </button>
            </div>
            <ul>
              {recentDecks.slice(0, 3).map((deck) => (
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
          </section>
        ) : null}
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
