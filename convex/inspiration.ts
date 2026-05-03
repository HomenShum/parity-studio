import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';

type MediaPreference = 'auto' | 'images' | 'videos' | 'mixed';
type MediaType = 'image' | 'video' | 'website' | 'case-study';

interface ReferenceSeed {
  id: string;
  product: string;
  title: string;
  sourceUrl: string;
  mediaType: MediaType;
  thumbnailTone: 'dark' | 'slate' | 'warm' | 'cream' | 'mist' | 'blue' | 'graphite';
  tags: string[];
  patterns: string[];
  useFor: string;
  avoid: string;
  confidence: 'high' | 'medium' | 'low';
  licenseNote: string;
}

interface InspirationPlanItem {
  title: string;
  rationale: string;
  impact: 'High' | 'Medium' | 'Low';
  sourceReferenceIds: string[];
}

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'app',
  'as',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'or',
  'page',
  'screen',
  'the',
  'to',
  'ui',
  'with',
]);

const CURATED_REFERENCES: ReferenceSeed[] = [
  {
    id: 'superhuman-inbox',
    product: 'Superhuman',
    title: 'Inbox zero triage and command density',
    sourceUrl: 'https://superhuman.com/',
    mediaType: 'case-study',
    thumbnailTone: 'dark',
    tags: ['inbox', 'email', 'triage', 'list', 'productivity', 'keyboard', 'density'],
    patterns: [
      'single dominant list',
      'fast triage states',
      'keyboard-first actions',
      'minimal card chrome',
    ],
    useFor: 'turning dense activity into one scannable list with a clear active item',
    avoid: 'copying brand colors, proprietary icons, or exact email-client layout',
    confidence: 'high',
    licenseNote: 'Inspiration only; use patterns, not visual copying.',
  },
  {
    id: 'linear-issues',
    product: 'Linear',
    title: 'List plus inspector product operating system',
    sourceUrl: 'https://linear.app/',
    mediaType: 'case-study',
    thumbnailTone: 'slate',
    tags: [
      'issues',
      'tasks',
      'dashboard',
      'developer',
      'list',
      'inspector',
      'performance',
      'workflow',
    ],
    patterns: [
      'dense list rows',
      'one selected inspector',
      'command-first navigation',
      'low-latency interaction model',
    ],
    useFor: 'making complex work feel organized without dashboard-card clutter',
    avoid: 'recreating Linear-specific visual identity or iconography',
    confidence: 'high',
    licenseNote: 'Inspiration only; preserve provenance and transform the pattern.',
  },
  {
    id: 'sunsama-planning',
    product: 'Sunsama',
    title: 'Guided daily planning sequence',
    sourceUrl: 'https://www.sunsama.com/',
    mediaType: 'case-study',
    thumbnailTone: 'warm',
    tags: ['planning', 'daily', 'tasks', 'calendar', 'calm', 'non-designer', 'coach'],
    patterns: [
      'finite planning steps',
      'calm visual pacing',
      'explicit done state',
      'gentle prioritization',
    ],
    useFor: 'helping non-technical users understand what to do next without reading docs',
    avoid: 'copying illustrations, exact copy, or onboarding choreography',
    confidence: 'high',
    licenseNote: 'Pattern-level reference only.',
  },
  {
    id: 'notion-calendar',
    product: 'Notion Calendar',
    title: 'Calendar as the primary canvas',
    sourceUrl: 'https://www.notion.com/product/calendar',
    mediaType: 'case-study',
    thumbnailTone: 'cream',
    tags: ['calendar', 'planning', 'time', 'canvas', 'schedule', 'grid', 'focus'],
    patterns: [
      'calendar-dominant canvas',
      'quiet supporting rails',
      'time-block clarity',
      'low-friction event details',
    ],
    useFor: 'making scheduling and time-oriented workflows feel spatial and obvious',
    avoid: 'copying Notion brand treatment or exact calendar visuals',
    confidence: 'high',
    licenseNote: 'Inspiration only; implement original styling.',
  },
  {
    id: 'chatgpt-pulse',
    product: 'ChatGPT Pulse',
    title: 'Finite AI-curated brief cards',
    sourceUrl: 'https://openai.com/',
    mediaType: 'case-study',
    thumbnailTone: 'mist',
    tags: ['ai', 'agent', 'brief', 'cards', 'summary', 'personalized', 'coach', 'non-designer'],
    patterns: [
      'finite curated cards',
      'plain-language summaries',
      'personalized context',
      'clear next-action framing',
    ],
    useFor: 'explaining agent work in language that a beginner can act on',
    avoid: 'claiming identical product behavior or copying branded assets',
    confidence: 'medium',
    licenseNote: 'Use as interaction inspiration, not as a source asset.',
  },
  {
    id: 'figma-comments',
    product: 'Figma',
    title: 'Pinned comments and collaborative canvas review',
    sourceUrl: 'https://www.figma.com/',
    mediaType: 'case-study',
    thumbnailTone: 'blue',
    tags: ['design', 'comments', 'canvas', 'collaboration', 'bbox', 'review', 'iteration'],
    patterns: [
      'pin comments to visible regions',
      'show thread context near the canvas',
      'keep canvas primary',
      'resolve states',
    ],
    useFor: 'making bbox comments meaningful and visibly tied to the design surface',
    avoid: 'copying Figma UI chrome or comment styling exactly',
    confidence: 'high',
    licenseNote: 'Reference collaboration pattern only.',
  },
  {
    id: 'vercel-v0',
    product: 'v0',
    title: 'Prompt-to-interface generation with preview-first iteration',
    sourceUrl: 'https://v0.dev/',
    mediaType: 'case-study',
    thumbnailTone: 'graphite',
    tags: ['ai', 'generation', 'preview', 'code', 'prompt', 'iteration', 'developer'],
    patterns: [
      'chat and preview stay coupled',
      'fast regenerate loop',
      'code handoff clarity',
      'versioned outcomes',
    ],
    useFor: 'connecting prompt, generated UI, and code artifacts in one understandable loop',
    avoid: 'copying v0 product chrome or output claims',
    confidence: 'medium',
    licenseNote: 'Workflow inspiration only.',
  },
  {
    id: 'ableton-product-page',
    product: 'Ableton',
    title: 'Editorial product landing page with strong hero rhythm',
    sourceUrl: 'https://www.ableton.com/',
    mediaType: 'website',
    thumbnailTone: 'dark',
    tags: ['music', 'landing', 'hero', 'navigation', 'media', 'product', 'cta', 'editorial'],
    patterns: [
      'large editorial hero',
      'confident navigation',
      'strong primary CTA',
      'media-led product storytelling',
    ],
    useFor:
      'matching a music-product landing page with real header, hero, CTA, and responsive sections',
    avoid: 'copying Ableton marks, screenshots, product claims, or copyrighted media',
    confidence: 'high',
    licenseNote: 'Use only as source/inspiration if the user provided or requested this target.',
  },
  {
    id: 'stripe-docs',
    product: 'Stripe Docs',
    title: 'Developer documentation with task-first IA',
    sourceUrl: 'https://docs.stripe.com/',
    mediaType: 'website',
    thumbnailTone: 'blue',
    tags: ['docs', 'developer', 'api', 'navigation', 'code', 'ia', 'search'],
    patterns: [
      'task-first navigation',
      'clear code/content split',
      'sticky context',
      'progressive disclosure',
    ],
    useFor: 'making technical workflows approachable without hiding important detail',
    avoid: 'copying Stripe colors, icons, or proprietary docs layout',
    confidence: 'high',
    licenseNote: 'Pattern-level reference only.',
  },
];

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((part) => part.trim())
    .filter((part) => part.length > 1 && !STOPWORDS.has(part));
}

function safeText(value: string | undefined, fallback: string, cap = 240): string {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  if (!trimmed) return fallback;
  return trimmed.length > cap ? `${trimmed.slice(0, cap - 3)}...` : trimmed;
}

function inferTags(input: {
  query: string;
  prompt?: string;
  title?: string;
  files: Record<string, string>;
  paritySummary?: string;
}): string[] {
  const text =
    `${input.query} ${input.prompt ?? ''} ${input.title ?? ''} ${Object.keys(input.files).join(' ')} ${input.paritySummary ?? ''}`.toLowerCase();
  const tags = new Set<string>();
  const rules: Array<[string, string[]]> = [
    ['inbox', ['inbox', 'email', 'mail', 'triage']],
    ['calendar', ['calendar', 'schedule', 'time', 'event']],
    ['dashboard', ['dashboard', 'metrics', 'analytics', 'cards']],
    ['agent', ['agent', 'chat', 'ai', 'generation', 'prompt']],
    ['design', ['design', 'canvas', 'comment', 'bbox', 'figma']],
    ['music', ['ableton', 'music', 'audio', 'song', 'live']],
    ['developer', ['code', 'api', 'docs', 'developer', 'mcp']],
    ['landing', ['landing', 'hero', 'cta', 'marketing', 'website']],
    ['non-designer', ['beginner', 'student', 'non technical', 'non-technical', 'foolproof']],
  ];
  for (const [tag, needles] of rules) {
    if (needles.some((needle) => text.includes(needle))) tags.add(tag);
  }
  for (const token of tokenize(text).slice(0, 12)) tags.add(token);
  return Array.from(tags).slice(0, 12);
}

function scoreReference(
  reference: ReferenceSeed,
  tokens: string[],
  tags: string[],
  mediaPreference: MediaPreference,
): number {
  const haystack =
    `${reference.product} ${reference.title} ${reference.tags.join(' ')} ${reference.patterns.join(' ')}`.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 2;
  }
  for (const tag of tags) {
    if (reference.tags.includes(tag)) score += 5;
  }
  if (mediaPreference === 'videos' && reference.mediaType === 'video') score += 4;
  if (
    mediaPreference === 'images' &&
    (reference.mediaType === 'image' || reference.mediaType === 'website')
  )
    score += 3;
  if (mediaPreference === 'mixed' && reference.mediaType !== 'case-study') score += 2;
  if (reference.confidence === 'high') score += 1;
  return score;
}

function hostnameFromUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'user reference';
  }
}

function inferMediaType(rawUrl: string): MediaType {
  const lower = rawUrl.toLowerCase().split('?')[0] ?? rawUrl.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|svg)$/.test(lower)) return 'image';
  if (/\.(mp4|webm|mov|m4v)$/.test(lower)) return 'video';
  return 'website';
}

function userReferenceFromUrl(rawUrl: string, index: number): ReferenceSeed {
  const trimmed = rawUrl.trim();
  const host = hostnameFromUrl(trimmed);
  const mediaType = inferMediaType(trimmed);
  return {
    id: `user-url-${index}-${host.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    product: host,
    title:
      mediaType === 'video'
        ? `Video reference from ${host}`
        : mediaType === 'image'
          ? `Image reference from ${host}`
          : `Reference page from ${host}`,
    sourceUrl: trimmed,
    mediaType,
    thumbnailTone: mediaType === 'video' ? 'graphite' : 'mist',
    tags: ['user-provided', mediaType, 'reference'],
    patterns: [
      'user-provided reference',
      'analyze visible structure',
      'extract reusable patterns',
      'avoid direct copying',
    ],
    useFor: 'grounding the redesign in a reference the user explicitly provided',
    avoid: 'loading private assets automatically or copying proprietary visuals',
    confidence: 'medium',
    licenseNote: 'User-provided URL; treat as inspiration/provenance and avoid direct copying.',
  };
}

function normalizeExternalReference(raw: unknown, index: number): ReferenceSeed | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const sourceUrl = typeof record['sourceUrl'] === 'string' ? record['sourceUrl'].trim() : '';
  if (!sourceUrl || sourceUrl.length > 900) return null;
  const product =
    typeof record['product'] === 'string' && record['product'].trim()
      ? record['product'].trim().slice(0, 80)
      : hostnameFromUrl(sourceUrl);
  const title =
    typeof record['title'] === 'string' && record['title'].trim()
      ? record['title'].trim().slice(0, 140)
      : `Live reference from ${product}`;
  const mediaTypeRaw =
    typeof record['mediaType'] === 'string' ? record['mediaType'] : inferMediaType(sourceUrl);
  const mediaType: MediaType =
    mediaTypeRaw === 'image' ||
    mediaTypeRaw === 'video' ||
    mediaTypeRaw === 'website' ||
    mediaTypeRaw === 'case-study'
      ? mediaTypeRaw
      : 'website';
  const provider =
    typeof record['provider'] === 'string' ? record['provider'].trim().slice(0, 32) : 'external';
  const snippet =
    typeof record['snippet'] === 'string' ? record['snippet'].trim().slice(0, 360) : '';
  const imageUrl =
    typeof record['imageUrl'] === 'string' ? record['imageUrl'].trim().slice(0, 900) : '';
  const tags = Array.isArray(record['tags'])
    ? record['tags']
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.slice(0, 32))
        .slice(0, 8)
    : [];
  const patterns = [
    mediaType === 'image'
      ? 'visual reference asset'
      : mediaType === 'video'
        ? 'motion/video reference asset'
        : 'live web reference',
    snippet || `found via ${provider} search`,
    'extract layout, hierarchy, interaction, and media treatment only',
  ];
  return {
    id: `external-${provider}-${index}-${sourceUrl
      .replace(/[^a-z0-9]+/gi, '-')
      .toLowerCase()
      .slice(0, 44)}`,
    product,
    title,
    sourceUrl,
    mediaType,
    thumbnailTone: mediaType === 'video' ? 'graphite' : mediaType === 'image' ? 'mist' : 'blue',
    tags: ['live-search', provider, mediaType, ...tags].slice(0, 10),
    patterns,
    useFor: snippet || `grounding the redesign with a live ${mediaType} reference from ${product}`,
    avoid: 'copying proprietary visuals, logos, exact copy, or private content from the source',
    confidence: 'medium',
    licenseNote: imageUrl
      ? `Live ${provider} result with image provenance; use as inspiration only.`
      : `Live ${provider} result; use as pattern/provenance only.`,
  };
}

function buildReportPayload(input: {
  runId: Id<'runs'>;
  run: { title?: string; prompt?: string };
  files: Record<string, string>;
  paritySummary?: string;
  query?: string;
  referenceUrls?: string[];
  mediaPreference?: MediaPreference;
  externalReferences?: ReferenceSeed[];
  providerMode?: 'curated' | 'curated-plus-urls' | 'external-ready';
}) {
  const queryText = safeText(
    input.query,
    `${input.run.title ?? input.run.prompt ?? 'Improve this UI'} reference inspiration`,
    500,
  );
  const mediaPreference = input.mediaPreference ?? 'auto';
  const tags = inferTags({
    query: queryText,
    ...(input.run.prompt !== undefined ? { prompt: input.run.prompt } : {}),
    ...(input.run.title !== undefined ? { title: input.run.title } : {}),
    files: input.files,
    ...(input.paritySummary !== undefined ? { paritySummary: input.paritySummary } : {}),
  });
  const tokens = tokenize(`${queryText} ${tags.join(' ')}`);
  const ranked = CURATED_REFERENCES.map((reference) => ({
    reference,
    score: scoreReference(reference, tokens, tags, mediaPreference),
  }))
    .sort((a, b) => b.score - a.score)
    .map(({ reference }) => reference);

  const userUrls = (input.referenceUrls ?? [])
    .map((url) => url.trim())
    .filter((url, index, arr) => url.length > 0 && url.length <= 500 && arr.indexOf(url) === index)
    .slice(0, 6);
  const userReferences = userUrls.map(userReferenceFromUrl);
  const externalReferences = input.externalReferences ?? [];
  const references = [...userReferences, ...externalReferences, ...ranked]
    .filter(
      (reference, index, arr) =>
        arr.findIndex((candidate) => candidate.id === reference.id) === index,
    )
    .slice(0, 10);

  const diagnosis = buildDiagnosis({
    title: input.run.title ?? input.run.prompt ?? 'Untitled run',
    prompt: input.run.prompt ?? '',
    fileCount: Object.keys(input.files).length,
    paritySummary: input.paritySummary ?? '',
    references,
  });
  const providerMode =
    input.providerMode ??
    (externalReferences.length > 0
      ? 'external-ready'
      : userReferences.length > 0
        ? 'curated-plus-urls'
        : 'curated');
  return {
    runId: input.runId,
    query: queryText,
    mediaPreference,
    status: 'ready' as const,
    tags,
    diagnosis,
    references,
    plan: buildPlan(references, tags),
    beforeAfter: buildBeforeAfter(references),
    providerMode,
    safetyNotes: [
      'Use references for structure, interaction, and hierarchy only; do not copy protected assets or product identity.',
      'Live search results are stored as provenance; arbitrary private thumbnails are not hot-loaded into the browser.',
      'Agent application must stay scoped to the current ui_kit and rerun parity/browser verification afterward.',
    ],
  };
}

function buildDiagnosis(input: {
  title: string;
  prompt: string;
  fileCount: number;
  paritySummary: string;
  references: ReferenceSeed[];
}): string {
  const lead = `Current target: ${input.title}.`;
  const source = input.prompt
    ? ` User intent says: "${safeText(input.prompt, 'not provided', 160)}".`
    : '';
  const parity = input.paritySummary
    ? ` Latest parity context: ${safeText(input.paritySummary, 'not available', 180)}.`
    : '';
  const refs = input.references
    .slice(0, 3)
    .map((reference) => reference.product)
    .join(', ');
  return `${lead}${source}${parity} The best reference direction is ${refs || 'the curated product pattern library'}: extract structure, hierarchy, interaction rhythm, and media treatment while keeping the generated UI original.`;
}

function buildPlan(references: ReferenceSeed[], tags: string[]): InspirationPlanItem[] {
  const primary = references[0];
  const secondary = references[1];
  const tertiary = references[2];
  const hasDesign = tags.includes('design') || tags.includes('agent');
  const hasLanding = tags.includes('landing') || tags.includes('music');
  return [
    {
      title: hasLanding ? 'Rebuild the page spine' : 'Simplify the primary work surface',
      rationale: hasLanding
        ? `Use ${primary?.product ?? 'the top reference'} for a real header, hero, CTA, section order, and responsive rhythm.`
        : `Use ${primary?.product ?? 'the top reference'} to reduce competing regions and make one path obvious.`,
      impact: 'High',
      sourceReferenceIds: [primary?.id, secondary?.id].filter(Boolean) as string[],
    },
    {
      title: 'Strengthen visual hierarchy',
      rationale: `Borrow hierarchy patterns from ${secondary?.product ?? primary?.product ?? 'the references'}: clearer headings, action emphasis, spacing cadence, and fewer equal-weight cards.`,
      impact: 'High',
      sourceReferenceIds: [secondary?.id, primary?.id].filter(Boolean) as string[],
    },
    {
      title: hasDesign ? 'Make comments and agent work feel anchored' : 'Surface the next action',
      rationale: hasDesign
        ? 'Use review/canvas references to keep comments, agent status, and output changes visibly tied to the selected surface.'
        : `Use ${tertiary?.product ?? 'the references'} to make the next user action obvious without needing technical interpretation.`,
      impact: 'Medium',
      sourceReferenceIds: [tertiary?.id, primary?.id].filter(Boolean) as string[],
    },
    {
      title: 'Preserve originality and verify',
      rationale:
        'Use references as pattern input only, then verify accessibility, responsive behavior, source parity, and no proprietary visual copying.',
      impact: 'Medium',
      sourceReferenceIds: references.slice(0, 3).map((reference) => reference.id),
    },
  ];
}

function buildBeforeAfter(references: ReferenceSeed[]) {
  return {
    currentBullets: [
      'Users must infer which region matters most',
      'Visual hierarchy can look close but still feel static',
      'Reference intent is not tied to files or agent edits',
    ],
    directionBullets: [
      `Apply ${references[0]?.product ?? 'top reference'} patterns to the visible structure`,
      'Use media/reference provenance as evidence, not decoration',
      'Convert the plan into a scoped agent prompt with safety constraints',
    ],
  };
}

export const getLatest = query({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query('inspiration_reports')
      .withIndex('by_run_created', (q) => q.eq('runId', runId))
      .order('desc')
      .first();
  },
});

export const runSearch = mutation({
  args: {
    runId: v.id('runs'),
    query: v.optional(v.string()),
    referenceUrls: v.optional(v.array(v.string())),
    mediaPreference: v.optional(
      v.union(v.literal('auto'), v.literal('images'), v.literal('videos'), v.literal('mixed')),
    ),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (run === null) throw new Error('inspiration:runSearch run not found');

    const uiKit = await ctx.db
      .query('ui_kits')
      .withIndex('by_run', (q) => q.eq('runId', args.runId))
      .order('desc')
      .first();
    const parity = await ctx.db
      .query('parity_reports')
      .withIndex('by_run_iter', (q) => q.eq('runId', args.runId))
      .order('desc')
      .first();

    const payload = buildReportPayload({
      runId: args.runId,
      run,
      files: (uiKit?.files as Record<string, string> | undefined) ?? {},
      ...(parity?.summary !== undefined ? { paritySummary: parity.summary } : {}),
      ...(args.query !== undefined ? { query: args.query } : {}),
      ...(args.referenceUrls !== undefined ? { referenceUrls: args.referenceUrls } : {}),
      ...(args.mediaPreference !== undefined ? { mediaPreference: args.mediaPreference } : {}),
    });
    const now = Date.now();

    return await ctx.db.insert('inspiration_reports', {
      ...payload,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const saveLiveReportInternal = internalMutation({
  args: {
    runId: v.id('runs'),
    query: v.optional(v.string()),
    referenceUrls: v.optional(v.array(v.string())),
    mediaPreference: v.optional(
      v.union(v.literal('auto'), v.literal('images'), v.literal('videos'), v.literal('mixed')),
    ),
    externalReferences: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (run === null) throw new Error('inspiration:saveLiveReportInternal run not found');
    const uiKit = await ctx.db
      .query('ui_kits')
      .withIndex('by_run', (q) => q.eq('runId', args.runId))
      .order('desc')
      .first();
    const parity = await ctx.db
      .query('parity_reports')
      .withIndex('by_run_iter', (q) => q.eq('runId', args.runId))
      .order('desc')
      .first();
    const externalReferences = Array.isArray(args.externalReferences)
      ? args.externalReferences
          .map((raw, index) => normalizeExternalReference(raw, index))
          .filter((reference): reference is ReferenceSeed => reference !== null)
      : [];
    const payload = buildReportPayload({
      runId: args.runId,
      run,
      files: (uiKit?.files as Record<string, string> | undefined) ?? {},
      ...(parity?.summary !== undefined ? { paritySummary: parity.summary } : {}),
      ...(args.query !== undefined ? { query: args.query } : {}),
      ...(args.referenceUrls !== undefined ? { referenceUrls: args.referenceUrls } : {}),
      ...(args.mediaPreference !== undefined ? { mediaPreference: args.mediaPreference } : {}),
      externalReferences,
      ...(externalReferences.length > 0 ? { providerMode: 'external-ready' as const } : {}),
    });
    const now = Date.now();
    return await ctx.db.insert('inspiration_reports', {
      ...payload,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getSearchContextInternal = internalQuery({
  args: { runId: v.id('runs') },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (run === null) throw new Error('inspiration:getSearchContextInternal run not found');
    const uiKit = await ctx.db
      .query('ui_kits')
      .withIndex('by_run', (q) => q.eq('runId', runId))
      .order('desc')
      .first();
    const parity = await ctx.db
      .query('parity_reports')
      .withIndex('by_run_iter', (q) => q.eq('runId', runId))
      .order('desc')
      .first();
    return {
      title: run.title,
      prompt: run.prompt,
      filePaths: Object.keys((uiKit?.files as Record<string, string> | undefined) ?? {}).slice(
        0,
        80,
      ),
      paritySummary: parity?.summary,
    };
  },
});

export const markApplied = mutation({
  args: { reportId: v.id('inspiration_reports') },
  handler: async (ctx, { reportId }) => {
    const report = await ctx.db.get(reportId);
    if (report === null) throw new Error('inspiration:markApplied report not found');
    await ctx.db.patch(reportId, { appliedAt: Date.now(), updatedAt: Date.now() });
    return { ok: true };
  },
});
