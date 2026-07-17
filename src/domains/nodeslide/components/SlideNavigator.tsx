import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  Link2,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import {
  type DeckComment,
  type DeckPatch,
  NODESLIDE_SCOPE_SLIDE_LIMIT,
  type Slide,
  type SlideElement,
  type SourceRecord,
  type ThemeSpec,
  type ValidationIssue,
  type ValidationResult,
} from '../../../../shared/nodeslide';
import './editorShell.css';
import { SlideRenderer } from './SlideRenderer';

export type SlideNavigatorTab = 'slides' | 'outline' | 'layers';
export type LayerZOrderAction = 'front' | 'forward' | 'backward' | 'back';
export type SlideSourceFreshness = 'current' | 'stale' | 'unsourced';

export interface SlideOutlineItem {
  slideId: string;
  role?: string;
  claim?: string;
  evidence?: string;
  freshness?: SlideSourceFreshness;
}

export interface SlideNavigatorProps {
  slides: readonly Slide[];
  elements: readonly SlideElement[];
  theme: ThemeSpec;
  activeSlideId: string;
  collapsed: boolean;
  canAddSlide: boolean;
  canDeleteSlide: boolean;
  onSelectSlide: (slideId: string) => void;
  onToggleCollapsed: () => void;
  onAddSlide: () => void;
  onDuplicateSlide: (slideId: string) => void;
  onDeleteSlide: (slideId: string) => void;
  onReorderSlide: (slideId: string, index: number) => void;

  selectedSlideIds?: readonly string[];
  onSelectedSlideIdsChange?: (slideIds: string[]) => void;

  /** Controlled rail view. It defaults to Slides only for the legacy studio call site. */
  activeTab?: SlideNavigatorTab;
  onTabChange?: (tab: SlideNavigatorTab) => void;
  onRenameSlide?: (slideId: string, currentTitle: string) => void;

  comments?: readonly DeckComment[];
  patches?: readonly DeckPatch[];
  sources?: readonly SourceRecord[];
  validations?: readonly ValidationResult[];
  outline?: readonly SlideOutlineItem[];
  freshnessReferenceTime?: number;
  freshnessWindowMs?: number;

  collapsedSections?: readonly string[];
  onToggleSection?: (section: string) => void;
  propagationSlideIds?: readonly string[];

  selectedElementIds?: readonly string[];
  onSelectedElementIdsChange?: (elementIds: string[]) => void;
  elementVisibility?: Readonly<Record<string, boolean>>;
  elementBindings?: Readonly<Record<string, string | readonly string[] | null | undefined>>;
  elementGroupIds?: Readonly<Record<string, string | null | undefined>>;
  onToggleElementVisibility?: (elementId: string, visible: boolean) => void;
  onGroupElements?: (elementIds: readonly string[]) => void;
  onUngroupElements?: (elementIds: readonly string[]) => void;
  onChangeElementZOrder?: (elementIds: readonly string[], action: LayerZOrderAction) => void;
}

const NAVIGATOR_TABS: readonly SlideNavigatorTab[] = ['slides', 'outline', 'layers'];
const DEFAULT_FRESHNESS_WINDOW_MS = 120 * 24 * 60 * 60 * 1_000;

export function SlideNavigator({
  slides,
  elements,
  theme,
  activeSlideId,
  collapsed,
  canAddSlide,
  canDeleteSlide,
  onSelectSlide,
  onToggleCollapsed,
  onAddSlide,
  onDuplicateSlide,
  onDeleteSlide,
  onReorderSlide,
  selectedSlideIds = [],
  onSelectedSlideIdsChange,
  activeTab = 'slides',
  onTabChange,
  onRenameSlide,
  comments = [],
  patches = [],
  sources = [],
  validations = [],
  outline = [],
  freshnessReferenceTime,
  freshnessWindowMs = DEFAULT_FRESHNESS_WINDOW_MS,
  collapsedSections = [],
  onToggleSection,
  propagationSlideIds = [],
  selectedElementIds = [],
  onSelectedElementIdsChange,
  elementVisibility = {},
  elementBindings = {},
  elementGroupIds = {},
  onToggleElementVisibility,
  onGroupElements,
  onUngroupElements,
  onChangeElementZOrder,
}: SlideNavigatorProps) {
  const [menuSlideId, setMenuSlideId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const tabsId = useId();
  const sections = useMemo(() => groupSlides(slides), [slides]);
  const elementsById = useMemo(
    () => new Map(elements.map((element) => [element.id, element])),
    [elements],
  );
  const elementsBySlide = useMemo(() => groupElementsBySlide(elements), [elements]);
  const sourceById = useMemo(
    () => new Map(sources.map((source) => [source.id, source])),
    [sources],
  );
  const latestValidation = useMemo(() => findLatestValidation(validations), [validations]);
  const elementSlideIds = useMemo(
    () => new Map(elements.map((element) => [element.id, element.slideId])),
    [elements],
  );
  const outlineBySlideId = useMemo(
    () => new Map(outline.map((item) => [item.slideId, item])),
    [outline],
  );
  const freshnessReference = useMemo(
    () => freshnessReferenceTime ?? latestSuppliedTime({ comments, patches, sources, validations }),
    [comments, freshnessReferenceTime, patches, sources, validations],
  );
  const collapsedSectionSet = useMemo(() => new Set(collapsedSections), [collapsedSections]);
  const propagationSet = useMemo(() => new Set(propagationSlideIds), [propagationSlideIds]);
  const selectedSlideSet = useMemo(() => new Set(selectedSlideIds), [selectedSlideIds]);
  const activeSlide = slides.find((slide) => slide.id === activeSlideId);
  const activeLayers = activeSlide
    ? activeSlide.elementOrder.flatMap((elementId) => {
        const element = elementsById.get(elementId);
        return element && element.slideId === activeSlide.id ? [element] : [];
      })
    : [];
  const activeLayerIds = new Set(activeLayers.map((element) => element.id));
  const activeSelection = selectedElementIds.filter((elementId) => activeLayerIds.has(elementId));
  const canUngroupSelection = activeSelection.some((elementId) =>
    Boolean(elementGroupIds[elementId] ?? elementsById.get(elementId)?.groupId),
  );

  useEffect(() => {
    if (!onSelectedSlideIdsChange) return;
    const normalized = normalizeSelectedSlideIds(
      slides.map((slide) => slide.id),
      selectedSlideIds,
    );
    if (!sameIds(normalized, selectedSlideIds)) onSelectedSlideIdsChange(normalized);
  }, [onSelectedSlideIdsChange, selectedSlideIds, slides]);

  const toggleSlideSelection = (slideId: string) => {
    if (!onSelectedSlideIdsChange) return;
    onSelectedSlideIdsChange(
      toggleBoundedSlideSelection(
        slides.map((slide) => slide.id),
        selectedSlideIds,
        slideId,
      ),
    );
  };

  const activateOrToggleSlide = (event: ReactMouseEvent<HTMLButtonElement>, slideId: string) => {
    if ((event.metaKey || event.ctrlKey) && onSelectedSlideIdsChange) {
      event.preventDefault();
      toggleSlideSelection(slideId);
      return;
    }
    onSelectSlide(slideId);
  };

  const statusContext: StatusContext = {
    comments,
    patches,
    sourceById,
    latestValidation,
    elementSlideIds,
    freshnessReference,
    freshnessWindowMs,
  };

  return (
    <nav
      className={`ns-navigator ${collapsed ? 'is-collapsed' : ''}`}
      aria-label="Slides"
      data-testid="slide-navigator"
      data-active-tab={activeTab}
      onKeyDown={stopStudioNavigationFromControls}
    >
      <div className="ns-panel-heading ns-navigator-heading">
        <div>
          <span className="ns-eyebrow">Storyboard</span>
          <strong>{slides.length} slides</strong>
        </div>
        <button
          className="ns-icon-button"
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expand slide navigator' : 'Collapse slide navigator'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <div className="ns-collapsed-slides">
        {slides.map((slide, index) => (
          <button
            type="button"
            key={slide.id}
            className={`${slide.id === activeSlideId ? 'is-active' : ''} ${
              selectedSlideSet.has(slide.id) ? 'is-multi-selected' : ''
            }`}
            aria-label={`Go to slide ${index + 1}: ${slide.title}${
              selectedSlideSet.has(slide.id) ? ', selected for multi-slide editing' : ''
            }`}
            aria-pressed={selectedSlideSet.has(slide.id)}
            onClick={(event) => activateOrToggleSlide(event, slide.id)}
          >
            {index + 1}
            {selectedSlideSet.has(slide.id) ? (
              <Check className="ns-slide-selection-marker" size={10} aria-hidden="true" />
            ) : null}
            {propagationSet.has(slide.id) ? (
              <span className="ns-propagation-dot" aria-label="Affected by propagation preview" />
            ) : null}
          </button>
        ))}
      </div>

      <div className="ns-navigator-expanded">
        <Tabs
          value={activeTab}
          onValueChange={(value) => onTabChange?.(value as SlideNavigatorTab)}
          unstyled
        >
          <TabsList className="ns-navigator-tabs" aria-label="Navigator views" unstyled>
            {NAVIGATOR_TABS.map((tab) => (
              <TabsTrigger
                value={tab}
                id={`${tabsId}-${tab}-tab`}
                aria-controls={`${tabsId}-${tab}-panel`}
                className={activeTab === tab ? 'is-active' : ''}
                key={tab}
                unstyled
              >
                {capitalize(tab)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {activeTab === 'slides' ? (
          <div
            className="ns-navigator-panel ns-slides-panel"
            role="tabpanel"
            id={`${tabsId}-slides-panel`}
            aria-labelledby={`${tabsId}-slides-tab`}
          >
            <div className="ns-slide-list">
              {sections.map(({ section, slides: sectionSlides }, sectionIndex) => {
                const sectionCollapsed = collapsedSectionSet.has(section);
                const sectionContentId = `${tabsId}-section-${sectionIndex}`;
                return (
                  <Collapsible
                    asChild
                    disabled={!onToggleSection}
                    key={section}
                    onOpenChange={() => onToggleSection?.(section)}
                    open={!sectionCollapsed}
                  >
                    <section className="ns-slide-section" aria-label={section}>
                      <div className="ns-section-label">
                        <CollapsibleTrigger asChild>
                          <button
                            className="ns-section-toggle"
                            type="button"
                            aria-controls={sectionContentId}
                          >
                            {sectionCollapsed ? (
                              <ChevronRight size={12} aria-hidden="true" />
                            ) : (
                              <ChevronDown size={12} aria-hidden="true" />
                            )}
                            <span>{section}</span>
                            <span>{sectionSlides.length}</span>
                          </button>
                        </CollapsibleTrigger>
                      </div>
                      <CollapsibleContent id={sectionContentId}>
                        {sectionSlides.map((slide) => {
                          const slideIndex = slides.findIndex(
                            (candidate) => candidate.id === slide.id,
                          );
                          const slideElements = elementsBySlide.get(slide.id) ?? [];
                          const active = slide.id === activeSlideId;
                          const selectedForMultiEdit = selectedSlideSet.has(slide.id);
                          const statusTokens = statusesForSlide(
                            slide,
                            slideElements,
                            statusContext,
                          );
                          return (
                            <div
                              className={`ns-slide-row ${active ? 'is-active' : ''} ${
                                selectedForMultiEdit ? 'is-multi-selected' : ''
                              } ${draggingId === slide.id ? 'is-dragging' : ''}`}
                              data-multi-selected={selectedForMultiEdit ? 'true' : 'false'}
                              key={slide.id}
                              draggable
                              onDragStart={(event) =>
                                handleDragStart(event, slide.id, setDraggingId)
                              }
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={(event) => {
                                event.preventDefault();
                                const sourceId = event.dataTransfer.getData('text/nodeslide-slide');
                                if (sourceId && sourceId !== slide.id)
                                  onReorderSlide(sourceId, slideIndex);
                                setDraggingId(null);
                              }}
                              onDragEnd={() => setDraggingId(null)}
                            >
                              <span className="ns-slide-number">
                                {String(slideIndex + 1).padStart(2, '0')}
                                {selectedForMultiEdit ? (
                                  <Check
                                    className="ns-slide-selection-marker"
                                    size={10}
                                    aria-hidden="true"
                                  />
                                ) : null}
                              </span>
                              <button
                                className="ns-thumbnail-button"
                                type="button"
                                aria-current={active ? 'page' : undefined}
                                aria-label={`Slide ${slideIndex + 1}: ${slide.title}${
                                  selectedForMultiEdit ? ', selected for multi-slide editing' : ''
                                }`}
                                aria-pressed={selectedForMultiEdit}
                                data-testid={`slide-thumbnail-${slide.id}`}
                                onClick={(event) => activateOrToggleSlide(event, slide.id)}
                                onDoubleClick={() => onRenameSlide?.(slide.id, slide.title)}
                                onKeyDown={(event) => {
                                  if (
                                    handleSlideSelectionKeyDown(
                                      event,
                                      slide.id,
                                      onSelectedSlideIdsChange,
                                      toggleSlideSelection,
                                    )
                                  )
                                    return;
                                  handleRenameKeyDown(event, slide, onRenameSlide);
                                }}
                                title={
                                  onRenameSlide
                                    ? `${slide.title} (double-click or press F2 to rename)`
                                    : slide.title
                                }
                              >
                                <SlideRenderer
                                  slide={slide}
                                  elements={slideElements}
                                  theme={theme}
                                  className="ns-thumbnail"
                                />
                              </button>
                              <div className="ns-slide-row-copy">
                                <button
                                  className="ns-slide-title-button"
                                  type="button"
                                  aria-pressed={selectedForMultiEdit}
                                  onClick={(event) => activateOrToggleSlide(event, slide.id)}
                                  onDoubleClick={() => onRenameSlide?.(slide.id, slide.title)}
                                  onKeyDown={(event) => {
                                    if (
                                      handleSlideSelectionKeyDown(
                                        event,
                                        slide.id,
                                        onSelectedSlideIdsChange,
                                        toggleSlideSelection,
                                      )
                                    )
                                      return;
                                    handleRenameKeyDown(event, slide, onRenameSlide);
                                  }}
                                  title={
                                    onRenameSlide
                                      ? `${slide.title} (double-click or press F2 to rename)`
                                      : slide.title
                                  }
                                >
                                  {slide.title}
                                </button>
                                <span className="ns-slide-status-line">
                                  {propagationSet.has(slide.id) ? (
                                    <span
                                      className="ns-propagation-dot"
                                      data-propagation-slide-id={slide.id}
                                      aria-label="Affected by propagation preview"
                                    />
                                  ) : null}
                                  {statusTokens.map((status, index) => (
                                    <span
                                      className={`ns-status-token is-${status.tone}`}
                                      data-status-kind={status.kind}
                                      key={`${status.kind}-${index}`}
                                    >
                                      {status.label}
                                    </span>
                                  ))}
                                </span>
                                <span className="ns-slide-grab">
                                  <GripVertical size={13} /> Drag to reorder
                                </span>
                              </div>
                              <DropdownMenu
                                open={menuSlideId === slide.id}
                                onOpenChange={(open) => setMenuSlideId(open ? slide.id : null)}
                              >
                                <DropdownMenuTrigger asChild>
                                  <button
                                    className="ns-slide-more"
                                    type="button"
                                    aria-label={`Slide ${slideIndex + 1} actions`}
                                    title={`Slide ${slideIndex + 1} actions`}
                                  >
                                    <MoreHorizontal size={15} />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  align="end"
                                  className="ns-popover ns-slide-menu"
                                  portalContainer={
                                    typeof document === 'undefined'
                                      ? null
                                      : document.querySelector<HTMLElement>('.nodeslide-studio')
                                  }
                                >
                                  {onSelectedSlideIdsChange ? (
                                    <DropdownMenuCheckboxItem
                                      checked={selectedForMultiEdit}
                                      disabled={
                                        !selectedForMultiEdit &&
                                        selectedSlideIds.length >= NODESLIDE_SCOPE_SLIDE_LIMIT
                                      }
                                      onSelect={() => {
                                        toggleSlideSelection(slide.id);
                                      }}
                                    >
                                      {selectedForMultiEdit
                                        ? 'Remove from multi-slide edit'
                                        : 'Select for multi-slide edit'}
                                    </DropdownMenuCheckboxItem>
                                  ) : null}
                                  {onRenameSlide ? (
                                    <DropdownMenuItem
                                      onSelect={() => {
                                        onRenameSlide(slide.id, slide.title);
                                      }}
                                    >
                                      <Pencil size={14} /> Rename slide
                                    </DropdownMenuItem>
                                  ) : null}
                                  <DropdownMenuItem
                                    disabled={slideIndex <= 0}
                                    onSelect={() => {
                                      onReorderSlide(slide.id, slideIndex - 1);
                                    }}
                                  >
                                    <ArrowUp size={14} /> Move slide up
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={slideIndex >= slides.length - 1}
                                    onSelect={() => {
                                      onReorderSlide(slide.id, slideIndex + 1);
                                    }}
                                  >
                                    <ArrowDown size={14} /> Move slide down
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      onDuplicateSlide(slide.id);
                                    }}
                                  >
                                    <Copy size={14} /> Duplicate slide
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="is-danger"
                                    disabled={!canDeleteSlide || slides.length <= 1}
                                    onSelect={() => {
                                      onDeleteSlide(slide.id);
                                    }}
                                  >
                                    <Trash2 size={14} /> Delete slide
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          );
                        })}
                      </CollapsibleContent>
                    </section>
                  </Collapsible>
                );
              })}
            </div>
            {onSelectedSlideIdsChange ? (
              <output
                className={`ns-slide-selection-summary ${
                  selectedSlideIds.length > 0 ? 'has-selection' : ''
                }`}
                aria-live="polite"
              >
                {selectedSlideIds.length > 0 ? (
                  <>
                    <span>
                      <strong>{selectedSlideIds.length} selected</strong>
                      <small>Bounded AI write scope</small>
                    </span>
                    <button type="button" onClick={() => onSelectedSlideIdsChange([])}>
                      Clear
                    </button>
                  </>
                ) : (
                  <span>
                    <strong>Multi-slide edit</strong>
                    <small>Ctrl/⌘-click slides, or use the slide actions menu.</small>
                  </span>
                )}
              </output>
            ) : null}
            <div className="ns-navigator-footer">
              <button
                className="ns-add-slide-button"
                type="button"
                onClick={onAddSlide}
                disabled={!canAddSlide}
                title={
                  canAddSlide
                    ? 'Add slide'
                    : 'Adding slides is not available in the current patch schema'
                }
              >
                <Plus size={15} /> Add slide
              </button>
            </div>
          </div>
        ) : null}

        {activeTab === 'outline' ? (
          <div
            className="ns-navigator-panel ns-outline-panel"
            role="tabpanel"
            id={`${tabsId}-outline-panel`}
            aria-labelledby={`${tabsId}-outline-tab`}
          >
            <ol className="ns-outline-list" aria-label="Deck story outline">
              {slides.map((slide, index) => {
                const slideElements = elementsBySlide.get(slide.id) ?? [];
                const projection = outlineProjectionForSlide(
                  slide,
                  slideElements,
                  outlineBySlideId.get(slide.id),
                  statusContext,
                );
                const active = slide.id === activeSlideId;
                return (
                  <li className={active ? 'is-active' : ''} key={slide.id}>
                    <button
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      aria-label={`Slide ${index + 1}, ${projection.role}: ${projection.claim}`}
                      onClick={() => onSelectSlide(slide.id)}
                    >
                      <span className="ns-outline-role">
                        {String(index + 1).padStart(2, '0')} · {projection.role}
                      </span>
                      <span className="ns-outline-claim">{projection.claim}</span>
                      <span
                        className={`ns-outline-evidence is-${projection.freshness}`}
                        data-freshness={projection.freshness}
                      >
                        {propagationSet.has(slide.id) ? (
                          <span
                            className="ns-propagation-dot"
                            data-propagation-slide-id={slide.id}
                            aria-label="Affected by propagation preview"
                          />
                        ) : null}
                        <span>{projection.evidence}</span>
                        <span aria-hidden="true">·</span>
                        <span>{projection.freshness}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}

        {activeTab === 'layers' ? (
          <div
            className="ns-navigator-panel ns-layers-panel"
            role="tabpanel"
            id={`${tabsId}-layers-panel`}
            aria-labelledby={`${tabsId}-layers-tab`}
          >
            {activeSlide ? (
              <>
                <div className="ns-layers-heading">
                  <span className="ns-eyebrow">
                    Slide {slides.findIndex((slide) => slide.id === activeSlide.id) + 1} · Layers
                  </span>
                  <strong>{activeSlide.title}</strong>
                </div>
                <div className="ns-layer-actions" role="toolbar" aria-label="Layer actions">
                  <button
                    type="button"
                    disabled={activeSelection.length < 2 || !onGroupElements}
                    onClick={() => onGroupElements?.([...activeSelection])}
                  >
                    Group
                  </button>
                  <button
                    type="button"
                    disabled={!canUngroupSelection || !onUngroupElements}
                    onClick={() => onUngroupElements?.([...activeSelection])}
                  >
                    Ungroup
                  </button>
                  <span className="ns-layer-action-divider" aria-hidden="true" />
                  <button
                    type="button"
                    aria-label="Bring selected layers to front"
                    title="Bring to front"
                    disabled={activeSelection.length === 0 || !onChangeElementZOrder}
                    onClick={() => onChangeElementZOrder?.([...activeSelection], 'front')}
                  >
                    <ArrowUp size={13} />+
                  </button>
                  <button
                    type="button"
                    aria-label="Bring selected layers forward"
                    title="Bring forward"
                    disabled={activeSelection.length === 0 || !onChangeElementZOrder}
                    onClick={() => onChangeElementZOrder?.([...activeSelection], 'forward')}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label="Send selected layers backward"
                    title="Send backward"
                    disabled={activeSelection.length === 0 || !onChangeElementZOrder}
                    onClick={() => onChangeElementZOrder?.([...activeSelection], 'backward')}
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label="Send selected layers to back"
                    title="Send to back"
                    disabled={activeSelection.length === 0 || !onChangeElementZOrder}
                    onClick={() => onChangeElementZOrder?.([...activeSelection], 'back')}
                  >
                    <ArrowDown size={13} />−
                  </button>
                </div>
                <ol className="ns-layer-list" aria-label={`Layers on ${activeSlide.title}`}>
                  {activeLayers.map((element, index) => {
                    const selected = activeSelection.includes(element.id);
                    const visible = elementVisibility[element.id] ?? element.visible ?? true;
                    const bindingLabels = bindingsForElement(element, elementBindings[element.id]);
                    const groupId = elementGroupIds[element.id] ?? element.groupId;
                    return (
                      <li
                        className={selected ? 'is-selected' : ''}
                        data-element-id={element.id}
                        data-layer-index={index}
                        key={element.id}
                      >
                        <button
                          className="ns-layer-select"
                          type="button"
                          aria-pressed={selected}
                          onClick={(event) =>
                            selectLayer(
                              event,
                              element.id,
                              activeSelection,
                              onSelectedElementIdsChange,
                            )
                          }
                        >
                          <span className="ns-layer-kind" aria-hidden="true">
                            {elementKindGlyph(element)}
                          </span>
                          <span className="ns-layer-name">{element.name}</span>
                        </button>
                        <span className="ns-layer-indicators">
                          {groupId ? (
                            <span className="ns-layer-indicator" title={`Group ${groupId}`}>
                              Group
                            </span>
                          ) : null}
                          {bindingLabels.length > 0 ? (
                            <span
                              className="ns-layer-indicator is-bound"
                              title={bindingLabels.join(', ')}
                            >
                              <Link2 size={11} aria-hidden="true" />
                              Bound to {bindingLabels.length}{' '}
                              {bindingLabels.length === 1 ? 'source' : 'sources'}
                            </span>
                          ) : null}
                          {element.locked ? (
                            <span className="ns-layer-indicator is-locked">
                              <Lock size={11} aria-hidden="true" /> Locked
                            </span>
                          ) : null}
                        </span>
                        <button
                          className="ns-layer-visibility"
                          type="button"
                          aria-label={`${visible ? 'Hide' : 'Show'} ${element.name}`}
                          aria-pressed={visible}
                          disabled={!onToggleElementVisibility || element.locked}
                          onClick={() => onToggleElementVisibility?.(element.id, !visible)}
                        >
                          {visible ? <Eye size={13} /> : <EyeOff size={13} />}
                        </button>
                      </li>
                    );
                  })}
                </ol>
                {activeLayers.length === 0 ? (
                  <p className="ns-navigator-empty">This slide has no ordered layers.</p>
                ) : null}
              </>
            ) : (
              <p className="ns-navigator-empty">Select a slide to inspect its layers.</p>
            )}
          </div>
        ) : null}
      </div>
    </nav>
  );
}

interface StatusContext {
  comments: readonly DeckComment[];
  patches: readonly DeckPatch[];
  sourceById: ReadonlyMap<string, SourceRecord>;
  latestValidation: ValidationResult | undefined;
  elementSlideIds: ReadonlyMap<string, string>;
  freshnessReference: number;
  freshnessWindowMs: number;
}

interface StatusToken {
  kind: 'validation' | 'patch' | 'comment' | 'source' | 'version';
  label: string;
  tone: 'neutral' | 'positive' | 'warning' | 'danger' | 'accent';
}

interface OutlineProjection {
  role: string;
  claim: string;
  evidence: string;
  freshness: SlideSourceFreshness;
}

function groupSlides(slides: readonly Slide[]) {
  const groups = new Map<string, Slide[]>();
  for (const slide of slides) {
    const section = slide.section?.trim() || 'Deck';
    const current = groups.get(section) ?? [];
    current.push(slide);
    groups.set(section, current);
  }
  return [...groups.entries()].map(([section, groupedSlides]) => ({
    section,
    slides: groupedSlides,
  }));
}

function groupElementsBySlide(elements: readonly SlideElement[]) {
  const grouped = new Map<string, SlideElement[]>();
  for (const element of elements) {
    const current = grouped.get(element.slideId) ?? [];
    current.push(element);
    grouped.set(element.slideId, current);
  }
  return grouped;
}

function statusesForSlide(
  slide: Slide,
  slideElements: readonly SlideElement[],
  context: StatusContext,
): StatusToken[] {
  const statuses: StatusToken[] = [];
  const issues = validationIssuesForSlide(slide.id, context);
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  if (errorCount > 0)
    statuses.push({
      kind: 'validation',
      label: countLabel(errorCount, 'error'),
      tone: 'danger',
    });
  if (warningCount > 0)
    statuses.push({
      kind: 'validation',
      label: countLabel(warningCount, 'warning'),
      tone: 'warning',
    });

  const relevantPatches = context.patches.filter((patch) => patchTouchesSlide(patch, slide.id));
  const readyCount = relevantPatches.filter((patch) => patch.status === 'ready').length;
  const validatingCount = relevantPatches.filter((patch) => patch.status === 'validating').length;
  const draftCount = relevantPatches.filter((patch) => patch.status === 'draft').length;
  const staleCount = relevantPatches.filter((patch) => patch.status === 'stale').length;
  if (readyCount > 0)
    statuses.push({
      kind: 'patch',
      label: `${countLabel(readyCount, 'proposal')} ready`,
      tone: 'accent',
    });
  if (validatingCount > 0)
    statuses.push({
      kind: 'patch',
      label: `${countLabel(validatingCount, 'proposal')} validating`,
      tone: 'neutral',
    });
  if (draftCount > 0)
    statuses.push({
      kind: 'patch',
      label: `${countLabel(draftCount, 'proposal')} drafting`,
      tone: 'neutral',
    });
  if (staleCount > 0)
    statuses.push({
      kind: 'patch',
      label: `${countLabel(staleCount, 'proposal')} stale`,
      tone: 'warning',
    });

  const openCommentCount = context.comments.filter(
    (comment) => comment.status === 'open' && commentSlideId(comment) === slide.id,
  ).length;
  if (openCommentCount > 0)
    statuses.push({
      kind: 'comment',
      label: countLabel(openCommentCount, 'comment'),
      tone: 'neutral',
    });

  const evidence = evidenceForSlide(slide.id, slideElements, context);
  if (evidence.sourceCount > 0)
    statuses.push({
      kind: 'source',
      label: `${countLabel(evidence.sourceCount, 'source')} · ${evidence.freshness}`,
      tone: evidence.freshness === 'stale' ? 'warning' : 'positive',
    });

  if (statuses.length === 0)
    statuses.push({
      kind: 'version',
      label: `v${slide.version}`,
      tone: 'neutral',
    });
  return statuses;
}

function outlineProjectionForSlide(
  slide: Slide,
  slideElements: readonly SlideElement[],
  supplied: SlideOutlineItem | undefined,
  context: StatusContext,
): OutlineProjection {
  const orderedElements = slide.elementOrder.flatMap((elementId) => {
    const element = slideElements.find((candidate) => candidate.id === elementId);
    return element ? [element] : [];
  });
  const evidence = evidenceForSlide(slide.id, slideElements, context);
  const roleElement = orderedElements.find((element) => Boolean(element.role?.trim()));
  const claimElement =
    orderedElements.find(
      (element) =>
        element.kind === 'text' &&
        /headline|title|claim|thesis|recommendation|summary/i.test(
          `${element.role ?? ''} ${element.name}`,
        ) &&
        Boolean(element.content?.trim()),
    ) ?? orderedElements.find((element) => element.kind === 'text' && element.content?.trim());
  return {
    role:
      cleanText(supplied?.role) ??
      cleanText(slide.section) ??
      cleanText(roleElement?.role) ??
      'Slide',
    claim:
      cleanText(supplied?.claim) ??
      cleanText(claimElement?.content) ??
      firstNotesLine(slide.notes) ??
      cleanText(slide.title) ??
      'Untitled slide',
    evidence:
      cleanText(supplied?.evidence) ??
      (evidence.sourceCount > 0 ? countLabel(evidence.sourceCount, 'source') : 'No linked sources'),
    freshness: supplied?.freshness ?? evidence.freshness,
  };
}

function evidenceForSlide(
  slideId: string,
  slideElements: readonly SlideElement[],
  context: StatusContext,
): { sourceCount: number; freshness: SlideSourceFreshness } {
  const referencedSourceIds = new Set(
    slideElements.flatMap((element) => [
      ...element.sourceIds,
      ...(element.chart?.sourceId ? [element.chart.sourceId] : []),
    ]),
  );
  const sourceRecords = [...referencedSourceIds].flatMap((sourceId) => {
    const source = context.sourceById.get(sourceId);
    return source ? [source] : [];
  });
  if (sourceRecords.length === 0) return { sourceCount: 0, freshness: 'unsourced' };

  const sourceIssue = validationIssuesForSlide(slideId, context).some(
    (issue) => issue.code === 'source' && issue.severity !== 'info',
  );
  const oldestRetrievedAt = Math.min(...sourceRecords.map((source) => source.retrievedAt));
  const staleByAge =
    context.freshnessReference > 0 &&
    context.freshnessReference - oldestRetrievedAt > context.freshnessWindowMs;
  return {
    sourceCount: sourceRecords.length,
    freshness: sourceIssue || staleByAge ? 'stale' : 'current',
  };
}

function validationIssuesForSlide(
  slideId: string,
  context: StatusContext,
): readonly ValidationIssue[] {
  return (
    context.latestValidation?.issues.filter(
      (issue) =>
        issue.slideId === slideId ||
        (issue.elementId !== undefined && context.elementSlideIds.get(issue.elementId) === slideId),
    ) ?? []
  );
}

function findLatestValidation(validations: readonly ValidationResult[]) {
  return validations.reduce<ValidationResult | undefined>((latest, validation) => {
    if (!latest) return validation;
    if (validation.deckVersion !== latest.deckVersion)
      return validation.deckVersion > latest.deckVersion ? validation : latest;
    return validation.checkedAt > latest.checkedAt ? validation : latest;
  }, undefined);
}

function latestSuppliedTime({
  comments,
  patches,
  sources,
  validations,
}: {
  comments: readonly DeckComment[];
  patches: readonly DeckPatch[];
  sources: readonly SourceRecord[];
  validations: readonly ValidationResult[];
}) {
  return Math.max(
    0,
    ...comments.map((comment) => comment.updatedAt),
    ...patches.map((patch) => patch.updatedAt),
    ...sources.map((source) => source.retrievedAt),
    ...validations.map((validation) => validation.checkedAt),
  );
}

function patchTouchesSlide(patch: DeckPatch, slideId: string) {
  if ('slideIds' in patch.scope && patch.scope.slideIds.includes(slideId)) return true;
  return patch.operations.some((operation) => {
    if (operation.op === 'add_slide') return operation.slide.id === slideId;
    if (operation.op === 'update_deck') return false;
    return operation.slideId === slideId;
  });
}

function commentSlideId(comment: DeckComment) {
  return 'slideId' in comment.anchor ? comment.anchor.slideId : undefined;
}

function countLabel(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function cleanText(value: string | undefined) {
  const cleaned = value?.replace(/\s+/g, ' ').trim();
  return cleaned || undefined;
}

function firstNotesLine(notes: string | undefined) {
  const firstLine = notes?.split(/\r?\n/).find((line) => line.trim());
  return cleanText(firstLine);
}

function bindingsForElement(
  element: SlideElement,
  supplied: string | readonly string[] | null | undefined,
): readonly string[] {
  if (typeof supplied === 'string') return supplied.trim() ? [supplied] : [];
  if (Array.isArray(supplied)) return supplied.filter((label) => label.trim());
  return [...element.sourceIds, ...(element.chart?.sourceId ? [element.chart.sourceId] : [])];
}

function elementKindGlyph(element: SlideElement) {
  if (element.kind === 'text') return 'T';
  if (element.kind === 'image') return '▧';
  if (element.kind === 'chart') return '▥';
  if (element.kind === 'math') return '∑';
  if (element.kind === 'video') return '▶';
  if (element.kind === 'connector') return '↗';
  return '◇';
}

function selectLayer(
  event: ReactMouseEvent<HTMLButtonElement>,
  elementId: string,
  selectedElementIds: readonly string[],
  onSelectionChange: ((elementIds: string[]) => void) | undefined,
) {
  const multiSelect = event.shiftKey || event.metaKey || event.ctrlKey;
  if (!multiSelect) {
    onSelectionChange?.([elementId]);
    return;
  }
  onSelectionChange?.(
    selectedElementIds.includes(elementId)
      ? selectedElementIds.filter((id) => id !== elementId)
      : [...selectedElementIds, elementId],
  );
}

export function normalizeSelectedSlideIds(
  slideOrder: readonly string[],
  selectedSlideIds: readonly string[],
): string[] {
  const selected = new Set(selectedSlideIds);
  return slideOrder
    .filter((slideId) => selected.has(slideId))
    .slice(0, NODESLIDE_SCOPE_SLIDE_LIMIT);
}

export function toggleBoundedSlideSelection(
  slideOrder: readonly string[],
  selectedSlideIds: readonly string[],
  slideId: string,
): string[] {
  const normalized = normalizeSelectedSlideIds(slideOrder, selectedSlideIds);
  if (!slideOrder.includes(slideId)) return normalized;
  if (normalized.includes(slideId)) return normalized.filter((id) => id !== slideId);
  if (normalized.length >= NODESLIDE_SCOPE_SLIDE_LIMIT) return normalized;
  return normalizeSelectedSlideIds(slideOrder, [...normalized, slideId]);
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function handleSlideSelectionKeyDown(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  slideId: string,
  onSelectionChange: SlideNavigatorProps['onSelectedSlideIdsChange'],
  onToggle: (slideId: string) => void,
): boolean {
  if (!onSelectionChange || (!event.metaKey && !event.ctrlKey)) return false;
  if (event.key !== 'Enter' && event.key !== ' ') return false;
  event.preventDefault();
  event.stopPropagation();
  onToggle(slideId);
  return true;
}

function handleDragStart(
  event: DragEvent<HTMLDivElement>,
  slideId: string,
  setDraggingId: (slideId: string) => void,
) {
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/nodeslide-slide', slideId);
  setDraggingId(slideId);
}

function handleRenameKeyDown(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  slide: Slide,
  onRenameSlide: SlideNavigatorProps['onRenameSlide'],
) {
  if (event.key !== 'F2' || !onRenameSlide) return;
  event.preventDefault();
  event.stopPropagation();
  onRenameSlide(slide.id, slide.title);
}

function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function stopStudioNavigationFromControls(event: ReactKeyboardEvent<HTMLElement>) {
  if (
    event.key === ' ' ||
    event.key === 'ArrowUp' ||
    event.key === 'ArrowDown' ||
    event.key === 'ArrowLeft' ||
    event.key === 'ArrowRight' ||
    event.key === 'PageUp' ||
    event.key === 'PageDown'
  ) {
    event.stopPropagation();
  }
}
