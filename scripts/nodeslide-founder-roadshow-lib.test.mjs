import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  REQUIRED_ROADSHOW_SCENES,
  ROADSHOW_ATTACHMENT_GROUPS,
  ROADSHOW_METRICS_INPUT,
  ROADSHOW_VIDEO,
  RoadshowContractError,
  assertRoadshowLiveReady,
  browserChromeMarkup,
  buildCaptionTimeline,
  buildFfmpegCommands,
  buildRoadshowAttachmentPlan,
  buildSrt,
  ffmpegFilterPath,
  formatSrtTimestamp,
  humanTypingTimeoutMs,
  readRoadshowJson,
  recorderEvidenceSkeleton,
  resolveRoadshowInputPaths,
  roadshowPlaybackRate,
  sanitizeEvidenceUrl,
  selectedElementScopePattern,
  selectedSlidesScopePattern,
  shouldClearBeforeHumanTyping,
  shouldTogglePressedControl,
  validateRoadshowContract,
} from './nodeslide-founder-roadshow-lib.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const storyboardPath = resolve(repoRoot, 'docs/demo/founder-roadshow/storyboard.json');
const captionsPath = resolve(repoRoot, 'docs/demo/founder-roadshow/captions.json');

describe('founder-roadshow contract', () => {
  it('covers every required scene with an implemented live hook', async () => {
    const [storyboard, captions] = await Promise.all([
      readRoadshowJson(storyboardPath),
      readRoadshowJson(captionsPath),
    ]);
    const result = validateRoadshowContract(storyboard, captions);

    expect(result.sceneCount).toBe(REQUIRED_ROADSHOW_SCENES.length);
    expect(result.captionCount).toBe(REQUIRED_ROADSHOW_SCENES.length);
    expect(result.pendingHooks).toEqual([]);
    expect(assertRoadshowLiveReady(storyboard)).toBe(true);
  });

  it('blocks live execution if any required hook regresses to pending', async () => {
    const storyboard = structuredClone(await readRoadshowJson(storyboardPath));
    const multiSlide = storyboard.scenes.find((scene) => scene.id === 'bounded_multi_slide_edit');
    multiSlide.hook = { status: 'pending-product-selector', name: 'boundedMultiSlideEdit' };
    expect(() => assertRoadshowLiveReady(storyboard)).toThrow(/bounded_multi_slide_edit/);
  });

  it('rejects a missing scene instead of shrinking the demo', async () => {
    const [storyboard, captions] = await Promise.all([
      readRoadshowJson(storyboardPath),
      readRoadshowJson(captionsPath),
    ]);
    const incomplete = {
      ...storyboard,
      scenes: storyboard.scenes.filter((scene) => scene.id !== 'trace_source_lineage'),
    };
    expect(() => validateRoadshowContract(incomplete, captions)).toThrow(RoadshowContractError);
    expect(() => validateRoadshowContract(incomplete, captions)).toThrow(
      /missing required scene: trace_source_lineage/,
    );
  });

  it('uses a temporary metrics fixture only when the recorder explicitly supplies one', () => {
    const inputs = [
      'docs/submission/nodeslide-prd.md',
      ROADSHOW_METRICS_INPUT,
      'docs/demo/founder-roadshow/customer-notes.md',
    ];
    const defaults = resolveRoadshowInputPaths(inputs, { repoRoot });
    const temporaryMetrics = resolve(repoRoot, '.tmp/roadshow/prototype-metrics.csv');
    const overridden = resolveRoadshowInputPaths(inputs, {
      repoRoot,
      metricsPath: temporaryMetrics,
    });

    expect(defaults[1]).toBe(resolve(repoRoot, ROADSHOW_METRICS_INPUT));
    expect(overridden).toEqual([
      resolve(repoRoot, inputs[0]),
      temporaryMetrics,
      resolve(repoRoot, inputs[2]),
    ]);
  });

  it('packs all five evidence sources into the product three-file attachment limit', async () => {
    const storyboard = await readRoadshowJson(storyboardPath);
    const resolvedPaths = resolveRoadshowInputPaths(storyboard.inputs, { repoRoot });
    const plan = buildRoadshowAttachmentPlan(storyboard.inputs, resolvedPaths);

    expect(plan).toHaveLength(3);
    expect(plan.map((group) => group.filename)).toEqual(
      ROADSHOW_ATTACHMENT_GROUPS.map((group) => group.filename),
    );
    expect(plan.flatMap((group) => group.sources)).toHaveLength(5);
    expect(
      new Set(plan.flatMap((group) => group.sources.map((source) => source.canonicalInput))),
    ).toEqual(new Set(storyboard.inputs));
  });

  it('tracks the visible bounded-scope count instead of the obsolete static label', () => {
    expect(selectedSlidesScopePattern(2).test('Selected slides (2)')).toBe(true);
    expect(selectedSlidesScopePattern(2).test('Selected slides')).toBe(false);
    expect(selectedSlidesScopePattern(2).test('Selected slides (3)')).toBe(false);
    expect(selectedSlidesScopePattern().test('Selected slides (12)')).toBe(true);
  });

  it('tracks the visible element-selection count in the compact composer', () => {
    expect(selectedElementScopePattern(1).test('Selection · 1')).toBe(true);
    expect(selectedElementScopePattern(1).test('Selection')).toBe(false);
    expect(selectedElementScopePattern(1).test('Selection · 2')).toBe(false);
    expect(selectedElementScopePattern().test('Selection · 12')).toBe(true);
  });

  it('does not backspace an empty composer and accidentally remove its last attachment', () => {
    expect(shouldClearBeforeHumanTyping('')).toBe(false);
    expect(shouldClearBeforeHumanTyping(null)).toBe(false);
    expect(shouldClearBeforeHumanTyping('existing text')).toBe(true);
  });

  it('resets a sticky web toggle between consecutive recorded runs', () => {
    expect(shouldTogglePressedControl('true', false)).toBe(true);
    expect(shouldTogglePressedControl('false', true)).toBe(true);
    expect(shouldTogglePressedControl('true', true)).toBe(false);
    expect(shouldTogglePressedControl('false', false)).toBe(false);
  });

  it('gives a full human-speed brief enough time to finish typing visibly', () => {
    expect(humanTypingTimeoutMs('short', 14)).toBe(30_000);
    expect(humanTypingTimeoutMs('x'.repeat(1_801), 14)).toBe(40_214);
  });
});

describe('caption timing and SRT generation', () => {
  it('builds one readable, non-overlapping caption per scene', async () => {
    const captions = await readRoadshowJson(captionsPath);
    let clock = 0;
    const scenes = captions.captions.map((caption) => {
      const scene = {
        id: caption.sceneId,
        status: 'passed',
        startedAtMs: clock,
        endedAtMs: clock + caption.minimumDurationMs + 700,
      };
      clock = scene.endedAtMs + 250;
      return scene;
    });
    const timeline = buildCaptionTimeline(scenes, captions, ROADSHOW_VIDEO.preRollMinimumMs);
    const srt = buildSrt(timeline);

    expect(timeline).toHaveLength(REQUIRED_ROADSHOW_SCENES.length);
    expect(srt.match(/ --> /g)).toHaveLength(REQUIRED_ROADSHOW_SCENES.length);
    expect(srt).toContain('00:00:05,180');
    for (let index = 1; index < timeline.length; index += 1) {
      expect(timeline[index].startMs).toBeGreaterThanOrEqual(timeline[index - 1].endMs);
    }
  });

  it('formats long timestamps deterministically', () => {
    expect(formatSrtTimestamp(3_726_004)).toBe('01:02:06,004');
  });

  it('uniformly time-compresses long captures without cuts and scales caption timing', async () => {
    const captions = await readRoadshowJson(captionsPath);
    const rate = roadshowPlaybackRate(5_000, 350_000);
    const timeline = buildCaptionTimeline(
      [
        {
          id: 'fresh_landing',
          status: 'passed',
          startedAtMs: 0,
          endedAtMs: 4_000,
        },
      ],
      captions,
      5_000,
      rate,
    );

    expect(rate).toBe(1.25);
    expect(timeline[0].startMs).toBe(5_180);
    expect(timeline[0].endMs).toBeLessThan(9_000);
  });

  it('fails when an incomplete scene is presented as caption evidence', async () => {
    const captions = await readRoadshowJson(captionsPath);
    expect(() =>
      buildCaptionTimeline(
        [{ id: 'fresh_landing', status: 'failed', startedAtMs: 0, endedAtMs: 3_000 }],
        captions,
        5_000,
      ),
    ).toThrow(/Cannot caption incomplete scene/);
  });
});

describe('browser overlay and ffmpeg construction', () => {
  it('renders only browser chrome, address input, and the visible cursor in pre-roll', () => {
    const markup = browserChromeMarkup('https://parity-studio.vercel.app/');
    expect(markup).toContain('aria-label="Address"');
    expect(markup).toContain('__nodeslide_demo_cursor');
    expect(markup).toContain('NodeSlide · Founder roadshow');
    expect(markup).toContain('https://parity-studio.vercel.app/');
    expect(markup).not.toContain('proposal-card');
  });

  it('constructs normalize, browser-frame, concat, and caption-burn commands', () => {
    const result = buildFfmpegCommands({
      preRollRaw: 'C:\\tmp\\pre.webm',
      productRaw: 'C:\\tmp\\product.webm',
      browserChromePng: 'C:\\tmp\\chrome.png',
      captionsSrt: 'C:\\tmp\\captions.srt',
      outputDir: 'C:\\tmp\\out',
      playbackRate: 1.25,
    });

    expect(result.commands.map((command) => command.label)).toEqual([
      'normalize browser pre-roll',
      'add browser chrome to product capture',
      'concatenate continuous recording',
      'burn scene captions',
    ]);
    expect(result.commands[1].args.join(' ')).toContain('overlay=0:0:shortest=1');
    expect(result.commands[1].args.join(' ')).toContain('setpts=PTS/1.250000');
    expect(result.commands[2].args.join(' ')).toContain('concat=n=2:v=1:a=0');
    expect(result.commands[3].args.join(' ')).toContain("subtitles='C\\:/tmp/captions.srt'");
    expect(result.outputs.finalMp4).toBe('C:\\tmp\\out\\nodeslide-founder-roadshow.mp4');
  });

  it('escapes Windows filter paths and redacts credential-like query values', () => {
    expect(ffmpegFilterPath("C:\\demo folder\\captions's.srt")).toBe(
      "C\\:/demo folder/captions\\'s.srt",
    );
    expect(
      sanitizeEvidenceUrl('https://example.test/?deck=deck_1&accessKey=very-secret&token=abc'),
    ).toBe('https://example.test/?deck=deck_1&accessKey=%5Bredacted%5D&token=%5Bredacted%5D');
  });

  it('declares overlays without claiming synthetic product state', () => {
    const storyboard = {
      scenes: [{ id: 'bounded_multi_slide_edit', hook: { status: 'pending-product-selector' } }],
    };
    const evidence = recorderEvidenceSkeleton({
      targetUrl: 'https://parity-studio.vercel.app/',
      commitSha: 'a'.repeat(40),
      mode: 'dry-run',
      storyboard,
    });
    expect(evidence.backgroundSafe).toBe(true);
    expect(evidence.productStateSynthetic).toBe(false);
    expect(evidence.syntheticOverlays).toEqual([
      'browser chrome',
      'animated cursor',
      'scene captions',
    ]);
  });
});
