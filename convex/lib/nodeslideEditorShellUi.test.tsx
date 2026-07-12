import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  DeckComment,
  DeckPatch,
  Slide,
  SlideElement,
  SourceRecord,
  ThemeSpec,
  ValidationResult,
} from '../../shared/nodeslide';
import {
  EditorCanvasModes,
  type EditorCanvasModesProps,
  type EditorCompareMode,
} from '../../src/domains/nodeslide/components/EditorCanvasModes';
import {
  SlideNavigator,
  type SlideNavigatorProps,
} from '../../src/domains/nodeslide/components/SlideNavigator';
import { shouldRevealCandidateCanvas } from '../../src/domains/nodeslide/components/editorShellResponsive';

describe('NodeSlide editor shell navigator', () => {
  it('renders controlled tabs and authoritative slide status lines', () => {
    const markup = renderNavigator({
      activeTab: 'slides',
      comments: [comment],
      patches: [patch],
      sources: [source],
      validations: [validation],
      propagationSlideIds: ['slide:product'],
      collapsedSections: ['Appendix'],
      onTabChange: () => undefined,
      onToggleSection: () => undefined,
      onRenameSlide: () => undefined,
    });

    expect(markup).toContain('role="tablist"');
    expect(markup).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Slides/);
    expect(markup).toContain('>Outline</button>');
    expect(markup).toContain('>Layers</button>');
    expect(markup).toContain('1 warning');
    expect(markup).toContain('1 proposal ready');
    expect(markup).toContain('1 comment');
    expect(markup).toContain('1 source · current');
    expect(markup).toContain('data-propagation-slide-id="slide:product"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('double-click or press F2 to rename');
  });

  it('projects semantic outline and controlled active-slide layers', () => {
    const outlineMarkup = renderNavigator({
      activeTab: 'outline',
      sources: [source],
      onTabChange: () => undefined,
    });

    expect(outlineMarkup).toContain('<ol class="ns-outline-list" aria-label="Deck story outline">');
    expect(outlineMarkup).toContain('01 · Product');
    expect(outlineMarkup).toContain('Structured authoring is the moat.');
    expect(outlineMarkup).toContain('1 source');
    expect(outlineMarkup).toContain('data-freshness="current"');
    expect(outlineMarkup).toContain('aria-current="page"');

    const layersMarkup = renderNavigator({
      activeTab: 'layers',
      sources: [source],
      selectedElementIds: ['element:proof'],
      elementVisibility: { 'element:proof': false },
      elementGroupIds: { 'element:headline': 'group:story' },
      onTabChange: () => undefined,
      onSelectedElementIdsChange: () => undefined,
      onToggleElementVisibility: () => undefined,
      onGroupElements: () => undefined,
      onUngroupElements: () => undefined,
      onChangeElementZOrder: () => undefined,
    });

    expect(layersMarkup).toContain('<ol class="ns-layer-list"');
    expect(layersMarkup.indexOf('Headline')).toBeLessThan(layersMarkup.indexOf('Proof point'));
    expect(layersMarkup).toMatch(/class="ns-layer-select"[^>]*aria-pressed="true"/);
    expect(layersMarkup).toContain('Bound to 1 source');
    expect(layersMarkup).toContain('Locked');
    expect(layersMarkup).toContain('Group');
    expect(layersMarkup).toContain('aria-label="Show Proof point"');
  });
});

describe('NodeSlide editor canvas modes', () => {
  it('reveals candidate canvas when the inspector is an overlay drawer', () => {
    expect(shouldRevealCandidateCanvas(390)).toBe(true);
    expect(shouldRevealCandidateCanvas(720)).toBe(true);
    expect(shouldRevealCandidateCanvas(1100)).toBe(true);
    expect(shouldRevealCandidateCanvas(1101)).toBe(false);
    expect(shouldRevealCandidateCanvas(Number.NaN)).toBe(false);
  });

  it.each<EditorCompareMode>(['side-by-side', 'slider', 'overlay', 'blink'])(
    'renders the compare seam, operation chips, and receipt in %s mode',
    (compareMode) => {
      const markup = renderCanvas({
        mode: 'compare',
        compareMode,
        candidateCanvas: <div>Candidate canvas</div>,
        compareOperations: [
          { id: 'op:headline', label: 'replace text · headline', tone: 'change' },
          { id: 'op:proof', label: 'add element · proof', tone: 'addition' },
        ],
        candidateReceipt: {
          id: 'candidate:4',
          status: 'ready',
          summary: 'Headline and proof updated',
          versionLabel: 'deck v18',
        },
        narrativeBanner: 'Recommendation → proof → next step',
        onSliderPositionChange: () => undefined,
        onOverlayOpacityChange: () => undefined,
        onBlinkPausedChange: () => undefined,
      });

      expect(markup).toContain(`data-compare-mode="${compareMode}"`);
      expect(markup).toContain('data-testid="compare-seam"');
      expect(markup).toContain('replace text · headline');
      expect(markup).toContain('add element · proof');
      expect(markup).toContain('data-testid="candidate-receipt"');
      expect(markup).toContain('Candidate ready');
      expect(markup).toContain('2 operations');
      expect(markup).toContain('Recommendation → proof → next step');
      expect(markup).toMatch(
        new RegExp(`aria-selected="true"[^>]*>${compareModeLabel(compareMode)}<`),
      );
    },
  );

  it('renders all overview thumbnails and only supplied affected-slide halos', () => {
    const markup = renderCanvas({
      mode: 'overview',
      affectedSlideIds: ['slide:appendix'],
    });

    expect(markup).toContain('data-testid="overview-slide-slide:product"');
    expect(markup).toContain('data-testid="overview-slide-slide:appendix"');
    expect(markup).toContain('data-affected-slide-id="slide:appendix"');
    expect(markup).toMatch(
      /class="is-affected " data-affected="true"[^>]*><button[^>]*aria-label="Open slide 2:[^>]*affected by propagation preview/,
    );
    expect(markup).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Overview/);
  });

  it('renders an honest no-candidate state without a seam or receipt', () => {
    const markup = renderCanvas({ mode: 'compare', compareMode: 'overlay' });

    expect(markup).toContain('data-testid="no-candidate-state"');
    expect(markup).toContain('No candidate to compare');
    expect(markup).toContain('Preview a proposal');
    expect(markup).not.toContain('data-testid="compare-seam"');
    expect(markup).not.toContain('data-testid="candidate-receipt"');
  });

  it('renders the story arc board in place of canvas mode tabs', () => {
    const markup = renderCanvas({
      storyArcBoard: <section aria-label="Story arc board">Story arc content</section>,
    });

    expect(markup).toContain('Story arc board');
    expect(markup).toContain('Story arc content');
    expect(markup).toContain('Story arc');
    expect(markup).not.toContain('role="tablist"');
  });

  it('enables Compare accept only for an exact successful patch candidate binding', () => {
    const markup = renderCanvas({
      mode: 'compare',
      candidateCanvas: <div>Bound candidate</div>,
      candidateReceipt: {
        status: 'ready',
        binding: {
          patchId: 'patch:bound',
          candidateDigest: 'sha256:bound',
          receiptPatchId: 'patch:bound',
          receiptCandidateDigest: 'sha256:bound',
        },
      },
      onAcceptCandidate: () => undefined,
    });
    const acceptButton = markup.match(/<button[^>]*>Accept<\/button>/)?.[0];

    expect(acceptButton).toBeDefined();
    expect(acceptButton).not.toContain('disabled');
    expect(acceptButton).toContain('Accept this exact validated patch candidate');
  });

  it.each(['invalid', 'stale', 'unavailable'] as const)(
    'keeps a %s candidate visibly non-accepting',
    (status) => {
      const markup = renderCanvas({
        mode: 'compare',
        candidateCanvas: <div>Unsafe candidate</div>,
        candidateReceipt: { status },
        onAcceptCandidate: () => undefined,
      });
      const acceptButton = markup.match(/<button[^>]*>Accept<\/button>/)?.[0];

      expect(markup).toContain(`data-candidate-status="${status}"`);
      expect(acceptButton).toContain('disabled');
    },
  );

  it('does not trust an unbound ready label from an unvalidated signature preview', () => {
    const markup = renderCanvas({
      mode: 'compare',
      candidateCanvas: <div>Local signature preview</div>,
      candidateReceipt: { status: 'ready', summary: 'No persisted receipt' },
      onAcceptCandidate: () => undefined,
    });
    const acceptButton = markup.match(/<button[^>]*>Accept<\/button>/)?.[0];

    expect(markup).toContain('Candidate ready');
    expect(acceptButton).toContain('disabled');
  });

  it('summarizes long operation lists without hiding the authoritative receipt total', () => {
    const markup = renderCanvas({
      mode: 'compare',
      candidateCanvas: <div>Propagation candidate</div>,
      compareOperations: Array.from({ length: 12 }, (_, index) => ({
        id: `operation:${index + 1}`,
        label: `update style · element ${index + 1}`,
        tone: 'change' as const,
      })),
      candidateReceipt: {
        id: 'candidate:propagation',
        status: 'ready',
        summary: 'Propagate accepted style',
      },
    });

    expect(markup).toContain('+6 more changes');
    expect(markup).toContain('12 operations');
    expect(markup).not.toContain('update style · element 7');
  });
});

const theme: ThemeSpec = {
  id: 'theme:test',
  name: 'Test theme',
  mode: 'light',
  colors: {
    canvas: '#ffffff',
    ink: '#111111',
    muted: '#666666',
    accent: '#5555cc',
    accentSoft: '#eeeeff',
    insight: '#ddaa55',
    insightInk: '#332211',
    trace: '#777777',
    border: '#dddddd',
  },
  typography: { display: 'Display', body: 'Body', data: 'Mono' },
  defaultRadius: 8,
  spacingUnit: 8,
};

const slides: Slide[] = [
  {
    id: 'slide:product',
    deckId: 'deck:test',
    title: 'Product thesis',
    section: 'Product',
    notes: 'A reviewable authoring model wins.',
    background: '#ffffff',
    elementOrder: ['element:headline', 'element:proof'],
    version: 18,
  },
  {
    id: 'slide:appendix',
    deckId: 'deck:test',
    title: 'Appendix',
    section: 'Appendix',
    background: '#ffffff',
    elementOrder: ['element:appendix'],
    version: 18,
  },
];

const elements: SlideElement[] = [
  {
    id: 'element:headline',
    slideId: 'slide:product',
    name: 'Headline',
    kind: 'text',
    role: 'Recommendation',
    bbox: { x: 0.08, y: 0.12, width: 0.75, height: 0.18 },
    rotation: 0,
    content: 'Structured authoring is the moat.',
    style: { fontSize: 32 },
    sourceIds: [],
    locked: false,
    exportCapabilities: ['web_native'],
    version: 4,
  },
  {
    id: 'element:proof',
    slideId: 'slide:product',
    name: 'Proof point',
    kind: 'text',
    role: 'Evidence',
    bbox: { x: 0.08, y: 0.4, width: 0.65, height: 0.14 },
    rotation: 0,
    content: 'Every patch has a receipt.',
    style: { fontSize: 18 },
    sourceIds: ['source:1'],
    locked: true,
    exportCapabilities: ['web_native'],
    version: 2,
  },
  {
    id: 'element:appendix',
    slideId: 'slide:appendix',
    name: 'Appendix title',
    kind: 'text',
    bbox: { x: 0.1, y: 0.1, width: 0.6, height: 0.2 },
    rotation: 0,
    content: 'Appendix',
    style: { fontSize: 28 },
    sourceIds: [],
    locked: false,
    exportCapabilities: ['web_native'],
    version: 1,
  },
];

const source: SourceRecord = {
  id: 'source:1',
  deckId: 'deck:test',
  title: 'Authoring study',
  sourceType: 'document',
  retrievedAt: 1_000,
  citation: 'Authoring study, p. 4',
};

const comment: DeckComment = {
  id: 'comment:1',
  deckId: 'deck:test',
  anchor: { type: 'slide', deckId: 'deck:test', slideId: 'slide:product' },
  authorId: 'user:1',
  authorName: 'Reviewer',
  text: 'Clarify the evidence.',
  status: 'open',
  createdAt: 1_000,
  updatedAt: 1_000,
};

const patch: DeckPatch = {
  id: 'patch:1',
  deckId: 'deck:test',
  baseDeckVersion: 18,
  baseSlideVersions: { 'slide:product': 18 },
  baseElementVersions: { 'element:headline': 4 },
  scope: {
    kind: 'slide',
    deckId: 'deck:test',
    slideIds: ['slide:product'],
    operationMode: 'copy',
  },
  operations: [
    {
      op: 'replace_text',
      slideId: 'slide:product',
      elementId: 'element:headline',
      text: 'A better thesis',
    },
  ],
  source: 'agent',
  status: 'ready',
  summary: 'Clarify the thesis',
  createdAt: 1_000,
  updatedAt: 1_000,
};

const validation: ValidationResult = {
  id: 'validation:18',
  deckId: 'deck:test',
  deckVersion: 18,
  ok: true,
  publishOk: true,
  cleanOk: false,
  issues: [
    {
      id: 'issue:1',
      severity: 'warning',
      code: 'contrast',
      message: 'Contrast needs review.',
      slideId: 'slide:product',
    },
  ],
  checkedAt: 1_000,
  toolchainVersion: 'test',
};

function renderNavigator(overrides: Partial<SlideNavigatorProps> = {}) {
  const props: SlideNavigatorProps = {
    slides,
    elements,
    theme,
    activeSlideId: 'slide:product',
    collapsed: false,
    canAddSlide: true,
    canDeleteSlide: true,
    onSelectSlide: () => undefined,
    onToggleCollapsed: () => undefined,
    onAddSlide: () => undefined,
    onDuplicateSlide: () => undefined,
    onDeleteSlide: () => undefined,
    onReorderSlide: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(<SlideNavigator {...props} />);
}

function renderCanvas(overrides: Partial<EditorCanvasModesProps> = {}) {
  const props: EditorCanvasModesProps = {
    mode: 'edit',
    onModeChange: () => undefined,
    compareMode: 'side-by-side',
    onCompareModeChange: () => undefined,
    slides,
    elements,
    theme,
    activeSlideId: 'slide:product',
    editCanvas: <div>Edit canvas</div>,
    baselineCanvas: <div>Baseline canvas</div>,
    ...overrides,
  };
  return renderToStaticMarkup(<EditorCanvasModes {...props} />);
}

function compareModeLabel(mode: EditorCompareMode) {
  if (mode === 'side-by-side') return 'Side by side';
  return `${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;
}
