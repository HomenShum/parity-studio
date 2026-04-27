import { ActionSidebar } from './components/ActionSidebar';
import { FilesPanel } from './components/FilesPanel';
import { InputBar } from './components/InputBar';
import { PreviewPane } from './components/PreviewPane';
import { TopBar } from './components/TopBar';

/**
 * App layout structure verbatim from the platform-generated index.html
 * (parity-studio-before run, claude-opus-4-1 decompose). Container classes
 * (`.main-content`, `.sidebar`, `.center-section`, `.right-panel`) match
 * the platform's CSS one-to-one. Each child component renders its own
 * `.section` blocks and interactive handlers.
 */
export default function App() {
  return (
    <>
      <TopBar />
      <InputBar />
      <main className="main-content" id="main-content">
        <aside className="sidebar" aria-label="Files and handoff">
          <FilesPanel />
        </aside>
        <section className="center-section" aria-label="Artifact preview">
          <PreviewPane />
        </section>
        <aside className="right-panel" aria-label="Pipeline status and tools">
          <ActionSidebar />
        </aside>
      </main>
    </>
  );
}
