import { Braces, Check, Clipboard, FileJson, FileUp, Pencil, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  DeckSnapshot,
  NodeSlideWorkspace,
  PatchOperation,
  SlideElement,
} from '../../../../shared/nodeslide';
import {
  JSON_EDITOR_CHARACTER_LIMIT,
  boundedJsonPreview,
  diffSelectedElementJson,
  jsonForCopy,
  latestDeckPatch,
} from '../slidelang/jsonEdit';
import type { JsonInspectorView } from './types';

export interface JsonInspectorProps {
  workspace: NodeSlideWorkspace;
  selectedElements: readonly SlideElement[];
  onApplyPatch: (
    operations: PatchOperation[],
    summary: string,
    elementId: string,
    baseElementVersion: number,
  ) => boolean | undefined | Promise<boolean | undefined>;
  onImportSourceFile?: (file: File, kind: 'json' | 'pptx') => Promise<string>;
}

const viewOptions: Array<{ id: JsonInspectorView; label: string }> = [
  { id: 'snapshot', label: 'Current snapshot' },
  { id: 'patch', label: 'Last patch' },
  { id: 'element', label: 'Selected element' },
];

export function JsonInspector({
  workspace,
  selectedElements,
  onApplyPatch,
  onImportSourceFile,
}: JsonInspectorProps) {
  const selectedElement = selectedElements.at(-1) ?? null;
  const [view, setView] = useState<JsonInspectorView>(selectedElement ? 'element' : 'snapshot');
  const [editingElement, setEditingElement] = useState<SlideElement | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [applying, setApplying] = useState(false);
  const [importing, setImporting] = useState<'json' | 'pptx' | null>(null);
  const snapshot = useMemo<DeckSnapshot>(
    () => ({
      deck: workspace.deck,
      slides: workspace.slides,
      elements: workspace.elements,
      sources: workspace.sources,
    }),
    [workspace.deck, workspace.elements, workspace.slides, workspace.sources],
  );
  const lastPatch = useMemo(() => latestDeckPatch(workspace.patches), [workspace.patches]);

  useEffect(() => {
    if (!editingElement || editingElement.id === selectedElement?.id) return;
    setEditingElement(null);
    setDraft('');
    setError(null);
    setNotice('Selection changed; the previous draft was closed.');
  }, [editingElement, selectedElement?.id]);

  const value =
    view === 'snapshot' ? snapshot : view === 'patch' ? lastPatch : (selectedElement ?? null);
  const preview = useMemo(() => boundedJsonPreview(value), [value]);
  const canEdit = view === 'element' && selectedElement !== null && !selectedElement.locked;

  const copyCurrentView = async () => {
    setError(null);
    setNotice(null);
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clipboard?.writeText) {
      setError('Clipboard access is unavailable.');
      return;
    }
    try {
      await clipboard.writeText(jsonForCopy(value));
      setCopying(true);
      setNotice('Valid JSON copied.');
      setTimeout(() => setCopying(false), 1200);
    } catch {
      setError('JSON could not be copied. Check clipboard permissions and try again.');
    }
  };

  const beginEdit = () => {
    if (!selectedElement) return;
    if (selectedElement.locked) {
      setError(`${selectedElement.name} is locked and cannot be edited.`);
      return;
    }
    setEditingElement(structuredClone(selectedElement));
    setDraft(jsonForCopy(selectedElement));
    setError(null);
    setNotice(null);
  };

  const cancelEdit = () => {
    setEditingElement(null);
    setDraft('');
    setError(null);
    setNotice(null);
  };

  const applyEdit = async () => {
    if (!editingElement || applying) return;
    setError(null);
    setNotice(null);
    const result = diffSelectedElementJson(
      editingElement,
      draft,
      new Set(workspace.sources.map((source) => source.id)),
    );
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.operations.length === 0) {
      setNotice('No supported fields changed.');
      return;
    }
    setApplying(true);
    try {
      const accepted = await onApplyPatch(
        result.operations,
        `Edited ${editingElement.name} from Spec JSON`,
        editingElement.id,
        editingElement.version,
      );
      if (accepted === false) {
        setError('The JSON edit was not applied. The element may have changed; review and retry.');
        return;
      }
      setEditingElement(null);
      setDraft('');
      setNotice(
        `Submitted ${result.operations.length} typed operation${result.operations.length === 1 ? '' : 's'}.`,
      );
    } catch (applyError) {
      setError(
        applyError instanceof Error ? applyError.message : 'The JSON edit could not be applied.',
      );
    } finally {
      setApplying(false);
    }
  };

  const importSourceFile = async (file: File, kind: 'json' | 'pptx') => {
    if (!onImportSourceFile || importing) return;
    setError(null);
    setNotice(null);
    setImporting(kind);
    try {
      setNotice(await onImportSourceFile(file, kind));
    } catch (importError) {
      setError(
        importError instanceof Error ? importError.message : 'The source file could not be read.',
      );
    } finally {
      setImporting(null);
    }
  };

  return (
    <div className="ns-inspector-scroll ns-json-inspector" data-testid="json-inspector">
      <section className="ns-inspector-section">
        <div className="ns-section-title-row">
          <div>
            <span className="ns-eyebrow">Deck structure</span>
            <h2>SlideLang spec</h2>
          </div>
          <Braces size={17} aria-hidden="true" />
        </div>
        <p>
          Inspect and copy the live structured deck state. Selected-element JSON edits still compile
          into typed patch operations; protected identity and version fields stay read-only.
        </p>
      </section>

      {onImportSourceFile ? (
        <section
          className="ns-inspector-section ns-source-import"
          aria-labelledby="source-import-title"
        >
          <div className="ns-section-heading" id="source-import-title">
            Review an external deck
          </div>
          <p>
            Re-open NodeSlide JSON exactly, or convert editable PPTX primitives. Every import is
            validated and stays unapplied until you accept its proposal.
          </p>
          <div className="ns-source-import-actions">
            <label className="ns-button" aria-disabled={Boolean(importing)}>
              <FileJson size={13} aria-hidden="true" />
              {importing === 'json' ? 'Reading JSON…' : 'Import Deck JSON'}
              <input
                type="file"
                accept="application/json,.json"
                disabled={Boolean(importing)}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void importSourceFile(file, 'json');
                }}
              />
            </label>
            <label className="ns-button" aria-disabled={Boolean(importing)}>
              <FileUp size={13} aria-hidden="true" />
              {importing === 'pptx' ? 'Reading PPTX…' : 'Import PPTX'}
              <input
                type="file"
                accept="application/vnd.openxmlformats-officedocument.presentationml.presentation,.pptx"
                disabled={Boolean(importing)}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void importSourceFile(file, 'pptx');
                }}
              />
            </label>
          </div>
          <small>
            PPTX import reports native, approximated, and dropped objects before any deck change.
          </small>
        </section>
      ) : null}

      <section className="ns-inspector-section">
        <div className="ns-json-view-tabs" role="tablist" aria-label="SlideLang spec views">
          {viewOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={view === option.id}
              className={view === option.id ? 'is-active' : ''}
              data-testid={`json-view-${option.id}`}
              onClick={() => {
                setView(option.id);
                setError(null);
                setNotice(null);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="ns-inspector-section" aria-label={`${view} JSON`}>
        <div className="ns-section-heading ns-json-heading">
          <span>{viewOptions.find((option) => option.id === view)?.label}</span>
          <div className="ns-json-heading-actions">
            {canEdit && !editingElement ? (
              <button type="button" className="ns-button" onClick={beginEdit}>
                <Pencil size={12} /> Edit
              </button>
            ) : null}
            <button
              type="button"
              className="ns-button"
              onClick={() => void copyCurrentView()}
              aria-label="Copy valid JSON"
            >
              {copying ? <Check size={12} /> : <Clipboard size={12} />}
              {copying ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        {view === 'element' && !selectedElement ? (
          <div className="ns-empty-state ns-empty-state--compact">
            <strong>No selected element</strong>
            <p>Select an element on the canvas or in Layers to inspect and edit its JSON.</p>
          </div>
        ) : view === 'patch' && !lastPatch ? (
          <div className="ns-empty-state ns-empty-state--compact">
            <strong>No patch history</strong>
            <p>The newest accepted, proposed, rejected, or stale patch will appear here.</p>
          </div>
        ) : editingElement && view === 'element' ? (
          <div className="ns-json-editor-shell">
            <label htmlFor="ns-selected-element-json" className="ns-eyebrow">
              Selected-element JSON
            </label>
            <textarea
              id="ns-selected-element-json"
              data-testid="selected-element-json-editor"
              value={draft}
              maxLength={JSON_EDITOR_CHARACTER_LIMIT}
              spellCheck={false}
              aria-invalid={Boolean(error)}
              onChange={(event) => {
                setDraft(event.currentTarget.value);
                setError(null);
                setNotice(null);
              }}
              className="ns-json-editor"
            />
            <small>
              Supported: bbox, style, text/math content, chart, embedded image, source bindings with
              content/image changes, and visibility. Rotation is read-only.
            </small>
            <div className="ns-json-editor-actions">
              <button type="button" className="ns-button" onClick={cancelEdit} disabled={applying}>
                <RotateCcw size={12} /> Revert
              </button>
              <button
                type="button"
                className="ns-button ns-button--accent"
                onClick={() => void applyEdit()}
                disabled={applying}
              >
                {applying ? 'Applying…' : 'Apply typed patch'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <pre data-testid="json-preview" className="ns-json-code">
              {preview.text}
            </pre>
            {preview.truncated ? (
              <output>
                Preview bounded to {preview.text.length.toLocaleString()} of{' '}
                {preview.totalCharacters.toLocaleString()} characters. Copy still uses the complete,
                valid JSON value.
              </output>
            ) : null}
          </>
        )}

        {error ? (
          <p className="ns-ai-attachment-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? <output>{notice}</output> : null}
        {view === 'element' && selectedElement?.locked ? (
          <output>
            This element is locked. Its JSON is available for inspection and copy only.
          </output>
        ) : null}
      </section>
    </div>
  );
}
