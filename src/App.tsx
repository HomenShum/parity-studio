import { InputBar } from './components/InputBar';
import { ActionSidebar } from './components/ActionSidebar';
import { FilesPanel } from './components/FilesPanel';
import { PreviewPane } from './components/PreviewPane';
import { TopBar } from './components/TopBar';

export default function App() {
  return (
    <div className="flex h-screen w-screen flex-col bg-[var(--color-bg)] text-[var(--color-content)]">
      <TopBar />
      <InputBar />
      <main className="flex flex-1 min-h-0">
        <FilesPanel />
        <PreviewPane />
        <ActionSidebar />
      </main>
    </div>
  );
}
