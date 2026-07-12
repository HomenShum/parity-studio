import type { Deck, Slide } from '../../../../shared/nodeslide';

interface StoryArcOverviewProps {
  deck: Deck;
  slides: readonly Slide[];
  activeSlideId: string;
  onOpenSlide: (slideId: string) => void;
}

/** Read-only narrative projection used by the v3 Outline workspace. */
export function StoryArcOverview({
  deck,
  slides,
  activeSlideId,
  onOpenSlide,
}: StoryArcOverviewProps) {
  const sections = groupBySection(slides);
  const purpose = deck.brief.purpose?.trim() || deck.brief.prompt?.trim();
  const decision = deck.brief.successCriteria.filter(Boolean).join(' · ');

  return (
    <section className="ns-story-arc" aria-label="Deck story arc" data-testid="story-arc">
      <span className="ns-eyebrow">Story arc</span>
      <article className="ns-story-arc-summary">
        <span>The whole deck, in plain language</span>
        <h2>{purpose || deck.title}</h2>
        {decision ? <p>{decision}</p> : null}
      </article>

      <div className="ns-story-arc-sections">
        {sections.map(({ section, slides: sectionSlides }) => (
          <section key={section} aria-labelledby={`story-section-${safeId(section)}`}>
            <h3 id={`story-section-${safeId(section)}`}>{section}</h3>
            <div className="ns-story-arc-grid">
              {sectionSlides.map((slide) => {
                const index = slides.findIndex((candidate) => candidate.id === slide.id);
                return (
                  <button
                    type="button"
                    className={slide.id === activeSlideId ? 'is-active' : ''}
                    key={slide.id}
                    onClick={() => onOpenSlide(slide.id)}
                    aria-current={slide.id === activeSlideId ? 'page' : undefined}
                  >
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <strong>{slide.title}</strong>
                    {slide.notes ? <small>{slide.notes}</small> : null}
                    <i>Open slide</i>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function groupBySection(slides: readonly Slide[]) {
  const sections = new Map<string, Slide[]>();
  for (const slide of slides) {
    const section = slide.section?.trim() || 'Deck';
    const entries = sections.get(section) ?? [];
    entries.push(slide);
    sections.set(section, entries);
  }
  return [...sections].map(([section, sectionSlides]) => ({ section, slides: sectionSlides }));
}

function safeId(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
