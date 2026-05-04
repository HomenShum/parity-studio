import { useMutation, useQuery } from 'convex/react';
import {
  Download,
  Expand,
  FilePlus2,
  FileText,
  Folder,
  Image as ImageIcon,
  PenTool,
  RefreshCw,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { convexHttpUrl } from '../../lib/convexEndpoints';
import { activeSurfaceFor, discoverProjectSurfaces, slugFromPath } from '../../lib/projectSurfaces';
import { FileEditor, starterContentForPath } from '../FileEditor';

interface FilesViewProps {
  runId: Id<'runs'> | null;
  selectedFile: string | null;
  onSelectFile: (path: string | null) => void;
  activeSurfaceSlug?: string | null;
  onSurfaceChange?: (slug: string | null) => void;
  sourceImagePreviewOpen?: boolean;
  onPreviewSourceImage?: () => void;
  onOpenSourceSync?: () => void;
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
  activeSurfaceSlug,
  onSurfaceChange,
  sourceImagePreviewOpen = false,
  onPreviewSourceImage,
  onOpenSourceSync,
}: FilesViewProps) {
  const uiKit = useQuery(api.uiKits.getLatest, runId ? { runId } : 'skip');
  const run = useQuery(api.runs.get, runId ? { runId } : 'skip');
  const sourceImage = useQuery(
    api.runs.getSourceImage,
    runId && sourceImagePreviewOpen ? { runId } : 'skip',
  );
  const createFile = useMutation(api.uiKits.createFile);
  const httpBase = convexHttpUrl();
  const exportHref =
    runId !== null && uiKit && httpBase ? `${httpBase}/api/runs/${runId}/zip` : '#';
  const figmaExportHref =
    runId !== null && uiKit && httpBase ? `${httpBase}/api/runs/${runId}/figma` : '#';
  const canExport = runId !== null && uiKit !== null && uiKit !== undefined;

  const fileCount = uiKit?.files ? Object.keys(uiKit.files as Record<string, string>).length : 0;
  const decomposeStatus = uiKit
    ? '(decompose complete)'
    : runId
      ? '(decompose pending)'
      : '(no run yet)';

  const files = uiKit ? (uiKit.files as Record<string, string>) : null;
  const surfaces = files && uiKit ? discoverProjectSurfaces(files, uiKit.slug) : [];
  const activeSurface =
    files && uiKit ? activeSurfaceFor(files, uiKit.slug, activeSurfaceSlug) : null;
  const visibleFilePaths = files
    ? Object.keys(files).sort(
        (a, b) =>
          surfaceDisplayPriority(a, activeSurface?.slug ?? null) -
            surfaceDisplayPriority(b, activeSurface?.slug ?? null) ||
          fileDisplayPriority(a) - fileDisplayPriority(b) ||
          a.localeCompare(b),
      )
    : [];
  const selectedContent = selectedFile && files ? (files[selectedFile] ?? null) : null;
  const componentCount = visibleFilePaths.filter((path) =>
    /^ui_kits\/[^/]+\/components\/.+\.(tsx|jsx|ts|js)$/i.test(path),
  ).length;
  const previewArtifactCount = visibleFilePaths.filter((path) => /^preview\//i.test(path)).length;
  const hasSourceImage = Boolean(run?.hasSourceImage);
  const sourceImageUrl =
    sourceImage?.base64 && sourceImage.mimeType
      ? `data:${sourceImage.mimeType};base64,${sourceImage.base64}`
      : null;

  async function onCreateFile() {
    if (!uiKit) return;
    const defaultSlug = activeSurface?.slug ?? uiKit.slug;
    const defaultPath = `ui_kits/${defaultSlug}/components/NewComponent.tsx`;
    const path = window.prompt('New file path inside this ui_kit:', defaultPath)?.trim();
    if (!path) return;
    try {
      await createFile({
        uiKitId: uiKit._id,
        path,
        content: starterContentForPath(path),
      });
      onSelectFile(path);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div
      className="files-workspace-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(260px, 340px) 1fr',
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
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <FileGroup label="Files" scroll>
          <button
            type="button"
            onClick={() => void onCreateFile()}
            disabled={!uiKit}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              minHeight: 30,
              marginBottom: 4,
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border-subtle)',
              background: 'var(--color-surface)',
              color: uiKit ? 'var(--color-text-primary)' : 'var(--color-text-faint)',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--font-size-body-sm)',
              fontWeight: 600,
              cursor: uiKit ? 'pointer' : 'not-allowed',
            }}
            title="Create a new file in the live ui_kit"
          >
            <FilePlus2 size={13} />
            New file
          </button>
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
              <div style={{ fontSize: 10, color: 'var(--color-text-faint)' }}>
                {surfaces.length > 1 ? `${surfaces.length} surfaces imported` : decomposeStatus}
              </div>
              <div style={{ fontSize: 10, color: 'var(--color-text-faint)' }}>
                {fileCount} component{fileCount === 1 ? '' : 's'}
              </div>
            </div>
          </div>

          {surfaces.length > 1 ? (
            <div style={{ display: 'grid', gap: 4, marginLeft: 18, marginBottom: 4 }}>
              {surfaces.map((surface) => {
                const selected = activeSurface?.slug === surface.slug;
                return (
                  <button
                    key={surface.slug}
                    type="button"
                    onClick={() => {
                      onSurfaceChange?.(surface.slug);
                      if (surface.entry) onSelectFile(surface.entry);
                    }}
                    title={`${surface.slug} - ${surface.kind}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto',
                      alignItems: 'center',
                      gap: 8,
                      textAlign: 'left',
                      background: selected ? 'var(--color-accent-soft)' : 'var(--color-surface)',
                      color: selected ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '6px 8px',
                      fontFamily: 'var(--font-sans)',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span
                        style={{
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          color: selected ? 'var(--color-accent)' : 'var(--color-text-primary)',
                          fontWeight: 700,
                        }}
                      >
                        {surface.label}
                      </span>
                      <span
                        style={{
                          display: 'block',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 9,
                          color: 'var(--color-text-faint)',
                        }}
                      >
                        {surface.kind} / {surface.fileCount} files
                      </span>
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 9,
                        color: 'var(--color-text-faint)',
                      }}
                    >
                      {surface.hasIndex ? 'index' : 'html'}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {files
            ? visibleFilePaths.map((path) => {
                const selected = path === selectedFile;
                const surfaceSlug = slugFromPath(path);
                return (
                  <button
                    key={path}
                    type="button"
                    onClick={() => {
                      if (surfaceSlug) onSurfaceChange?.(surfaceSlug);
                      onSelectFile(selected ? null : path);
                    }}
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
                      minHeight: 22,
                      marginLeft: 18,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      lineHeight: 1.25,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    <FileText size={11} />
                    {displayFilePath(path)}
                  </button>
                );
              })
            : null}
        </FileGroup>

        <FileGroup label="Source">
          <button
            type="button"
            onClick={hasSourceImage ? onPreviewSourceImage : undefined}
            disabled={!hasSourceImage}
            aria-pressed={sourceImagePreviewOpen}
            aria-label={hasSourceImage ? 'Preview source image' : 'No source image available'}
            style={{
              display: 'grid',
              gridTemplateColumns: sourceImageUrl ? '56px 1fr auto' : 'auto 1fr auto',
              alignItems: 'center',
              gap: 8,
              padding: 8,
              borderRadius: 'var(--radius-md)',
              border: `1px solid ${sourceImagePreviewOpen ? 'var(--color-accent)' : 'var(--color-border-subtle)'}`,
              background: sourceImagePreviewOpen
                ? 'var(--color-accent-soft)'
                : 'var(--color-surface)',
              textAlign: 'left',
              cursor: hasSourceImage ? 'pointer' : 'not-allowed',
              opacity: hasSourceImage ? 1 : 0.62,
              boxShadow: sourceImagePreviewOpen ? 'var(--shadow-soft)' : 'none',
            }}
          >
            {sourceImageUrl ? (
              <span
                style={{
                  width: 56,
                  height: 42,
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border-subtle)',
                  overflow: 'hidden',
                  background: 'var(--color-background-secondary)',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <img
                  src={sourceImageUrl}
                  alt=""
                  aria-hidden
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              </span>
            ) : (
              <ImageIcon size={14} style={{ color: 'var(--color-text-secondary)', marginTop: 2 }} />
            )}
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
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--color-text-faint)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {hasSourceImage
                  ? sourceImagePreviewOpen && !sourceImageUrl
                    ? 'loading original reference...'
                    : 'click to compare original reference'
                  : 'no inline source stored'}
              </div>
            </div>
            {hasSourceImage ? (
              <Expand
                size={13}
                style={{
                  color: sourceImagePreviewOpen ? 'var(--color-accent)' : 'var(--color-text-faint)',
                }}
              />
            ) : null}
          </button>
          <button
            type="button"
            onClick={onOpenSourceSync}
            disabled={!runId}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border-subtle)',
              background: 'var(--color-surface)',
              color: runId ? 'var(--color-text-primary)' : 'var(--color-text-faint)',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--font-size-body-sm)',
              cursor: runId ? 'pointer' : 'not-allowed',
            }}
            title="Patch this saved kit or recapture the source app as a new run revision"
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <RefreshCw size={13} />
              Version sync
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--color-text-faint)',
              }}
            >
              patch / recapture
            </span>
          </button>
        </FileGroup>

        <FileGroup label="Handoff">
          {canExport ? (
            <>
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
              <a
                href={figmaExportHref}
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
                <PenTool size={13} />
                Export Figma bridge
                <span
                  style={{
                    marginLeft: 'auto',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: 'var(--color-text-faint)',
                  }}
                >
                  plugin ZIP
                </span>
              </a>
            </>
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
              {fileCount} files - {formatSize(estimateZipSize(files))}
            </div>
          ) : null}
        </FileGroup>
      </div>

      <div
        aria-label="File details"
        style={{
          minWidth: 0,
          minHeight: 0,
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--color-surface)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            minHeight: 54,
            borderBottom: '1px solid var(--color-border-subtle)',
            padding: '0 var(--space-5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-4)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: 'var(--tracking-eyebrow)',
                color: 'var(--color-text-faint)',
                textTransform: 'uppercase',
              }}
            >
              File workspace
            </div>
            <div
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--font-size-body)',
                fontWeight: 600,
                color: 'var(--color-text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {selectedFile ? displayFilePath(selectedFile) : 'Select a component to scope work'}
            </div>
          </div>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--color-text-faint)',
              whiteSpace: 'nowrap',
            }}
          >
            browse + edit
          </span>
        </div>

        {selectedContent !== null && selectedFile !== null ? (
          <div
            style={{
              padding: 'var(--space-5)',
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-4)',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: 'var(--space-3)',
              }}
            >
              <Stat label="Path" value={displayFilePath(selectedFile)} />
              <Stat label="Size" value={formatSize(new Blob([selectedContent]).size)} />
              <Stat label="Scope" value="next comment" />
            </div>
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-accent)',
                background: 'var(--color-accent-soft)',
                color: 'var(--color-accent)',
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--font-size-body-sm)',
              }}
            >
              This file is now the scoped target for comments and agent edits. Use Preview for
              visual bbox comments; edit the actual code below.
            </div>
            <div
              style={{
                flex: 1,
                minHeight: 0,
                height: '100%',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border-subtle)',
                overflow: 'hidden',
              }}
            >
              <FileEditor runId={runId} selectedFile={selectedFile} onSelectFile={onSelectFile} />
            </div>
          </div>
        ) : (
          <div
            style={{
              padding: 'var(--space-6)',
              minHeight: 0,
              overflow: 'auto',
              display: 'grid',
              gridTemplateRows: 'auto auto 1fr',
              gap: 'var(--space-5)',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 22,
                lineHeight: 1.2,
                color: 'var(--color-text-primary)',
                maxWidth: 560,
              }}
            >
              File tree, source, and handoff stay here. Use Preview when you want the live rendered
              artifact.
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: 'var(--space-3)',
                maxWidth: 720,
              }}
            >
              <Stat label="Components" value={`${componentCount}`} />
              <Stat label="Preview artifacts" value={`${previewArtifactCount}`} />
              <Stat label="Total files" value={`${fileCount}`} />
            </div>
            <div
              style={{
                border: '1px dashed var(--color-border-strong)',
                borderRadius: 'var(--radius-lg)',
                display: 'grid',
                placeItems: 'center',
                minHeight: 220,
                color: 'var(--color-text-faint)',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                textAlign: 'center',
                padding: 'var(--space-6)',
              }}
            >
              Select a file on the left to inspect its path, size, scoped-comment target, and source
              excerpt.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FileGroup({
  label,
  children,
  scroll = false,
}: {
  label: string;
  children: ReactNode;
  scroll?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
        minHeight: scroll ? 0 : undefined,
        flex: scroll ? '1 1 0' : '0 0 auto',
        overflow: scroll ? 'hidden' : 'visible',
      }}
    >
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
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          minHeight: 0,
          flex: scroll ? '1 1 auto' : undefined,
          overflowY: scroll ? 'auto' : 'visible',
          paddingRight: scroll ? 4 : 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border-subtle)',
        background: 'var(--color-background)',
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--color-text-faint)',
          textTransform: 'uppercase',
          letterSpacing: '0.02em',
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 4,
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--font-size-body-sm)',
          fontWeight: 600,
          color: 'var(--color-text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={value}
      >
        {value}
      </div>
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

function surfaceDisplayPriority(path: string, activeSlug: string | null): number {
  const slug = slugFromPath(path);
  if (!slug) return 2;
  if (slug === activeSlug) return 0;
  return 1;
}

function displayFilePath(path: string): string {
  if (path.startsWith('ui_kits/')) return path.replace(/^ui_kits\//, '');
  return path;
}

function estimateZipSize(files: Record<string, string> | null): number {
  if (!files) return 0;
  let total = 0;
  for (const v of Object.values(files)) total += new Blob([v]).size;
  return Math.round(total * 0.4);
}
