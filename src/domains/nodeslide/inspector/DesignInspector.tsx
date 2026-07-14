import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  BarChart3,
  Baseline,
  Bold,
  ChevronDown,
  CornerUpLeft,
  ImageUp,
  Lock,
  Minus,
  Move,
  Palette,
  Plus,
  Square,
  Type,
  X,
} from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { PatchOperation, Slide, SlideElement, ThemeSpec } from '../../../../shared/nodeslide';
import type { TasteProfile } from '../../../../shared/nodeslidePreference';
import type { SignatureProfile } from '../../../../shared/nodeslideSignature';
import { NODESLIDE_TASTE_PACKS, type NodeSlideTastePackId } from '../signature/packs/index';
import { TasteProfileCard } from './TasteProfileCard';

interface DesignInspectorProps {
  slide: Slide;
  slideElements: readonly SlideElement[];
  selectedElements: readonly SlideElement[];
  theme: ThemeSpec;
  activeTastePackId: NodeSlideTastePackId | null;
  activeProfileId: string | null;
  previewProfileId: string | null;
  profiles: readonly SignatureProfile[];
  busy: boolean;
  onApplyTastePack: (packId: NodeSlideTastePackId) => void;
  onApplyProfile: ((profile: SignatureProfile) => void) | undefined;
  onPreviewProfile: ((profile: SignatureProfile | null) => void) | undefined;
  onUploadSource: ((file: File) => void) | undefined;
  tasteProfile: TasteProfile | null;
  tasteProfileLoading: boolean;
  onEvictTasteSignal: ((signalId: string) => void) | undefined;
  onOpenPreferenceEvidence: ((eventId: string) => void) | undefined;
  onClearTastePack: () => void;
  onApplyPatch: (operations: PatchOperation[], summary: string) => void;
}

export type DesignInspectorSectionId = 'content' | 'data' | 'appearance' | 'advanced';

export type DesignInspectorSectionState = Record<DesignInspectorSectionId, boolean>;

export const DEFAULT_DESIGN_INSPECTOR_SECTIONS: DesignInspectorSectionState = {
  content: true,
  data: true,
  appearance: false,
  advanced: false,
};

const DESIGN_SECTION_STORAGE_KEY = 'nodeslide.design-inspector-sections';

export function toggleDesignInspectorSection(
  state: DesignInspectorSectionState,
  section: DesignInspectorSectionId,
): DesignInspectorSectionState {
  return { ...state, [section]: !state[section] };
}

function initialDesignInspectorSections(): DesignInspectorSectionState {
  if (typeof window === 'undefined') return DEFAULT_DESIGN_INSPECTOR_SECTIONS;
  try {
    const stored = window.sessionStorage.getItem(DESIGN_SECTION_STORAGE_KEY);
    if (!stored) return DEFAULT_DESIGN_INSPECTOR_SECTIONS;
    const parsed = JSON.parse(stored) as Partial<DesignInspectorSectionState>;
    return { ...DEFAULT_DESIGN_INSPECTOR_SECTIONS, ...parsed };
  } catch {
    return DEFAULT_DESIGN_INSPECTOR_SECTIONS;
  }
}

export function DesignInspector({
  slide,
  slideElements,
  selectedElements,
  theme,
  activeTastePackId,
  activeProfileId,
  previewProfileId,
  profiles,
  busy,
  onApplyTastePack,
  onApplyProfile,
  onPreviewProfile,
  onUploadSource,
  tasteProfile,
  tasteProfileLoading,
  onEvictTasteSignal,
  onOpenPreferenceEvidence,
  onClearTastePack,
  onApplyPatch,
}: DesignInspectorProps) {
  const [openSections, setOpenSections] = useState(initialDesignInspectorSections);
  const toggleSection = (section: DesignInspectorSectionId) => {
    setOpenSections((current) => {
      const next = toggleDesignInspectorSection(current, section);
      try {
        window.sessionStorage.setItem(DESIGN_SECTION_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Session persistence is a convenience; the controls remain fully functional without it.
      }
      return next;
    });
  };
  const primary = selectedElements.at(-1);
  if (!primary) {
    return (
      <div className="ns-inspector-scroll">
        <div className="ns-empty-state">
          <span>
            <Move size={19} />
          </span>
          <strong>Select an element</strong>
          <p>
            Position, type, fill, and alignment controls will appear here. Your selection stays
            active when you switch tabs.
          </p>
        </div>
        <CollapsibleInspectorSection
          id="content"
          title="Content"
          open={openSections.content}
          onToggle={() => toggleSection('content')}
        >
          <SlideNotesEditor slide={slide} onApplyPatch={onApplyPatch} />
        </CollapsibleInspectorSection>
        <CollapsibleInspectorSection
          id="advanced"
          title="Advanced"
          open={openSections.advanced}
          onToggle={() => toggleSection('advanced')}
        >
          <TastePackPanel
            activeTastePackId={activeTastePackId}
            activeProfileId={activeProfileId}
            previewProfileId={previewProfileId}
            profiles={profiles}
            busy={busy}
            onApply={onApplyTastePack}
            onApplyProfile={onApplyProfile}
            onPreviewProfile={onPreviewProfile}
            onUploadSource={onUploadSource}
            onClear={onClearTastePack}
          />
          {onEvictTasteSignal ? (
            <TasteProfileCard
              profile={tasteProfile ?? null}
              loading={tasteProfileLoading}
              onEvictSignal={onEvictTasteSignal}
              onOpenEvidence={onOpenPreferenceEvidence}
            />
          ) : null}
          <ThemeSummary theme={theme} />
        </CollapsibleInspectorSection>
      </div>
    );
  }

  const editable = selectedElements.filter((element) => !element.locked);
  const patchStyle = (properties: SlideElement['style'], label: string) => {
    const operations: PatchOperation[] = editable.map((element) => ({
      op: 'update_style',
      slideId: element.slideId,
      elementId: element.id,
      properties,
    }));
    if (operations.length > 0) onApplyPatch(operations, label);
  };

  return (
    <div className="ns-inspector-scroll ns-design-inspector">
      <section className="ns-inspector-section ns-selection-summary">
        <div className="ns-section-title-row">
          <div>
            <span className="ns-eyebrow">Selection</span>
            <h2>{primary.name}</h2>
          </div>
          <span className="ns-kind-pill">{primary.kind}</span>
        </div>
        <p>
          {selectedElements.length > 1
            ? `${selectedElements.length} elements selected`
            : (primary.role ?? `${primary.kind} element`)}
        </p>
        {primary.locked ? (
          <span className="ns-lock-notice">
            <Lock size={12} /> This element is locked
          </span>
        ) : null}
      </section>

      <CollapsibleInspectorSection
        id="content"
        title="Content"
        open={openSections.content}
        onToggle={() => toggleSection('content')}
      >
        <InspectorGroup icon={<Move size={14} />} title="Position & size">
          <div className="ns-field-grid ns-field-grid--four">
            <NumberField
              label="X"
              value={primary.bbox.x * 100}
              suffix="%"
              disabled={primary.locked}
              onCommit={(value) =>
                onApplyPatch(
                  [
                    {
                      op: 'move',
                      slideId: primary.slideId,
                      elementId: primary.id,
                      x: clampPercent(value),
                      y: primary.bbox.y,
                    },
                  ],
                  `Moved ${primary.name}`,
                )
              }
            />
            <NumberField
              label="Y"
              value={primary.bbox.y * 100}
              suffix="%"
              disabled={primary.locked}
              onCommit={(value) =>
                onApplyPatch(
                  [
                    {
                      op: 'move',
                      slideId: primary.slideId,
                      elementId: primary.id,
                      x: primary.bbox.x,
                      y: clampPercent(value),
                    },
                  ],
                  `Moved ${primary.name}`,
                )
              }
            />
            <NumberField
              label="W"
              value={primary.bbox.width * 100}
              suffix="%"
              disabled={primary.locked}
              onCommit={(value) =>
                onApplyPatch(
                  [
                    {
                      op: 'resize',
                      slideId: primary.slideId,
                      elementId: primary.id,
                      width: clampSize(value),
                      height: primary.bbox.height,
                    },
                  ],
                  `Resized ${primary.name}`,
                )
              }
            />
            <NumberField
              label="H"
              value={primary.bbox.height * 100}
              suffix="%"
              disabled={primary.locked}
              onCommit={(value) =>
                onApplyPatch(
                  [
                    {
                      op: 'resize',
                      slideId: primary.slideId,
                      elementId: primary.id,
                      width: primary.bbox.width,
                      height: clampSize(value),
                    },
                  ],
                  `Resized ${primary.name}`,
                )
              }
            />
          </div>
        </InspectorGroup>

        {primary.kind === 'text' || primary.kind === 'math' ? (
          <InspectorGroup icon={<Type size={14} />} title="Content">
            <label className="ns-text-content-field">
              <span>{primary.kind === 'math' ? 'Math expression' : 'Text content'}</span>
              <textarea
                key={`${primary.id}-${primary.version}-content`}
                defaultValue={
                  primary.kind === 'math'
                    ? (primary.math?.expression ?? '')
                    : (primary.content ?? '')
                }
                rows={5}
                disabled={editable.length === 0}
                onBlur={(event) => {
                  const next = event.currentTarget.value;
                  const current =
                    primary.kind === 'math'
                      ? (primary.math?.expression ?? '')
                      : (primary.content ?? '');
                  if (next !== current) {
                    const operations: PatchOperation[] = [
                      {
                        op: 'replace_text',
                        slideId: primary.slideId,
                        elementId: primary.id,
                        text: next,
                      },
                    ];
                    if (
                      (primary.role === 'title' || primary.role === 'headline') &&
                      (slide.title === 'Untitled slide' || slide.title === primary.content)
                    ) {
                      operations.push({
                        op: 'update_slide',
                        slideId: slide.id,
                        properties: { title: next.trim() || 'Untitled slide' },
                      });
                    }
                    onApplyPatch(operations, `Edited ${primary.name}`);
                  }
                }}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                  if (event.key === 'Escape') {
                    event.currentTarget.value =
                      primary.kind === 'math'
                        ? (primary.math?.expression ?? '')
                        : (primary.content ?? '');
                    event.currentTarget.blur();
                  }
                }}
              />
              <small>Ctrl/⌘ + Enter to apply · Escape to cancel</small>
            </label>
          </InspectorGroup>
        ) : null}

        {primary.kind === 'image' ? (
          <ImageAssetEditor
            element={primary}
            slideElements={slideElements}
            onApplyPatch={onApplyPatch}
          />
        ) : null}
      </CollapsibleInspectorSection>

      {primary.kind === 'chart' && primary.chart ? (
        <CollapsibleInspectorSection
          id="data"
          title="Data"
          open={openSections.data}
          onToggle={() => toggleSection('data')}
        >
          <ChartDataEditor
            key={`${primary.id}-${primary.version}-chart-editor`}
            element={primary}
            onApplyPatch={onApplyPatch}
          />
        </CollapsibleInspectorSection>
      ) : null}

      <CollapsibleInspectorSection
        id="appearance"
        title="Appearance"
        open={openSections.appearance}
        onToggle={() => toggleSection('appearance')}
      >
        {primary.kind === 'text' || primary.kind === 'math' ? (
          <InspectorGroup icon={<Type size={14} />} title="Typography">
            <label className="ns-select-field">
              <span>Typeface</span>
              <select
                value={primary.style.fontFamily ?? theme.typography.body}
                disabled={editable.length === 0}
                onChange={(event) =>
                  patchStyle({ fontFamily: event.target.value }, 'Updated typeface')
                }
              >
                <option value={theme.typography.display}>
                  {labelFont(theme.typography.display)} · Display
                </option>
                <option value={theme.typography.body}>
                  {labelFont(theme.typography.body)} · Body
                </option>
                <option value={theme.typography.data}>
                  {labelFont(theme.typography.data)} · Data
                </option>
                <option value="system-ui, sans-serif">System sans</option>
                <option value="Georgia, serif">Georgia</option>
              </select>
              <ChevronDown size={13} />
            </label>
            <div className="ns-control-line">
              <NumberStepper
                icon={<Baseline size={14} />}
                label="Font size"
                value={primary.style.fontSize ?? 32}
                min={8}
                max={160}
                onCommit={(value) => patchStyle({ fontSize: value }, 'Updated font size')}
                disabled={editable.length === 0}
              />
              <button
                className={`ns-square-toggle ${(primary.style.fontWeight ?? 400) >= 650 ? 'is-active' : ''}`}
                type="button"
                disabled={editable.length === 0}
                aria-label="Toggle bold"
                aria-pressed={(primary.style.fontWeight ?? 400) >= 650}
                onClick={() =>
                  patchStyle(
                    { fontWeight: (primary.style.fontWeight ?? 400) >= 650 ? 400 : 700 },
                    'Updated font weight',
                  )
                }
              >
                <Bold size={15} aria-hidden="true" />
                <span>Bold</span>
              </button>
            </div>
            <div className="ns-segmented-control" aria-label="Text alignment">
              {(
                [
                  ['left', AlignLeft],
                  ['center', AlignCenter],
                  ['right', AlignRight],
                ] as const
              ).map(([alignment, Icon]) => (
                <button
                  type="button"
                  key={alignment}
                  className={(primary.style.textAlign ?? 'left') === alignment ? 'is-active' : ''}
                  aria-label={`Align ${alignment}`}
                  aria-pressed={(primary.style.textAlign ?? 'left') === alignment}
                  disabled={editable.length === 0}
                  onClick={() => patchStyle({ textAlign: alignment }, `Aligned text ${alignment}`)}
                >
                  <Icon size={15} aria-hidden="true" />
                  <span>{alignment[0]?.toUpperCase() + alignment.slice(1)}</span>
                </button>
              ))}
            </div>
          </InspectorGroup>
        ) : null}

        <InspectorGroup icon={<Palette size={14} />} title="Appearance">
          <ColorField
            label={primary.kind === 'text' || primary.kind === 'math' ? 'Text' : 'Fill'}
            value={
              primary.kind === 'text' || primary.kind === 'math'
                ? (primary.style.color ?? theme.colors.ink)
                : (primary.style.fill ?? theme.colors.accentSoft)
            }
            onCommit={(value) =>
              patchStyle(
                primary.kind === 'text' || primary.kind === 'math'
                  ? { color: value }
                  : { fill: value },
                `Updated ${primary.kind === 'text' || primary.kind === 'math' ? 'text color' : 'fill'}`,
              )
            }
            disabled={editable.length === 0}
          />
          <div className="ns-control-line">
            {primary.kind !== 'text' ? (
              <NumberStepper
                icon={<CornerUpLeft size={14} />}
                label="Corner radius"
                value={primary.style.radius ?? theme.defaultRadius}
                min={0}
                max={96}
                onCommit={(value) => patchStyle({ radius: value }, 'Updated corner radius')}
                disabled={editable.length === 0}
              />
            ) : null}
            <NumberStepper
              icon={<Square size={14} />}
              label="Opacity %"
              value={Math.round((primary.style.opacity ?? 1) * 100)}
              min={0}
              max={100}
              onCommit={(value) => patchStyle({ opacity: value / 100 }, 'Updated opacity')}
              disabled={editable.length === 0}
            />
          </div>
        </InspectorGroup>
      </CollapsibleInspectorSection>

      <CollapsibleInspectorSection
        id="advanced"
        title="Advanced"
        open={openSections.advanced}
        onToggle={() => toggleSection('advanced')}
      >
        <TastePackPanel
          activeTastePackId={activeTastePackId}
          activeProfileId={activeProfileId}
          previewProfileId={previewProfileId}
          profiles={profiles}
          busy={busy}
          onApply={onApplyTastePack}
          onApplyProfile={onApplyProfile}
          onPreviewProfile={onPreviewProfile}
          onUploadSource={onUploadSource}
          onClear={onClearTastePack}
        />
        {onEvictTasteSignal ? (
          <TasteProfileCard
            profile={tasteProfile ?? null}
            loading={tasteProfileLoading}
            onEvictSignal={onEvictTasteSignal}
            onOpenEvidence={onOpenPreferenceEvidence}
          />
        ) : null}
        <SlideNotesEditor slide={slide} onApplyPatch={onApplyPatch} />
        <ElementMetadata element={primary} />
        <ThemeSummary theme={theme} />
      </CollapsibleInspectorSection>
    </div>
  );
}

export function CollapsibleInspectorSection({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: DesignInspectorSectionId;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const reactId = useId();
  const contentId = `${reactId}-${id}-content`;
  return (
    <section
      className={`ns-design-section ${open ? 'is-open' : 'is-closed'}`}
      data-testid={`design-section-${id}`}
    >
      <button
        type="button"
        className="ns-design-section-toggle"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={onToggle}
      >
        <span>{title}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      <div id={contentId} className="ns-design-section-content" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

function ElementMetadata({ element }: { element: SlideElement }) {
  return (
    <InspectorGroup icon={<Square size={14} />} title="Element metadata">
      <dl className="ns-element-metadata">
        <div>
          <dt>Kind</dt>
          <dd>{element.kind}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{element.role ?? 'None'}</dd>
        </div>
        <div>
          <dt>Version</dt>
          <dd>{element.version}</dd>
        </div>
        <div>
          <dt>Element ID</dt>
          <dd>{element.id}</dd>
        </div>
      </dl>
    </InspectorGroup>
  );
}

function SlideNotesEditor({
  slide,
  onApplyPatch,
}: { slide: Slide; onApplyPatch: DesignInspectorProps['onApplyPatch'] }) {
  return (
    <InspectorGroup icon={<Type size={14} />} title="Speaker notes">
      <label className="ns-text-content-field">
        <span>Notes for this slide</span>
        <textarea
          key={`${slide.id}-${slide.version}-notes`}
          defaultValue={slide.notes ?? ''}
          rows={5}
          onBlur={(event) => {
            const next = event.currentTarget.value;
            if (next !== (slide.notes ?? '')) {
              onApplyPatch(
                [{ op: 'update_slide', slideId: slide.id, properties: { notes: next } }],
                `Updated notes for ${slide.title}`,
              );
            }
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === 'Escape') {
              event.currentTarget.value = slide.notes ?? '';
              event.currentTarget.blur();
            }
          }}
        />
        <small>Visible in speaker notes and exported artifacts</small>
      </label>
    </InspectorGroup>
  );
}

export interface ChartDataRow {
  id: string;
  label: string;
  value: string;
}

type ChartType = NonNullable<SlideElement['chart']>['chartType'];

export function chartRowsFromElement(element: SlideElement): ChartDataRow[] {
  const chart = element.chart;
  if (!chart) return [];
  const values = chart.series[0]?.values ?? [];
  return chart.labels.map((label, index) => ({
    id: `${element.id}:${index}`,
    label,
    value: values[index] === undefined ? '' : String(values[index]),
  }));
}

export function appendChartDataRow(rows: readonly ChartDataRow[], id: string): ChartDataRow[] {
  if (rows.length >= 24) return [...rows];
  return [...rows, { id, label: '', value: '' }];
}

export function removeChartDataRow(rows: readonly ChartDataRow[], rowId: string): ChartDataRow[] {
  if (rows.length <= 1) return [...rows];
  return rows.filter((row) => row.id !== rowId);
}

export function buildChartUpdateOperation({
  element,
  rows,
  chartType,
  seriesName,
  unit,
}: {
  element: SlideElement;
  rows: readonly ChartDataRow[];
  chartType: ChartType;
  seriesName: string;
  unit: string;
}): { operation: PatchOperation | null; error: string | null } {
  const chart = element.chart;
  if (!chart) return { operation: null, error: 'This chart is no longer available.' };
  if (rows.length === 0 || rows.length > 24 || rows.some((row) => !row.label.trim())) {
    return { operation: null, error: 'Add a label for every point.' };
  }
  if (rows.some((row) => row.value.trim() === '' || !Number.isFinite(Number(row.value)))) {
    return { operation: null, error: 'Enter a number for every point.' };
  }

  const primarySeries = chart.series[0];
  const normalizedUnit = unit.trim();
  return {
    error: null,
    operation: {
      op: 'update_chart',
      slideId: element.slideId,
      elementId: element.id,
      chart: {
        chartType,
        labels: rows.map((row) => row.label.trim()),
        series: [
          {
            name: seriesName.trim() || 'Series',
            values: rows.map((row) => Number(row.value)),
            ...(primarySeries?.color ? { color: primarySeries.color } : {}),
          },
        ],
        ...(normalizedUnit ? { unit: normalizedUnit } : {}),
        ...(chart.sourceId ? { sourceId: chart.sourceId } : {}),
      },
    },
  };
}

function ChartDataEditor({
  element,
  onApplyPatch,
}: {
  element: SlideElement;
  onApplyPatch: DesignInspectorProps['onApplyPatch'];
}) {
  const [error, setError] = useState<string | null>(null);
  const chart = element.chart;
  const [rows, setRows] = useState<ChartDataRow[]>(() => chartRowsFromElement(element));
  const nextRowId = useRef(rows.length);
  if (!chart) return null;
  const primarySeries = chart.series[0];

  return (
    <InspectorGroup icon={<BarChart3 size={14} />} title="Chart data">
      <form
        className="ns-primitive-editor"
        key={`${element.id}-${element.version}-chart`}
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          const form = new FormData(event.currentTarget);
          const result = buildChartUpdateOperation({
            element,
            rows,
            chartType: String(form.get('chartType')) as ChartType,
            seriesName: String(form.get('seriesName') ?? ''),
            unit: String(form.get('unit') ?? ''),
          });
          if (!result.operation) {
            setError(result.error);
            return;
          }
          onApplyPatch([result.operation], `Updated chart data for ${element.name}`);
        }}
      >
        <label>
          <span>Chart type</span>
          <select name="chartType" defaultValue={chart.chartType}>
            <option value="bar">Bar</option>
            <option value="line">Line</option>
            <option value="area">Area</option>
            <option value="donut">Donut</option>
          </select>
        </label>
        <div className="ns-chart-data-grid">
          <table>
            <caption className="ns-sr-only">Chart data points</caption>
            <thead>
              <tr>
                <th scope="col">Label</th>
                <th scope="col">Value</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id}>
                  <td>
                    <label>
                      <span className="ns-sr-only">Label for point {index + 1}</span>
                      <input
                        value={row.label}
                        aria-label={`Label for point ${index + 1}`}
                        data-testid={`chart-label-${index}`}
                        onChange={(event) => {
                          const label = event.target.value;
                          setRows((current) =>
                            current.map((candidate) =>
                              candidate.id === row.id ? { ...candidate, label } : candidate,
                            ),
                          );
                          setError(null);
                        }}
                      />
                    </label>
                  </td>
                  <td>
                    <label>
                      <span className="ns-sr-only">Value for point {index + 1}</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        value={row.value}
                        aria-label={`Value for point ${index + 1}`}
                        data-testid={`chart-value-${index}`}
                        onChange={(event) => {
                          const value = event.target.value;
                          setRows((current) =>
                            current.map((candidate) =>
                              candidate.id === row.id ? { ...candidate, value } : candidate,
                            ),
                          );
                          setError(null);
                        }}
                      />
                    </label>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ns-chart-data-grid__remove"
                      disabled={rows.length <= 1}
                      aria-label={`Remove point ${index + 1}`}
                      onClick={() => {
                        setRows((current) => removeChartDataRow(current, row.id));
                        setError(null);
                      }}
                    >
                      <X size={12} aria-hidden="true" />
                      <span>Remove</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className="ns-chart-data-grid__add"
          disabled={rows.length >= 24}
          onClick={() => {
            const id = `${element.id}:new:${nextRowId.current}`;
            nextRowId.current += 1;
            setRows((current) => appendChartDataRow(current, id));
            setError(null);
          }}
        >
          <Plus size={13} aria-hidden="true" /> Add point
        </button>
        <div className="ns-primitive-editor-grid">
          <label>
            <span>Series</span>
            <input name="seriesName" defaultValue={primarySeries?.name ?? 'Series'} />
          </label>
          <label>
            <span>Unit</span>
            <input name="unit" defaultValue={chart.unit ?? ''} />
          </label>
        </div>
        <button type="submit" className="ns-chart-data-grid__apply">
          Apply chart data
        </button>
        {error ? <output role="alert">{error}</output> : null}
      </form>
    </InspectorGroup>
  );
}

function ImageAssetEditor({
  element,
  slideElements,
  onApplyPatch,
}: {
  element: SlideElement;
  slideElements: readonly SlideElement[];
  onApplyPatch: DesignInspectorProps['onApplyPatch'];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <InspectorGroup icon={<ImageUp size={14} />} title="Image asset">
      <form className="ns-primitive-editor" key={`${element.id}-${element.version}-image`}>
        <label>
          <span>Alt text</span>
          <input name="altText" defaultValue={element.altText ?? element.name} maxLength={320} />
        </label>
        <label>
          <span>Credit</span>
          <input
            name="credit"
            defaultValue={element.image?.credit ?? ''}
            maxLength={320}
            placeholder="Source, photographer, or license"
          />
        </label>
        <label className="ns-image-upload-control">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            data-testid="image-upload"
            disabled={busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              const form = event.currentTarget.form;
              if (!file || !form) return;
              const formData = new FormData(form);
              const altText = String(formData.get('altText') ?? '').trim() || file.name;
              const credit = String(formData.get('credit') ?? '').trim();
              setError(null);
              setBusy(true);
              void imageFileToEmbeddedWebp(file)
                .then((imageUrl) => {
                  const operations: PatchOperation[] = [
                    {
                      op: 'update_image',
                      slideId: element.slideId,
                      elementId: element.id,
                      imageUrl,
                      altText,
                      ...(credit ? { credit } : {}),
                    },
                  ];
                  const creditElement = slideElements.find(
                    (candidate) =>
                      candidate.kind === 'text' &&
                      !candidate.locked &&
                      (candidate.name.toLowerCase().includes('image credit') ||
                        candidate.role === 'caption'),
                  );
                  if (credit && creditElement && creditElement.content !== credit) {
                    operations.push({
                      op: 'replace_text',
                      slideId: creditElement.slideId,
                      elementId: creditElement.id,
                      text: credit,
                    });
                  }
                  onApplyPatch(operations, `Replaced image asset for ${element.name}`);
                })
                .catch((cause) =>
                  setError(cause instanceof Error ? cause.message : 'The image could not be read.'),
                )
                .finally(() => setBusy(false));
            }}
          />
          <ImageUp size={14} /> {busy ? 'Preparing image…' : 'Upload downloaded image'}
        </label>
        <small>PNG, JPEG, WebP, or GIF. NodeSlide embeds a compressed copy in the deck.</small>
        {error ? <output role="alert">{error}</output> : null}
      </form>
    </InspectorGroup>
  );
}

async function imageFileToEmbeddedWebp(file: File): Promise<string> {
  if (file.size > 8_000_000) throw new Error('Choose an image smaller than 8 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const maxEdge = 1_100;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot prepare image uploads.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let dataUrl = canvas.toDataURL('image/webp', 0.8);
    if (dataUrl.length > 680_000) dataUrl = canvas.toDataURL('image/webp', 0.58);
    if (dataUrl.length > 680_000) {
      throw new Error('This image remains too large after compression. Choose a smaller image.');
    }
    return dataUrl;
  } finally {
    bitmap.close();
  }
}

function InspectorGroup({
  icon,
  title,
  children,
}: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="ns-control-group-section">
      <h3>
        {icon}
        {title}
      </h3>
      <div className="ns-control-group-body">{children}</div>
    </section>
  );
}

function NumberField({
  label,
  value,
  suffix,
  onCommit,
  disabled,
}: {
  label: string;
  value: number;
  suffix: string;
  onCommit: (value: number) => void;
  disabled: boolean;
}) {
  return (
    <label className="ns-number-field">
      <span>{label}</span>
      <input
        key={`${label}-${value}`}
        type="number"
        defaultValue={round(value)}
        disabled={disabled}
        onBlur={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next) && Math.abs(next - value) > 0.01) onCommit(next);
        }}
      />
      <small>{suffix}</small>
    </label>
  );
}

function NumberStepper({
  icon,
  label,
  value,
  min,
  max,
  disabled,
  onCommit,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  return (
    <div className="ns-stepper-field">
      <span className="ns-stepper-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="ns-stepper-label">{label}</span>
      <button
        type="button"
        disabled={disabled || value <= min}
        aria-label={`Decrease ${label}`}
        onClick={() => onCommit(Math.max(min, value - 1))}
      >
        <Minus size={12} />
      </button>
      <input
        key={`${label}-${value}`}
        aria-label={label}
        type="number"
        defaultValue={round(value)}
        min={min}
        max={max}
        disabled={disabled}
        onBlur={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next) && next !== value) onCommit(Math.min(max, Math.max(min, next)));
        }}
      />
      <button
        type="button"
        disabled={disabled || value >= max}
        aria-label={`Increase ${label}`}
        onClick={() => onCommit(Math.min(max, value + 1))}
      >
        <Plus size={12} />
      </button>
    </div>
  );
}

function ColorField({
  label,
  value,
  disabled,
  onCommit,
}: { label: string; value: string; disabled: boolean; onCommit: (value: string) => void }) {
  return (
    <label className="ns-color-field">
      <span>{label}</span>
      <i style={{ background: value }} />
      <input
        key={`${label}-${value}`}
        defaultValue={value}
        disabled={disabled}
        onBlur={(event) => {
          const next = event.target.value.trim();
          if (next && next !== value) onCommit(next);
        }}
      />
    </label>
  );
}

function ThemeSummary({ theme }: { theme: ThemeSpec }) {
  return (
    <section className="ns-theme-summary">
      <span className="ns-eyebrow">Deck theme</span>
      <h3>{theme.name}</h3>
      <div className="ns-theme-swatches">
        {Object.entries(theme.colors)
          .slice(0, 7)
          .map(([name, color]) => (
            <span key={name} title={`${name}: ${color}`} style={{ background: color }} />
          ))}
      </div>
      <p>
        <Type size={13} /> {labelFont(theme.typography.display)} +{' '}
        {labelFont(theme.typography.body)}
      </p>
    </section>
  );
}

const TASTE_PACK_DESCRIPTIONS: Record<NodeSlideTastePackId, string> = {
  'finance-ibcs': 'Compact, message-led reporting with restrained analytical emphasis.',
  'startup-narrative': 'Clear narrative contrast, generous focus, and a decisive next action.',
};

function TastePackPanel({
  activeTastePackId,
  activeProfileId,
  previewProfileId,
  profiles,
  busy,
  onApply,
  onApplyProfile,
  onPreviewProfile,
  onUploadSource,
  onClear,
}: {
  activeTastePackId: NodeSlideTastePackId | null;
  activeProfileId?: string | null;
  previewProfileId?: string | null;
  profiles: readonly SignatureProfile[];
  busy: boolean;
  onApply: (packId: NodeSlideTastePackId) => void;
  onApplyProfile: ((profile: SignatureProfile) => void) | undefined;
  onPreviewProfile: ((profile: SignatureProfile | null) => void) | undefined;
  onUploadSource: ((file: File) => void) | undefined;
  onClear: () => void;
}) {
  const allProfiles = [...NODESLIDE_TASTE_PACKS, ...profiles].filter(
    (profile, index, values) =>
      values.findIndex((candidate) => candidate.id === profile.id) === index,
  );
  return (
    <section className="ns-inspector-section ns-taste-packs" data-testid="taste-pack-panel">
      <div className="ns-section-title-row">
        <div>
          <span className="ns-eyebrow">Deck direction</span>
          <h2>Signatures</h2>
        </div>
        {activeTastePackId || activeProfileId ? (
          <span className="ns-kind-pill">Checks active</span>
        ) : null}
      </div>
      <p>
        Independent NodeSlide defaults with source-backed rules. Applying one creates a normal,
        reversible deck version.
      </p>
      {onUploadSource ? (
        <label className="ns-signature-upload">
          <strong>Upload a past deck</strong>
          <span>NodeSlide extracts observed colors, type, and layout evidence from PPTX.</span>
          <input
            type="file"
            accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUploadSource(file);
              event.target.value = '';
            }}
          />
        </label>
      ) : null}
      <div className="ns-taste-pack-list">
        {allProfiles.map((profile) => {
          const tastePackMetadata =
            '$extensions' in profile && profile.$extensions
              ? (profile.$extensions as Record<string, unknown>)['com.nodeslide.tastePack']
              : undefined;
          const packId =
            tastePackMetadata && typeof tastePackMetadata === 'object' && 'id' in tastePackMetadata
              ? (tastePackMetadata.id as NodeSlideTastePackId)
              : null;
          const active = profile.id === activeProfileId || packId === activeTastePackId;
          const previewing = profile.id === previewProfileId;
          const swatches = Object.values(profile.tokens.colors)
            .slice(0, 4)
            .map((token) => token.$value.hex);
          return (
            <article
              key={profile.id}
              className={`ns-taste-pack-card${active ? ' is-active' : ''}${previewing ? ' is-previewing' : ''}`}
              data-testid={`signature-profile-${packId ?? profile.id}`}
            >
              <span className="ns-taste-pack-card__heading">
                <strong>{profile.name}</strong>
                <span className="ns-taste-pack-swatches">
                  {swatches.map((color) => (
                    <i key={color} style={{ background: color }} aria-label={color} />
                  ))}
                </span>
              </span>
              <span>
                {packId
                  ? TASTE_PACK_DESCRIPTIONS[packId]
                  : `Observed from ${profile.source.fileName ?? profile.source.kind}; review extraction evidence before applying.`}
              </span>
              <small>
                {profile.confidence} confidence · {profile.warnings.length} warning
                {profile.warnings.length === 1 ? '' : 's'} ·{' '}
                {profile.source.kind === 'taste_pack' ? 'Sector pack' : 'Yours'}
              </small>
              <small>
                {signatureFontLabel(profile.tokens.fontFamilies['display'], 'Display fallback')} +{' '}
                {signatureFontLabel(profile.tokens.fontFamilies['body'], 'Body fallback')}
              </small>
              {profile.warnings.length > 0 ? (
                <ul className="ns-signature-warnings">
                  {profile.warnings.slice(0, 3).map((warning, index) => (
                    <li key={`${warning.code}:${index}`}>{warning.message}</li>
                  ))}
                </ul>
              ) : null}
              <span className="ns-signature-actions">
                {onPreviewProfile ? (
                  <button
                    type="button"
                    className="ns-button ns-button--quiet"
                    disabled={busy}
                    onClick={() => onPreviewProfile(previewing ? null : profile)}
                  >
                    {previewing ? 'Revert preview' : 'Preview'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="ns-button ns-button--accent"
                  disabled={busy}
                  onClick={() => {
                    if (onApplyProfile) onApplyProfile(profile);
                    else if (packId) onApply(packId);
                  }}
                >
                  {busy ? 'Applying…' : active ? 'Reapply' : 'Apply'}
                </button>
              </span>
            </article>
          );
        })}
      </div>
      {activeTastePackId || activeProfileId ? (
        <button
          type="button"
          className="ns-button ns-button--quiet ns-taste-pack-clear"
          onClick={onClear}
          disabled={busy}
        >
          Clear on-brand checks
        </button>
      ) : null}
    </section>
  );
}

function signatureFontLabel(
  token: SignatureProfile['tokens']['fontFamilies'][string] | undefined,
  fallback: string,
): string {
  if (!token) return fallback;
  return Array.isArray(token.$value) ? token.$value.join(', ') : token.$value;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(1, value / 100));
}

function clampSize(value: number) {
  return Math.max(0.01, Math.min(1, value / 100));
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function labelFont(value: string) {
  return value.split(',')[0]?.replaceAll('"', '').trim() ?? value;
}
