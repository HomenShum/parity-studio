import { FileJson2, FileUp } from 'lucide-react';
import { type CSSProperties, useMemo, useState } from 'react';
import type {
  DeckPatch,
  DeckSnapshot,
  PatchOperation,
  Slide,
  SlideElement,
} from '../../../../shared/nodeslide';
import {
  JSON_EDITOR_CHARACTER_LIMIT,
  boundedJsonPreview,
  latestDeckPatch,
} from '../slidelang/jsonEdit';

export type DeckJsonMode = 'deck' | 'slide' | 'selection' | 'patch';

export interface DeckJsonContext {
  snapshot: DeckSnapshot;
  slide: Slide;
  selectedElements: readonly SlideElement[];
  patches: readonly DeckPatch[];
}

/**
 * The value serialized for each view mode. Pure so it can be unit-tested and so
 * the rendered JSON and Copy payload never diverge. Deck downloads use the
 * validated, versioned NodeSlide envelope from `downloadDeckJson`.
 * Returns `null` for the empty states (nothing selected / no proposals yet).
 */
export function deckJsonView(mode: DeckJsonMode, ctx: DeckJsonContext): unknown {
  switch (mode) {
    case 'deck':
      return ctx.snapshot;
    case 'slide':
      return {
        slide: ctx.slide,
        elements: ctx.snapshot.elements.filter((element) => element.slideId === ctx.slide.id),
      };
    case 'selection':
      return ctx.selectedElements.length > 0 ? [...ctx.selectedElements] : null;
    case 'patch':
      return latestDeckPatch(ctx.patches);
  }
}

export function serializeDeckJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export type ElementEditResult = { ok: true; ops: PatchOperation[] } | { ok: false; error: string };

const EDITABLE_NOTE =
  'Editable from JSON: position, size, text, style, visibility, and (for charts) chart data.';

function deepChanged(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

// Fields with no granular EditOp yet. Editing them from JSON is blocked (never
// silently dropped) so the JSON edit path can only ever produce faithful ops.
const UNSUPPORTED_FIELDS: readonly (keyof SlideElement)[] = [
  'name',
  'role',
  'rotation',
  'math',
  'video',
  'image',
  'imageUrl',
  'altText',
  'sourceIds',
  'locked',
  'groupId',
  'exportCapabilities',
  'version',
];

/**
 * Diff an edited element against the original and synthesize typed
 * PatchOperations. Pure + exported for tests. Identity (`id`/`kind`/`slideId`)
 * and unsupported fields are rejected rather than dropped; the returned ops still
 * pass through the server's validate → CAS → proposal gate — no second write path.
 */
export function synthesizeElementOps(
  original: SlideElement,
  editedRaw: unknown,
): ElementEditResult {
  if (typeof editedRaw !== 'object' || editedRaw === null || Array.isArray(editedRaw)) {
    return { ok: false, error: 'Edited JSON must be a single element object.' };
  }
  const edited = editedRaw as Partial<SlideElement>;
  if (edited.id !== original.id) {
    return { ok: false, error: 'The element "id" cannot be changed here.' };
  }
  if (edited.kind !== original.kind) {
    return { ok: false, error: 'The element "kind" cannot be changed here.' };
  }
  if (edited.slideId !== original.slideId) {
    return { ok: false, error: 'The element "slideId" cannot be changed here.' };
  }
  if (typeof edited.bbox !== 'object' || edited.bbox === null) {
    return { ok: false, error: 'A "bbox" object with x, y, width, and height is required.' };
  }

  const slideId = original.slideId;
  const elementId = original.id;
  const bbox = edited.bbox;
  const ops: PatchOperation[] = [];

  if (bbox.x !== original.bbox.x || bbox.y !== original.bbox.y) {
    ops.push({ op: 'move', slideId, elementId, x: bbox.x, y: bbox.y });
  }
  if (bbox.width !== original.bbox.width || bbox.height !== original.bbox.height) {
    ops.push({ op: 'resize', slideId, elementId, width: bbox.width, height: bbox.height });
  }
  if (deepChanged(original.content, edited.content)) {
    ops.push({ op: 'replace_text', slideId, elementId, text: edited.content ?? '' });
  }
  if (deepChanged(original.style, edited.style)) {
    ops.push({ op: 'update_style', slideId, elementId, properties: edited.style ?? {} });
  }
  if (Boolean(original.visible ?? true) !== Boolean(edited.visible ?? true)) {
    ops.push({ op: 'set_visibility_v1', slideId, elementId, visible: edited.visible ?? true });
  }
  if (original.kind === 'chart' && deepChanged(original.chart, edited.chart)) {
    if (!edited.chart) {
      return { ok: false, error: 'A chart element needs a "chart" object.' };
    }
    ops.push({ op: 'update_chart', slideId, elementId, chart: edited.chart });
  }

  const unsupported: string[] = UNSUPPORTED_FIELDS.filter((field) =>
    deepChanged(original[field], edited[field]),
  );
  if (original.kind !== 'chart' && deepChanged(original.chart, edited.chart)) {
    unsupported.push('chart');
  }
  if (unsupported.length > 0) {
    return {
      ok: false,
      error: `Not editable from JSON yet: ${unsupported.join(', ')}. ${EDITABLE_NOTE}`,
    };
  }

  return { ok: true, ops };
}

const MODES: ReadonlyArray<{ id: DeckJsonMode; label: string }> = [
  { id: 'deck', label: 'Deck' },
  { id: 'slide', label: 'Slide' },
  { id: 'selection', label: 'Selection' },
  { id: 'patch', label: 'Last patch' },
];

// Cap the *rendered* string so a very large deck cannot freeze the panel.
// Copy and Download always use the full JSON.
const RENDER_CAP = 200_000;

const rowStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
  padding: '0 var(--ns-space-4, 12px) var(--ns-space-3, 8px)',
};

const chipStyle = (active: boolean): CSSProperties => ({
  font: 'inherit',
  fontSize: 11,
  fontWeight: 600,
  padding: '4px 10px',
  borderRadius: 'var(--ns-radius-pill, 999px)',
  border: '1px solid var(--ns-border, rgba(0,0,0,0.12))',
  background: active ? 'var(--ns-accent, #4f46e5)' : 'transparent',
  color: active ? 'var(--ns-on-accent, #fff)' : 'var(--ns-text, inherit)',
  cursor: 'pointer',
});

const actionStyle: CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  padding: '5px 12px',
  borderRadius: 'var(--ns-radius, 8px)',
  border: '1px solid var(--ns-border, rgba(0,0,0,0.12))',
  background: 'var(--ns-surface, rgba(0,0,0,0.03))',
  color: 'var(--ns-text, inherit)',
  cursor: 'pointer',
};

const codeStyle: CSSProperties = {
  margin: 0,
  padding: 'var(--ns-space-3, 10px)',
  maxHeight: '52vh',
  overflow: 'auto',
  whiteSpace: 'pre',
  fontFamily: `var(--ns-font-mono, ui-monospace, 'JetBrains Mono', 'SFMono-Regular', monospace)`,
  fontSize: 11,
  lineHeight: 1.5,
  borderRadius: 'var(--ns-radius, 8px)',
  border: '1px solid var(--ns-border, rgba(0,0,0,0.12))',
  background: 'var(--ns-surface-sunken, rgba(0,0,0,0.03))',
  color: 'var(--ns-text, inherit)',
};

export interface JsonPatchProposalRequest {
  operations: PatchOperation[];
  summary: string;
  elementId: string;
  baseElementVersion: number;
}

/**
 * Hands a JSON edit to the host's proposal lane. The callback may report
 * success only after a server-validated candidate was opened; it never returns
 * or fabricates a mutation receipt for the editor.
 */
export type JsonPatchProposalCallback = (
  request: JsonPatchProposalRequest,
) => boolean | Promise<boolean>;

function ElementJsonEditor({
  element,
  onPropose,
}: {
  element: SlideElement;
  onPropose: JsonPatchProposalCallback;
}) {
  const original = useMemo(() => serializeDeckJson(element), [element]);
  const [text, setText] = useState(original);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);
  const dirty = text !== original;

  const propose = async () => {
    setError(null);
    setNote(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (parseError) {
      setError(`Invalid JSON: ${(parseError as Error).message}`);
      return;
    }
    const result = synthesizeElementOps(element, parsed);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.ops.length === 0) {
      setNote('No changes to propose.');
      return;
    }
    setProposing(true);
    try {
      const proposed = await onPropose({
        operations: result.ops,
        summary: `Edit ${element.name || element.kind} via JSON`,
        elementId: element.id,
        baseElementVersion: element.version,
      });
      if (!proposed) {
        setError(
          'The JSON candidate was not created. The element may have changed; review and retry.',
        );
        return;
      }
      setNote(
        `Proposed ${result.ops.length} change${result.ops.length === 1 ? '' : 's'}. The deck is unchanged; review Compare and choose Accept or Reject.`,
      );
    } catch (proposalError) {
      setError(
        proposalError instanceof Error
          ? proposalError.message
          : 'The JSON edit could not be proposed.',
      );
    } finally {
      setProposing(false);
    }
  };

  return (
    <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={JSON_EDITOR_CHARACTER_LIMIT}
        spellCheck={false}
        aria-label={`JSON for ${element.name || element.id}`}
        style={{ ...codeStyle, width: '100%', minHeight: 220, resize: 'vertical' }}
      />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => void propose()}
          disabled={!dirty || proposing}
          style={actionStyle}
        >
          {proposing ? 'Proposing…' : 'Propose changes'}
        </button>
        <button
          type="button"
          onClick={() => {
            setText(original);
            setError(null);
            setNote(null);
          }}
          disabled={!dirty}
          style={actionStyle}
        >
          Reset
        </button>
      </div>
      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--ns-danger, #b42318)' }}>
          {error}
        </p>
      ) : null}
      {note ? (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--ns-text-muted, #667085)' }}>{note}</p>
      ) : null}
    </div>
  );
}

export interface JsonInspectorProps {
  snapshot: DeckSnapshot;
  slide: Slide;
  selectedElements: readonly SlideElement[];
  patches: readonly DeckPatch[];
  onProposePatch?: JsonPatchProposalCallback;
  onImportSourceFile?: (file: File, kind: 'json' | 'pptx') => Promise<string>;
}

export function JsonInspector({
  snapshot,
  slide,
  selectedElements,
  patches,
  onProposePatch,
  onImportSourceFile,
}: JsonInspectorProps) {
  const [mode, setMode] = useState<DeckJsonMode>('deck');
  const [importing, setImporting] = useState<'json' | 'pptx' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const view = useMemo(
    () => deckJsonView(mode, { snapshot, slide, selectedElements, patches }),
    [mode, snapshot, slide, selectedElements, patches],
  );
  const json = useMemo(() => (view === null ? '' : serializeDeckJson(view)), [view]);
  const shown = useMemo(
    () => (view === null ? '' : boundedJsonPreview(view, RENDER_CAP).text.trimEnd()),
    [view],
  );

  const selectedOne = selectedElements.length === 1 ? (selectedElements[0] ?? null) : null;
  const editing = mode === 'selection' && onProposePatch !== undefined && selectedOne !== null;

  const copy = () => {
    if (json && typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(json);
    }
  };

  const importSourceFile = async (file: File, kind: 'json' | 'pptx') => {
    if (!onImportSourceFile || importing) return;
    setActionError(null);
    setActionNotice(null);
    setImporting(kind);
    try {
      setActionNotice(await onImportSourceFile(file, kind));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The source file could not be read.');
    } finally {
      setImporting(null);
    }
  };

  return (
    <div className="ns-inspector-scroll ns-json-inspector">
      <section className="ns-inspector-section">
        <div className="ns-section-title-row">
          <div>
            <span className="ns-eyebrow">Deck as code</span>
            <h2>JSON</h2>
          </div>
          <span className="ns-count-pill">{snapshot.slides.length}</span>
        </div>
        <p>
          The canonical <code>nodeslide.slidelang/v1</code> DeckSpec — {snapshot.slides.length}{' '}
          slides · {snapshot.elements.length} elements.{' '}
          {onProposePatch
            ? 'Select a single element and switch to Selection to edit its JSON; changes create a validated candidate, open Compare, and require Accept or Reject.'
            : 'Read-only view.'}
        </p>
      </section>

      {onImportSourceFile ? (
        <section className="ns-inspector-section" aria-labelledby="ns-source-import-title">
          <div className="ns-section-title-row">
            <div>
              <span className="ns-eyebrow">Review before applying</span>
              <h3 id="ns-source-import-title">Import an external deck</h3>
            </div>
          </div>
          <p>
            Re-open validated NodeSlide JSON or convert bounded PPTX primitives into an unapplied
            proposal. PPTX review reports native, approximated, and dropped objects.
          </p>
          <div style={rowStyle}>
            <label
              style={{ ...actionStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}
              aria-disabled={Boolean(importing)}
            >
              <FileJson2 size={14} aria-hidden="true" />
              {importing === 'json' ? 'Reading JSON…' : 'Import Deck JSON'}
              <input
                type="file"
                accept="application/json,.json"
                disabled={Boolean(importing)}
                style={{ display: 'none' }}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void importSourceFile(file, 'json');
                }}
              />
            </label>
            <label
              style={{ ...actionStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}
              aria-disabled={Boolean(importing)}
            >
              <FileUp size={14} aria-hidden="true" />
              {importing === 'pptx' ? 'Reading PPTX…' : 'Import PPTX'}
              <input
                type="file"
                accept="application/vnd.openxmlformats-officedocument.presentationml.presentation,.pptx"
                disabled={Boolean(importing)}
                style={{ display: 'none' }}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void importSourceFile(file, 'pptx');
                }}
              />
            </label>
          </div>
          {actionError ? (
            <p role="alert" style={{ color: 'var(--ns-danger, #b42318)' }}>
              {actionError}
            </p>
          ) : null}
          {actionNotice ? <output aria-live="polite">{actionNotice}</output> : null}
        </section>
      ) : null}

      <div style={rowStyle} role="tablist" aria-label="JSON view">
        {MODES.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={mode === option.id}
            onClick={() => setMode(option.id)}
            style={chipStyle(mode === option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div style={rowStyle}>
        <button type="button" onClick={copy} disabled={!json} style={actionStyle}>
          Copy
        </button>
        <button
          type="button"
          onClick={() => {
            setActionError(null);
            void import('../slidelang/download')
              .then(({ downloadDeckJson }) => {
                downloadDeckJson(snapshot);
                setActionNotice('Validated NodeSlide JSON download prepared.');
              })
              .catch((error: unknown) => {
                setActionError(error instanceof Error ? error.message : 'Deck JSON export failed.');
              });
          }}
          style={actionStyle}
        >
          Download deck.json
        </button>
      </div>

      {editing && selectedOne && onProposePatch ? (
        <ElementJsonEditor
          key={`${selectedOne.id}:${selectedOne.version}`}
          element={selectedOne}
          onPropose={onProposePatch}
        />
      ) : json ? (
        <pre className="ns-json-view" style={{ ...codeStyle, margin: '0 12px 12px' }}>
          {shown}
        </pre>
      ) : (
        <div className="ns-empty-state ns-empty-state--compact" style={{ margin: '0 12px 12px' }}>
          <span>
            {mode === 'selection'
              ? 'Select one or more elements on the canvas to see their JSON.'
              : 'No agent proposal yet — the last patch will appear here once one is created.'}
          </span>
        </div>
      )}
    </div>
  );
}
