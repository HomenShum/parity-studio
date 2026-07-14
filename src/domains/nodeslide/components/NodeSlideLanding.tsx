import {
  ArrowRight,
  FileText,
  FolderOpen,
  Globe2,
  Layers3,
  LoaderCircle,
  Paperclip,
  PlugZap,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { type ChangeEvent, type FormEvent, useRef, useState } from 'react';
import {
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
import { NodeSlideConnectionsDialog } from './NodeSlideConnectionsDialog';
import {
  type CreateDeckAdmissionRequest,
  NODESLIDE_NEBIUS_BRIEF_CONSENT,
  NODESLIDE_OPENROUTER_BRIEF_CONSENT,
  type NodeSlideBriefProviderMode,
  type RecentDeck,
} from './ProjectDialog';
import { readNodeSlideAttachmentFiles } from './nodeSlideAttachmentFiles';

interface NodeSlideLandingProps {
  clientSessionId: string;
  recentDecks: readonly RecentDeck[];
  creating: boolean;
  error?: string | null;
  onClearError?: () => void;
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
  onCreate,
  onExploreSample,
  onOpenProjects,
  onOpenDeck,
}: NodeSlideLandingProps) {
  const [prompt, setPrompt] = useState('');
  const [starterTitle, setStarterTitle] = useState<string | null>(null);
  const [generation, setGeneration] = useState<'deterministic' | NodeSlideAgentModelId>(
    NODESLIDE_DEFAULT_AGENT_MODEL,
  );
  const [reasoningEffort, setReasoningEffort] = useState<NodeSlideReasoningEffort>(
    NODESLIDE_DEFAULT_REASONING_EFFORT,
  );
  // Zero-friction consent: the external model is disclosed by the composer's model
  // pill, so choosing it and creating IS the consent. The consent token is still
  // generated + validated server-side (createDeckFromBrief) — only the checkbox is gone.
  const [attachments, setAttachments] = useState<NodeSlideDataAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const providerMode: NodeSlideBriefProviderMode =
    generation === 'deterministic' ? 'deterministic' : nodeSlideProviderModeForModel(generation);
  const selectedModel = generation === 'deterministic' ? null : nodeSlideAgentModel(generation);

  const start = () => {
    const nextPrompt = prompt.trim();
    if (!nextPrompt) return;
    onCreate({
      clientSessionId,
      title: starterTitle ?? titleFromPrompt(nextPrompt),
      brief: {
        prompt: nextPrompt,
        audience: 'Decision-makers described in the brief',
        purpose: 'Create an editable, reviewable presentation from this idea',
        successCriteria: [
          'A coherent 6–8 slide narrative',
          'Structured chart, formula, and image primitives where relevant',
          'Validation passes before presentation or export',
        ],
      },
      themeId: 'editorial-signal',
      route: 'free',
      providerMode,
      attachments,
      ...(generation === 'deterministic'
        ? {}
        : {
            providerModel: generation,
            providerEffort: reasoningEffort,
            providerConsent:
              providerMode === 'nebius'
                ? NODESLIDE_NEBIUS_BRIEF_CONSENT
                : NODESLIDE_OPENROUTER_BRIEF_CONSENT,
          }),
    });
  };

  const applyStarter = (starter: (typeof starters)[number]) => {
    setPrompt(starter.prompt);
    setStarterTitle(starter.title);
    onClearError?.();
  };

  const attachFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    if (!files.length) return;
    try {
      setAttachments(await readNodeSlideAttachmentFiles(files, attachments));
      setAttachmentError(null);
      onClearError?.();
    } catch (error) {
      setAttachmentError(
        error instanceof Error ? error.message : 'The file could not be attached.',
      );
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    start();
  };

  const canCreate = Boolean(prompt.trim()) && !creating;

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

        <form className="ns-landing-composer" onSubmit={submit}>
          <label className="ns-sr-only" htmlFor="nodeslide-landing-prompt">
            Presentation brief
          </label>
          <textarea
            id="nodeslide-landing-prompt"
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
              setStarterTitle(null);
              onClearError?.();
            }}
            placeholder="Describe the presentation you want to make…"
            rows={4}
            maxLength={4000}
          />
          {attachments.length > 0 ? (
            <div className="ns-landing-attachments" aria-label="Attached data files">
              {attachments.map((attachment) => (
                <span key={attachment.title}>
                  <FileText size={12} aria-hidden="true" />
                  <span>{attachment.title}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${attachment.title}`}
                    onClick={() =>
                      setAttachments((current) =>
                        current.filter((item) => item.title !== attachment.title),
                      )
                    }
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <input
            ref={fileInputRef}
            className="ns-sr-only"
            data-testid="landing-file-input"
            type="file"
            accept=".csv,.json,.txt,.md,text/csv,application/json,text/plain,text/markdown"
            multiple
            onChange={(event) => void attachFiles(event)}
          />
          <div className="ns-landing-composer-bar">
            <div className="ns-landing-tools">
              <button
                className="ns-landing-attach"
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip size={14} aria-hidden="true" /> Attach data
              </button>
              <span className="ns-landing-web" data-active={providerMode !== 'deterministic'}>
                <Globe2 size={13} aria-hidden="true" />
                {providerDisplayName(providerMode)}
              </span>
              <label className="ns-landing-model">
                <span className="ns-sr-only">Generation model</span>
                {providerMode === 'deterministic' ? (
                  <ShieldCheck size={14} aria-hidden="true" />
                ) : (
                  <Sparkles size={14} aria-hidden="true" />
                )}
                <select
                  aria-label="Generation model"
                  data-testid="landing-model-select"
                  value={generation}
                  onChange={(event) => {
                    const model = event.target.value as 'deterministic' | NodeSlideAgentModelId;
                    setGeneration(model);
                    if (
                      model !== 'deterministic' &&
                      !nodeSlideModelSupportsReasoningEffort(model, reasoningEffort)
                    ) {
                      setReasoningEffort('high');
                    }
                    onClearError?.();
                  }}
                >
                  <optgroup label="Recommended">
                    <option value={NODESLIDE_DEFAULT_AGENT_MODEL}>
                      GLM 5.2 · Nebius · Recommended
                    </option>
                  </optgroup>
                  <optgroup label="More live models">
                    {NODESLIDE_AGENT_MODELS.slice(1).map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label} · {model.vendor} ·{' '}
                        {providerDisplayName(nodeSlideProviderModeForModel(model.id))}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Private fallback">
                    <option value="deterministic">Deterministic · no external model</option>
                  </optgroup>
                </select>
              </label>
              {providerMode !== 'deterministic' ? (
                <label className="ns-landing-model ns-landing-effort">
                  <span className="ns-sr-only">Reasoning effort</span>
                  <select
                    aria-label="Reasoning effort"
                    data-testid="landing-effort-select"
                    value={reasoningEffort}
                    onChange={(event) => {
                      setReasoningEffort(event.target.value as NodeSlideReasoningEffort);
                      onClearError?.();
                    }}
                  >
                    {NODESLIDE_REASONING_EFFORTS.filter((effort) =>
                      generation !== 'deterministic'
                        ? nodeSlideModelSupportsReasoningEffort(generation, effort.id)
                        : false,
                    ).map((effort) => (
                      <option key={effort.id} value={effort.id}>
                        {effort.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            <button
              className="ns-landing-send"
              type="submit"
              aria-label="Create presentation"
              disabled={!canCreate}
              title={!prompt.trim() ? 'Describe a presentation first' : 'Create presentation'}
            >
              {creating ? <LoaderCircle className="ns-spin" size={18} /> : <ArrowRight size={18} />}
            </button>
          </div>
          {creating ? (
            <output className="ns-landing-create-status" aria-live="polite">
              <LoaderCircle className="ns-spin" size={13} /> Planning, composing, and validating
              your editable deck…
            </output>
          ) : error ? (
            <output className="ns-landing-create-error" role="alert">
              {error}
            </output>
          ) : null}
          {attachmentError ? (
            <output className="ns-landing-file-error" role="alert">
              {attachmentError}
            </output>
          ) : null}
        </form>

        <p className="ns-landing-privacy" aria-live="polite">
          {providerMode === 'deterministic' ? (
            <>
              <ShieldCheck size={13} /> Private deterministic generation. No external model egress.
            </>
          ) : (
            <>
              <Sparkles size={13} /> Recommended: {selectedModel?.label ?? 'the selected model'} via{' '}
              {providerDisplayName(providerMode)}
              {attachments.length > 0
                ? ` + ${attachments.length} file${attachments.length === 1 ? '' : 's'}`
                : ''}
              . Create directly; the route, tokens, and cost are recorded in Trace.
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

        <button className="ns-landing-sample" type="button" onClick={onExploreSample}>
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
