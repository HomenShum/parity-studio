import {
  type AuthoredTastePackDefinition,
  createAuthoredTastePack,
  stableSerializeTastePack,
} from './encoding';

const IBCS_PDF =
  'https://www.ibcs.com/wp-content/uploads/2026/07/IBCS_v2_final_2026-07-02_jf-with-ad.pdf' as const;
const FT_VISUAL_VOCABULARY =
  'https://github.com/Financial-Times/chart-doctor/blob/f54ecfd57b9450aad86bdbcbd19a26b0405375ce/visual-vocabulary/README.md' as const;
const IBCS_LICENSE = 'CC BY-SA 4.0; paraphrased with attribution';
const FT_LICENSE = 'FT content; all rights reserved; short paraphrase and link only';

const financeIbcsDefinition = {
  id: 'finance-ibcs',
  name: 'Finance reporting',
  colors: [
    {
      key: 'canvas',
      hex: '#FFFFFF',
      description: 'Default slide and chart background.',
    },
    {
      key: 'ink',
      hex: '#171A1F',
      description: 'Primary text, labels, and axes.',
    },
    {
      key: 'muted',
      hex: '#4B5563',
      description: 'Reporting context, source notes, and secondary labels.',
    },
    {
      key: 'accent',
      hex: '#005EA8',
      description: 'One focal series, selected value, or neutral reference.',
    },
    {
      key: 'accent-soft',
      hex: '#DCEBFA',
      description: 'Small analytical callout surface, not a decorative full-slide fill.',
    },
    {
      key: 'border',
      hex: '#8A94A3',
      description: 'Essential dividers and focus boundaries.',
    },
    {
      key: 'data-neutral',
      hex: '#334155',
      description: 'Default comparison series.',
    },
    {
      key: 'data-positive',
      hex: '#006B5E',
      description: 'Desirable business impact only.',
    },
    {
      key: 'data-negative',
      hex: '#A4262C',
      description: 'Undesirable business impact only.',
    },
    {
      key: 'data-comparison',
      hex: '#65418A',
      description: 'Secondary named comparison when neutral plus accent is insufficient.',
    },
    {
      key: 'data-caution',
      hex: '#7A4F00',
      description: 'Explicit caution state, never decoration.',
    },
  ],
  fontFamilies: [
    {
      key: 'display',
      families: ['Arial', 'Helvetica Neue', 'Helvetica', 'Liberation Sans', 'sans-serif'],
      description: 'System-safe reporting headline fallback stack; no font is downloaded.',
    },
    {
      key: 'body',
      families: ['Arial', 'Helvetica Neue', 'Helvetica', 'Liberation Sans', 'sans-serif'],
      description: 'System-safe reporting body fallback stack; no font is downloaded.',
    },
    {
      key: 'data',
      families: ['Arial', 'Helvetica Neue', 'Helvetica', 'Liberation Sans', 'sans-serif'],
      description: 'System-safe chart and tabular-label fallback stack; no font is downloaded.',
    },
  ],
  fontSizes: [
    {
      key: 'title',
      pixels: 48,
      description: 'Message line, equivalent to 36 presentation points.',
    },
    {
      key: 'context',
      pixels: 28,
      description: 'Reporting context line, equivalent to 21 presentation points.',
    },
    {
      key: 'body',
      pixels: 24,
      description: 'Main explanatory text, equivalent to 18 presentation points.',
    },
    {
      key: 'data-label',
      pixels: 20,
      description: 'Chart and table label, equivalent to 15 presentation points.',
    },
    {
      key: 'caption',
      pixels: 20,
      description: 'Source and caption text, equivalent to 15 presentation points.',
    },
  ],
  colorPriority: [
    'canvas',
    'ink',
    'muted',
    'accent',
    'accent-soft',
    'border',
    'data-neutral',
    'data-positive',
    'data-negative',
    'data-comparison',
    'data-caution',
  ],
  fontFamilyPriority: ['display', 'body', 'data'],
  fontSizePriority: ['title', 'context', 'body', 'data-label', 'caption'],
  layout: {
    widthInches: 13.333333,
    heightInches: 7.5,
    density: 'dense',
    targets: {
      minimumNonFooterFontPoints: 15,
      maximumFocalAccents: 1,
      maximumSmallMultiples: 4,
    },
    guardrails: [
      'Lead with one message line and keep unit, measure, period, and scenario in separate context.',
      'Use one primary analytical view or two to four same-unit small multiples with shared scaling.',
      'Prefer direct labels; use a legend only when direct labels collide with or obscure the data.',
      'Never encode meaning by hue alone; add a label, sign, marker, pattern, or textual status.',
      'Start magnitude bars and columns at zero; disclose any indexed or cropped exception.',
      'Use equal scales for same-unit charts on one slide or visibly disclose the difference.',
      'Remove pseudo-3D, decorative shadows, patterned backgrounds, and ornamental transitions.',
      'Retain whitespace that clarifies the message, labels, and groups despite the dense intent.',
    ],
  },
  rules: [
    {
      id: 'finance.message-first',
      title: 'Lead with the analytical message',
      behavior:
        'Lead each analytical slide with one clear takeaway and keep reporting unit, measure, period, and scenario in a separate context line.',
      citations: [
        {
          title: 'IBCS Standards 2.0 - SA 3.2 and UN 2.1-2.2',
          url: IBCS_PDF,
          supports:
            'Supports presenting a clear key message before its evidence, keeping message placement consistent, and keeping descriptive reporting context distinct from evaluation.',
          license: IBCS_LICENSE,
        },
      ],
    },
    {
      id: 'finance.semantic-consistency',
      title: 'Keep business meanings visually consistent',
      behavior:
        'Map each business meaning to a stable visual role across slides; do not reuse one treatment for unrelated meanings.',
      citations: [
        {
          title: 'IBCS Standards 2.0 - UNIFY',
          url: IBCS_PDF,
          supports:
            'Supports using the same visual representation for the same business meaning throughout a reporting system.',
          license: IBCS_LICENSE,
        },
      ],
    },
    {
      id: 'finance.no-decoration',
      title: 'Remove decoration without analytical meaning',
      behavior:
        'Use a neutral canvas, flat marks, legible type, and color only for an explicit analytical role.',
      citations: [
        {
          title: 'IBCS Standards 2.0 - SI 1-3',
          url: IBCS_PDF,
          supports:
            'Supports removing non-semantic backgrounds, effects, colors, and decorative type so that data and labels carry the communication.',
          license: IBCS_LICENSE,
        },
      ],
    },
    {
      id: 'finance.dense-but-legible',
      title: 'Keep reporting compact and legible',
      behavior:
        'Reduce wasted margins and oversized components without shrinking below the authored type floor or removing useful whitespace.',
      citations: [
        {
          title: 'IBCS Standards 2.0 - CO 1-2',
          url: IBCS_PDF,
          supports:
            'Supports compact, legible visuals and better use of space while retaining whitespace that improves clarity and structure.',
          license: IBCS_LICENSE,
        },
      ],
    },
    {
      id: 'finance.direct-labels',
      title: 'Label data where it is read',
      behavior:
        'Place series labels next to marks or line ends when feasible and retain legends or reference furniture when direct labels would reduce comprehension.',
      citations: [
        {
          title: 'IBCS Standards 2.0 - UN 2.3 and SI 3.1',
          url: IBCS_PDF,
          supports:
            'Supports integrating series identification into charts and using data labels to reduce external legends and redundant reference furniture when comprehension is preserved.',
          license: IBCS_LICENSE,
        },
      ],
    },
    {
      id: 'finance.integrity-axes-scales',
      title: 'Preserve axis and scale integrity',
      behavior:
        'Start magnitude bars and columns at zero, share scales for same-unit comparisons, and expose any allowed indexed or scale exception.',
      citations: [
        {
          title: 'IBCS Standards 2.0 - CH 1.1 and CH 4.1',
          url: IBCS_PDF,
          supports:
            'Supports a general zero-baseline rule, a disclosed indexed-data exception, and identical scales for same-unit charts on one page unless a scale difference is clearly marked.',
          license: IBCS_LICENSE,
        },
        {
          title: 'Financial Times Visual Vocabulary - Magnitude',
          url: `${FT_VISUAL_VOCABULARY}#magnitude`,
          supports:
            'Supports zero-based standard bars and columns when the analytical task is comparing magnitude.',
          license: FT_LICENSE,
        },
      ],
    },
    {
      id: 'finance.time-horizontal',
      title: 'Show time from left to right',
      behavior:
        'Place time on the horizontal axis in left-to-right order; default to a line for continuous change and consider columns for one discrete series.',
      citations: [
        {
          title: 'IBCS Standards 2.0 - UN 3.3',
          url: IBCS_PDF,
          supports:
            'Supports horizontal left-to-right presentation of time in charts and tabular columns.',
          license: IBCS_LICENSE,
        },
        {
          title: 'Financial Times Visual Vocabulary - Change over Time',
          url: `${FT_VISUAL_VOCABULARY}#change-over-time`,
          supports:
            'Supports line charts as the default for changing time series, with columns useful mainly for a single series and with period context chosen deliberately.',
          license: FT_LICENSE,
        },
      ],
    },
    {
      id: 'finance.structure-vertical',
      title: 'Put structural categories on a vertical axis',
      behavior:
        'Use a vertical category axis and horizontal bars for non-time structures, especially when labels are long, unless the scale type calls for a documented exception.',
      citations: [
        {
          title: 'IBCS Standards 2.0 - UN 3.4',
          url: IBCS_PDF,
          supports:
            'Supports vertical category axes for structural dimensions in the general case, with explicit exceptions for other scale types.',
          license: IBCS_LICENSE,
        },
        {
          title: 'Financial Times Visual Vocabulary - Magnitude',
          url: `${FT_VISUAL_VOCABULARY}#magnitude`,
          supports:
            'Supports horizontal bars for non-time magnitude comparisons and long category labels.',
          license: FT_LICENSE,
        },
      ],
    },
    {
      id: 'finance.highlight-with-purpose',
      title: 'Highlight only with analytical purpose',
      behavior:
        'Emphasize the evidence for the key message, reserve semantic colors for their named meanings, and keep other series neutral.',
      citations: [
        {
          title: 'IBCS Standards 2.0 - UN 5.1 and SA 4.3',
          url: IBCS_PDF,
          supports:
            'Supports consistent markers that connect selected values, differences, trends, or references to the key message and defined business meaning.',
          license: IBCS_LICENSE,
        },
      ],
    },
    {
      id: 'finance.chart-by-question',
      title: 'Choose the chart from the analytical question',
      behavior:
        'Choose a chart family from the data relationship before applying visual tokens rather than using one chart type universally.',
      citations: [
        {
          title: 'Financial Times Visual Vocabulary',
          url: FT_VISUAL_VOCABULARY,
          supports:
            'Supports selecting chart symbology according to the relationship or question in the data rather than applying one chart type universally.',
          license: FT_LICENSE,
        },
      ],
    },
  ],
  nonAffiliation: {
    statement:
      'The NodeSlide Finance reporting taste pack is independently authored and is not affiliated with, endorsed by, certified by, or approved by the IBCS Association, IBCS Institute, Financial Times, DTCG, W3C, or ISO. It does not reproduce their templates, brand identity, or proprietary assets.',
    organizations: [
      'IBCS Association',
      'IBCS Institute',
      'Financial Times',
      'Design Tokens Community Group',
      'W3C',
      'ISO',
    ],
    prohibitedClaims: [
      'IBCS certified',
      'IBCS compliant',
      'IBCS style',
      'FT style',
      'FT approved',
      'ISO 24896 conformant',
    ],
  },
  approvedContrastPairs: [
    { foreground: 'ink', background: 'canvas', minimumRatio: 4.5, usage: 'text' },
    { foreground: 'muted', background: 'canvas', minimumRatio: 4.5, usage: 'text' },
    { foreground: 'accent', background: 'canvas', minimumRatio: 4.5, usage: 'text' },
    { foreground: 'canvas', background: 'accent', minimumRatio: 4.5, usage: 'text' },
    { foreground: 'ink', background: 'accent-soft', minimumRatio: 4.5, usage: 'text' },
    { foreground: 'muted', background: 'accent-soft', minimumRatio: 4.5, usage: 'text' },
    { foreground: 'accent', background: 'accent-soft', minimumRatio: 4.5, usage: 'text' },
    { foreground: 'border', background: 'canvas', minimumRatio: 3, usage: 'non_text' },
    { foreground: 'data-neutral', background: 'canvas', minimumRatio: 4.5, usage: 'text' },
    { foreground: 'data-positive', background: 'canvas', minimumRatio: 4.5, usage: 'text' },
    { foreground: 'data-negative', background: 'canvas', minimumRatio: 4.5, usage: 'text' },
    {
      foreground: 'data-comparison',
      background: 'canvas',
      minimumRatio: 4.5,
      usage: 'text',
    },
    { foreground: 'data-caution', background: 'canvas', minimumRatio: 4.5, usage: 'text' },
  ],
} satisfies AuthoredTastePackDefinition;

export const financeIbcsTastePack = createAuthoredTastePack(financeIbcsDefinition);
export const financeIbcsTastePackJson = stableSerializeTastePack(financeIbcsTastePack);
