import { useQuery } from 'convex/react';
import { Bot, Code, Eye, Folder, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { FileEditor } from '../FileEditor';
import type { Device } from '../HeaderActions';
import { ArtifactPreview } from './ArtifactPreview';
import { ChatPanel } from './ChatPanel';
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

type Tab = 'files' | 'preview' | 'code' | 'chat';

const TAB_META: Record<Tab, { label: string; Icon: typeof Folder }> = {
  files: { label: 'Files', Icon: Folder },
  preview: { label: 'preview', Icon: Eye },
  code: { label: 'code', Icon: Code },
  chat: { label: 'chat', Icon: Bot },
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
  const uiKit = useQuery(api.uiKits.getLatest, runId ? { runId } : 'skip');

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
                zoom={zoom}
                commentModeActive={commentModeActive}
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
                onAutoFixKicked={() => setTab('chat')}
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
        ) : tab === 'code' ? (
          <div
            style={{
              width: '100%',
              height: '100%',
              minWidth: 0,
              minHeight: 0,
              padding: 'var(--space-6) var(--space-7)',
              display: 'flex',
              flexDirection: 'column',
              boxSizing: 'border-box',
            }}
          >
            <FileEditor runId={runId} selectedFile={selectedFile} />
          </div>
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              minWidth: 0,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              boxSizing: 'border-box',
            }}
          >
            <ChatPanel runId={runId} />
          </div>
        )}

        {/* SourceImagePopover floats bottom-right of the canvas pane.
            Self-hides when there's no run, no scoped file, or no source. */}
        <SourceImagePopover runId={runId} selectedFile={selectedFile} />
      </div>
    </section>
  );
}
