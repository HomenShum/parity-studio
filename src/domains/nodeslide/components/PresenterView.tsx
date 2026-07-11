import { ChevronLeft, ChevronRight, Maximize2, Minimize2, NotebookText, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Deck, Slide, SlideElement } from '../../../../shared/nodeslide';
import { SlideRenderer } from './SlideRenderer';

interface PresenterViewProps {
  workspace: {
    deck: Pick<Deck, 'title' | 'theme' | 'slideOrder'>;
    slides: Slide[];
    elements: SlideElement[];
  };
  initialSlideId?: string;
  showNotes?: boolean;
  onExit: (slideId: string) => void;
}

export function PresenterView({
  workspace,
  initialSlideId,
  showNotes = true,
  onExit,
}: PresenterViewProps) {
  const slides = workspace.deck.slideOrder
    .map((id) => workspace.slides.find((slide) => slide.id === id))
    .filter((slide): slide is Slide => slide !== undefined);
  const initialIndex = Math.max(
    0,
    slides.findIndex((slide) => slide.id === initialSlideId),
  );
  const [index, setIndex] = useState(initialIndex);
  const [notesOpen, setNotesOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const slide = slides[index];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isInteractiveTarget(event.target)) return;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) {
        event.preventDefault();
        setIndex((value) => Math.min(slides.length - 1, value + 1));
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) {
        event.preventDefault();
        setIndex((value) => Math.max(0, value - 1));
      } else if (event.key === 'Escape' && !document.fullscreenElement && slide) {
        onExit(slide.id);
      } else if (showNotes && event.key.toLowerCase() === 'n') {
        setNotesOpen((value) => !value);
      }
    };
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [onExit, showNotes, slide, slides.length]);

  useEffect(() => {
    if (!slide) return;
    const url = new URL(window.location.href);
    url.searchParams.set('slide', slide.id);
    window.history.replaceState(null, '', url);
  }, [slide]);

  if (!slide) return null;
  const slideElements = workspace.elements.filter((element) => element.slideId === slide.id);
  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  };

  return (
    <main className="ns-presenter">
      <output className="ns-sr-only" aria-live="polite">
        Slide {index + 1} of {slides.length}: {slide.title}
      </output>
      <div className="ns-presenter-progress">
        <span style={{ width: `${((index + 1) / slides.length) * 100}%` }} />
      </div>
      <div className="ns-presenter-topbar">
        <span>{workspace.deck.title}</span>
        <div>
          {showNotes ? (
            <button
              type="button"
              onClick={() => setNotesOpen((value) => !value)}
              className={notesOpen ? 'is-active' : ''}
            >
              <NotebookText size={15} /> Notes
            </button>
          ) : null}
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button type="button" onClick={() => onExit(slide.id)} aria-label="Exit presenter">
            <X size={17} />
          </button>
        </div>
      </div>
      <div className={`ns-presenter-stage ${showNotes && notesOpen ? 'has-notes' : ''}`}>
        <div className="ns-presenter-slide-wrap">
          <SlideRenderer
            slide={slide}
            elements={slideElements}
            theme={workspace.deck.theme}
            className="ns-presenter-slide"
          />
        </div>
        {showNotes && notesOpen ? (
          <aside className="ns-presenter-notes">
            <span className="ns-eyebrow">Speaker notes</span>
            <h2>{slide.title}</h2>
            <p>{slide.notes || 'No speaker notes for this slide.'}</p>
          </aside>
        ) : null}
      </div>
      <div className="ns-presenter-controls">
        <button
          type="button"
          onClick={() => setIndex((value) => Math.max(0, value - 1))}
          disabled={index === 0}
          aria-label="Previous slide"
        >
          <ChevronLeft size={18} />
        </button>
        <span>
          {index + 1} <i /> {slides.length}
        </span>
        <button
          type="button"
          onClick={() => setIndex((value) => Math.min(slides.length - 1, value + 1))}
          disabled={index === slides.length - 1}
          aria-label="Next slide"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </main>
  );
}

function isInteractiveTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('button, a, input, textarea, select, [contenteditable="true"]'))
  );
}
