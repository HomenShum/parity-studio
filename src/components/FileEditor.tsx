import { useMutation, useQuery } from 'convex/react';
import { useEffect, useState } from 'react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

/**
 * FileEditor — Monaco-backed in-app editor for a single ui_kit file.
 *
 * Closes the "edit a component in-app" gap from issue #225. Activated by
 * picking a file in FilesPanel; PreviewPane swaps its iframe for this
 * editor when the user selects a file in the unified Files workspace.
 *
 * Storage model: edits write to `uiKits.patchFile` which mutates the
 * latest ui_kit's `files` map in place. The next iterate run reads the
 * edited code as the "current" state. The export-zip endpoint also reads
 * from the same map, so edits flow into both downstream paths.
 *
 * Monaco loads from CDN by default — keeps our bundle ~280KB instead of
 * ballooning by ~3MB.
 */
interface FileEditorProps {
  runId: Id<'runs'> | null;
  selectedFile: string | null;
  onSelectFile?: (path: string | null) => void;
}

function languageForPath(path: string): string {
  if (path.endsWith('.tsx') || path.endsWith('.ts')) return 'typescript';
  if (path.endsWith('.jsx') || path.endsWith('.js')) return 'javascript';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.html')) return 'html';
  if (path.endsWith('.svg')) return 'xml';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.md')) return 'markdown';
  return 'plaintext';
}

export function starterContentForPath(path: string): string {
  const name =
    path
      .split('/')
      .pop()
      ?.replace(/\.[^.]+$/, '') || 'NewFile';
  if (path.endsWith('.tsx')) {
    const componentName =
      name
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .replace(/(?:^|\s)([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase())
        .replace(/[^a-zA-Z0-9]/g, '') || 'NewComponent';
    return `export function ${componentName}() {\n  return (\n    <section>\n      <h2>${componentName}</h2>\n    </section>\n  );\n}\n`;
  }
  if (path.endsWith('.css')) return ':root {\n  /* Add tokens or styles here. */\n}\n';
  if (path.endsWith('.json')) return '{\n  "schemaVersion": 1\n}\n';
  if (path.endsWith('.md')) return `# ${name}\n\n`;
  if (path.endsWith('.html')) return '<section>\n  <!-- Add markup here. -->\n</section>\n';
  return '';
}

export function FileEditor({ runId, selectedFile, onSelectFile }: FileEditorProps) {
  const uiKit = useQuery(api.uiKits.getLatest, runId ? { runId } : 'skip');
  const patchFile = useMutation(api.uiKits.patchFile);
  const renameFile = useMutation(api.uiKits.renameFile);
  const deleteFile = useMutation(api.uiKits.deleteFile);
  const [draft, setDraft] = useState<string>('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const original =
    uiKit && selectedFile && (uiKit.files as Record<string, string>)[selectedFile] != null
      ? ((uiKit.files as Record<string, string>)[selectedFile] as string)
      : '';

  // Reset draft when the selected file or kit changes
  useEffect(() => {
    setDraft(original);
    setSavedAt(null);
    setError(null);
  }, [original]);

  if (!runId) {
    return (
      <div className="editor-empty">
        <div className="editor-empty-label">code editor</div>
        <div>start a run, then pick a file from the left to edit it here.</div>
      </div>
    );
  }
  if (!uiKit) {
    return (
      <div className="editor-empty">
        <div className="editor-empty-label">code editor</div>
        <div>waiting for decompose...</div>
      </div>
    );
  }
  if (!selectedFile) {
    return (
      <div className="editor-empty">
        <div className="editor-empty-label">code editor</div>
        <div>select a file in Files to inspect and edit it here.</div>
      </div>
    );
  }

  const dirty = draft !== original;
  const language = languageForPath(selectedFile);

  async function onSave() {
    if (!uiKit || !selectedFile) return;
    setError(null);
    setSaving(true);
    try {
      await patchFile({ uiKitId: uiKit._id, path: selectedFile, content: draft });
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onRename() {
    if (!uiKit || !selectedFile) return;
    const nextPath = window.prompt('Rename file path inside this ui_kit:', selectedFile)?.trim();
    if (!nextPath || nextPath === selectedFile) return;
    setError(null);
    setSaving(true);
    try {
      await renameFile({ uiKitId: uiKit._id, fromPath: selectedFile, toPath: nextPath });
      onSelectFile?.(nextPath);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!uiKit || !selectedFile) return;
    const ok = window.confirm(
      `Delete ${selectedFile} from this ui_kit?\n\nThis removes it from the live kit file map and the next export ZIP.`,
    );
    if (!ok) return;
    setError(null);
    setSaving(true);
    try {
      await deleteFile({ uiKitId: uiKit._id, path: selectedFile });
      onSelectFile?.(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function onRevert() {
    setDraft(original);
    setError(null);
    setSavedAt(null);
  }

  return (
    <div className="editor-shell">
      <div className="editor-toolbar">
        <span className="editor-path" title={selectedFile}>
          {selectedFile}
        </span>
        <span className="editor-lang">{language}</span>
        {dirty ? (
          <span className="editor-status editor-status-dirty">unsaved</span>
        ) : savedAt ? (
          <span className="editor-status editor-status-saved">saved</span>
        ) : null}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button type="button" className="tab" onClick={() => void onRename()} disabled={saving}>
            rename
          </button>
          <button type="button" className="tab" onClick={() => void onDelete()} disabled={saving}>
            delete
          </button>
          <button type="button" className="tab" onClick={onRevert} disabled={!dirty || saving}>
            revert
          </button>
          <button
            type="button"
            className="generate-button"
            style={{ padding: '6px 14px', fontSize: 13 }}
            onClick={() => void onSave()}
            disabled={!dirty || saving}
          >
            {saving ? 'saving…' : 'save'}
          </button>
        </div>
      </div>
      {error ? <div className="editor-error">{error}</div> : null}
      <div style={{ flex: 1, minHeight: 320, display: 'flex' }}>
        <textarea
          value={draft}
          spellCheck={false}
          onChange={(event) => setDraft(event.currentTarget.value)}
          aria-label={`Edit ${selectedFile}`}
          style={{
            flex: 1,
            width: '100%',
            minHeight: 320,
            resize: 'none',
            border: 'none',
            outline: 'none',
            padding: '14px 16px',
            background: '#1e1e1e',
            color: '#f4efe7',
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 13,
            lineHeight: 1.55,
            tabSize: 2,
            whiteSpace: 'pre',
            overflow: 'auto',
            boxSizing: 'border-box',
          }}
        />
      </div>
      <div className="editor-footer">
        edits land in the live ui_kit - background verify reruns - export ZIP includes them
      </div>
    </div>
  );
}
