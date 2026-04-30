import { useQuery } from 'convex/react';
import { Eye, Folder, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import type { Device } from '../HeaderActions';
import { ArtifactPreview } from './ArtifactPreview';
import { FilesView } from './FilesView';
import { LandingGuidance } from './LandingGuidance';
import { SourceImagePopover } from './SourceImagePopover';
import { TweakPanel } from './TweakPanel';

interface CanvasPanelProps {
  runId: Id<'runs'> | null;
  selectedFile: string | null;
  onSelectFile: (path: string | null) => void;
  zoom: number;
  device: Device;
  commentModeActive: boolean;
}

type Tab = 'files' | 'preview';

const TAB_META: Record<Tab, { label: string; Icon: typeof Folder }> = {
  files: { label: 'Files', Icon: Folder },
  preview: { label: 'Preview', Icon: Eye },
};

export function CanvasPanel({
  runId,
  selectedFile,
  onSelectFile,
  zoom,
  device,
  commentModeActive,
}: CanvasPanelProps) {
  const [tab, setTab] = useState<Tab>('files');
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [sourcePreviewOpen, setSourcePreviewOpen] = useState(false);
  const uiKit = useQuery(api.uiKits.getLatest, runId ? { runId } : 'skip');

  useEffect(() => {
    setTab(runId === null ? 'files' : 'preview');
    setTweaksOpen(false);
    setSourcePreviewOpen(false);
  }, [runId]);

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
      aria-label="Artifact canvas"
    >
      <div
        role="tablist"
        aria-label="Canvas view mode"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-7)',
          height: 48,
          padding: '0 var(--space-7)',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}
      >
        {(Object.keys(TAB_META) as Tab[]).map((t) => {
          const active = t === tab;
          const Icon = TAB_META[t].Icon;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={active ? 'true' : 'false'}
              onClick={() => setTab(t)}
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
              {TAB_META[t].label}
            </button>
          );
        })}
        <span style={{ flex: 1 }} aria-hidden />
        {tab === 'preview' && runId !== null ? (
          <button
            type="button"
            onClick={() => setTweaksOpen((v) => !v)}
            aria-pressed={tweaksOpen}
            aria-label="Toggle tweaks panel"
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
            Tweaks
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
                sourceImagePreviewOpen={sourcePreviewOpen}
                onPreviewSourceImage={() => setSourcePreviewOpen(true)}
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
              />
            </div>
            {tweaksOpen ? (
              <TweakPanel
                uiKitId={uiKit?._id ?? null}
                slug={uiKit?.slug ?? null}
                files={(uiKit?.files as Record<string, string>) ?? {}}
                onClose={() => setTweaksOpen(false)}
              />
            ) : null}
          </div>
        ) : null}

        {/* SourceImagePopover floats bottom-right of the canvas pane.
            It self-hides when there's no run/source, but can be opened from Files. */}
        <SourceImagePopover
          runId={runId}
          selectedFile={selectedFile}
          open={sourcePreviewOpen}
          onOpenChange={setSourcePreviewOpen}
        />
      </div>
    </section>
  );
}
