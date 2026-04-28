import { useState } from 'react';

/**
 * AgentChatSidebar — compact threads rail on the LEFT of the workspace.
 *
 * Pattern reference: NodeBench AI threads rail (brand mark + THREADS list +
 * inline composer). Adapted for parity-studio: brand "PS", threads scoped to
 * parity runs. This is purely additive — sits to the LEFT of the existing
 * 3-column main-content (FilesPanel / PreviewPane / ActionSidebar) and does
 * not modify any existing surfaces.
 *
 * v0.0.4 scaffold: thread state is local; future wiring will read recent
 * runs from Convex (`runs:listRecent`) and allow switching `currentRunId`.
 */
type Thread = {
  id: string;
  title: string;
  meta: string;
};

const PLACEHOLDER_THREADS: Thread[] = [
  { id: 't1', title: 'Decompose checkout sketch into ui_kit', meta: '2h • 6 src' },
  { id: 't2', title: 'Iterate dashboard cards on visual gaps', meta: '5h • 3 src' },
  { id: 't3', title: 'Verify parity for landing hero variant', meta: '1d • 4 src' },
  { id: 't4', title: 'Handoff bundle to claude code agent', meta: '2d • 2 src' },
  { id: 't5', title: 'Rebuild marketing nav from screenshot', meta: '3d • 5 src' },
];

export function AgentChatSidebar() {
  const [activeId, setActiveId] = useState<string>('t1');
  const [draft, setDraft] = useState('');

  return (
    <div className="agent-chat-rail-inner">
      <div className="agent-chat-brand">
        <span className="agent-chat-brand-mark" aria-hidden="true">
          PS
        </span>
        <span className="agent-chat-brand-word">parity studio</span>
      </div>

      <div className="agent-chat-section-header">
        <span>THREADS</span>
        <button type="button" className="agent-chat-add" aria-label="New thread">
          +
        </button>
      </div>

      <ul className="agent-chat-thread-list" role="list">
        {PLACEHOLDER_THREADS.map((t) => {
          const active = t.id === activeId;
          return (
            <li key={t.id}>
              <button
                type="button"
                className={`agent-chat-thread${active ? ' active' : ''}`}
                onClick={() => setActiveId(t.id)}
                aria-current={active ? 'true' : undefined}
              >
                <span className="agent-chat-thread-title">{t.title}</span>
                <span className="agent-chat-thread-meta">{t.meta}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="agent-chat-composer">
        <textarea
          className="agent-chat-composer-input"
          placeholder="ask the agent…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          aria-label="Ask the agent"
        />
        <button
          type="button"
          className="agent-chat-composer-send"
          disabled={draft.trim().length === 0}
        >
          send
        </button>
      </div>
    </div>
  );
}
