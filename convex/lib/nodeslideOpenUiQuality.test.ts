import { describe, expect, it } from 'vitest';
import { estimateTextFit } from '../../src/domains/nodeslide/slidelang/utils';
import { validateSnapshot } from '../../src/domains/nodeslide/slidelang/validation';
import { buildBriefNodeSlide, coerceBriefSpec, deterministicBriefSpec } from './nodeslideSeed';
import { validateNodeSlideSnapshot } from './nodeslideValidation';

const prompt = [
  'Create exactly seven visually ambitious, claim-led slides explaining why NodeSlide should dogfood its own authoring system.',
  'Audience: product and design leadership. Decision: approve the governed live-agent authoring roadmap and require recorded browser proof for every release.',
  'Use a refined editorial product-design aesthetic: warm off-white canvas, near-black typography, electric blue and coral accents, generous whitespace, strong hierarchy, and a distinct composition on every slide. Avoid repeated bullet-card grids. Keep every visible object natively editable.',
  'Use this exact layout contract in order: hero, comparison, contract, flow, split, evidence_board, decision.',
  'Slide 1 is a bold thesis cover: "NodeSlide must beat one-shot generation on governed creativity," with one supporting line and a visual tension motif.',
  'Slide 2 is a three-column competitive landscape. Canva AI wins brand and asset velocity; Gamma AI wins research-to-story speed; NodeSlide must own editable, governed execution.',
  'Slide 3 is an authoring contract that locks audience, decision, evidence ledger, and claim-led storyboard before layout. Show it as a structured editorial artifact, not bullets.',
  'Slide 4 is the only diagram: use exactly four short native editable nodes labeled Strategy, Agent team, Validate + review, and Editable export.',
  'Slide 5 uses a split composition: bounded repair on the left; HyperAgent-inspired versioned policy evolution, held-out evaluation, and safe promotion on the right.',
  'Slide 6 is an evidence board with labeled proof slots for provider, named model, input and output tokens, nonzero cost, candidate digest, durable validation receipt, version delta, and export artifact. Do not invent values.',
  'Slide 7 is a decisive release-gate checklist ending with "Approve the quality gate and require recorded proof for every release."',
  'Keep copy concise, use sentence-case headlines, preserve source notes for external references, and do not invent data or benchmark metrics.',
  'Treat Canva and Gamma as design inspirations rather than unverified performance claims. Treat HyperAgent as inspiration for versioned policy evolution, held-out evaluation, and safe promotionâ€”not permission to mutate production code. Keep every object editable and do not invent data.',
].join(' ');

const brief = {
  prompt,
  audience: 'Product and design leadership',
  purpose: 'Approve the governed live-agent authoring roadmap',
  successCriteria: ['Exactly 7 slides', 'Every visible object remains editable'],
};

describe('NodeSlide OpenUI dogfood quality contract', () => {
  it('turns the exact brief into seven audience-facing compositions', () => {
    const spec = deterministicBriefSpec('NodeSlide governed creativity', brief);
    expect(spec.slides.map((slide) => slide.layout)).toEqual([
      'hero',
      'comparison',
      'contract',
      'flow',
      'split',
      'evidence_board',
      'decision',
    ]);
    expect(spec.slides[0]?.headline).toBe(
      'NodeSlide must beat one-shot generation on governed creativity,',
    );
    expect(spec.slides[1]?.bullets).toEqual([
      'Canva AI — brand and asset velocity',
      'Gamma AI — research-to-story speed',
      'NodeSlide — editable, governed execution',
    ]);
    expect(spec.slides[3]?.diagram?.nodes).toEqual([
      'Strategy',
      'Agent team',
      'Validate + review',
      'Editable export',
    ]);
    expect(spec.slides[4]?.metric).toBeUndefined();
    expect(spec.slides[5]?.headline).toBe(
      'The evidence board makes every model action auditable after the browser closes.',
    );
    expect(spec.slides[5]?.bullets).toEqual([
      'Provider + model + tokens',
      'Cost + candidate digest',
      'Receipt + version + export',
    ]);
    expect(spec.slides[6]?.headline).toBe(
      'Approve the quality gate and require recorded proof for every release.',
    );
    expect(JSON.stringify(spec.slides)).not.toMatch(/Slide \d+ is|use exactly/iu);
  });

  it('builds a collision-free, text-fit, editable seven-composition snapshot', () => {
    const built = buildBriefNodeSlide({
      deckId: 'deck_openui_quality',
      projectId: 'project_openui_quality',
      title: 'NodeSlide governed creativity',
      brief,
      themeId: 'editorial-signal',
      rawSpec: deterministicBriefSpec('NodeSlide governed creativity', brief),
      now: 1_000,
    });
    expect(validateSnapshot(built.snapshot).publishOk).toBe(true);
    expect(validateNodeSlideSnapshot(built.snapshot, 1_000).publishOk).toBe(true);
    for (const element of built.snapshot.elements) {
      if ((element.kind === 'text' || element.kind === 'math') && element.content?.trim()) {
        expect(estimateTextFit(element).overflow, `${element.name}: ${element.content}`).toBe(
          false,
        );
      }
    }
    expect(
      built.snapshot.elements.filter((element) => element.role === 'diagram_node'),
    ).toHaveLength(4);
    expect(
      built.snapshot.elements.filter((element) => element.role === 'diagram_connector'),
    ).toHaveLength(3);
    const fingerprints = built.snapshot.slides.map((slide) =>
      built.snapshot.elements
        .filter((element) => element.slideId === slide.id && !element.locked)
        .map(
          (element) => `${element.kind}:${element.role}:${Object.values(element.bbox).join(',')}`,
        )
        .sort()
        .join('|'),
    );
    expect(new Set(fingerprints).size).toBe(7);
  });

  it('compiles a leaky live-provider draft back into the explicit audience contract', () => {
    const rawSpec = {
      title: 'Provider draft',
      narrative: ['Create the requested slides'],
      slides: Array.from({ length: 7 }, (_, index) => ({
        title: `Slide ${index + 1}`,
        section: `Step / ${index + 1}`,
        headline: `Is slide ${index + 1} exactly as instructed`,
        body: 'Use exactly the requested production instruction as visible copy.',
        bullets: ['Instruction one', 'Instruction two', 'Instruction three'],
        layout: 'comparison',
      })),
    };
    const spec = coerceBriefSpec(rawSpec, 'NodeSlide governed creativity', brief);
    expect(spec.slides.map((slide) => slide.layout)).toEqual([
      'hero',
      'comparison',
      'contract',
      'flow',
      'split',
      'evidence_board',
      'decision',
    ]);
    expect(spec.slides[3]?.diagram?.nodes).toEqual([
      'Strategy',
      'Agent team',
      'Validate + review',
      'Editable export',
    ]);
    expect(spec.slides[5]?.headline).toBe(
      'The evidence board makes every model action auditable after the browser closes.',
    );
    expect(JSON.stringify(spec.slides)).not.toMatch(/as instructed|Use exactly/iu);
  });
});
