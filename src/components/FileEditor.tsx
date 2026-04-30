import Editor from '@monaco-editor/react';
import { useMutation, useQuery } from 'convex/react';
import { useEffect, useState } from 'react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

/**
 * FileEditor — Monaco-backed in-app editor for a single ui_kit file.
 *
 * Closes the "edit a component in-app" gap from issue #225. Activated by
 * picking a file in FilesPanel; PreviewPane swaps its iframe for this
 * editor when the user clicks the "Code" tab.
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

export function FileEditor({ runId, selectedFile }: FileEditorProps) {
  const uiKit = useQuery(api.uiKits.getLatest, runId ? { runId } : 'skip');
  const patchFile = useMutation(api.uiKits.patchFile);
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
  }, [original, selectedFile, uiKit?._id]);

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
        <div>select a file in Files to inspect it, then use Code for full editing.</div>
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
      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          height="100%"
          value={draft}
          language={language}
          theme="vs-dark"
          onChange={(v) => setDraft(v ?? '')}
          options={{
            fontSize: 13,
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            tabSize: 2,
            automaticLayout: true,
          }}
        />
      </div>
      <div className="editor-footer">
        edits land in the live ui_kit · next iterate run reads them · export ZIP includes them
      </div>
    </div>
  );
}
