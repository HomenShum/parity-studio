import {
  ArrowRight,
  FileText,
  FolderOpen,
  Globe2,
  Layers3,
  Paperclip,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { type ChangeEvent, type FormEvent, useRef, useState } from 'react';
import {
  NODESLIDE_AGENT_MODELS,
  type NodeSlideAgentModelId,
  nodeSlideAgentModel,
} from '../../../../shared/nodeslide';
import type { NodeSlideDataAttachment } from '../../../../shared/nodeslideAttachments';
import type { NodeSlideBriefProviderMode, RecentDeck } from './ProjectDialog';
import { readNodeSlideAttachmentFiles } from './nodeSlideAttachmentFiles';

export interface NodeSlideLandingDraft {
  title: string;
  prompt: string;
  providerMode: NodeSlideBriefProviderMode;
  providerModel?: NodeSlideAgentModelId;
  attachments: NodeSlideDataAttachment[];
}

interface NodeSlideLandingProps {
  recentDecks: readonly RecentDeck[];
  onStart: (draft: NodeSlideLandingDraft) => void;
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
  recentDecks,
  onStart,
  onExploreSample,
  onOpenProjects,
  onOpenDeck,
}: NodeSlideLandingProps) {
  const [prompt, setPrompt] = useState('');
  const [generation, setGeneration] = useState<'deterministic' | NodeSlideAgentModelId>(
    'deterministic',
  );
  const [attachments, setAttachments] = useState<NodeSlideDataAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const providerMode: NodeSlideBriefProviderMode =
    generation === 'deterministic' ? 'deterministic' : 'openrouter_free';
  const selectedModel = generation === 'deterministic' ? null : nodeSlideAgentModel(generation);

  const start = (draft?: (typeof starters)[number]) => {
    const nextPrompt = draft?.prompt ?? prompt.trim();
    if (!nextPrompt) return;
    onStart({
      title: draft?.title ?? titleFromPrompt(nextPrompt),
      prompt: nextPrompt,
      providerMode,
      ...(generation === 'deterministic' ? {} : { providerModel: generation }),
      attachments,
    });
  };

  const attachFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    if (!files.length) return;
    try {
      setAttachments(await readNodeSlideAttachmentFiles(files, attachments));
      setAttachmentError(null);
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

  return (
    <main className="nodeslide-studio ns-landing" data-testid="nodeslide-landing">
      <header className="ns-landing-header">
        <a className="ns-landing-brand" href="/" aria-label="NodeSlide home">
          <span aria-hidden="true">N</span>
          <strong>NodeSlide</strong>
        </a>
        <button className="ns-landing-open" type="button" onClick={onOpenProjects}>
          <FolderOpen size={15} /> Open deck
        </button>
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
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe the audience, decision, and evidence this deck needs…"
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
              <span className="ns-landing-web" data-active={providerMode === 'openrouter_free'}>
                <Globe2 size={13} aria-hidden="true" />
                {providerMode === 'deterministic' ? 'Web off' : 'Web · OpenRouter'}
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
                  onChange={(event) =>
                    setGeneration(event.target.value as 'deterministic' | NodeSlideAgentModelId)
                  }
                >
                  <option value="deterministic">Private · deterministic</option>
                  {NODESLIDE_AGENT_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.vendor} · {model.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              className="ns-landing-send"
              type="submit"
              aria-label="Continue with this presentation brief"
              disabled={!prompt.trim()}
            >
              <ArrowRight size={18} />
            </button>
          </div>
          {attachmentError ? (
            <output className="ns-landing-file-error" role="alert">
              {attachmentError}
            </output>
          ) : null}
        </form>

        <p className="ns-landing-privacy" aria-live="polite">
          {providerMode === 'deterministic' ? (
            <>
              <ShieldCheck size={13} /> Your brief stays inside NodeSlide by default.
            </>
          ) : (
            <>
              <Sparkles size={13} /> {selectedModel?.label ?? 'The selected model'} via OpenRouter
              {attachments.length > 0
                ? ` + ${attachments.length} file${attachments.length === 1 ? '' : 's'}`
                : ''}
              . Explicit consent is required next.
            </>
          )}
        </p>

        <div className="ns-landing-starters" aria-label="Presentation starters">
          {starters.map((starter) => (
            <button key={starter.label} type="button" onClick={() => start(starter)}>
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
    </main>
  );
}

function titleFromPrompt(prompt: string): string {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  const sentence = compact.split(/[.!?]/, 1)[0]?.trim() || compact;
  return sentence.length <= 72 ? sentence : `${sentence.slice(0, 69).trimEnd()}…`;
}
