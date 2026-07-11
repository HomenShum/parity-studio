import { describe, expect, it } from 'vitest';
import { validateNodeSlideSnapshot } from '../convex/lib/nodeslideValidation';
import {
  FINANCE_IBCS_TASTE_PACK,
  STARTUP_NARRATIVE_TASTE_PACK,
} from '../src/domains/nodeslide/signature/packs';
import { validateSnapshot } from '../src/domains/nodeslide/slidelang/validation';
import type {
  DeckSnapshot,
  PatchOperation,
  PatchScope,
  Slide,
  SlideElement,
  ThemeSpec,
} from './nodeslide';
import { applyDeckPatch } from './nodeslidePatch';
import type {
  SignatureColorToken,
  SignatureDimensionToken,
  SignatureEvidence,
  SignatureFontFamilyToken,
  SignatureProfile,
} from './nodeslideSignature';
import {
  NODESLIDE_ON_BRAND_ISSUE_LIMIT,
  NODESLIDE_SIGNATURE_OPERATION_LIMIT,
  onBrandIssues,
  planSignatureApplication,
  resolveSignatureTheme,
} from './nodeslideSignatureApply';

const BASE_THEME: ThemeSpec = {
  id: 'base',
  name: 'Base',
  mode: 'light',
  colors: {
    canvas: '#F5F1E8',
    ink: '#14231C',
    muted: '#5F6B64',
    accent: '#B44A2D',
    accentSoft: '#F8D8CC',
    insight: '#DCEBDD',
    insightInk: '#17442D',
    trace: '#6B5BD2',
    border: '#D8D1C5',
  },
  typography: {
    display: 'Fraunces Variable',
    body: 'Geist Variable',
    data: 'JetBrains Mono Variable',
  },
  defaultRadius: 18,
  spacingUnit: 8,
};

const LIGHT_SIGNATURE = {
  canvas: '#FAFAF8',
  ink: '#182026',
  muted: '#4F5B62',
  accent: '#1C6474',
  accentSoft: '#DDECEF',
  border: '#BBCDD2',
  data: '#7A4EAB',
  display: 'Aptos Display',
  body: 'Aptos',
  dataFont: 'Aptos Mono',
  titlePt: 40,
  bodyPt: 18,
  dataPt: 14,
} as const;

const DARK_SIGNATURE = {
  canvas: '#101518',
  ink: '#F5F5F0',
  muted: '#C0C8CC',
  accent: '#B8E068',
  accentSoft: '#28321F',
  border: '#3A444A',
  data: '#8DA2FF',
  display: 'Georgia',
  body: 'Arial',
  dataFont: 'Courier New',
  titlePt: 44,
  bodyPt: 18,
  dataPt: 14,
} as const;

describe('NodeSlide signature application', () => {
  it('produces visibly distinct clean candidates through the existing patch path', () => {
    const snapshot = makeSnapshot();
    const light = makeProfile('profile:light', LIGHT_SIGNATURE);
    const dark = makeProfile('profile:dark', DARK_SIGNATURE);

    const lightResult = planSignatureApplication(snapshot, light);
    const darkResult = planSignatureApplication(snapshot, dark);
    if (!lightResult.ok || !darkResult.ok) {
      throw new Error(`Expected plans: ${JSON.stringify([lightResult, darkResult])}`);
    }

    expect(lightResult.plan.operations.every(isSignatureOperation)).toBe(true);
    expect(darkResult.plan.operations.every(isSignatureOperation)).toBe(true);
    expect(
      lightResult.plan.operations.map((operation) =>
        operation.op === 'update_style'
          ? `${operation.slideId}:${operation.elementId}:${operation.op}`
          : operation.op === 'update_slide'
            ? `${operation.slideId}:${operation.op}`
            : operation.op,
      ),
    ).toEqual([
      'slide:1:update_slide',
      'slide:1:element:title:1:update_style',
      'slide:1:element:body:1:update_style',
    ]);
    expect(lightResult.plan.operations).not.toEqual(darkResult.plan.operations);
    expect(lightResult.plan.baseSlideVersions).toEqual({ 'slide:1': 3 });
    expect(lightResult.plan.baseElementVersions).toEqual({
      'element:title:1': 5,
      'element:body:1': 7,
    });

    const lightCandidate = applyPlan(snapshot, lightResult.plan);
    const darkCandidate = applyPlan(snapshot, darkResult.plan);
    expect(lightCandidate.deck.version).toBe(snapshot.deck.version + 1);
    expect(darkCandidate.deck.version).toBe(snapshot.deck.version + 1);
    expect(lightCandidate.slides[0]?.background).toBe(LIGHT_SIGNATURE.canvas);
    expect(darkCandidate.slides[0]?.background).toBe(DARK_SIGNATURE.canvas);
    expect(lightCandidate.elements.find((element) => element.role === 'title')?.style).not.toEqual(
      darkCandidate.elements.find((element) => element.role === 'title')?.style,
    );

    for (const [candidate, profile] of [
      [lightCandidate, light],
      [darkCandidate, dark],
    ] as const) {
      expect(
        onBrandIssues(candidate, profile).filter((issue) => issue.severity !== 'info'),
      ).toEqual([]);
      const structural = validateSnapshot(candidate);
      expect(structural.ok).toBe(true);
      expect(structural.publishOk).toBe(true);
      expect(structural.cleanOk).toBe(true);
    }
  });

  it('adds on-brand findings to unchanged validation receipts and blocks publish until applied', () => {
    const snapshot = makeSnapshot();
    const profile = makeProfile('profile:validation', LIGHT_SIGNATURE);
    const clientBefore = validateSnapshot(snapshot, { signatureProfile: profile });
    const serverBefore = validateNodeSlideSnapshot(snapshot, 1_234, 'validation:test', {
      signatureProfile: profile,
    });

    expect(Object.keys(clientBefore).sort()).toEqual([
      'checkedAt',
      'cleanOk',
      'deckId',
      'deckVersion',
      'id',
      'issues',
      'ok',
      'publishOk',
      'toolchainVersion',
    ]);
    expect(Object.keys(serverBefore).sort()).toEqual(Object.keys(clientBefore).sort());
    for (const receipt of [clientBefore, serverBefore]) {
      expect(receipt.ok).toBe(true);
      expect(receipt.publishOk).toBe(false);
      expect(receipt.cleanOk).toBe(false);
      expect(receipt.issues.some((issue) => issue.code.startsWith('on_brand_'))).toBe(true);
    }

    const plan = planSignatureApplication(snapshot, profile);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const candidate = applyPlan(snapshot, plan.plan);
    const clientAfter = validateSnapshot(candidate, { signatureProfile: profile });
    const serverAfter = validateNodeSlideSnapshot(candidate, 1_235, 'validation:test:after', {
      signatureProfile: profile,
    });
    for (const receipt of [clientAfter, serverAfter]) {
      expect(receipt.ok).toBe(true);
      expect(receipt.publishOk).toBe(true);
      expect(
        receipt.issues.filter(
          (issue) => issue.code.startsWith('on_brand_') && issue.severity !== 'info',
        ),
      ).toEqual([]);
    }
  });

  it('uses honest observed, deck, and safe fallbacks with stable evidence', () => {
    const snapshot = makeSnapshot();
    const observed = renameTokensAsObserved(makeProfile('profile:observed', LIGHT_SIGNATURE));
    const first = resolveSignatureTheme(observed, { currentTheme: snapshot.deck.theme });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.warnings.some((warning) => warning.code === 'observed_usage_fallback')).toBe(true);
    expect(
      first.warnings
        .filter((warning) => warning.code === 'observed_usage_fallback')
        .every((warning) => warning.evidenceIds.length > 0),
    ).toBe(true);
    expect(contrast(first.theme.colors.ink, first.theme.colors.canvas)).toBeGreaterThanOrEqual(4.5);

    const missing = makeProfile('profile:missing', LIGHT_SIGNATURE);
    missing.tokens = { colors: {}, fontFamilies: {}, fontSizes: {} };
    missing.usage = { colors: [], fonts: [], fontSizes: [] };
    missing.evidence = [];
    const fallback = resolveSignatureTheme(missing, { currentTheme: snapshot.deck.theme });
    expect(fallback.ok).toBe(true);
    if (!fallback.ok) return;
    expect(fallback.theme.colors.canvas).toBe(BASE_THEME.colors.canvas);
    expect(fallback.theme.typography.body).toBe(BASE_THEME.typography.body);
    expect(fallback.theme.typography.bodyPt).toBe(18);
    expect(fallback.warnings.some((warning) => warning.code === 'deck_theme_fallback')).toBe(true);
    expect(fallback.warnings.some((warning) => warning.code === 'safe_default_fallback')).toBe(
      true,
    );

    const fallbackPlan = planSignatureApplication(snapshot, missing);
    expect(fallbackPlan.ok).toBe(true);
    if (!fallbackPlan.ok) return;
    const matchingCandidate = applyPlan(snapshot, fallbackPlan.plan);
    const matchingIssues = onBrandIssues(matchingCandidate, missing);
    expect(matchingIssues.filter((issue) => issue.severity !== 'info')).toEqual([]);
    expect(matchingIssues).toContainEqual(
      expect.objectContaining({
        severity: 'info',
        code: 'scope',
        message: expect.stringContaining('deck_theme_fallback'),
      }),
    );
  });

  it('honors W5 authored priorities and applies complete CSS-safe font fallback stacks', () => {
    const snapshot = makeSnapshot();
    const cases = [
      [
        FINANCE_IBCS_TASTE_PACK,
        {
          display: 'Arial, "Helvetica Neue", Helvetica, "Liberation Sans", sans-serif',
          body: 'Arial, "Helvetica Neue", Helvetica, "Liberation Sans", sans-serif',
          data: 'Arial, "Helvetica Neue", Helvetica, "Liberation Sans", sans-serif',
        },
      ],
      [
        STARTUP_NARRATIVE_TASTE_PACK,
        {
          display: '"Aptos Display", Aptos, "Segoe UI", Arial, sans-serif',
          body: 'Aptos, "Segoe UI", Arial, sans-serif',
          data: '"Aptos Mono", "Cascadia Mono", Consolas, "Courier New", monospace',
        },
      ],
    ] as const;

    for (const [pack, expectedFonts] of cases) {
      const resolution = resolveSignatureTheme(pack, { currentTheme: snapshot.deck.theme });
      expect(resolution.ok).toBe(true);
      if (!resolution.ok) continue;
      expect(resolution.theme.typography).toMatchObject(expectedFonts);
      expect(
        resolution.warnings.some((warning) => warning.code === 'observed_usage_fallback'),
      ).toBe(false);

      const planned = planSignatureApplication(snapshot, pack);
      expect(planned.ok).toBe(true);
      if (!planned.ok) continue;
      expect(
        planned.plan.warnings.some((warning) => warning.code === 'observed_usage_fallback'),
      ).toBe(false);
      const candidate = applyPlan(snapshot, planned.plan);
      expect(candidate.elements.find((element) => element.role === 'title')?.style.fontFamily).toBe(
        expectedFonts.display,
      );
      expect(candidate.elements.find((element) => element.role === 'body')?.style.fontFamily).toBe(
        expectedFonts.body,
      );
      expect(onBrandIssues(candidate, pack).filter((issue) => issue.severity !== 'info')).toEqual(
        [],
      );
    }

    const finance = resolveSignatureTheme(FINANCE_IBCS_TASTE_PACK);
    expect(finance.ok).toBe(true);
    if (finance.ok) {
      expect(finance.theme.colors.data).toEqual([
        '#334155',
        '#006B5E',
        '#A4262C',
        '#65418A',
        '#7A4F00',
      ]);
    }

    const startupPlan = planSignatureApplication(snapshot, STARTUP_NARRATIVE_TASTE_PACK);
    expect(startupPlan.ok).toBe(true);
    if (!startupPlan.ok) return;
    expect(startupPlan.plan.warnings).toContainEqual(
      expect.objectContaining({ code: 'authored_token_fallback', role: 'colors.data' }),
    );
    const startupCandidate = applyPlan(snapshot, startupPlan.plan);
    expect(onBrandIssues(startupCandidate, STARTUP_NARRATIVE_TASTE_PACK)).toContainEqual(
      expect.objectContaining({
        severity: 'info',
        code: 'scope',
        message: expect.stringContaining('authored_token_fallback'),
      }),
    );
  });

  it('maps chart containers and known shape roles while preserving unknown shape fills', () => {
    const snapshot = makeSnapshot();
    const slide = snapshot.slides[0];
    if (!slide) throw new Error('Missing test slide');
    const extras: SlideElement[] = [
      {
        id: 'element:soft-shape',
        slideId: slide.id,
        name: 'Soft panel',
        kind: 'shape',
        role: 'accent_soft',
        bbox: { x: 0.75, y: 0.1, width: 0.15, height: 0.15 },
        rotation: 0,
        style: { fill: BASE_THEME.colors.accent },
        sourceIds: [],
        locked: false,
        exportCapabilities: ['web_native'],
        version: 1,
      },
      {
        id: 'element:unknown-shape',
        slideId: slide.id,
        name: 'Unknown',
        kind: 'shape',
        role: 'mystery',
        bbox: { x: 0.75, y: 0.3, width: 0.15, height: 0.15 },
        rotation: 0,
        style: { fill: '#123456' },
        sourceIds: [],
        locked: false,
        exportCapabilities: ['web_native'],
        version: 1,
      },
      {
        id: 'element:chart',
        slideId: slide.id,
        name: 'Chart',
        kind: 'chart',
        role: 'evidence',
        bbox: { x: 0.55, y: 0.62, width: 0.35, height: 0.2 },
        rotation: 0,
        style: { fill: BASE_THEME.colors.accentSoft },
        chart: {
          chartType: 'bar',
          labels: ['A'],
          series: [{ name: 'Signal', values: [1], color: BASE_THEME.colors.accent }],
        },
        sourceIds: [],
        locked: false,
        exportCapabilities: ['web_native'],
        version: 1,
      },
    ];
    snapshot.elements.push(...extras);
    slide.elementOrder.push(...extras.map((element) => element.id));

    const result = planSignatureApplication(
      snapshot,
      makeProfile('profile:mapping', LIGHT_SIGNATURE),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const styleOperations = result.plan.operations.filter(
      (operation): operation is Extract<PatchOperation, { op: 'update_style' }> =>
        operation.op === 'update_style',
    );
    expect(
      styleOperations.find((operation) => operation.elementId === 'element:soft-shape'),
    ).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({ fill: LIGHT_SIGNATURE.accentSoft }),
      }),
    );
    expect(
      styleOperations.find((operation) => operation.elementId === 'element:unknown-shape'),
    ).toBeUndefined();
    expect(styleOperations.find((operation) => operation.elementId === 'element:chart')).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          fill: LIGHT_SIGNATURE.accentSoft,
          stroke: LIGHT_SIGNATURE.border,
          fontFamily: LIGHT_SIGNATURE.dataFont,
        }),
      }),
    );
  });

  it.each([
    [
      'unknown schema',
      (profile: SignatureProfile) => {
        (profile as unknown as { schemaVersion: string }).schemaVersion = 'nodeslide.signature/v0';
      },
    ],
    [
      'bad color',
      (profile: SignatureProfile) => {
        requiredValue(profile.tokens.colors, 'canvas').$value.hex = '#NOTHEX';
      },
    ],
    [
      'empty font',
      (profile: SignatureProfile) => {
        requiredValue(profile.tokens.fontFamilies, 'body').$value = '';
      },
    ],
    [
      'invalid dimension',
      (profile: SignatureProfile) => {
        requiredValue(profile.tokens.fontSizes, 'body').$value.value = 0;
      },
    ],
    [
      'out-of-range confidence',
      (profile: SignatureProfile) => {
        requiredValue(profile.tokens.colors, 'canvas').$extensions[
          'com.nodeslide.signature'
        ].confidence = 1.1;
      },
    ],
  ])('fails malformed profile data as schema input: %s', (_label, mutate) => {
    const snapshot = makeSnapshot();
    const profile = makeProfile('profile:malformed', LIGHT_SIGNATURE);
    mutate(profile);
    const result = planSignatureApplication(snapshot, profile);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('schema');
    expect(onBrandIssues(snapshot, profile)).toEqual([
      expect.objectContaining({ severity: 'error', code: 'schema' }),
    ]);
  });

  it('skips locked elements, honors exact element scope, and becomes already-applied', () => {
    const snapshot = makeSnapshot(2);
    const profile = makeProfile('profile:scope', LIGHT_SIGNATURE);
    const malformedScope = planSignatureApplication(snapshot, profile, {
      scope: { kind: 'unknown' } as unknown as PatchScope,
    });
    expect(malformedScope.ok).toBe(false);
    if (!malformedScope.ok) expect(malformedScope.error.code).toBe('scope');
    const scope: PatchScope = {
      kind: 'elements',
      deckId: snapshot.deck.id,
      slideIds: ['slide:1'],
      elementIds: ['element:title:1'],
      operationMode: 'style',
    };
    const scoped = planSignatureApplication(snapshot, profile, { scope });
    expect(scoped.ok).toBe(true);
    if (!scoped.ok) return;
    expect(scoped.plan.scope).toEqual(scope);
    expect(scoped.plan.operations).toEqual([
      expect.objectContaining({
        op: 'update_style',
        slideId: 'slide:1',
        elementId: 'element:title:1',
      }),
    ]);
    expect(scoped.plan.operations.some((operation) => operation.op === 'update_slide')).toBe(false);

    const beforeSecondSlide = structuredClone(snapshot.slides[1]);
    const beforeSecondElements = structuredClone(
      snapshot.elements.filter((element) => element.slideId === 'slide:2'),
    );
    const scopedCandidate = applyPlan(snapshot, scoped.plan);
    expect(scopedCandidate.slides[1]).toEqual(beforeSecondSlide);
    expect(scopedCandidate.elements.filter((element) => element.slideId === 'slide:2')).toEqual(
      beforeSecondElements,
    );
    expect(scopedCandidate.slides[0]?.background).toBe(snapshot.slides[0]?.background);

    const full = planSignatureApplication(snapshot, profile);
    expect(full.ok).toBe(true);
    if (!full.ok) return;
    expect(full.plan.skippedLockedElementIds).toEqual(['element:locked:1', 'element:locked:2']);
    expect(
      full.plan.operations.some(
        (operation) =>
          operation.op === 'update_style' && operation.elementId.startsWith('element:locked:'),
      ),
    ).toBe(false);
    const candidate = applyPlan(snapshot, full.plan);
    const replay = planSignatureApplication(candidate, profile);
    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(replay.error.code).toBe('already_applied');
    expect(replay.error.requiredOperations).toBe(0);

    const lockedIssues = onBrandIssues(candidate, profile).filter(
      (issue) => issue.severity === 'info' && issue.code === 'scope',
    );
    expect(lockedIssues).toHaveLength(2);
    expect(new Set(lockedIssues.map((issue) => issue.slideId))).toEqual(
      new Set(['slide:1', 'slide:2']),
    );
  });

  it('enforces the 512-operation hard cap without truncating or mutating input', () => {
    const profile = makeProfile('profile:bound', LIGHT_SIGNATURE);
    const atLimit = makeOperationBoundSnapshot(NODESLIDE_SIGNATURE_OPERATION_LIMIT, profile);
    const accepted = planSignatureApplication(atLimit, profile);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.plan.operations).toHaveLength(512);

    const overLimit = makeOperationBoundSnapshot(NODESLIDE_SIGNATURE_OPERATION_LIMIT + 1, profile);
    const before = JSON.stringify(overLimit);
    const rejected = planSignatureApplication(overLimit, profile);
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error).toMatchObject({
      code: 'operation_limit_exceeded',
      limit: 512,
      requiredOperations: 513,
    });
    expect(JSON.stringify(overLimit)).toBe(before);
    expect('operations' in rejected.error).toBe(false);
  });

  it('repairs unsafe contrast and type floors with explicit warnings', () => {
    const profile = makeProfile('profile:contrast', {
      ...DARK_SIGNATURE,
      accentSoft: '#8A8A8A',
      bodyPt: 8,
      dataPt: 9,
    });
    const result = resolveSignatureTheme(profile);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(contrast(result.theme.colors.ink, result.theme.colors.canvas)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(
      contrast(result.theme.colors.ink, result.theme.colors.accentSoft),
    ).toBeGreaterThanOrEqual(4.5);
    expect(result.theme.typography.bodyPt).toBe(12);
    expect(result.theme.typography.dataPt).toBe(12);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'contrast_adjusted', role: 'colors.accentSoft' }),
        expect.objectContaining({ code: 'type_scale_adjusted', role: 'typography.bodyPt' }),
        expect.objectContaining({ code: 'type_scale_adjusted', role: 'typography.dataPt' }),
      ]),
    );
  });

  it('keeps plan IDs, warnings, and issue order deterministic across profile ordering', () => {
    const snapshot = makeSnapshot();
    const profile = makeProfile('profile:deterministic', LIGHT_SIGNATURE);
    const reordered = reverseProfileOrder(profile);
    const first = planSignatureApplication(snapshot, profile);
    const second = planSignatureApplication(snapshot, reordered);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.plan.id).toBe(first.plan.id);
    expect(second.plan.operations).toEqual(first.plan.operations);
    expect(second.plan.warnings).toEqual(first.plan.warnings);

    const issues = onBrandIssues(snapshot, profile, { maxIssues: 2 });
    expect(issues).toHaveLength(2);
    expect(issues[1]).toMatchObject({ severity: 'info', code: 'scope' });
    expect(onBrandIssues(snapshot, reordered, { maxIssues: 2 })).toEqual(issues);
    const bounded = onBrandIssues(
      makeOperationBoundSnapshot(NODESLIDE_ON_BRAND_ISSUE_LIMIT + 88, profile),
      profile,
    );
    expect(bounded).toHaveLength(NODESLIDE_ON_BRAND_ISSUE_LIMIT);
    expect(bounded.at(-1)).toMatchObject({ severity: 'info', code: 'scope' });
  });

  it('compares colors canonically and font families case-insensitively', () => {
    const snapshot = makeSnapshot();
    const profile = makeProfile('profile:canonical', LIGHT_SIGNATURE);
    const result = planSignatureApplication(snapshot, profile);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const candidate = applyPlan(snapshot, result.plan);
    for (const slide of candidate.slides) slide.background = slide.background.toLowerCase();
    for (const element of candidate.elements) {
      if (element.style.fill) element.style.fill = element.style.fill.toLowerCase();
      if (element.style.stroke) element.style.stroke = element.style.stroke.toLowerCase();
      if (element.style.color) element.style.color = element.style.color.toLowerCase();
      if (element.style.fontFamily)
        element.style.fontFamily = element.style.fontFamily.toUpperCase();
    }
    expect(onBrandIssues(candidate, profile).filter((issue) => issue.severity !== 'info')).toEqual(
      [],
    );
  });

  it('leaves the patch operation union at the existing eleven names', () => {
    const operationNames: PatchOperation['op'][] = [
      'move',
      'resize',
      'replace_text',
      'update_style',
      'add_element',
      'remove_element',
      'add_slide',
      'remove_slide',
      'reorder_slide',
      'update_slide',
      'update_deck',
    ];
    expect(new Set(operationNames).size).toBe(11);
  });
});

function isSignatureOperation(operation: PatchOperation): boolean {
  return operation.op === 'update_slide' || operation.op === 'update_style';
}

function applyPlan(
  snapshot: DeckSnapshot,
  plan: {
    baseDeckVersion: number;
    operations: PatchOperation[];
    scope: Parameters<typeof applyDeckPatch>[1]['scope'];
  },
): DeckSnapshot {
  return applyDeckPatch(
    snapshot,
    {
      baseDeckVersion: plan.baseDeckVersion,
      operations: plan.operations,
      scope: plan.scope,
    },
    2_000,
  ).snapshot;
}

function makeSnapshot(slideCount = 1): DeckSnapshot {
  const slides: Slide[] = [];
  const elements: SlideElement[] = [];
  for (let index = 1; index <= slideCount; index += 1) {
    const slideId = `slide:${index}`;
    const slideElements: SlideElement[] = [
      {
        id: `element:title:${index}`,
        slideId,
        name: 'Title',
        kind: 'text',
        role: 'title',
        bbox: { x: 0.08, y: 0.1, width: 0.75, height: 0.16 },
        rotation: 0,
        content: 'A concise title',
        style: {
          color: BASE_THEME.colors.ink,
          fontFamily: BASE_THEME.typography.display,
          fontSize: 38,
          fontWeight: 700,
        },
        sourceIds: [],
        locked: false,
        exportCapabilities: ['web_native'],
        version: 5,
      },
      {
        id: `element:body:${index}`,
        slideId,
        name: 'Body',
        kind: 'text',
        role: 'body',
        bbox: { x: 0.08, y: 0.42, width: 0.62, height: 0.13 },
        rotation: 0,
        content: 'A short supporting line.',
        style: {
          color: BASE_THEME.colors.muted,
          fontFamily: BASE_THEME.typography.body,
          fontSize: 19,
        },
        sourceIds: [],
        locked: false,
        exportCapabilities: ['web_native'],
        version: 7,
      },
      {
        id: `element:locked:${index}`,
        slideId,
        name: 'Locked accent',
        kind: 'shape',
        role: 'decoration',
        bbox: { x: 0.02, y: 0.08, width: 0.01, height: 0.8 },
        rotation: 0,
        style: { fill: BASE_THEME.colors.accent },
        sourceIds: [],
        locked: true,
        exportCapabilities: ['web_native'],
        version: 2,
      },
    ];
    slides.push({
      id: slideId,
      deckId: 'deck:test',
      title: `Slide ${index}`,
      background: BASE_THEME.colors.canvas,
      elementOrder: slideElements.map((element) => element.id),
      version: index + 2,
    });
    elements.push(...slideElements);
  }
  return {
    deck: {
      schemaVersion: 'nodeslide.slidelang/v1',
      toolchainVersion: 'test/1',
      id: 'deck:test',
      projectId: 'project:test',
      title: 'Signature test',
      brief: {
        prompt: 'Test a signature',
        audience: 'Reviewers',
        purpose: 'Verification',
        successCriteria: ['Deterministic'],
      },
      theme: structuredClone(BASE_THEME),
      slideOrder: slides.map((slide) => slide.id),
      version: 11,
      status: 'ready',
      createdAt: 1_000,
      updatedAt: 1_000,
    },
    slides,
    elements,
    sources: [],
  };
}

function makeOperationBoundSnapshot(count: number, profile: SignatureProfile): DeckSnapshot {
  const snapshot = makeSnapshot();
  const resolved = resolveSignatureTheme(profile, { currentTheme: snapshot.deck.theme });
  if (!resolved.ok) throw new Error(resolved.error.message);
  const slide = snapshot.slides[0];
  if (!slide) throw new Error('Missing test slide');
  slide.background = resolved.theme.colors.canvas;
  const elements: SlideElement[] = Array.from({ length: count }, (_, index) => ({
    id: `element:bound:${index.toString().padStart(4, '0')}`,
    slideId: slide.id,
    name: `Bound ${index}`,
    kind: 'text',
    role: 'body',
    bbox: { x: 0.01, y: 0.01, width: 0.1, height: 0.05 },
    rotation: 0,
    content: 'Bound',
    style: { color: '#000000', fontFamily: 'Wrong Font', fontSize: 16 },
    sourceIds: [],
    locked: false,
    exportCapabilities: ['web_native'],
    version: 1,
  }));
  snapshot.elements = elements;
  slide.elementOrder = elements.map((element) => element.id);
  return snapshot;
}

function makeProfile(
  id: string,
  values: {
    canvas: string;
    ink: string;
    muted: string;
    accent: string;
    accentSoft: string;
    border: string;
    data: string;
    display: string;
    body: string;
    dataFont: string;
    titlePt: number;
    bodyPt: number;
    dataPt: number;
  },
): SignatureProfile {
  const evidence: SignatureEvidence[] = [];
  const makeEvidence = (key: string, observedValue: string): string => {
    const evidenceId = `evidence:${key}`;
    evidence.push({
      id: evidenceId,
      sourceKind: 'taste_pack',
      method: 'authored',
      sourceDigest: 'digest:test',
      locator: `authored/${key}`,
      observedValue,
      confidence: 1,
    });
    return evidenceId;
  };
  const colors = {
    canvas: colorToken(values.canvas, makeEvidence('canvas', values.canvas), 30),
    ink: colorToken(values.ink, makeEvidence('ink', values.ink), 28),
    muted: colorToken(values.muted, makeEvidence('muted', values.muted), 20),
    accent: colorToken(values.accent, makeEvidence('accent', values.accent), 18),
    'accent-soft': colorToken(
      values.accentSoft,
      makeEvidence('accent-soft', values.accentSoft),
      12,
    ),
    border: colorToken(values.border, makeEvidence('border', values.border), 10),
    'data-1': colorToken(values.data, makeEvidence('data-1', values.data), 8),
  };
  const fontFamilies = {
    display: fontToken(values.display, makeEvidence('font-display', values.display), 12),
    body: fontToken(values.body, makeEvidence('font-body', values.body), 30),
    data: fontToken(values.dataFont, makeEvidence('font-data', values.dataFont), 8),
  };
  const fontSizes = {
    title: dimensionToken(values.titlePt, makeEvidence('size-title', String(values.titlePt)), 12),
    body: dimensionToken(values.bodyPt, makeEvidence('size-body', String(values.bodyPt)), 30),
    data: dimensionToken(values.dataPt, makeEvidence('size-data', String(values.dataPt)), 8),
  };
  return {
    schemaVersion: 'nodeslide.signature/v1',
    id,
    name: id,
    source: { kind: 'taste_pack', digest: 'digest:test' },
    tokens: { colors, fontFamilies, fontSizes },
    usage: {
      colors: Object.values(colors).map((token) => ({
        value: token.$value.hex,
        occurrences: token.$extensions['com.nodeslide.signature'].occurrences,
        evidenceIds: [...token.$extensions['com.nodeslide.signature'].evidenceIds],
      })),
      fonts: Object.values(fontFamilies).map((token) => ({
        value: typeof token.$value === 'string' ? token.$value : token.$value[0],
        occurrences: token.$extensions['com.nodeslide.signature'].occurrences,
        evidenceIds: [...token.$extensions['com.nodeslide.signature'].evidenceIds],
      })),
      fontSizes: Object.values(fontSizes).map((token) => ({
        value: token.$extensions['com.nodeslide.signature'].originalPoints ?? 12,
        unit: 'pt',
        occurrences: token.$extensions['com.nodeslide.signature'].occurrences,
        evidenceIds: [...token.$extensions['com.nodeslide.signature'].evidenceIds],
      })),
    },
    layout: {
      slideWidthInches: 13.333,
      slideHeightInches: 7.5,
      aspectRatio: 16 / 9,
      slideCount: 1,
      masterCount: 1,
      layoutCount: 1,
      layoutUsage: [{ partName: 'ppt/slideLayouts/slideLayout1.xml', occurrences: 1 }],
      averageShapesPerSlide: 3,
      maximumShapesPerSlide: 3,
      averageTextRunsPerSlide: 2,
      medianFontSizePoints: values.bodyPt,
      density: 'sparse',
      embeddedFontsPresent: false,
      embeddedFontFamilies: [],
    },
    evidence,
    confidence: 'high',
    warnings: [],
  };
}

function colorToken(hex: string, evidenceId: string, occurrences: number): SignatureColorToken {
  const channels = [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ] as const;
  return {
    $type: 'color',
    $value: {
      colorSpace: 'srgb',
      components: channels.map((channel) => channel / 255) as [number, number, number],
      hex,
    },
    $extensions: {
      'com.nodeslide.signature': {
        evidenceIds: [evidenceId],
        confidence: 1,
        occurrences,
        sourceRole: 'authored',
      },
    },
  };
}

function fontToken(
  value: string,
  evidenceId: string,
  occurrences: number,
): SignatureFontFamilyToken {
  return {
    $type: 'fontFamily',
    $value: value,
    $extensions: {
      'com.nodeslide.signature': {
        evidenceIds: [evidenceId],
        confidence: 1,
        occurrences,
        sourceRole: 'authored',
      },
    },
  };
}

function dimensionToken(
  points: number,
  evidenceId: string,
  occurrences: number,
): SignatureDimensionToken {
  return {
    $type: 'dimension',
    $value: { value: points * (4 / 3), unit: 'px' },
    $extensions: {
      'com.nodeslide.signature': {
        evidenceIds: [evidenceId],
        confidence: 1,
        occurrences,
        sourceRole: 'authored',
        originalPoints: points,
      },
    },
  };
}

function renameTokensAsObserved(profile: SignatureProfile): SignatureProfile {
  const renamed = structuredClone(profile);
  renamed.tokens.colors = Object.fromEntries(
    Object.values(renamed.tokens.colors).map((token, index) => [`observed-color-${index}`, token]),
  );
  renamed.tokens.fontFamilies = Object.fromEntries(
    Object.values(renamed.tokens.fontFamilies).map((token, index) => [
      `observed-family-${index}`,
      token,
    ]),
  );
  renamed.tokens.fontSizes = Object.fromEntries(
    Object.values(renamed.tokens.fontSizes).map((token, index) => [
      `observed-size-${index}`,
      token,
    ]),
  );
  for (const token of [
    ...Object.values(renamed.tokens.colors),
    ...Object.values(renamed.tokens.fontFamilies),
    ...Object.values(renamed.tokens.fontSizes),
  ]) {
    token.$extensions['com.nodeslide.signature'].sourceRole = 'inferred';
  }
  return renamed;
}

function reverseProfileOrder(profile: SignatureProfile): SignatureProfile {
  const reversed = structuredClone(profile);
  reversed.tokens.colors = Object.fromEntries(Object.entries(reversed.tokens.colors).reverse());
  reversed.tokens.fontFamilies = Object.fromEntries(
    Object.entries(reversed.tokens.fontFamilies).reverse(),
  );
  reversed.tokens.fontSizes = Object.fromEntries(
    Object.entries(reversed.tokens.fontSizes).reverse(),
  );
  reversed.usage.colors.reverse();
  reversed.usage.fonts.reverse();
  reversed.usage.fontSizes.reverse();
  reversed.evidence.reverse();
  return reversed;
}

function contrast(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
    const [red = 0, green = 0, blue = 0] = channels.map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

function requiredValue<T>(record: Readonly<Record<string, T>>, key: string): T {
  const value = record[key];
  if (value === undefined) throw new Error(`Missing test value ${key}`);
  return value;
}
