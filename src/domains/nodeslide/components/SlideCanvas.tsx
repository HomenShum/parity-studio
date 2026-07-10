import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Copy,
  Hand,
  Layers3,
  MessageSquarePlus,
  Minus,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  BoundingBox,
  DeckComment,
  PatchOperation,
  Presence,
  Slide,
  SlideElement,
  ThemeSpec,
} from '../../../../shared/nodeslide';
import { SlideRenderer } from './SlideRenderer';

type ResizeDirection = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

interface PointerInteraction {
  pointerId: number;
  kind: 'move' | 'resize' | 'pan';
  direction?: ResizeDirection;
  elementIds: string[];
  startClientX: number;
  startClientY: number;
  slideRect: DOMRect;
  startBoxes: Record<string, BoundingBox>;
  startScrollLeft: number;
  startScrollTop: number;
}

interface SlideCanvasProps {
  slide: Slide;
  slideIndex: number;
  slideCount: number;
  deckVersion: number;
  elements: readonly SlideElement[];
  comments: readonly DeckComment[];
  presence: readonly Presence[];
  theme: ThemeSpec;
  selectedElementIds: readonly string[];
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onSelectionChange: (elementIds: string[]) => void;
  onOpenAi: () => void;
  onOpenComments: () => void;
  onDuplicateElements: (elementIds: string[]) => void;
  onDeleteElements: (elementIds: string[]) => void;
  onApplyLayoutPatch: (operations: PatchOperation[], elementIds: string[], summary: string) => void;
  onPreviousSlide: () => void;
  onNextSlide: () => void;
}

export function SlideCanvas({
  slide,
  slideIndex,
  slideCount,
  deckVersion,
  elements,
  comments,
  presence,
  theme,
  selectedElementIds,
  zoom,
  onZoomChange,
  onSelectionChange,
  onOpenAi,
  onOpenComments,
  onDuplicateElements,
  onDeleteElements,
  onApplyLayoutPatch,
  onPreviousSlide,
  onNextSlide,
}: SlideCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<PointerInteraction | null>(null);
  const previousVersionRef = useRef(deckVersion);
  const [transientBoxes, setTransientBoxes] = useState<Record<string, BoundingBox>>({});
  const [optimisticBoxes, setOptimisticBoxes] = useState<Record<string, BoundingBox>>({});
  const [panMode, setPanMode] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);

  const elementMap = useMemo(
    () => new Map(elements.map((element) => [element.id, element])),
    [elements],
  );
  const selectedElements = selectedElementIds
    .map((id) => elementMap.get(id))
    .filter((element): element is SlideElement => element !== undefined);
  const primarySelection = selectedElements.at(-1);
  const displayedBox = (element: SlideElement) =>
    transientBoxes[element.id] ?? optimisticBoxes[element.id] ?? element.bbox;

  useEffect(() => {
    if (previousVersionRef.current !== deckVersion) {
      previousVersionRef.current = deckVersion;
      setOptimisticBoxes({});
    }
  }, [deckVersion]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.code === 'Space' &&
        !event.defaultPrevented &&
        !isKeyboardControlTarget(event.target)
      ) {
        setSpacePressed(true);
        event.preventDefault();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpacePressed(false);
    };
    const onBlur = () => setSpacePressed(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction || event.pointerId !== interaction.pointerId) return;
      if (interaction.kind === 'pan') {
        const viewport = viewportRef.current;
        if (!viewport) return;
        viewport.scrollLeft =
          interaction.startScrollLeft - (event.clientX - interaction.startClientX);
        viewport.scrollTop =
          interaction.startScrollTop - (event.clientY - interaction.startClientY);
        return;
      }

      const deltaX = (event.clientX - interaction.startClientX) / interaction.slideRect.width;
      const deltaY = (event.clientY - interaction.startClientY) / interaction.slideRect.height;
      const boxes: Record<string, BoundingBox> = {};
      for (const elementId of interaction.elementIds) {
        const start = interaction.startBoxes[elementId];
        if (!start) continue;
        boxes[elementId] =
          interaction.kind === 'move'
            ? moveBox(start, deltaX, deltaY)
            : resizeBox(start, deltaX, deltaY, interaction.direction ?? 'se');
      }
      setTransientBoxes(boxes);
    };

    const onPointerUp = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction || event.pointerId !== interaction.pointerId) return;
      interactionRef.current = null;
      document.documentElement.classList.remove('ns-is-dragging');
      if (interaction.kind === 'pan') return;

      setTransientBoxes((boxes) => {
        const operations: PatchOperation[] = [];
        for (const elementId of interaction.elementIds) {
          const before = interaction.startBoxes[elementId];
          const after = boxes[elementId];
          const element = elementMap.get(elementId);
          if (!before || !after || !element || element.locked) continue;
          if (!near(before.x, after.x) || !near(before.y, after.y)) {
            operations.push({ op: 'move', slideId: slide.id, elementId, x: after.x, y: after.y });
          }
          if (!near(before.width, after.width) || !near(before.height, after.height)) {
            operations.push({
              op: 'resize',
              slideId: slide.id,
              elementId,
              width: after.width,
              height: after.height,
            });
          }
        }
        if (operations.length > 0) {
          setOptimisticBoxes((current) => ({ ...current, ...boxes }));
          onApplyLayoutPatch(
            operations,
            interaction.elementIds,
            interaction.kind === 'move'
              ? `Moved ${interaction.elementIds.length === 1 ? 'element' : `${interaction.elementIds.length} elements`}`
              : 'Resized element',
          );
        }
        return {};
      });
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      document.documentElement.classList.remove('ns-is-dragging');
    };
  }, [elementMap, onApplyLayoutPatch, slide.id]);

  const beginElementMove = (event: ReactPointerEvent<HTMLDivElement>, element: SlideElement) => {
    if (panMode || spacePressed) return;
    event.stopPropagation();
    const modifier = event.shiftKey || event.metaKey || event.ctrlKey;
    let nextSelection = [...selectedElementIds];
    if (modifier) {
      if (nextSelection.includes(element.id)) {
        nextSelection = nextSelection.filter((id) => id !== element.id);
        onSelectionChange(nextSelection);
        return;
      }
      nextSelection.push(element.id);
    } else if (!nextSelection.includes(element.id)) {
      nextSelection = [element.id];
    }
    onSelectionChange(nextSelection);
    if (element.locked || event.button !== 0) return;
    startInteraction(
      event,
      'move',
      nextSelection.filter((id) => !elementMap.get(id)?.locked),
    );
  };

  const selectElementFromKeyboard = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    element: SlideElement,
  ) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();

    const modifier = event.shiftKey || event.metaKey || event.ctrlKey;
    if (!modifier) {
      onSelectionChange([element.id]);
      return;
    }
    onSelectionChange(
      selectedElementIds.includes(element.id)
        ? selectedElementIds.filter((id) => id !== element.id)
        : [...selectedElementIds, element.id],
    );
  };

  const startInteraction = (
    event: ReactPointerEvent<HTMLElement>,
    kind: 'move' | 'resize',
    elementIds: string[],
    direction?: ResizeDirection,
  ) => {
    const slideElement = event.currentTarget.closest('.ns-slide-renderer');
    if (!(slideElement instanceof HTMLElement) || elementIds.length === 0) return;
    const startBoxes: Record<string, BoundingBox> = {};
    for (const elementId of elementIds) {
      const element = elementMap.get(elementId);
      if (element) startBoxes[elementId] = { ...displayedBox(element) };
    }
    interactionRef.current = {
      pointerId: event.pointerId,
      kind,
      ...(direction ? { direction } : {}),
      elementIds,
      startClientX: event.clientX,
      startClientY: event.clientY,
      slideRect: slideElement.getBoundingClientRect(),
      startBoxes,
      startScrollLeft: 0,
      startScrollTop: 0,
    };
    document.documentElement.classList.add('ns-is-dragging');
    event.preventDefault();
    event.stopPropagation();
  };

  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!(panMode || spacePressed) || event.button !== 0) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    interactionRef.current = {
      pointerId: event.pointerId,
      kind: 'pan',
      elementIds: [],
      startClientX: event.clientX,
      startClientY: event.clientY,
      slideRect: new DOMRect(),
      startBoxes: {},
      startScrollLeft: viewport.scrollLeft,
      startScrollTop: viewport.scrollTop,
    };
    document.documentElement.classList.add('ns-is-dragging');
    event.preventDefault();
  };

  const selectedUnion = selectedElements.length
    ? unionBoxes(selectedElements.map((element) => displayedBox(element)))
    : null;
  const slideComments = comments.filter(
    (comment) => comment.status === 'open' && anchorSlideId(comment) === slide.id,
  );
  const slidePresence = presence.filter((person) => person.slideId === slide.id);

  return (
    <section
      className="ns-canvas-panel"
      aria-label={`Canvas, slide ${slideIndex + 1}`}
      data-testid="slide-canvas"
      onKeyDown={stopStudioNavigationFromControls}
    >
      <div className="ns-canvas-meta">
        <div>
          <span>Slide {slideIndex + 1}</span>
          <i /> <strong>{slide.title}</strong>
        </div>
        <span className="ns-canvas-mode">
          <span /> Live canvas
        </span>
      </div>

      <div
        ref={viewportRef}
        className={`ns-canvas-viewport ${panMode || spacePressed ? 'is-pan-ready' : ''}`}
        onWheel={(event) => handleWheelZoom(event, zoom, onZoomChange)}
        onPointerDown={startPan}
      >
        <div
          className="ns-canvas-stage"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && !(panMode || spacePressed))
              onSelectionChange([]);
          }}
        >
          <div className="ns-slide-shell" style={{ width: `${Math.round(960 * (zoom / 100))}px` }}>
            <SlideRenderer
              slide={slide}
              elements={elements}
              theme={theme}
              className="ns-editor-slide"
              elementClassName="ns-canvas-element"
              isElementSelected={(element) => selectedElementIds.includes(element.id)}
              onElementKeyDown={selectElementFromKeyboard}
              onElementPointerDown={beginElementMove}
              getElementStyle={(element) => {
                const box = displayedBox(element);
                return {
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.width * 100}%`,
                  height: `${box.height * 100}%`,
                  cursor: element.locked
                    ? 'not-allowed'
                    : panMode || spacePressed
                      ? 'grab'
                      : 'move',
                };
              }}
            >
              {selectedElements.map((element) => {
                const box = displayedBox(element);
                return (
                  <div className="ns-selection-box" key={element.id} style={boxStyle(box)}>
                    {element.id === primarySelection?.id && !element.locked
                      ? resizeDirections.map((direction) => (
                          <button
                            type="button"
                            key={direction}
                            className={`ns-resize-handle ns-resize-handle--${direction}`}
                            aria-label={`Resize ${element.name} from the ${resizeDirectionLabels[direction]}`}
                            title={`Resize from the ${resizeDirectionLabels[direction]}`}
                            onPointerDown={(event) =>
                              startInteraction(event, 'resize', [element.id], direction)
                            }
                          />
                        ))
                      : null}
                  </div>
                );
              })}

              {slidePresence.flatMap((person) =>
                person.elementIds.map((elementId) => {
                  const element = elementMap.get(elementId);
                  if (!element || selectedElementIds.includes(elementId)) return null;
                  return (
                    <div
                      className="ns-presence-outline"
                      key={`${person.id}-${elementId}`}
                      style={{ ...boxStyle(displayedBox(element)), borderColor: person.color }}
                    >
                      <span style={{ background: person.color }}>{person.displayName}</span>
                    </div>
                  );
                }),
              )}

              {slideComments.map((comment, index) => {
                const box = commentBox(comment, elementMap);
                if (!box) return null;
                return (
                  <button
                    type="button"
                    className="ns-comment-pin"
                    key={comment.id}
                    style={{ left: `${(box.x + box.width) * 100}%`, top: `${box.y * 100}%` }}
                    aria-label={`Open comment by ${comment.authorName}: ${comment.text}`}
                    onClick={onOpenComments}
                  >
                    {index + 1}
                  </button>
                );
              })}

              {selectedUnion ? (
                <div
                  className="ns-context-toolbar"
                  role="toolbar"
                  aria-label="Element actions"
                  style={{
                    left: `${Math.min(96, Math.max(4, selectedUnion.x * 100 + (selectedUnion.width * 100) / 2))}%`,
                    top: `${Math.max(1.5, selectedUnion.y * 100)}%`,
                  }}
                >
                  <button type="button" onClick={onOpenAi}>
                    <Bot size={14} /> Ask AI
                  </button>
                  <button type="button" onClick={onOpenComments}>
                    <MessageSquarePlus size={14} /> Comment
                  </button>
                  <button
                    type="button"
                    onClick={() => onDuplicateElements([...selectedElementIds])}
                  >
                    <Copy size={14} /> Duplicate
                  </button>
                  <button
                    type="button"
                    disabled
                    title="Element layering is not part of the current patch contract"
                  >
                    <Layers3 size={14} /> Arrange
                  </button>
                  <button
                    type="button"
                    className="is-danger"
                    onClick={() => onDeleteElements([...selectedElementIds])}
                    aria-label="Delete selected elements"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ) : null}
            </SlideRenderer>
          </div>
        </div>
      </div>

      <div className="ns-slide-stepper" aria-label="Slide navigation">
        <button
          type="button"
          onClick={onPreviousSlide}
          disabled={slideIndex <= 0}
          aria-label="Previous slide"
        >
          <ChevronLeft size={16} />
        </button>
        <span>
          {slideIndex + 1} / {slideCount}
        </span>
        <button
          type="button"
          onClick={onNextSlide}
          disabled={slideIndex >= slideCount - 1}
          aria-label="Next slide"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="ns-zoom-controls" aria-label="Canvas zoom and pan controls">
        <button
          type="button"
          className={panMode ? 'is-active' : ''}
          onClick={() => setPanMode((value) => !value)}
          aria-pressed={panMode}
          aria-label="Toggle pan tool"
          title="Pan tool (hold Space)"
        >
          <Hand size={15} />
        </button>
        <i />
        <button
          type="button"
          onClick={() => onZoomChange(clampZoom(zoom - 10))}
          aria-label="Zoom out"
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          className="ns-zoom-value"
          onClick={() => onZoomChange(100)}
          aria-label="Reset zoom to 100 percent"
        >
          {zoom}%
        </button>
        <button
          type="button"
          onClick={() => onZoomChange(clampZoom(zoom + 10))}
          aria-label="Zoom in"
        >
          <Plus size={14} />
        </button>
      </div>
    </section>
  );
}

const resizeDirections: ResizeDirection[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const resizeDirectionLabels: Record<ResizeDirection, string> = {
  n: 'top edge',
  ne: 'top right corner',
  e: 'right edge',
  se: 'bottom right corner',
  s: 'bottom edge',
  sw: 'bottom left corner',
  w: 'left edge',
  nw: 'top left corner',
};

function moveBox(box: BoundingBox, deltaX: number, deltaY: number): BoundingBox {
  return {
    ...box,
    x: clamp(box.x + deltaX, 0, 1 - box.width),
    y: clamp(box.y + deltaY, 0, 1 - box.height),
  };
}

function resizeBox(
  box: BoundingBox,
  deltaX: number,
  deltaY: number,
  direction: ResizeDirection,
): BoundingBox {
  const minWidth = 0.02;
  const minHeight = 0.025;
  let { x, y, width, height } = box;
  const right = x + width;
  const bottom = y + height;
  if (direction.includes('e')) width = clamp(width + deltaX, minWidth, 1 - x);
  if (direction.includes('s')) height = clamp(height + deltaY, minHeight, 1 - y);
  if (direction.includes('w')) {
    x = clamp(x + deltaX, 0, right - minWidth);
    width = right - x;
  }
  if (direction.includes('n')) {
    y = clamp(y + deltaY, 0, bottom - minHeight);
    height = bottom - y;
  }
  return { x, y, width, height };
}

function boxStyle(box: BoundingBox): CSSProperties {
  return {
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.width * 100}%`,
    height: `${box.height * 100}%`,
  };
}

function unionBoxes(boxes: BoundingBox[]): BoundingBox {
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x, y, width: right - x, height: bottom - y };
}

function anchorSlideId(comment: DeckComment) {
  return 'slideId' in comment.anchor ? comment.anchor.slideId : undefined;
}

function commentBox(
  comment: DeckComment,
  elementMap: Map<string, SlideElement>,
): BoundingBox | null {
  if (comment.anchor.type === 'element')
    return elementMap.get(comment.anchor.elementId)?.bbox ?? null;
  if (comment.anchor.type === 'bounding_box') return comment.anchor.bbox;
  if (comment.anchor.type === 'slide') return { x: 0.96, y: 0.04, width: 0, height: 0 };
  return null;
}

function handleWheelZoom(
  event: ReactWheelEvent<HTMLDivElement>,
  zoom: number,
  onZoomChange: (zoom: number) => void,
) {
  if (!(event.ctrlKey || event.metaKey)) return;
  event.preventDefault();
  onZoomChange(clampZoom(zoom + (event.deltaY > 0 ? -5 : 5)));
}

function clampZoom(zoom: number) {
  return Math.min(200, Math.max(25, zoom));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function near(a: number, b: number) {
  return Math.abs(a - b) < 0.0005;
}

function isKeyboardControlTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        'button, a[href], input, textarea, select, [contenteditable="true"], [role="button"], [role="menuitem"], [tabindex]:not([tabindex="-1"])',
      ),
    )
  );
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
