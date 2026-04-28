import { ChatComposerSurface } from './components/composer/ChatComposerSurface';

/**
 * App — root surface. Replaced the original 3-column workspace shell
 * (FilesPanel / PreviewPane / ActionSidebar) with the platform-generated
 * agentic-sidebar-chat composer for v0.0.3.
 *
 * Provenance for the composer: gpt-image-2 → claude-opus-4-1 decompose →
 * claude-sonnet-4-5 visual judge, parityScore 1.00 verified, $0.78, 305s.
 * See DOGFOOD.md "v0.0.3 — composer dogfood" section.
 *
 * The old workspace components (TopBar, InputBar, FilesPanel, PreviewPane,
 * ActionSidebar) live in src/components/* unchanged. Keeping them around
 * because their useQuery wiring against runs/artifacts/uiKits/parityReports
 * is the proven path — the composer surface needs to take those over in a
 * follow-up (threads = runs, citations = sources, top cards = ui_kit slugs).
 */
export default function App() {
  return <ChatComposerSurface />;
}
