import { Code, Eye, Folder } from 'lucide-react';
import { useState } from 'react';
import type { Id } from '../../../convex/_generated/dataModel';
import { FileEditor } from '../FileEditor';
import { ArtifactPreview } from './ArtifactPreview';
import { FilesView } from './FilesView';

interface CanvasPanelProps {
  runId: Id<'runs'> | null;
  selectedFile: string | null;
  onSelectFile: (path: string | null) => void;
  zoom: number;
  commentModeActive: boolean;
}

type Tab = 'files' | 'preview' | 'code';

const TAB_META: Record<Tab, { label: string; Icon: typeof Folder }> = {
  files: { label: 'Files', Icon: Folder },
  preview: { label: 'preview', Icon: Eye },
  code: { label: 'code', Icon: Code },
};

export function CanvasPanel({
  runId,
  selectedFile,
  onSelectFile,
  zoom,
  commentModeActive,
}: CanvasPanelProps) {
  const [tab, setTab] = useState<Tab>('files');

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
            <FilesView
              runId={runId}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              zoom={zoom}
              commentModeActive={commentModeActive}
            />
          </div>
        ) : tab === 'preview' ? (
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
            <ArtifactPreview
              runId={runId}
              selectedFile={selectedFile}
              zoom={zoom}
              commentModeActive={commentModeActive}
            />
          </div>
        ) : (
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
        )}
      </div>
    </section>
  );
}
