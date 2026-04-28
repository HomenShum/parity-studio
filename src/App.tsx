import { useState } from 'react';
import type { Id } from '../convex/_generated/dataModel';
import { ActionSidebar } from './components/ActionSidebar';
import { AgentChatSidebar } from './components/AgentChatSidebar';
import { FilesPanel } from './components/FilesPanel';
import { InputBar } from './components/InputBar';
import { PreviewPane } from './components/PreviewPane';
import { TopBar } from './components/TopBar';

/**
 * App layout structure verbatim from the platform-generated index.html
 * (parity-studio-before run, claude-opus-4-1 decompose). Container classes
 * match the platform's CSS one-to-one.
 *
 * State: `currentRunId` is the single piece of app state. InputBar.onRunStarted
 * sets it; all three panels (FilesPanel, PreviewPane, ActionSidebar) read it
 * and run their own useQuery against the matching Convex function.
 */
export default function App() {
  const [currentRunId, setCurrentRunId] = useState<Id<'runs'> | null>(null);
  const [commentModeActive, setCommentModeActive] = useState(false);

  return (
    <>
      <TopBar />
      <InputBar onRunStarted={setCurrentRunId} />
      <main className="main-content" id="main-content">
        <aside className="agent-chat-rail" aria-label="Agent chat threads">
          <AgentChatSidebar />
        </aside>
        <aside className="sidebar" aria-label="Files and handoff">
          <FilesPanel runId={currentRunId} />
        </aside>
        <section className="center-section" aria-label="Artifact preview">
          <PreviewPane runId={currentRunId} commentModeActive={commentModeActive} />
        </section>
        <aside className="right-panel" aria-label="Pipeline status and tools">
          <ActionSidebar
            runId={currentRunId}
            commentModeActive={commentModeActive}
            onToggleCommentMode={() => setCommentModeActive((v) => !v)}
          />
        </aside>
      </main>
    </>
  );
}
