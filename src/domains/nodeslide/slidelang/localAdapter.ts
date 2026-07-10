import {
  type DeckSnapshot,
  NODESLIDE_SCHEMA_VERSION,
  NODESLIDE_TOOLCHAIN_VERSION,
  type ThemeSpec,
} from '../../../../shared/nodeslide';
import { getCapabilityReports, getCapabilityWarnings, getElementCapability } from './capabilities';
import { renderDeckHtml, renderSlideHtml } from './html';
import { buildPptx } from './pptx';
import { applyRepairPlan, getRepairPlan } from './repair';
import type {
  SlideLangAdapter,
  SlideLangLocalPlan,
  SlideLangLocalPublication,
  SlideLangScaffoldInput,
} from './types';
import { cloneSnapshot, stableHash } from './utils';
import { validateSnapshot } from './validation';

const DEFAULT_THEME: ThemeSpec = {
  id: 'slidelang-local',
  name: 'SlideLang Local',
  mode: 'dark',
  colors: {
    canvas: '#10131a',
    ink: '#f7f4ec',
    muted: '#aeb5c2',
    accent: '#f6b94a',
    accentSoft: '#3b3222',
    insight: '#d9f99d',
    insightInk: '#17210b',
    trace: '#7dd3fc',
    border: '#303744',
  },
  typography: {
    display: 'Aptos Display',
    body: 'Aptos',
    data: 'Aptos Mono',
  },
  defaultRadius: 18,
  spacingUnit: 8,
};

function stableScaffoldId(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function scaffold(input: SlideLangScaffoldInput): DeckSnapshot {
  const deckId = stableScaffoldId(input.deckId, `deck-${stableHash(input.title)}`);
  const slideId = `${deckId}:slide:cover`;
  const titleId = `${slideId}:title`;
  const purposeId = `${slideId}:purpose`;
  const timestamp = input.timestamp ?? 0;
  const theme = structuredClone(input.theme ?? DEFAULT_THEME);
  return {
    deck: {
      schemaVersion: NODESLIDE_SCHEMA_VERSION,
      toolchainVersion: NODESLIDE_TOOLCHAIN_VERSION,
      id: deckId,
      projectId: stableScaffoldId(input.projectId, 'project-local'),
      title: input.title,
      brief: structuredClone(input.brief),
      theme,
      slideOrder: [slideId],
      version: 1,
      status: 'draft',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    slides: [
      {
        id: slideId,
        deckId,
        title: input.title,
        background: theme.colors.canvas,
        elementOrder: [titleId, purposeId],
        version: 1,
      },
    ],
    elements: [
      {
        id: titleId,
        slideId,
        name: 'Cover title',
        kind: 'text',
        role: 'title',
        bbox: { x: 0.08, y: 0.16, width: 0.76, height: 0.2 },
        rotation: 0,
        content: input.title,
        style: {
          color: theme.colors.ink,
          fontFamily: theme.typography.display,
          fontSize: 44,
          fontWeight: 700,
          lineHeight: 1.05,
        },
        sourceIds: [],
        locked: false,
        exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
        version: 1,
      },
      {
        id: purposeId,
        slideId,
        name: 'Cover purpose',
        kind: 'text',
        role: 'subtitle',
        bbox: { x: 0.08, y: 0.43, width: 0.62, height: 0.16 },
        rotation: 0,
        content: input.brief.purpose,
        style: {
          color: theme.colors.muted,
          fontFamily: theme.typography.body,
          fontSize: 22,
          lineHeight: 1.25,
        },
        sourceIds: [],
        locked: false,
        exportCapabilities: ['web_native', 'pptx_editable', 'google_importable'],
        version: 1,
      },
    ],
    sources: [],
  };
}

function plan(snapshot: DeckSnapshot): SlideLangLocalPlan {
  const validation = validateSnapshot(snapshot);
  const repairs = getRepairPlan(validation);
  const steps = ['check'];
  if (repairs.actions.length > 0) steps.push('review-repair-plan');
  if (repairs.actions.some((action) => action.automatic)) steps.push('apply-safe-local-repairs');
  steps.push(validation.publishOk ? 'publish' : 'recheck-before-publish');
  return {
    id: `plan:${snapshot.deck.id}:v${snapshot.deck.version}:${stableHash(steps.join('|'))}`,
    deckId: snapshot.deck.id,
    deckVersion: snapshot.deck.version,
    validation,
    repairs,
    capabilities: getCapabilityReports(snapshot),
    steps,
  };
}

function publish(snapshot: DeckSnapshot): SlideLangLocalPublication {
  const validation = validateSnapshot(snapshot);
  if (!validation.publishOk) {
    throw new Error(
      `Deck ${snapshot.deck.id} v${snapshot.deck.version} is not publishable; resolve blocking validation issues first.`,
    );
  }
  return {
    id: `local-publication:${snapshot.deck.id}:v${snapshot.deck.version}`,
    deckId: snapshot.deck.id,
    deckVersion: snapshot.deck.version,
    snapshot: cloneSnapshot(snapshot),
    html: renderDeckHtml(snapshot),
    validation,
    capabilityWarnings: getCapabilityWarnings(snapshot),
  };
}

export function createLocalSlideLangAdapter(): SlideLangAdapter {
  return {
    mode: 'local',
    scaffold,
    plan,
    check: validateSnapshot,
    repair: applyRepairPlan,
    publish,
    pull: (publication) => cloneSnapshot(publication.snapshot),
    validate: validateSnapshot,
    getRepairPlan,
    getElementCapability,
    getCapabilityReports,
    renderSlideHtml,
    renderDeckHtml,
    buildPptx,
  };
}

/** Default/free adapter. Hosted behavior is always an explicit opt-in. */
export const localSlideLangAdapter: SlideLangAdapter = createLocalSlideLangAdapter();
export const slideLangAdapter: SlideLangAdapter = localSlideLangAdapter;
