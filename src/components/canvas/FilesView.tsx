import { useQuery } from 'convex/react';
import { Download, FileText, Folder, Image as ImageIcon } from 'lucide-react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { ArtifactPreview } from './ArtifactPreview';

interface FilesViewProps {
  runId: Id<'runs'> | null;
  selectedFile: string | null;
  onSelectFile: (path: string | null) => void;
  zoom: number;
  commentModeActive: boolean;
}

function convexHttpBase(): string | null {
  const fromEnv = import.meta.env['VITE_CONVEX_HTTP_URL'] as string | undefined;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const wsUrl = (import.meta.env['VITE_CONVEX_URL'] as string | undefined) ?? '';
  if (!wsUrl) return null;
  return wsUrl.replace('.convex.cloud', '.convex.site').replace(/\/$/, '');
}

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function FilesView({
  runId,
  selectedFile,
  onSelectFile,
  zoom,
  commentModeActive,
}: FilesViewProps) {
  const uiKit = useQuery(api.uiKits.getLatest, runId ? { runId } : 'skip');
  const httpBase = convexHttpBase();
  const exportHref =
    runId !== null && uiKit && httpBase ? `${httpBase}/api/runs/${runId}/zip` : '#';
  const canExport = runId !== null && uiKit !== null && uiKit !== undefined && httpBase !== null;

  const fileCount =
    uiKit && uiKit.files ? Object.keys(uiKit.files as Record<string, string>).length : 0;
  const decomposeStatus = uiKit ? '(decompose complete)' : runId ? '(decompose pending)' : '(no run yet)';

  const files = uiKit ? (uiKit.files as Record<string, string>) : null;
  const visibleFilePaths = files
    ? Object.keys(files)
        .sort((a, b) => fileDisplayPriority(a) - fileDisplayPriority(b) || a.localeCompare(b))
        .slice(0, 10)
    : [];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '240px 1fr',
        gap: 'var(--space-7)',
        height: '100%',
        width: '100%',
        minHeight: 0,
        padding: 'var(--space-6) var(--space-6) var(--space-7) var(--space-7)',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-6)',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--font-size-body-sm)',
          color: 'var(--color-text-secondary)',
          minWidth: 0,
        }}
      >
        <FileGroup label="Files">
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '6px 8px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-surface-hover)',
            }}
          >
            <Folder size={14} style={{ color: 'var(--color-warning)', marginTop: 2 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>ui_kits/</div>
              <div style={{ fontSize: 10, color: 'var(--color-text-faint)' }}>{decomposeStatus}</div>
              <div style={{ fontSize: 10, color: 'var(--color-text-faint)' }}>
                {fileCount} component{fileCount === 1 ? '' : 's'}
              </div>
            </div>
          </div>

          {files
            ? visibleFilePaths.map((path) => {
                  const selected = path === selectedFile;
                  return (
                    <button
                      key={path}
                      type="button"
                      onClick={() => onSelectFile(selected ? null : path)}
                      title={`Scope next comment to ${path}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        textAlign: 'left',
                        background: selected ? 'var(--color-accent-soft)' : 'transparent',
                        color: selected ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        padding: '4px 8px',
                        marginLeft: 18,
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      <FileText size={11} />
                      {path.split('/').slice(-1)[0]}
                    </button>
                  );
                })
            : null}
        </FileGroup>

        <FileGroup label="Source">
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '6px 8px',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <ImageIcon size={14} style={{ color: 'var(--color-text-secondary)', marginTop: 2 }} />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  color: 'var(--color-text-primary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                }}
              >
                source image
              </div>
              <div style={{ fontSize: 10, color: 'var(--color-text-faint)', fontFamily: 'var(--font-mono)' }}>
                inline base64 · png/jpeg/webp
              </div>
            </div>
          </div>
        </FileGroup>

        <FileGroup label="Handoff">
          {canExport ? (
            <a
              href={exportHref}
              download
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border-subtle)',
                color: 'var(--color-text-primary)',
                textDecoration: 'none',
                fontSize: 'var(--font-size-body-sm)',
              }}
            >
              <Download size={13} />
              Export ZIP
              <span
                style={{
                  marginLeft: 'auto',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--color-text-faint)',
                }}
              >
                ui_kits_bundle.zip
              </span>
            </a>
          ) : (
            <div
              style={{
                padding: '8px 10px',
                fontSize: 11,
                color: 'var(--color-text-faint)',
              }}
            >
              run a pipeline to enable export
            </div>
          )}
          {fileCount > 0 ? (
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--color-text-faint)',
                paddingLeft: 10,
              }}
            >
              {fileCount} files · {formatSize(estimateZipSize(files))}
            </div>
          ) : null}
        </FileGroup>
      </div>

      <ArtifactPreview
        runId={runId}
        selectedFile={selectedFile}
        zoom={zoom}
        device="desktop"
        commentModeActive={commentModeActive}
      />
    </div>
  );
}

function FileGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 'var(--tracking-eyebrow)',
          color: 'var(--color-text-secondary)',
          textTransform: 'uppercase',
          paddingLeft: 4,
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</div>
    </div>
  );
}

function fileDisplayPriority(path: string): number {
  if (/^ui_kits\/[^/]+\/components\/.+\.(tsx|jsx|ts|js)$/i.test(path)) return 0;
  if (/^ui_kits\/[^/]+\/(tokens\.css|manifest\.json|tweak-schema\.json)$/i.test(path)) return 1;
  if (/^preview\/component-/i.test(path)) return 2;
  if (/^ui_kits\/[^/]+\/(README|HANDOFF)\.md$/i.test(path)) return 3;
  return 4;
}

function estimateZipSize(files: Record<string, string> | null): number {
  if (!files) return 0;
  let total = 0;
  for (const v of Object.values(files)) total += new Blob([v]).size;
  return Math.round(total * 0.4);
}
