import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Copy,
  GripVertical,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react';
import { type DragEvent, type KeyboardEvent as ReactKeyboardEvent, useMemo, useState } from 'react';
import type { Slide, SlideElement, ThemeSpec } from '../../../../shared/nodeslide';
import { SlideRenderer } from './SlideRenderer';

interface SlideNavigatorProps {
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
}

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
}: SlideNavigatorProps) {
  const [menuSlideId, setMenuSlideId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const sections = useMemo(() => groupSlides(slides), [slides]);

  return (
    <nav
      className={`ns-navigator ${collapsed ? 'is-collapsed' : ''}`}
      aria-label="Slides"
      data-testid="slide-navigator"
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
            className={slide.id === activeSlideId ? 'is-active' : ''}
            aria-label={`Go to slide ${index + 1}: ${slide.title}`}
            onClick={() => onSelectSlide(slide.id)}
          >
            {index + 1}
          </button>
        ))}
      </div>

      <div className="ns-navigator-expanded">
        <div className="ns-slide-list">
          {sections.map(({ section, slides: sectionSlides }) => (
            <section className="ns-slide-section" key={section} aria-label={section}>
              <div className="ns-section-label">
                <span>{section}</span>
                <span>{sectionSlides.length}</span>
              </div>
              {sectionSlides.map((slide) => {
                const slideIndex = slides.findIndex((candidate) => candidate.id === slide.id);
                const slideElements = elements.filter((element) => element.slideId === slide.id);
                const active = slide.id === activeSlideId;
                return (
                  <div
                    className={`ns-slide-row ${active ? 'is-active' : ''} ${draggingId === slide.id ? 'is-dragging' : ''}`}
                    key={slide.id}
                    draggable
                    onDragStart={(event) => handleDragStart(event, slide.id, setDraggingId)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const sourceId = event.dataTransfer.getData('text/nodeslide-slide');
                      if (sourceId && sourceId !== slide.id) onReorderSlide(sourceId, slideIndex);
                      setDraggingId(null);
                    }}
                    onDragEnd={() => setDraggingId(null)}
                  >
                    <span className="ns-slide-number">
                      {String(slideIndex + 1).padStart(2, '0')}
                    </span>
                    <button
                      className="ns-thumbnail-button"
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      aria-label={`Slide ${slideIndex + 1}: ${slide.title}`}
                      data-testid={`slide-thumbnail-${slide.id}`}
                      onClick={() => onSelectSlide(slide.id)}
                    >
                      <SlideRenderer
                        slide={slide}
                        elements={slideElements}
                        theme={theme}
                        className="ns-thumbnail"
                      />
                    </button>
                    <div className="ns-slide-row-copy">
                      <span>{slide.title}</span>
                      <span className="ns-slide-grab">
                        <GripVertical size={13} /> Drag to reorder
                      </span>
                    </div>
                    <button
                      className="ns-slide-more"
                      type="button"
                      aria-label={`Slide ${slideIndex + 1} actions`}
                      aria-haspopup="menu"
                      aria-expanded={menuSlideId === slide.id}
                      title={`Slide ${slideIndex + 1} actions`}
                      onClick={() =>
                        setMenuSlideId((value) => (value === slide.id ? null : slide.id))
                      }
                    >
                      <MoreHorizontal size={15} />
                    </button>
                    {menuSlideId === slide.id ? (
                      <div className="ns-popover ns-slide-menu" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          disabled={slideIndex <= 0}
                          onClick={() => {
                            setMenuSlideId(null);
                            onReorderSlide(slide.id, slideIndex - 1);
                          }}
                        >
                          <ArrowUp size={14} /> Move slide up
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={slideIndex >= slides.length - 1}
                          onClick={() => {
                            setMenuSlideId(null);
                            onReorderSlide(slide.id, slideIndex + 1);
                          }}
                        >
                          <ArrowDown size={14} /> Move slide down
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuSlideId(null);
                            onDuplicateSlide(slide.id);
                          }}
                        >
                          <Copy size={14} /> Duplicate slide
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="is-danger"
                          disabled={!canDeleteSlide || slides.length <= 1}
                          onClick={() => {
                            setMenuSlideId(null);
                            onDeleteSlide(slide.id);
                          }}
                        >
                          <Trash2 size={14} /> Delete slide
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
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
    </nav>
  );
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

function handleDragStart(
  event: DragEvent<HTMLDivElement>,
  slideId: string,
  setDraggingId: (slideId: string) => void,
) {
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/nodeslide-slide', slideId);
  setDraggingId(slideId);
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
