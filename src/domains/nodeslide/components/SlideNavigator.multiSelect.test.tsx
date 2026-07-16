// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGoldenNodeSlide } from '../../../../convex/lib/nodeslideSeed';
import { NODESLIDE_SCOPE_SLIDE_LIMIT, type Slide } from '../../../../shared/nodeslide';
import {
  SlideNavigator,
  type SlideNavigatorProps,
  normalizeSelectedSlideIds,
  toggleBoundedSlideSelection,
} from './SlideNavigator';

afterEach(cleanup);

describe('NodeSlide bounded multi-slide selection', () => {
  it('uses the shared disclosure primitive without losing the controlled section contract', async () => {
    const snapshot = buildGoldenNodeSlide('navigator-disclosure', 1_000).snapshot;
    const slides = snapshot.slides.slice(0, 2);
    const section = slides[0]?.section;
    if (!section) throw new Error('Fixture requires a named first section.');
    const onToggleSection = vi.fn();
    const user = userEvent.setup();
    renderNavigator(slides, {
      collapsedSections: [section],
      onToggleSection,
    });

    const trigger = screen.getByRole('button', { name: `${section}1` });
    expect(trigger).toHaveAttribute('data-slot', 'collapsible-trigger');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId(`slide-thumbnail-${slides[0]?.id}`)).not.toBeInTheDocument();

    await user.click(trigger);
    expect(onToggleSection).toHaveBeenCalledWith(section);
  });

  it('selects noncontiguous slides without moving the active canvas and supports deselection', () => {
    const snapshot = buildGoldenNodeSlide('multi-slide-ui', 1_000).snapshot;
    const slides = snapshot.slides.slice(0, 4);
    const onSelectSlide = vi.fn();
    const onSelectedSlideIdsChange = vi.fn();
    const view = renderNavigator(slides, {
      activeSlideId: slides[0]?.id ?? '',
      onSelectSlide,
      onSelectedSlideIdsChange,
      selectedSlideIds: [],
    });

    const slide2 = slides[1];
    const slide4 = slides[3];
    if (!slide2 || !slide4) throw new Error('Fixture requires four slides.');

    fireEvent.click(screen.getByTestId(`slide-thumbnail-${slide2.id}`), { ctrlKey: true });
    expect(onSelectedSlideIdsChange).toHaveBeenLastCalledWith([slide2.id]);
    expect(onSelectSlide).not.toHaveBeenCalled();

    view.rerender(
      <div className="nodeslide-studio">
        <SlideNavigator
          {...navigatorProps(slides)}
          activeSlideId={slides[0]?.id ?? ''}
          onSelectSlide={onSelectSlide}
          onSelectedSlideIdsChange={onSelectedSlideIdsChange}
          selectedSlideIds={[slide2.id]}
        />
      </div>,
    );
    fireEvent.click(screen.getByTestId(`slide-thumbnail-${slide4.id}`), { ctrlKey: true });
    expect(onSelectedSlideIdsChange).toHaveBeenLastCalledWith([slide2.id, slide4.id]);
    expect(onSelectSlide).not.toHaveBeenCalled();

    view.rerender(
      <div className="nodeslide-studio">
        <SlideNavigator
          {...navigatorProps(slides)}
          activeSlideId={slides[0]?.id ?? ''}
          onSelectSlide={onSelectSlide}
          onSelectedSlideIdsChange={onSelectedSlideIdsChange}
          selectedSlideIds={[slide2.id, slide4.id]}
        />
      </div>,
    );
    expect(screen.getByText('2 selected')).toBeVisible();
    expect(screen.getByTestId(`slide-thumbnail-${slide2.id}`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId(`slide-thumbnail-${slide4.id}`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByTestId(`slide-thumbnail-${slide2.id}`), { ctrlKey: true });
    expect(onSelectedSlideIdsChange).toHaveBeenLastCalledWith([slide4.id]);
    expect(screen.getByTestId(`slide-thumbnail-${slides[0]?.id}`)).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('offers a keyboard-operable, labeled slide action for touch and non-modifier users', async () => {
    const snapshot = buildGoldenNodeSlide('multi-slide-keyboard', 1_000).snapshot;
    const slides = snapshot.slides.slice(0, 4);
    const slide2 = slides[1];
    if (!slide2) throw new Error('Fixture requires a second slide.');
    const onSelectedSlideIdsChange = vi.fn();
    const user = userEvent.setup();
    renderNavigator(slides, { onSelectedSlideIdsChange, selectedSlideIds: [] });

    await user.click(screen.getByRole('button', { name: 'Slide 2 actions' }));
    const selectAction = screen.getByRole('menuitemcheckbox', {
      name: 'Select for multi-slide edit',
    });
    expect(selectAction).toHaveAttribute('aria-checked', 'false');
    selectAction.focus();
    await user.keyboard('{Enter}');

    expect(onSelectedSlideIdsChange).toHaveBeenLastCalledWith([slide2.id]);
  });

  it('enforces the shared cap and prunes duplicates, stale IDs, and deleted slides', async () => {
    const slideOrder = Array.from(
      { length: NODESLIDE_SCOPE_SLIDE_LIMIT + 1 },
      (_, index) => `slide-${index + 1}`,
    );
    const atCap = slideOrder.slice(0, NODESLIDE_SCOPE_SLIDE_LIMIT);
    expect(toggleBoundedSlideSelection(slideOrder, atCap, slideOrder.at(-1) as string)).toEqual(
      atCap,
    );
    expect(
      normalizeSelectedSlideIds(slideOrder, [
        slideOrder[2] as string,
        'deleted',
        slideOrder[0] as string,
        slideOrder[2] as string,
      ]),
    ).toEqual([slideOrder[0], slideOrder[2]]);

    const snapshot = buildGoldenNodeSlide('multi-slide-prune', 1_000).snapshot;
    const slides = snapshot.slides.slice(0, 3);
    const first = slides[0];
    const deleted = slides[1];
    if (!first || !deleted) throw new Error('Fixture requires two slides.');
    const onSelectedSlideIdsChange = vi.fn();
    const view = renderNavigator(slides, {
      onSelectedSlideIdsChange,
      selectedSlideIds: [first.id, deleted.id],
    });
    onSelectedSlideIdsChange.mockClear();

    view.rerender(
      <div className="nodeslide-studio">
        <SlideNavigator
          {...navigatorProps(slides.filter((slide) => slide.id !== deleted.id))}
          selectedSlideIds={[first.id, deleted.id]}
          onSelectedSlideIdsChange={onSelectedSlideIdsChange}
        />
      </div>,
    );

    await waitFor(() => expect(onSelectedSlideIdsChange).toHaveBeenCalledWith([first.id]));
  });
});

function renderNavigator(slides: readonly Slide[], overrides: Partial<SlideNavigatorProps> = {}) {
  return render(
    <div className="nodeslide-studio">
      <SlideNavigator {...navigatorProps(slides)} {...overrides} />
    </div>,
  );
}

function navigatorProps(slides: readonly Slide[]): SlideNavigatorProps {
  const snapshot = buildGoldenNodeSlide('multi-slide-props', 1_000).snapshot;
  const slideIds = new Set(slides.map((slide) => slide.id));
  return {
    slides,
    elements: snapshot.elements.filter((element) => slideIds.has(element.slideId)),
    theme: snapshot.deck.theme,
    activeSlideId: slides[0]?.id ?? '',
    collapsed: false,
    canAddSlide: true,
    canDeleteSlide: slides.length > 1,
    onSelectSlide: () => undefined,
    onToggleCollapsed: () => undefined,
    onAddSlide: () => undefined,
    onDuplicateSlide: () => undefined,
    onDeleteSlide: () => undefined,
    onReorderSlide: () => undefined,
  };
}
