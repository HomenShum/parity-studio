import {
  type AuthoredTastePackDefinition,
  createAuthoredTastePack,
  stableSerializeTastePack,
} from './encoding';

const DUARTE_LICENSE =
  'No permissive content license identified; citation and idea-level paraphrase only. Do not reproduce source prose, images, diagrams, templates, course materials, trade dress, or marks; no affiliation or endorsement.';

const startupNarrativeDefinition = {
  id: 'startup-narrative',
  name: 'Startup narrative',
  colors: [
    {
      key: 'canvas',
      hex: '#FFFFFF',
      description: 'Primary light canvas and inverse text.',
    },
    {
      key: 'canvas-alt',
      hex: '#F4F7FB',
      description: 'Quiet section or card surface.',
    },
    {
      key: 'ink',
      hex: '#111827',
      description: 'Primary text and dark marks.',
    },
    {
      key: 'muted',
      hex: '#475569',
      description: 'Secondary text that remains readable as body copy.',
    },
    {
      key: 'accent',
      hex: '#0057B8',
      description: 'Primary emphasis and action fill.',
    },
    {
      key: 'accent-soft',
      hex: '#DCEBFA',
      description: 'Low-emphasis callout surface.',
    },
    {
      key: 'insight',
      hex: '#F7C948',
      description: 'Highlight surface, never a text color on white.',
    },
    {
      key: 'insight-ink',
      hex: '#2A1B00',
      description: 'Text and marks on the insight surface.',
    },
    {
      key: 'current',
      hex: '#5B4B8A',
      description: 'Current-state marker without implying that current means failure.',
    },
    {
      key: 'future',
      hex: '#0F766E',
      description: 'Possible-future or progress marker.',
    },
    {
      key: 'border',
      hex: '#64748B',
      description: 'Essential dividers and object boundaries.',
    },
    {
      key: 'inverse-canvas',
      hex: '#0B1020',
      description: 'Optional dark cover or closing canvas.',
    },
    {
      key: 'inverse-ink',
      hex: '#FFFFFF',
      description: 'Text on approved dark fills.',
    },
  ],
  fontFamilies: [
    {
      key: 'display',
      families: ['Aptos Display', 'Aptos', 'Segoe UI', 'Arial', 'sans-serif'],
      description: 'Local display fallback stack for titles and large takeaway statements.',
    },
    {
      key: 'body',
      families: ['Aptos', 'Segoe UI', 'Arial', 'sans-serif'],
      description: 'Local body fallback stack for explanation, labels, and annotations.',
    },
    {
      key: 'data',
      families: ['Aptos Mono', 'Cascadia Mono', 'Consolas', 'Courier New', 'monospace'],
      description: 'Local monospace fallback stack for aligned figures and technical labels.',
    },
  ],
  fontSizes: [
    {
      key: 'hero',
      pixels: 64,
      description: 'Cover claim or singular close, equivalent to 48 presentation points.',
    },
    {
      key: 'title',
      pixels: 48,
      description: 'Slide title, equivalent to 36 presentation points.',
    },
    {
      key: 'takeaway',
      pixels: 36,
      description: 'Dominant evidence-backed takeaway, equivalent to 27 presentation points.',
    },
    {
      key: 'body',
      pixels: 24,
      description: 'Main explanatory text, equivalent to 18 presentation points.',
    },
    {
      key: 'label',
      pixels: 20,
      description: 'Smallest non-footer text, equivalent to 15 presentation points.',
    },
    {
      key: 'footer',
      pixels: 16,
      description: 'Source, footer, and page-number roles only, equivalent to 12 points.',
    },
  ],
  colorPriority: [
    'canvas',
    'canvas-alt',
    'ink',
    'muted',
    'accent',
    'accent-soft',
    'insight',
    'insight-ink',
    'current',
    'future',
    'border',
    'inverse-canvas',
    'inverse-ink',
  ],
  fontFamilyPriority: ['display', 'body', 'data'],
  fontSizePriority: ['hero', 'title', 'takeaway', 'body', 'label', 'footer'],
  layout: {
    widthInches: 13.333333,
    heightInches: 7.5,
    density: 'sparse',
    safeAreaInches: {
      top: 0.5,
      right: 0.67,
      bottom: 0.5,
      left: 0.67,
    },
    targets: {
      minimumNonFooterFontPoints: 15,
      maximumForegroundElements: 12,
      maximumFocalVisuals: 1,
      maximumSupportingGroups: 2,
      minimumWhitespaceFraction: 0.3,
    },
    guardrails: [
      'Require audience, current state, desired state, stakes, and ask inputs or report a bounded narrative-incomplete warning.',
      'Give each substantive slide one evidence-backed takeaway of at most twelve words; split independent claims.',
      'Use explicit Current and Possible labels plus position or shape differences; color is only a redundant cue.',
      'Default to one focal visual and at most two supporting groups; split instead of shrinking past the type floor.',
      'Keep at least thirty percent whitespace outside foreground bounds on non-full-bleed slides.',
      'Put a supplied verb-plus-object ask on the final substantive slide; never invent owner or timing.',
      'Repair overflow by removing decoration, shortening or splitting content, and then restoring whitespace.',
    ],
  },
  rules: [
    {
      id: 'startup.audience-centered-arc',
      title: 'Center the audience transformation',
      behavior:
        'Frame the audience as the main actor and organize the narrative around the change they need rather than around the presenter, company, or product.',
      citations: [
        {
          title: "Center the audience's transformation",
          url: 'https://www.duarte.com/blog/presentation-storytelling-audience-is-hero/',
          supports:
            'Frame the audience, rather than the speaker, company, or product, as the main actor; focus the message on what the audience needs and the change in what they think, feel, believe, or do.',
          license: DUARTE_LICENSE,
        },
      ],
    },
    {
      id: 'startup.single-takeaway',
      title: 'Keep one takeaway per slide',
      behavior:
        'Give each substantive slide one evidence-backed takeaway and split the slide when two independent claims remain.',
      citations: [
        {
          title: 'Keep one clear takeaway per slide',
          url: 'https://www.duarte.com/blog/presenting/',
          supports:
            'Limit a slide to one main idea so the visual supports the spoken message instead of competing with it.',
          license: DUARTE_LICENSE,
        },
      ],
    },
    {
      id: 'startup.current-future-contrast',
      title: 'Contrast current reality with a possible future',
      behavior:
        'Move from shared current context through credible evidence toward a possible future without copying a proprietary story diagram or pitch-deck sequence.',
      citations: [
        {
          title: 'Contrast current reality with a possible future',
          url: 'https://www.duarte.com/blog/move-presentation-audience-with-story-techniques-in-presentations/',
          supports:
            "Establish a shared current reality, introduce a credible possible future, and keep presentation content aligned to the audience's intended transformation.",
          license: DUARTE_LICENSE,
        },
      ],
    },
    {
      id: 'startup.purposeful-simplicity',
      title: 'Make each visual element earn its place',
      behavior:
        'Use design to carry meaning, remove non-meaningful decoration, and keep the slide only as complex as its message requires.',
      citations: [
        {
          title: 'Make every visual element earn its place',
          url: 'https://www.duarte.com/blog/presenting/',
          supports:
            'Use design to carry meaning, not as decoration; remove superfluous details and keep the slide as simple as the message allows.',
          license: DUARTE_LICENSE,
        },
      ],
    },
    {
      id: 'startup.whitespace-for-focus',
      title: 'Preserve whitespace for focus',
      behavior:
        'Reserve open space around the essential message and split cluttered content instead of shrinking it.',
      citations: [
        {
          title: 'Preserve whitespace for focus',
          url: 'https://www.duarte.com/blog/techniques-for-using-critique-language-for-more-powerful-and-effective-presentations/',
          supports:
            'Use open space to direct focus; when a slide feels cluttered, reduce or split its content so the essential message remains clear.',
          license: DUARTE_LICENSE,
        },
      ],
    },
    {
      id: 'startup.decisive-next-action',
      title: 'End with a clear next action',
      behavior:
        'Close with a supplied verb-plus-object ask and add an owner or timing only when the brief provides them.',
      citations: [
        {
          title: 'End with a clear next action',
          url: 'https://www.duarte.com/blog/audience-engagement-strategies-presentations/',
          supports:
            'At the end, state clearly what the audience can do to move from the current state toward the possible future, using concrete tasks.',
          license: DUARTE_LICENSE,
        },
      ],
    },
  ],
  nonAffiliation: {
    statement:
      'The NodeSlide Startup narrative taste pack is independently authored and is not affiliated with, approved by, certified by, sponsored by, or endorsed by Duarte, Inc., the Design Tokens Community Group, or W3C. It does not reproduce their prose, diagrams, templates, course materials, trade dress, or marks.',
    organizations: ['Duarte, Inc.', 'Design Tokens Community Group', 'W3C'],
    prohibitedClaims: [
      'Duarte style',
      'Duarte method',
      'Duarte approved',
      'Duarte certified',
      'DTCG endorsed',
      'W3C endorsed',
    ],
  },
  approvedContrastPairs: [
    { foreground: 'ink', background: 'canvas', minimumRatio: 4.5, usage: 'text' },
    { foreground: 'ink', background: 'canvas-alt', minimumRatio: 4.5, usage: 'text' },
    { foreground: 'muted', background: 'canvas', minimumRatio: 4.5, usage: 'text' },
    { foreground: 'canvas', background: 'accent', minimumRatio: 4.5, usage: 'text' },
    { foreground: 'ink', background: 'accent-soft', minimumRatio: 4.5, usage: 'text' },
    { foreground: 'insight-ink', background: 'insight', minimumRatio: 4.5, usage: 'text' },
    { foreground: 'canvas', background: 'current', minimumRatio: 4.5, usage: 'text' },
    { foreground: 'canvas', background: 'future', minimumRatio: 4.5, usage: 'text' },
    { foreground: 'border', background: 'canvas', minimumRatio: 3, usage: 'non_text' },
    {
      foreground: 'inverse-ink',
      background: 'inverse-canvas',
      minimumRatio: 4.5,
      usage: 'text',
    },
  ],
} satisfies AuthoredTastePackDefinition;

export const startupNarrativeTastePack = createAuthoredTastePack(startupNarrativeDefinition);
export const startupNarrativeTastePackJson = stableSerializeTastePack(startupNarrativeTastePack);
