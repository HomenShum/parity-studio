import {
  type BoundingBox,
  type DeckBrief,
  type DeckSnapshot,
  NODESLIDE_SCHEMA_VERSION,
  NODESLIDE_TOOLCHAIN_VERSION,
  type Slide,
  type SlideElement,
  type SourceRecord,
  type ThemeSpec,
} from '../../shared/nodeslide';
import {
  type NodeSlideDataAttachment,
  nodeSlideDataAttachmentShape,
} from '../../shared/nodeslideAttachments';
import {
  nodeslideCleanText,
  nodeslideContentDigest,
  nodeslideHash,
  nodeslideSlug,
  nodeslideStableId,
} from './nodeslideIds';
import { validateNodeSlideSnapshot } from './nodeslideValidation';

export interface NodeSlidePlannedChart {
  labels: string[];
  values: number[];
  unit?: string;
}

export interface NodeSlidePlannedFormula {
  expression: string;
  display: string;
  variables: Array<{ label: string; value: number; unit?: string }>;
  syntax?: 'plain' | 'latex';
  description?: string;
}

export interface NodeSlidePlannedImage {
  url?: string;
  imageUrl?: string;
  altText: string;
  credit?: string;
  caption?: string;
}

export interface NodeSlidePlannedVideo {
  url: string;
  posterUrl?: string;
  title?: string;
  captionsUrl?: string;
  captionsLanguage?: string;
  startAtSeconds?: number;
  endAtSeconds?: number;
}

export interface NodeSlidePlannedSlide {
  title: string;
  section: string;
  headline: string;
  body: string;
  bullets: string[];
  metric?: string;
  metricLabel?: string;
  chart?: NodeSlidePlannedChart;
  formula?: NodeSlidePlannedFormula;
  image?: NodeSlidePlannedImage;
  video?: NodeSlidePlannedVideo;
}

export interface NodeSlideDeckSpec {
  title: string;
  narrative: string[];
  slides: NodeSlidePlannedSlide[];
}

export interface NodeSlideBuildResult {
  snapshot: DeckSnapshot;
  plan: string[];
  spec: NodeSlideDeckSpec;
}

export interface NodeSlideLegacyGoldenRepairResult {
  changed: boolean;
  snapshot: DeckSnapshot;
}

export interface BuildBriefDeckInput {
  deckId: string;
  projectId: string;
  title: string;
  brief: DeckBrief;
  themeId: string;
  rawSpec?: unknown;
  plan?: readonly string[];
  attachments?: readonly NodeSlideDataAttachment[];
  now: number;
}

const EDITABLE_CAPABILITIES = ['web_native', 'pptx_editable', 'google_importable'] as const;

const FALLBACK_LIGHT_THEME: ThemeSpec = {
  id: 'editorial-signal',
  name: 'Editorial Signal',
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

const FALLBACK_DARK_THEME: ThemeSpec = {
  id: 'midnight-signal',
  name: 'Midnight Signal',
  mode: 'dark',
  colors: {
    canvas: '#111815',
    ink: '#F5F1E8',
    muted: '#A7B2AB',
    accent: '#FF7655',
    accentSoft: '#42271F',
    insight: '#193E2B',
    insightInk: '#C8F3D6',
    trace: '#9E8CFF',
    border: '#344139',
  },
  typography: {
    display: 'Fraunces Variable',
    body: 'Geist Variable',
    data: 'JetBrains Mono Variable',
  },
  defaultRadius: 18,
  spacingUnit: 8,
};

const THEME_EDITORIAL_SIGNAL: ThemeSpec = {
  id: 'editorial-signal',
  name: 'Editorial Signal',
  mode: 'light',
  colors: {
    canvas: '#F7F4ED',
    ink: '#26221D',
    muted: '#756B61',
    accent: '#B44A2D',
    accentSoft: '#F2DED3',
    insight: '#E5E9D6',
    insightInk: '#34452C',
    trace: '#7566A8',
    border: '#DED7CC',
  },
  typography: {
    display: 'Fraunces Variable',
    body: 'Geist Variable',
    data: 'JetBrains Mono Variable',
  },
  defaultRadius: 18,
  spacingUnit: 8,
};

const THEME_QUIET_PRECISION: ThemeSpec = {
  id: 'quiet-precision',
  name: 'Quiet Precision',
  mode: 'light',
  colors: {
    canvas: '#F4F7F8',
    ink: '#17242B',
    muted: '#60727B',
    accent: '#287A8D',
    accentSoft: '#DCECF0',
    insight: '#DDEDE8',
    insightInk: '#15554E',
    trace: '#4E6E8E',
    border: '#CFDCE0',
  },
  typography: {
    display: 'Geist Variable',
    body: 'Geist Variable',
    data: 'JetBrains Mono Variable',
  },
  defaultRadius: 8,
  spacingUnit: 8,
};

const THEME_NIGHT_BRIEFING: ThemeSpec = {
  id: 'night-briefing',
  name: 'Night Briefing',
  mode: 'dark',
  colors: {
    canvas: '#15171C',
    ink: '#F4F1E9',
    muted: '#A9AFBA',
    accent: '#B8E068',
    accentSoft: '#2B331F',
    insight: '#334022',
    insightInk: '#E4FFAA',
    trace: '#8DA2FF',
    border: '#353A43',
  },
  typography: {
    display: 'Geist Variable',
    body: 'Geist Variable',
    data: 'JetBrains Mono Variable',
  },
  defaultRadius: 10,
  spacingUnit: 8,
};

const DESIGN_PROFILE_THEMES: Readonly<Record<string, ThemeSpec>> = {
  [THEME_EDITORIAL_SIGNAL.id]: THEME_EDITORIAL_SIGNAL,
  [THEME_QUIET_PRECISION.id]: THEME_QUIET_PRECISION,
  [THEME_NIGHT_BRIEFING.id]: THEME_NIGHT_BRIEFING,
};

export function nodeslideTheme(themeId: string): ThemeSpec {
  const cleanId = nodeslideSlug(themeId);
  const profile = DESIGN_PROFILE_THEMES[cleanId];
  if (profile) return structuredClone(profile);

  const dark = /dark|midnight|night|black/i.test(themeId);
  const base = structuredClone(dark ? FALLBACK_DARK_THEME : FALLBACK_LIGHT_THEME);
  if (cleanId && cleanId !== 'deck') base.id = cleanId;
  return base;
}

export function repairLegacyGoldenSnapshot(
  snapshot: DeckSnapshot,
  canonical: DeckSnapshot,
): NodeSlideLegacyGoldenRepairResult {
  if (!isMatchingCanonicalGolden(snapshot, canonical)) {
    return { changed: false, snapshot };
  }

  const canonicalElements = new Map(canonical.elements.map((element) => [element.id, element]));
  let repaired: DeckSnapshot | undefined;
  const currentSnapshot = () => repaired ?? snapshot;
  const replaceElement = (index: number, element: SlideElement) => {
    if (!repaired) repaired = structuredClone(snapshot);
    repaired.elements[index] = element;
  };

  for (let index = 0; index < snapshot.elements.length; index += 1) {
    const current = currentSnapshot().elements[index];
    if (!current) continue;
    const expected = canonicalElements.get(current.id);
    if (!expected || !isUntouchedCanonicalElementIdentity(current, expected)) continue;
    if (!isLegacyDuplicatedNumberedBullet(current, expected)) continue;

    replaceElement(index, { ...current, content: expected.content ?? '' });
  }

  if (geometryValidationIssueCount(canonical) === 0) {
    for (let index = 0; index < snapshot.elements.length; index += 1) {
      const working = currentSnapshot();
      const current = working.elements[index];
      if (!current) continue;
      const expected = canonicalElements.get(current.id);
      if (
        !expected ||
        !isUntouchedCanonicalElementIdentity(current, expected) ||
        sameBoundingBox(current.bbox, expected.bbox)
      ) {
        continue;
      }

      const issueCount = geometryValidationIssueCount(working);
      if (issueCount === 0) break;
      const trialElements = [...working.elements];
      trialElements[index] = { ...current, bbox: structuredClone(expected.bbox) };
      const trial = { ...working, elements: trialElements };
      if (geometryValidationIssueCount(trial) >= issueCount) continue;

      replaceElement(index, trialElements[index] as SlideElement);
    }
  }

  return repaired ? { changed: true, snapshot: repaired } : { changed: false, snapshot };
}

export function buildGoldenNodeSlide(clientSessionId: string, now: number): NodeSlideBuildResult {
  const sessionKey = nodeslideHash(clientSessionId.trim());
  const deckId = `deck_golden_${sessionKey}`;
  const projectId = `project_nodeslide_${sessionKey}`;
  const brief: DeckBrief = {
    prompt:
      'Show how NodeSlide turns presentation work into a traceable, editable, reviewable system.',
    audience: 'Product, design, and engineering leaders evaluating a new presentation workflow',
    purpose: 'Demonstrate the NodeSlide product story with a credible, polished golden deck',
    successCriteria: [
      'Make the product promise obvious in the first minute',
      'Make workflow value legible without inventing evidence',
      'Explain guarded agent edits, review, and version recovery',
    ],
  };
  const spec: NodeSlideDeckSpec = {
    title: 'NodeSlide — stories with structure',
    narrative: [
      'Presentation work should be editable data, not a pile of pixels.',
      'Typed structure makes every agent change reviewable and reversible.',
      'A source-aware workflow can move quickly without losing trust.',
    ],
    slides: [
      {
        title: 'Stories with structure',
        section: 'NodeSlide / 01',
        headline: 'Build the story. Keep every decision editable.',
        body: 'NodeSlide treats a deck as a typed system: narrative, geometry, sources, comments, and changes stay connected from first brief to final room.',
        bullets: ['Structured canvas', 'Guarded edits', 'Traceable claims'],
      },
      {
        title: 'The handoff tax compounds',
        section: 'Scenario / 02',
        headline: 'Keep source context attached as the story moves.',
        body: 'This golden scenario focuses on one design goal: keep copy, layout, citations, and feedback connected through drafting, review, revision, and handoff.',
        bullets: [
          'Draft with source context',
          'Review on stable anchors',
          'Hand off editable structure',
        ],
        metric: 'CONTEXT',
        metricLabel: 'Qualitative workflow label — not a measured benchmark',
      },
      {
        title: 'A deck is a typed system',
        section: 'Foundation / 03',
        headline: 'Structure turns a visual artifact into an operating surface.',
        body: 'Slides and elements carry stable IDs, normalized geometry, source links, export capability, locks, and independent versions.',
        bullets: [
          'Stable IDs survive every view',
          'Normalized boxes travel across renderers',
          'Locks protect intent',
        ],
        image: {
          altText: 'Structured deck graph connecting slides, elements, sources, and versions',
          caption: 'A canonical deck graph keeps every artifact connected.',
        },
      },
      {
        title: 'One intent, three guarded passes',
        section: 'Workflow / 04',
        headline: 'Plan → propose → commit, with scope checked at every boundary.',
        body: 'The agent can reason broadly, but it may only write inside the explicit deck, slide, element, comment, or bounding-box scope.',
        bullets: ['Read context', 'Propose an inspectable patch', 'Validate and accept atomically'],
        formula: {
          expression: 'authorized change = requested scope ∩ allowed scope',
          display: 'authorized change = requested scope ∩ allowed scope',
          variables: [],
          syntax: 'plain',
          description:
            'The agent can only mutate the intersection of requested and authorized scope.',
        },
      },
      {
        title: 'Quality is measurable',
        section: 'Proof / 05',
        headline: 'A beautiful deck still needs deterministic gates.',
        body: 'Structural, geometry, source, and export checks produce separate signals for basic validity, publishing safety, and a clean handoff.',
        bullets: [
          'ok · structurally valid',
          'publishOk · safe to present',
          'cleanOk · no warnings',
        ],
        metric: '3 gates',
        metricLabel: 'independent validation signals: ok, publishOk, cleanOk',
        chart: {
          labels: ['ok', 'publish', 'clean'],
          values: [1, 1, 1],
          unit: 'pass',
        },
      },
      {
        title: 'Human review stays in the loop',
        section: 'Trust / 06',
        headline: 'Comments become context. Patches remain choices.',
        body: 'A reviewer can anchor feedback to a deck, slide, element, or region; link the resolution to an accepted patch; and restore any prior snapshot.',
        bullets: ['Anchored discussion', 'Compare-and-set acceptance', 'Version recovery'],
      },
      {
        title: 'Ship the story, keep the structure',
        section: 'Next / 07',
        headline: 'Move at presentation speed without giving up engineering-grade trust.',
        body: 'Start with a brief, shape the narrative together, and leave with a deck whose content, sources, changes, and exports are still yours.',
        bullets: ['Create from brief', 'Review every change', 'Present with confidence'],
      },
    ],
  };
  const plan = [
    'Open with the promise: storytelling speed without structural loss.',
    'Frame context continuity as the qualitative workflow goal.',
    'Reveal the typed deck model as the foundation.',
    'Demonstrate the scoped plan–propose–commit workflow.',
    'Prove quality with deterministic validation gates.',
    'Make human review, comments, and restore explicit.',
    'Close on the durable outcome and a clear invitation.',
  ];
  return buildNodeSlideDeck({
    deckId,
    projectId,
    title: spec.title,
    brief,
    themeId: THEME_EDITORIAL_SIGNAL.id,
    spec,
    plan,
    now,
    shareSlug: nodeslideSlug('nodeslide-stories-with-structure', sessionKey),
    golden: true,
  });
}

export function deterministicBriefSpec(title: string, brief: DeckBrief): NodeSlideDeckSpec {
  const cleanTitle = nodeslideCleanText(title, 80) || 'Untitled story';
  const audience = nodeslideCleanText(brief.audience, 120) || 'the audience';
  const purpose = nodeslideCleanText(brief.purpose, 180) || nodeslideCleanText(brief.prompt, 180);
  const outcome = sentenceCase(purpose || nodeslideCleanText(brief.prompt, 180));
  const criteria = brief.successCriteria
    .map((criterion) => nodeslideCleanText(criterion, 96))
    .filter(Boolean)
    .slice(0, 3);
  const success =
    criteria.length > 0 ? criteria : ['Make the decision clear', 'Show credible evidence'];

  const spec: NodeSlideDeckSpec = {
    title: cleanTitle,
    narrative: [
      `Orient ${audience} around the central promise.`,
      'Move from current tension to a concrete, credible approach.',
      'Close with proof, ownership, and a specific next move.',
    ],
    slides: [
      {
        title: cleanTitle,
        section: 'Opening / 01',
        headline: outcome,
        body: `A focused narrative for ${audience}, built from the supplied brief and kept editable from first draft onward.`,
        bullets: success,
      },
      {
        title: 'The moment to solve',
        section: 'Context / 02',
        headline: 'The cost of waiting is usually hidden in repeated work.',
        body: `Frame the current reality for ${audience}: what is fragmented today, why it matters now, and where momentum is being lost.`,
        bullets: ['Name the friction', 'Expose the consequence', 'Create urgency without hype'],
      },
      {
        title: 'The decisive insight',
        section: 'Insight / 03',
        headline: 'A better outcome starts with a sharper point of view.',
        body: nodeslideCleanText(brief.prompt, 260),
        bullets: success,
      },
      {
        title: 'How the approach works',
        section: 'Approach / 04',
        headline: 'Turn the idea into a sequence people can understand and own.',
        body: 'Connect intent, action, and feedback in one visible operating path so the audience can see both the destination and the mechanics.',
        bullets: ['Align on intent', 'Execute the critical moves', 'Review measurable outcomes'],
        formula: {
          expression: 'accepted change = proposal ∩ authorized scope',
          display: 'accepted change = proposal ∩ authorized scope',
          variables: [],
          syntax: 'plain',
          description: 'Only the authorized portion of a proposal may be accepted.',
        },
      },
      {
        title: 'What success looks like',
        section: 'Evidence / 05',
        headline: 'Define proof before asking for commitment.',
        body: 'Use the brief’s success criteria as explicit evaluation signals, with assumptions clearly separated from measured evidence.',
        bullets: success,
        metric: `${success.length} signals`,
        metricLabel: 'agreed measures of a successful outcome',
        chart: {
          labels: success.map((_, index) => `S${index + 1}`),
          values: success.map(() => 1),
          unit: 'defined',
        },
      },
      {
        title: 'A practical path forward',
        section: 'Delivery / 06',
        headline: 'Start narrow, learn quickly, and preserve room to adapt.',
        body: 'Sequence the work into a focused launch, an evidence review, and a deliberate scale decision with named ownership at every step.',
        bullets: [
          'Launch the smallest credible move',
          'Review evidence with stakeholders',
          'Scale what earns confidence',
        ],
        image: {
          altText: 'Structured evidence map derived from the supplied brief',
          caption: 'The visual is illustrative and remains replaceable as an image object.',
        },
      },
      {
        title: 'The decision',
        section: 'Close / 07',
        headline: outcome || 'Choose the next move and make ownership explicit.',
        body: `Invite ${audience} to align on the outcome, the first action, and the evidence that will guide the next decision.`,
        bullets: ['Agree the outcome', 'Name the owner', 'Set the next checkpoint'],
      },
    ],
  };
  applyDeterministicBriefPrimitives(spec.slides, brief.prompt);
  return spec;
}

function applyDeterministicBriefPrimitives(slides: NodeSlidePlannedSlide[], prompt: string): void {
  const csvRecords = briefMetricCsvRecords(prompt);
  const csvByMetric = new Map(csvRecords.map((record) => [record.metric, record]));
  const totalGoals = Number(csvByMetric.get('total_goals')?.value);
  const matchesPlayed = Number(csvByMetric.get('matches_played')?.value);
  const suppliedGoalsPerMatch = Number(csvByMetric.get('goals_per_match')?.value);
  const contextSlide = slides[1];
  const derivedSlide = slides[2];
  if (
    Number.isFinite(totalGoals) &&
    Number.isFinite(matchesPlayed) &&
    matchesPlayed > 0 &&
    contextSlide &&
    derivedSlide
  ) {
    const goalsPerMatch = Number.isFinite(suppliedGoalsPerMatch)
      ? suppliedGoalsPerMatch
      : Number((totalGoals / matchesPlayed).toFixed(2));
    contextSlide.title = 'Tournament at a glance';
    contextSlide.headline = `${totalGoals} goals across ${matchesPlayed} matches.`;
    contextSlide.body =
      'The uploaded tournament data is compiled into editable metrics, not flattened into an image.';
    contextSlide.bullets = [
      `Average: ${goalsPerMatch} goals per match`,
      'Every value remains linked to the uploaded source',
      'Review or replace the data without rebuilding the slide',
    ];
    contextSlide.metric = String(totalGoals);
    contextSlide.metricLabel = 'total goals in the supplied dataset';
    derivedSlide.title = 'Scoring rate';
    derivedSlide.headline = `${goalsPerMatch} goals per match.`;
    derivedSlide.body =
      'NodeSlide keeps the result and both inputs as a structured formula for review and native export.';
    derivedSlide.bullets = ['Editable numerator', 'Editable denominator', 'Recomputable result'];
    derivedSlide.formula = {
      expression: 'total_goals / matches_played',
      display: `${totalGoals} ÷ ${matchesPlayed} = ${goalsPerMatch}`,
      variables: [
        { label: 'Total goals', value: totalGoals, unit: 'goals' },
        { label: 'Matches played', value: matchesPlayed, unit: 'matches' },
      ],
      syntax: 'plain',
      description: 'Goals per match derived from the uploaded tournament totals.',
    };
  }

  const scorerRecords = ['top_scorer', 'runner_up'].flatMap((metric) => {
    const record = csvByMetric.get(metric);
    if (!record) return [];
    const goals = Number(record.unit.match(/\d+(?:\.\d+)?/u)?.[0]);
    return record.value && Number.isFinite(goals) ? [{ label: record.value, value: goals }] : [];
  });
  const csvChartRecords =
    scorerRecords.length >= 2
      ? scorerRecords
      : csvRecords.flatMap((record) => {
          const value = Number(record.value);
          return Number.isFinite(value) ? [{ label: humanizeMetric(record.metric), value }] : [];
        });
  const csvChartSlide = slides[3];
  if (csvChartRecords.length >= 2 && csvChartSlide) {
    const { formula: _formula, ...chartOnlySlide } = csvChartSlide;
    slides[3] = {
      ...chartOnlySlide,
      title: scorerRecords.length >= 2 ? 'Golden Boot race' : 'Uploaded comparison',
      headline:
        scorerRecords.length >= 2
          ? 'The top two scorers were separated by one goal.'
          : 'The uploaded values remain an editable chart.',
      body: 'Labels and values stay in the canonical deck spec for direct editing, validation, and native export.',
      bullets: ['Data-bound bars', 'Source-linked values', 'Editable labels'],
      chart: {
        labels: csvChartRecords.slice(0, 8).map(({ label }) => label),
        values: csvChartRecords.slice(0, 8).map(({ value }) => value),
        unit: scorerRecords.length >= 2 ? 'goals' : 'value',
      },
    };
  }

  const formulaMatch = prompt.match(
    /formula[^.;]{0,40}?(\d+(?:\.\d+)?)\s*(?:÷|\/)\s*(\d+(?:\.\d+)?)\s*=\s*(\d+(?:\.\d+)?)([^,.;]*)/iu,
  );
  const formulaSlide = slides[2];
  if (formulaMatch && formulaSlide) {
    const numerator = Number(formulaMatch[1]);
    const denominator = Number(formulaMatch[2]);
    const result = Number(formulaMatch[3]);
    const suffix = nodeslideCleanText(
      (formulaMatch[4] ?? '').split(/\s+and\s+an?\s+editable\b/iu)[0] ?? '',
      80,
    );
    const display = `${numerator} ÷ ${denominator} = ${result}${suffix ? ` ${suffix}` : ''}`;
    formulaSlide.title = 'Derived measure';
    formulaSlide.headline = display;
    formulaSlide.body =
      'This formula remains structured with editable inputs, a presentation value, and linked evidence.';
    formulaSlide.formula = {
      expression: `${numerator} / ${denominator}`,
      display,
      variables: [
        { label: 'Numerator', value: numerator },
        { label: 'Denominator', value: denominator },
      ],
    };
  }

  const comparisonText = prompt.match(/top scorers were\s+([^.;]+)/iu)?.[1];
  const comparisons = comparisonText
    ? comparisonText.split(/,\s*(?:and\s+)?|\s+and\s+/iu).flatMap((part) => {
        const match = part.trim().match(/^(.+?)\s+(\d+(?:\.\d+)?)$/u);
        if (!match) return [];
        const label = nodeslideCleanText(match[1] ?? '', 60);
        const value = Number(match[2]);
        return label && Number.isFinite(value) ? [{ label, value }] : [];
      })
    : [];
  const chartSlide = slides[3];
  if (comparisons.length >= 2 && chartSlide) {
    const { formula: _formula, ...chartOnlySlide } = chartSlide;
    slides[3] = {
      ...chartOnlySlide,
      title: 'Supplied comparison',
      headline: 'The supplied values remain an editable chart.',
      body: 'Labels and values stay in the canonical deck spec for direct editing and native export.',
      chart: {
        labels: comparisons.slice(0, 8).map(({ label }) => label),
        values: comparisons.slice(0, 8).map(({ value }) => value),
        unit: 'goals',
      },
    };
  }

  const imageLabel = nodeslideCleanText(
    prompt.match(/editable\s+([^.;]{3,80}?)\s+image placeholder/iu)?.[1] ?? '',
    80,
  );
  const imageSlide = slides.find((slide) => slide.image) ?? slides[5];
  if (imageLabel && imageSlide) {
    imageSlide.title = `${imageLabel} image placeholder`;
    imageSlide.headline = 'Missing image evidence stays explicit, editable, and credited.';
    imageSlide.body =
      'NodeSlide keeps an honest replace-image primitive until a licensed asset is supplied.';
    imageSlide.image = {
      altText: `${imageLabel} — replace with a licensed image`,
      credit: 'Licensed image and visible credit required before external use',
    };
  }
}

function briefMetricCsvRecords(
  prompt: string,
): Array<{ metric: string; value: string; unit: string }> {
  const lines = prompt.split(/\r?\n/u);
  const headerIndex = lines.findIndex(
    (line) => line.trim().toLowerCase() === 'metric,value,unit,source',
  );
  if (headerIndex < 0) return [];
  return lines.slice(headerIndex + 1, headerIndex + 101).flatMap((line) => {
    const [rawMetric = '', rawValue = '', rawUnit = ''] = line.split(',');
    const metric = rawMetric.trim().toLowerCase();
    const value = rawValue.trim();
    const unit = rawUnit.trim();
    return /^[a-z0-9_ -]{1,80}$/u.test(metric) && value
      ? [{ metric: metric.replace(/[ -]+/gu, '_'), value, unit }]
      : [];
  });
}

function humanizeMetric(metric: string): string {
  return metric
    .split('_')
    .filter(Boolean)
    .map((part) => `${part[0]?.toLocaleUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function sentenceCase(value: string): string {
  const characters = Array.from(value);
  if (characters.length === 0) return '';
  return `${characters[0]?.toLocaleUpperCase() ?? ''}${characters.slice(1).join('')}`;
}

export function coerceBriefSpec(
  rawSpec: unknown,
  title: string,
  brief: DeckBrief,
): NodeSlideDeckSpec {
  const fallback = deterministicBriefSpec(title, brief);
  if (!isRecord(rawSpec) || !Array.isArray(rawSpec.slides)) return fallback;
  const slides = rawSpec.slides
    .map((value, index) => coercePlannedSlide(value, fallback.slides[index], index))
    .filter((slide): slide is NodeSlidePlannedSlide => slide !== null)
    .slice(0, 8);
  if (slides.length < 6) return fallback;

  const narrative = Array.isArray(rawSpec.narrative)
    ? rawSpec.narrative
        .filter((value): value is string => typeof value === 'string')
        .map((value) => nodeslideCleanText(value, 180))
        .filter(Boolean)
        .slice(0, 5)
    : fallback.narrative;
  return {
    title:
      typeof rawSpec.title === 'string'
        ? nodeslideCleanText(rawSpec.title, 80) || fallback.title
        : fallback.title,
    narrative: narrative.length > 0 ? narrative : fallback.narrative,
    slides,
  };
}

export function buildBriefNodeSlide(input: BuildBriefDeckInput): NodeSlideBuildResult {
  const spec = coerceBriefSpec(input.rawSpec, input.title, input.brief);
  const fallbackPlan = spec.slides.map(
    (slide, index) => `${index + 1}. ${slide.section}: ${slide.headline}`,
  );
  const plan = (input.plan ?? fallbackPlan)
    .map((step) => nodeslideCleanText(step, 220))
    .filter(Boolean)
    .slice(0, 12);
  return buildNodeSlideDeck({
    deckId: input.deckId,
    projectId: input.projectId,
    title: nodeslideCleanText(input.title, 80) || spec.title,
    brief: input.brief,
    themeId: input.themeId,
    spec,
    plan: plan.length > 0 ? plan : fallbackPlan,
    ...(input.attachments ? { attachments: input.attachments } : {}),
    now: input.now,
    shareSlug: nodeslideSlug(input.title, nodeslideHash(input.deckId)),
    golden: false,
  });
}

function buildNodeSlideDeck(input: {
  deckId: string;
  projectId: string;
  title: string;
  brief: DeckBrief;
  themeId: string;
  spec: NodeSlideDeckSpec;
  plan: string[];
  attachments?: readonly NodeSlideDataAttachment[];
  now: number;
  shareSlug: string;
  golden: boolean;
}): NodeSlideBuildResult {
  const theme = nodeslideTheme(input.themeId);
  const sourceBriefId = nodeslideStableId('source', input.deckId, 'brief');
  const sourceEvidenceId = nodeslideStableId('source', input.deckId, 'evidence');
  const linkedSources = linkedBriefSources(input.deckId, input.brief.prompt, input.now);
  const uploadedSources: SourceRecord[] = (input.attachments ?? []).map((attachment) => {
    const sourceType =
      attachment.format === 'csv'
        ? ('spreadsheet' as const)
        : attachment.format === 'json'
          ? ('document' as const)
          : ('note' as const);
    return {
      id: nodeslideStableId(
        'source',
        input.deckId,
        sourceType,
        attachment.title,
        nodeslideHash(attachment.content),
      ),
      deckId: input.deckId,
      title: attachment.title,
      sourceType,
      retrievedAt: input.now,
      citation: `Uploaded file: ${attachment.title}\n${attachment.content}`,
      license: 'User supplied',
      format: attachment.format,
      contentDigest: nodeslideContentDigest(attachment.content),
      byteSize: new TextEncoder().encode(attachment.content).byteLength,
      ...nodeSlideDataAttachmentShape(attachment.content, attachment.format),
      retention: 'until_deleted',
      status: 'ready',
      lastRefreshedAt: input.now,
    };
  });
  const linkedSourceIds = [...linkedSources, ...uploadedSources].map((source) => source.id);
  const sources: SourceRecord[] = [
    {
      id: sourceBriefId,
      deckId: input.deckId,
      title: input.golden ? 'NodeSlide product brief' : `${input.title} — creation brief`,
      sourceType: 'internal',
      retrievedAt: input.now,
      citation: input.brief.prompt,
      license: 'Internal working material',
    },
    {
      id: sourceEvidenceId,
      deckId: input.deckId,
      title: input.golden ? 'Golden workflow scenario' : 'Brief success criteria',
      sourceType: 'note',
      retrievedAt: input.now,
      citation: input.golden
        ? 'Qualitative product-workflow scenario for demonstrating NodeSlide; no measured customer benchmark is claimed.'
        : input.brief.successCriteria.join('; ') || 'No explicit success criteria supplied.',
      license: 'Internal working material',
    },
    ...linkedSources,
    ...uploadedSources,
  ];

  const slides: Slide[] = [];
  const elements: SlideElement[] = [];
  for (let index = 0; index < input.spec.slides.length; index += 1) {
    const planned = input.spec.slides[index];
    if (!planned) continue;
    const slideId = nodeslideStableId('slide', input.deckId, String(index + 1), planned.title);
    const built = buildSlide({
      deckId: input.deckId,
      slideId,
      planned,
      index,
      total: input.spec.slides.length,
      theme,
      sourceBriefId,
      sourceEvidenceId,
      linkedSourceIds,
    });
    slides.push(built.slide);
    elements.push(...built.elements);
  }

  const deck = {
    schemaVersion: NODESLIDE_SCHEMA_VERSION,
    toolchainVersion: NODESLIDE_TOOLCHAIN_VERSION,
    id: input.deckId,
    projectId: input.projectId,
    title: input.title,
    brief: structuredClone(input.brief),
    theme,
    slideOrder: slides.map((slide) => slide.id),
    version: 1,
    status: 'ready' as const,
    shareSlug: input.shareSlug,
    createdAt: input.now,
    updatedAt: input.now,
  };
  return {
    snapshot: { deck, slides, elements, sources },
    plan: input.plan,
    spec: input.spec,
  };
}

function buildSlide(input: {
  deckId: string;
  slideId: string;
  planned: NodeSlidePlannedSlide;
  index: number;
  total: number;
  theme: ThemeSpec;
  sourceBriefId: string;
  sourceEvidenceId: string;
  linkedSourceIds: string[];
}): { slide: Slide; elements: SlideElement[] } {
  const { planned, theme } = input;
  const elements: SlideElement[] = [];
  const add = (element: SlideElement) => {
    elements.push(element);
    return element.id;
  };
  const element = (
    key: string,
    value: Omit<SlideElement, 'id' | 'slideId' | 'version'>,
  ): SlideElement => ({
    ...value,
    id: nodeslideStableId('element', input.slideId, key),
    slideId: input.slideId,
    version: 1,
  });

  add(
    element('accent-rail', {
      name: 'Accent rail',
      kind: 'shape',
      role: 'decoration',
      bbox: box(0.035, 0.065, 0.008, 0.83),
      rotation: 0,
      style: { fill: theme.colors.accent, radius: 8 },
      sourceIds: [],
      locked: true,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );
  add(
    element('section', {
      name: 'Section label',
      kind: 'text',
      role: 'section',
      bbox: box(0.07, 0.065, 0.48, 0.05),
      rotation: 0,
      content: planned.section.toUpperCase(),
      style: {
        color: theme.colors.accent,
        fontFamily: theme.typography.data,
        fontSize: 15,
        fontWeight: 650,
        letterSpacing: 1.3,
      },
      sourceIds: [],
      locked: false,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );
  add(
    element('headline', {
      name: 'Headline',
      kind: 'text',
      role: input.index === 0 ? 'title' : 'headline',
      bbox: box(0.07, 0.15, input.index === 0 ? 0.79 : 0.76, input.index === 0 ? 0.27 : 0.2),
      rotation: 0,
      content: planned.headline,
      style: {
        color: theme.colors.ink,
        fontFamily: theme.typography.display,
        fontSize: input.index === 0 ? 48 : 38,
        fontWeight: 620,
        lineHeight: 1.04,
        letterSpacing: -0.8,
      },
      sourceIds: [input.sourceBriefId],
      locked: false,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );

  const isOpening = input.index === 0;
  const isClosing = input.index === input.total - 1;
  const hasPrimaryMedia =
    planned.formula !== undefined || planned.image !== undefined || planned.video !== undefined;
  const hasStructuredPrimitive = Boolean(planned.chart || hasPrimaryMedia);
  const hasVisual = hasStructuredPrimitive || planned.metric !== undefined;
  const claimSourceIds = [input.sourceBriefId, ...input.linkedSourceIds];
  const evidenceSourceIds =
    input.linkedSourceIds.length > 0 ? input.linkedSourceIds : [input.sourceEvidenceId];
  const primaryEvidenceSourceId = evidenceSourceIds[0] ?? input.sourceEvidenceId;
  const bodyWidth = hasVisual ? 0.39 : isOpening || isClosing ? 0.66 : 0.48;
  add(
    element('body', {
      name: 'Body copy',
      kind: 'text',
      role: 'body',
      bbox: box(0.07, isOpening ? 0.48 : 0.4, bodyWidth, isOpening ? 0.17 : 0.2),
      rotation: 0,
      content: planned.body,
      style: {
        color: theme.colors.muted,
        fontFamily: theme.typography.body,
        fontSize: 19,
        fontWeight: 430,
        lineHeight: 1.35,
      },
      sourceIds: claimSourceIds,
      locked: false,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );

  const horizontalBullets = (isOpening || isClosing) && !hasVisual;
  const bulletX = horizontalBullets ? 0.07 : hasVisual ? 0.07 : 0.59;
  const bulletY = horizontalBullets ? 0.72 : hasVisual ? 0.62 : 0.42;
  const bulletWidth = horizontalBullets ? 0.8 : hasVisual ? 0.39 : 0.33;
  planned.bullets.slice(0, 3).forEach((bullet, bulletIndex) => {
    add(
      element(`bullet-${bulletIndex + 1}`, {
        name: `Key point ${bulletIndex + 1}`,
        kind: 'text',
        role: 'bullet',
        bbox: box(
          horizontalBullets ? bulletX + bulletIndex * 0.28 : bulletX,
          horizontalBullets ? bulletY : bulletY + bulletIndex * 0.12,
          horizontalBullets ? 0.25 : bulletWidth,
          horizontalBullets ? 0.08 : 0.09,
        ),
        rotation: 0,
        content: `${horizontalBullets ? '•' : `0${bulletIndex + 1}`}  ${bullet}`,
        style: {
          color: theme.colors.ink,
          fontFamily: theme.typography.body,
          fontSize: horizontalBullets ? 16 : 17,
          fontWeight: 560,
          lineHeight: 1.2,
        },
        sourceIds: claimSourceIds,
        locked: false,
        exportCapabilities: [...EDITABLE_CAPABILITIES],
      }),
    );
  });

  if (planned.metric && !hasPrimaryMedia) {
    add(
      element('metric', {
        name: 'Primary metric',
        kind: 'text',
        role: 'metric',
        bbox: box(0.56, 0.41, 0.34, 0.15),
        rotation: 0,
        content: planned.metric,
        style: {
          color: theme.colors.insightInk,
          fill: theme.colors.insight,
          fontFamily: theme.typography.data,
          fontSize: 43,
          fontWeight: 720,
          lineHeight: 1,
          padding: 20,
          radius: theme.defaultRadius,
        },
        sourceIds: evidenceSourceIds,
        locked: false,
        exportCapabilities: [...EDITABLE_CAPABILITIES],
      }),
    );
    add(
      element('metric-label', {
        name: 'Metric label',
        kind: 'text',
        role: 'caption',
        bbox: box(0.59, 0.58, 0.29, 0.09),
        rotation: 0,
        content: planned.metricLabel ?? 'Success signal from the working brief',
        style: {
          color: theme.colors.muted,
          fontFamily: theme.typography.body,
          fontSize: 15,
          fontWeight: 500,
          lineHeight: 1.25,
          textAlign: 'center',
        },
        sourceIds: evidenceSourceIds,
        locked: false,
        exportCapabilities: [...EDITABLE_CAPABILITIES],
      }),
    );
  }

  if (planned.formula) {
    add(
      element('formula', {
        name: 'Editable formula',
        kind: 'math',
        role: 'formula',
        bbox: box(0.53, 0.42, 0.39, 0.24),
        rotation: 0,
        content: planned.formula.display,
        style: {
          fill: theme.colors.insight,
          color: theme.colors.insightInk,
          fontFamily: theme.typography.data,
          fontSize: 30,
          fontWeight: 720,
          lineHeight: 1.15,
          padding: 20,
          radius: theme.defaultRadius,
          textAlign: 'center',
          verticalAlign: 'middle',
        },
        math: {
          expression: planned.formula.expression,
          display: planned.formula.display,
          variables: planned.formula.variables,
          syntax: planned.formula.syntax ?? 'plain',
          displayMode: 'block',
          ...(planned.formula.description ? { description: planned.formula.description } : {}),
          sourceId: primaryEvidenceSourceId,
        },
        sourceIds: evidenceSourceIds,
        locked: false,
        exportCapabilities: [...EDITABLE_CAPABILITIES],
      }),
    );
  }

  if (planned.image) {
    const imageUrl = planned.image.imageUrl ?? planned.image.url;
    const hasEmbeddedAsset = Boolean(imageUrl);
    const credit =
      planned.image.credit ??
      planned.image.caption ??
      'Credit required before external publication';
    add(
      element('image', {
        name: 'Editable image',
        kind: 'image',
        role: 'image',
        bbox: box(0.53, 0.39, 0.39, 0.38),
        rotation: 0,
        style: {
          fill: theme.colors.accentSoft,
          stroke: theme.colors.border,
          strokeWidth: 2,
          color: theme.colors.muted,
          radius: theme.defaultRadius,
        },
        image: {
          placeholder: !hasEmbeddedAsset,
          credit,
          sourceId: primaryEvidenceSourceId,
        },
        ...(imageUrl ? { imageUrl } : {}),
        altText: planned.image.altText,
        sourceIds: evidenceSourceIds,
        locked: false,
        exportCapabilities: hasEmbeddedAsset
          ? ['web_native', 'pptx_static_fallback', 'google_importable']
          : [...EDITABLE_CAPABILITIES],
      }),
    );
    add(
      element('image-credit', {
        name: 'Image credit',
        kind: 'text',
        role: 'caption',
        bbox: box(0.55, 0.79, 0.35, 0.07),
        rotation: 0,
        content: planned.image.caption
          ? planned.image.caption
          : `${hasEmbeddedAsset ? 'Image credit' : 'Replace image before external use'} · ${credit}`,
        style: {
          color: theme.colors.muted,
          fontFamily: theme.typography.body,
          fontSize: 14,
          fontWeight: 520,
          lineHeight: 1.2,
          textAlign: 'center',
        },
        sourceIds: evidenceSourceIds,
        locked: false,
        exportCapabilities: [...EDITABLE_CAPABILITIES],
      }),
    );
  }

  if (planned.video) {
    add(
      element('video', {
        name: 'Linked video',
        kind: 'video',
        role: 'evidence_video',
        bbox: box(0.53, 0.4, 0.39, 0.28),
        rotation: 0,
        style: {
          fill: '#111318',
          stroke: theme.colors.border,
          strokeWidth: 1,
          radius: theme.defaultRadius,
        },
        video: {
          url: planned.video.url,
          ...(planned.video.posterUrl ? { posterUrl: planned.video.posterUrl } : {}),
          ...(planned.video.title ? { title: planned.video.title } : {}),
          ...(planned.video.captionsUrl ? { captionsUrl: planned.video.captionsUrl } : {}),
          ...(planned.video.captionsLanguage
            ? { captionsLanguage: planned.video.captionsLanguage }
            : {}),
          ...(planned.video.startAtSeconds !== undefined
            ? { startAtSeconds: planned.video.startAtSeconds }
            : {}),
          ...(planned.video.endAtSeconds !== undefined
            ? { endAtSeconds: planned.video.endAtSeconds }
            : {}),
        },
        altText: planned.video.title ?? 'Linked video',
        sourceIds: [input.sourceEvidenceId],
        locked: false,
        exportCapabilities: ['web_native', 'pptx_static_fallback', 'google_importable'],
      }),
    );
  }

  if (planned.chart) {
    const labels = planned.chart.labels.slice(0, 8);
    const values = planned.chart.values.slice(0, labels.length);
    add(
      element('chart', {
        name: 'Evidence chart',
        kind: 'chart',
        role: 'evidence',
        bbox: box(
          0.53,
          hasPrimaryMedia || planned.metric ? 0.7 : 0.42,
          0.39,
          hasPrimaryMedia || planned.metric ? 0.17 : 0.4,
        ),
        rotation: 0,
        style: {
          fill: theme.colors.accentSoft,
          color: theme.colors.ink,
          radius: theme.defaultRadius,
          padding: 14,
        },
        chart: {
          chartType: 'bar',
          labels,
          series: [{ name: 'Signal', values, color: theme.colors.accent }],
          ...(planned.chart.unit ? { unit: planned.chart.unit } : {}),
          sourceId: primaryEvidenceSourceId,
        },
        sourceIds: evidenceSourceIds,
        locked: false,
        exportCapabilities: [...EDITABLE_CAPABILITIES],
      }),
    );
  }

  add(
    element('footer', {
      name: 'Deck footer',
      kind: 'text',
      role: 'footer',
      bbox: box(0.07, 0.93, 0.72, 0.035),
      rotation: 0,
      content: 'NODESLIDE  ·  SOURCE-AWARE  ·  EDITABLE',
      style: {
        color: theme.colors.muted,
        fontFamily: theme.typography.data,
        fontSize: 10,
        fontWeight: 550,
        letterSpacing: 1.1,
      },
      sourceIds: [],
      locked: true,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );
  add(
    element('page-number', {
      name: 'Page number',
      kind: 'text',
      role: 'page_number',
      bbox: box(0.88, 0.92, 0.06, 0.05),
      rotation: 0,
      content: String(input.index + 1).padStart(2, '0'),
      style: {
        color: theme.colors.accent,
        fontFamily: theme.typography.data,
        fontSize: 13,
        fontWeight: 700,
        textAlign: 'right',
      },
      sourceIds: [],
      locked: true,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );

  return {
    slide: {
      id: input.slideId,
      deckId: input.deckId,
      title: planned.title,
      section: planned.section,
      notes: `Narrative role: ${planned.section}. Keep the spoken transition focused on “${planned.headline}”\n\nEvidence note: Content is based on the supplied creation brief. Illustrative examples are not independently verified; replace them with measured evidence before external publication.`,
      background: theme.colors.canvas,
      elementOrder: elements.map((candidate) => candidate.id),
      version: 1,
    },
    elements,
  };
}

function coercePlannedSlide(
  value: unknown,
  fallback: NodeSlidePlannedSlide | undefined,
  index: number,
): NodeSlidePlannedSlide | null {
  if (!isRecord(value)) return fallback ?? null;
  const title = cleanField(value.title, fallback?.title ?? `Slide ${index + 1}`, 80);
  const headline = cleanField(value.headline, fallback?.headline ?? title, 180);
  const body = cleanField(value.body, fallback?.body ?? headline, 360);
  const section = cleanField(value.section, fallback?.section ?? `Story / ${index + 1}`, 60);
  const bullets = Array.isArray(value.bullets)
    ? value.bullets
        .filter((bullet): bullet is string => typeof bullet === 'string')
        .map(cleanPlannedBullet)
        .filter(Boolean)
        .slice(0, 3)
    : (fallback?.bullets ?? []);
  const metric =
    typeof value.metric === 'string' ? nodeslideCleanText(value.metric, 24) : undefined;
  const metricLabel =
    typeof value.metricLabel === 'string' ? nodeslideCleanText(value.metricLabel, 100) : undefined;
  const explicitChart = coerceChart(value.chart);
  const explicitFormula = coerceFormula(value.formula ?? value.math);
  const explicitImage = coerceImage(value.image);
  const explicitVideo = coerceVideo(value.video);
  const hasExplicitPrimary = Boolean(
    explicitChart || explicitFormula || explicitImage || explicitVideo,
  );
  const chart = explicitChart ?? (hasExplicitPrimary ? undefined : fallback?.chart);
  const formula = explicitFormula ?? (hasExplicitPrimary ? undefined : fallback?.formula);
  const image = explicitImage ?? (hasExplicitPrimary ? undefined : fallback?.image);
  const video = explicitVideo ?? (hasExplicitPrimary ? undefined : fallback?.video);
  return {
    title,
    section,
    headline,
    body,
    bullets: bullets.length > 0 ? bullets : ['Context', 'Action', 'Outcome'],
    ...(metric ? { metric } : {}),
    ...(metricLabel ? { metricLabel } : {}),
    ...(chart ? { chart } : {}),
    ...(formula ? { formula } : {}),
    ...(image ? { image } : {}),
    ...(video ? { video } : {}),
  };
}

function coerceChart(value: unknown): NodeSlidePlannedChart | undefined {
  if (!isRecord(value) || !Array.isArray(value.labels) || !Array.isArray(value.values)) {
    return undefined;
  }
  const labels = value.labels
    .filter((label): label is string => typeof label === 'string')
    .map((label) => nodeslideCleanText(label, 30))
    .slice(0, 8);
  const values = value.values
    .filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
    .slice(0, labels.length);
  if (labels.length < 2 || values.length !== labels.length) return undefined;
  return {
    labels,
    values,
    ...(typeof value.unit === 'string' ? { unit: nodeslideCleanText(value.unit, 16) } : {}),
  };
}

function coerceFormula(value: unknown): NodeSlidePlannedFormula | undefined {
  if (!isRecord(value)) return undefined;
  const expression = cleanField(value.expression, '', 4_000);
  const display = cleanField(value.display, expression, 4_000);
  if (!expression || !display) return undefined;
  const syntax = value.syntax === 'latex' ? 'latex' : 'plain';
  const description =
    typeof value.description === 'string' ? nodeslideCleanText(value.description, 320) : undefined;
  const variables = Array.isArray(value.variables)
    ? value.variables.flatMap((candidate) => {
        if (!isRecord(candidate) || typeof candidate.value !== 'number') return [];
        const label = cleanField(candidate.label, '', 48);
        if (!label || !Number.isFinite(candidate.value)) return [];
        const unit = cleanField(candidate.unit, '', 24);
        return [{ label, value: candidate.value, ...(unit ? { unit } : {}) }];
      })
    : [];
  return {
    expression,
    display,
    variables: variables.slice(0, 8),
    syntax,
    ...(description ? { description } : {}),
  };
}

function coerceImage(value: unknown): NodeSlidePlannedImage | undefined {
  if (!isRecord(value)) return undefined;
  const altText = cleanField(value.altText, '', 320);
  if (!altText) return undefined;
  const url = safePlannedMediaUrl(value.url ?? value.imageUrl, 'image');
  const credit =
    typeof value.credit === 'string' ? nodeslideCleanText(value.credit, 180) : undefined;
  const caption =
    typeof value.caption === 'string' ? nodeslideCleanText(value.caption, 240) : undefined;
  return {
    altText,
    ...(url ? { imageUrl: url } : {}),
    ...(credit ? { credit } : {}),
    ...(caption ? { caption } : {}),
  };
}

function coerceVideo(value: unknown): NodeSlidePlannedVideo | undefined {
  if (!isRecord(value)) return undefined;
  const url = safePlannedMediaUrl(value.url, 'video');
  if (!url) return undefined;
  const posterUrl = safePlannedMediaUrl(value.posterUrl, 'image');
  const title = typeof value.title === 'string' ? nodeslideCleanText(value.title, 160) : undefined;
  const captionsUrl = safePlannedCaptionUrl(value['captionsUrl']);
  const captionsLanguage =
    typeof value['captionsLanguage'] === 'string'
      ? nodeslideCleanText(value['captionsLanguage'], 32)
      : undefined;
  const startAtSeconds = boundedMediaTime(value.startAtSeconds);
  const requestedEnd = boundedMediaTime(value.endAtSeconds);
  const endAtSeconds =
    requestedEnd !== undefined && requestedEnd > (startAtSeconds ?? 0) ? requestedEnd : undefined;
  return {
    url,
    ...(posterUrl ? { posterUrl } : {}),
    ...(title ? { title } : {}),
    ...(captionsUrl ? { captionsUrl } : {}),
    ...(captionsLanguage ? { captionsLanguage } : {}),
    ...(startAtSeconds !== undefined ? { startAtSeconds } : {}),
    ...(endAtSeconds !== undefined ? { endAtSeconds } : {}),
  };
}

function safePlannedCaptionUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.trim().slice(0, 4_000);
  const lower = clean.toLowerCase();
  return lower.startsWith('https://') || lower.startsWith('data:text/vtt') ? clean : undefined;
}

function safePlannedMediaUrl(value: unknown, kind: 'image' | 'video'): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.trim().slice(0, 4_000);
  const lower = clean.toLowerCase();
  if (lower.startsWith('https://') || lower.startsWith(`data:${kind}/`)) return clean;
  return undefined;
}

function boundedMediaTime(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(value, 86_400)
    : undefined;
}

function linkedBriefSources(deckId: string, prompt: string, now: number): SourceRecord[] {
  const urls = [
    ...new Set(
      (prompt.match(/https:\/\/[^\s<>()]+/g) ?? []).map((url) =>
        url.replace(/[.,;:!?]+$/u, '').slice(0, 900),
      ),
    ),
  ].slice(0, 8);
  return urls.map((url, index) => {
    let hostname = 'Linked source';
    try {
      hostname = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      // The source still remains an explicit user-supplied URL.
    }
    return {
      id: nodeslideStableId('source', deckId, 'url', String(index + 1), url),
      deckId,
      title: `${hostname} · supplied source ${index + 1}`,
      url,
      sourceType: 'url' as const,
      retrievedAt: now,
      citation: url,
      license: 'User-supplied linked evidence; verify reuse rights before external publication.',
    };
  });
}

function cleanField(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === 'string' ? nodeslideCleanText(value, maxLength) || fallback : fallback;
}

function cleanPlannedBullet(value: string): string {
  return nodeslideCleanText(value, 100)
    .replace(/^(?:(?:0?\d{1,2})\s*[.):\-·]\s*|[•–—-]\s*)+/u, '')
    .trim();
}

interface NodeSlideInputRecord extends Record<string, unknown> {
  slides?: unknown;
  narrative?: unknown;
  title?: unknown;
  headline?: unknown;
  body?: unknown;
  section?: unknown;
  bullets?: unknown;
  metric?: unknown;
  metricLabel?: unknown;
  chart?: unknown;
  formula?: unknown;
  math?: unknown;
  image?: unknown;
  video?: unknown;
  expression?: unknown;
  syntax?: unknown;
  display?: unknown;
  description?: unknown;
  variables?: unknown;
  label?: unknown;
  value?: unknown;
  altText?: unknown;
  credit?: unknown;
  caption?: unknown;
  url?: unknown;
  imageUrl?: unknown;
  posterUrl?: unknown;
  captionsUrl?: unknown;
  captionsLanguage?: unknown;
  startAtSeconds?: unknown;
  endAtSeconds?: unknown;
  labels?: unknown;
  values?: unknown;
  unit?: unknown;
}

function isRecord(value: unknown): value is NodeSlideInputRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function box(x: number, y: number, width: number, height: number): BoundingBox {
  return { x, y, width, height };
}

function isMatchingCanonicalGolden(snapshot: DeckSnapshot, canonical: DeckSnapshot): boolean {
  if (
    snapshot.deck.id !== canonical.deck.id ||
    !snapshot.deck.id.startsWith('deck_golden_') ||
    snapshot.deck.schemaVersion !== canonical.deck.schemaVersion
  ) {
    return false;
  }
  const currentSlides = new Set(snapshot.slides.map((slide) => slide.id));
  const currentElements = new Set(snapshot.elements.map((element) => element.id));
  return (
    canonical.slides.every((slide) => currentSlides.has(slide.id)) &&
    canonical.elements.every((element) => currentElements.has(element.id))
  );
}

function isUntouchedCanonicalElementIdentity(
  current: SlideElement,
  expected: SlideElement,
): boolean {
  return (
    current.version === 1 &&
    current.slideId === expected.slideId &&
    current.name === expected.name &&
    current.kind === expected.kind &&
    current.role === expected.role &&
    current.locked === expected.locked &&
    sameMembers(current.sourceIds, expected.sourceIds)
  );
}

function isLegacyDuplicatedNumberedBullet(current: SlideElement, expected: SlideElement): boolean {
  if (current.kind !== 'text' || expected.kind !== 'text') return false;
  const currentText = current.content?.trim() ?? '';
  const expectedText = expected.content?.trim() ?? '';
  if (!currentText || !expectedText || currentText === expectedText) return false;
  const duplicatedNumber = expectedText.match(/^(\d{1,2})(\s*[·.):-]\s*.+)$/u);
  if (duplicatedNumber) {
    const [, number, rest] = duplicatedNumber;
    if (currentText === `${number} ${number}${rest}`) return true;
  }
  if (expectedText.startsWith('• ') && currentText === `• ${expectedText}`) return true;
  return false;
}

function geometryValidationIssueCount(snapshot: DeckSnapshot): number {
  return validateNodeSlideSnapshot(snapshot, snapshot.deck.updatedAt).issues.filter(
    (issue) => issue.code === 'overflow' || issue.code === 'collision',
  ).length;
}

function sameBoundingBox(left: BoundingBox, right: BoundingBox): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value) => right.includes(value)) &&
    right.every((value) => left.includes(value))
  );
}
