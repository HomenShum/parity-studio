import { useQuery } from 'convex/react';
import { Eye, Folder, RefreshCw, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { useT } from '../../lib/i18n';
import { activeSurfaceFor, discoverProjectSurfaces, slugFromPath } from '../../lib/projectSurfaces';
import type { Device } from '../HeaderActions';
import { ArtifactPreview } from './ArtifactPreview';
import { FilesView } from './FilesView';
import { InspirationView } from './InspirationView';
import { LandingGuidance } from './LandingGuidance';
import { SourceImagePopover } from './SourceImagePopover';
import { SourceSyncModal } from './SourceSyncModal';
import { TweakPanel } from './TweakPanel';

interface CanvasPanelProps {
  runId: Id<'runs'> | null;
  selectedFile: string | null;
  onSelectFile: (path: string | null) => void;
  activeTab?: CanvasTab;
  onTabChange?: (tab: CanvasTab) => void;
  zoom: number;
  device: Device;
  commentModeActive: boolean;
  activeSurfaceSlug: string | null;
  onSurfaceChange: (slug: string | null) => void;
}

export type CanvasTab = 'files' | 'preview' | 'inspiration';

const TAB_META: Record<CanvasTab, { label: string; Icon: typeof Folder }> = {
  files: { label: 'canvas.files', Icon: Folder },
  preview: { label: 'canvas.preview', Icon: Eye },
  inspiration: { label: 'canvas.inspiration', Icon: Sparkles },
};

export function CanvasPanel({
  runId,
  selectedFile,
  onSelectFile,
  activeTab,
  onTabChange,
  zoom,
  device,
  commentModeActive,
  activeSurfaceSlug,
  onSurfaceChange,
}: CanvasPanelProps) {
  const t = useT();
  const [internalTab, setInternalTab] = useState<CanvasTab>('files');
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [sourcePreviewOpen, setSourcePreviewOpen] = useState(false);
  const [sourceSyncOpen, setSourceSyncOpen] = useState(false);
  const uiKit = useQuery(api.uiKits.getLatest, runId ? { runId } : 'skip');
  const files = (uiKit?.files as Record<string, string> | undefined) ?? {};
  const surfaces = uiKit ? discoverProjectSurfaces(files, uiKit.slug) : [];
  const activeSurface = uiKit ? activeSurfaceFor(files, uiKit.slug, activeSurfaceSlug) : null;
  const tab = activeTab ?? internalTab;
  const activeTabRef = useRef(activeTab);
  const onTabChangeRef = useRef(onTabChange);

  function setTab(nextTab: CanvasTab) {
    if (activeTab === undefined) setInternalTab(nextTab);
    onTabChange?.(nextTab);
  }

  useEffect(() => {
    activeTabRef.current = activeTab;
    onTabChangeRef.current = onTabChange;
  }, [activeTab, onTabChange]);

  useEffect(() => {
    const nextTab = runId === null ? 'files' : 'preview';
    if (activeTabRef.current === undefined) setInternalTab(nextTab);
    onTabChangeRef.current?.(nextTab);
    setTweaksOpen(false);
    setSourcePreviewOpen(false);
  }, [runId]);

  useEffect(() => {
    const slug = selectedFile ? slugFromPath(selectedFile) : null;
    if (slug && slug !== activeSurfaceSlug) onSurfaceChange(slug);
  }, [activeSurfaceSlug, onSurfaceChange, selectedFile]);

  return (
    <section
      style={{
        flex: 1,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-background)',
        minWidth: 0,
        minHeight: 0,
      }}
      aria-label={t('canvas.label')}
    >
      <div
        role="tablist"
        aria-label={t('canvas.tabMode')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-7)',
          height: 48,
          padding: '0 var(--space-7)',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}
      >
        {(Object.keys(TAB_META) as CanvasTab[]).map((tabId) => {
          const active = tabId === tab;
          const Icon = TAB_META[tabId].Icon;
          return (
            <button
              key={tabId}
              type="button"
              role="tab"
              aria-selected={active ? 'true' : 'false'}
              onClick={() => setTab(tabId)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'transparent',
                border: 'none',
                padding: '14px 0 12px',
                borderBottom: `2px solid ${active ? 'var(--color-accent)' : 'transparent'}`,
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--font-size-body-sm)',
                color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                fontWeight: active ? 600 : 500,
                cursor: 'pointer',
                marginBottom: -1,
              }}
            >
              <Icon size={14} />
              {t(TAB_META[tabId].label)}
            </button>
          );
        })}
        <span style={{ flex: 1 }} aria-hidden />
        {surfaces.length > 1 ? (
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              minWidth: 220,
              padding: '5px 8px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border-subtle)',
              background: 'var(--color-surface)',
              boxShadow: 'var(--shadow-soft)',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--color-text-faint)',
                whiteSpace: 'nowrap',
              }}
            >
              Surface
            </span>
            <select
              aria-label="Active project surface"
              data-testid="surface-select"
              value={activeSurface?.slug ?? ''}
              onChange={(event) => {
                const surface = surfaces.find((item) => item.slug === event.target.value);
                if (!surface) return;
                onSurfaceChange(surface.slug);
                if (surface.entry) onSelectFile(surface.entry);
              }}
              style={{
                flex: 1,
                minWidth: 0,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: 'var(--color-text-primary)',
                fontFamily: 'var(--font-sans)',
                fontSize: 12,
                fontWeight: 760,
                cursor: 'pointer',
              }}
            >
              {surfaces.map((surface) => (
                <option key={surface.slug} value={surface.slug}>
                  {surface.label} - {surface.kind}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {runId !== null ? (
          <button
            type="button"
            onClick={() => setSourceSyncOpen(true)}
            aria-label="Open version sync and source recapture"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 10px',
              borderRadius: 'var(--radius-md)',
              background: sourceSyncOpen ? 'var(--color-accent-soft)' : 'transparent',
              color: sourceSyncOpen ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              border: `1px solid ${sourceSyncOpen ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--font-size-body-sm)',
              cursor: 'pointer',
            }}
            title="Version control: patch this saved kit or recapture the source route as a new revision"
          >
            <RefreshCw size={13} />
            Version sync
          </button>
        ) : null}
        {tab === 'preview' && runId !== null ? (
          <button
            type="button"
            onClick={() => setTweaksOpen((v) => !v)}
            aria-pressed={tweaksOpen}
            aria-label="Toggle design token tweaks panel"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 10px',
              borderRadius: 'var(--radius-md)',
              background: tweaksOpen ? 'var(--color-accent-soft)' : 'transparent',
              color: tweaksOpen ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              border: `1px solid ${tweaksOpen ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--font-size-body-sm)',
              cursor: 'pointer',
            }}
          >
            <SlidersHorizontal size={13} />
            Design tokens
          </button>
        ) : null}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          width: '100%',
          display: 'block',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {tab === 'files' ? (
          <div
            style={{
              width: '100%',
              height: '100%',
              minWidth: 0,
              minHeight: 0,
              overflow: 'auto',
            }}
          >
            {runId === null ? (
              <LandingGuidance />
            ) : (
              <FilesView
                runId={runId}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                activeSurfaceSlug={activeSurface?.slug ?? activeSurfaceSlug}
                onSurfaceChange={onSurfaceChange}
                sourceImagePreviewOpen={sourcePreviewOpen}
                onPreviewSourceImage={() => setSourcePreviewOpen(true)}
                onOpenSourceSync={() => setSourceSyncOpen(true)}
              />
            )}
          </div>
        ) : tab === 'preview' ? (
          <div
            style={{
              width: '100%',
              height: '100%',
              minWidth: 0,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'row',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 0,
                padding: 'var(--space-6) var(--space-7)',
                display: 'flex',
                flexDirection: 'column',
                boxSizing: 'border-box',
              }}
            >
              <ArtifactPreview
                runId={runId}
                selectedFile={selectedFile}
                zoom={zoom}
                device={device}
                commentModeActive={commentModeActive}
                activeSurfaceSlug={activeSurface?.slug ?? activeSurfaceSlug}
              />
            </div>
            {tweaksOpen ? (
              <TweakPanel
                uiKitId={uiKit?._id ?? null}
                slug={uiKit?.slug ?? null}
                activeSurfaceSlug={activeSurface?.slug ?? activeSurfaceSlug}
                files={(uiKit?.files as Record<string, string>) ?? {}}
                onClose={() => setTweaksOpen(false)}
              />
            ) : null}
          </div>
        ) : tab === 'inspiration' ? (
          <InspirationView runId={runId} />
        ) : null}

        {/* SourceImagePopover floats bottom-right of the canvas pane.
            It self-hides when there's no run/source, but can be opened from Files. */}
        <SourceImagePopover
          runId={runId}
          selectedFile={selectedFile}
          open={sourcePreviewOpen}
          onOpenChange={setSourcePreviewOpen}
        />
        <SourceSyncModal
          runId={runId}
          open={sourceSyncOpen}
          onClose={() => setSourceSyncOpen(false)}
          onOpenFile={(path) => {
            onSelectFile(path);
            setTab('files');
          }}
        />
      </div>
    </section>
  );
}
