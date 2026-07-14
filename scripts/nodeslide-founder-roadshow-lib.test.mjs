import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  REQUIRED_ROADSHOW_SCENES,
  ROADSHOW_VIDEO,
  RoadshowContractError,
  assertRoadshowLiveReady,
  browserChromeMarkup,
  buildCaptionTimeline,
  buildFfmpegCommands,
  buildSrt,
  ffmpegFilterPath,
  formatSrtTimestamp,
  readRoadshowJson,
  recorderEvidenceSkeleton,
  sanitizeEvidenceUrl,
  validateRoadshowContract,
} from './nodeslide-founder-roadshow-lib.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const storyboardPath = resolve(repoRoot, 'docs/demo/founder-roadshow/storyboard.json');
const captionsPath = resolve(repoRoot, 'docs/demo/founder-roadshow/captions.json');

describe('founder-roadshow contract', () => {
  it('covers every required scene and labels the current live blocker', async () => {
    const [storyboard, captions] = await Promise.all([
      readRoadshowJson(storyboardPath),
      readRoadshowJson(captionsPath),
    ]);
    const result = validateRoadshowContract(storyboard, captions);

    expect(result.sceneCount).toBe(REQUIRED_ROADSHOW_SCENES.length);
    expect(result.captionCount).toBe(REQUIRED_ROADSHOW_SCENES.length);
    expect(result.pendingHooks).toEqual([
      expect.objectContaining({
        sceneId: 'bounded_multi_slide_edit',
        status: 'pending-product-selector',
      }),
    ]);
    expect(() => assertRoadshowLiveReady(storyboard)).toThrow(/bounded_multi_slide_edit/);
  });

  it('allows live execution only after every required hook is implemented', async () => {
    const storyboard = structuredClone(await readRoadshowJson(storyboardPath));
    const pending = storyboard.scenes.find((scene) => scene.id === 'bounded_multi_slide_edit');
    pending.hook = { status: 'implemented', name: 'boundedMultiSlideEdit' };
    expect(assertRoadshowLiveReady(storyboard)).toBe(true);
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
    });

    expect(result.commands.map((command) => command.label)).toEqual([
      'normalize browser pre-roll',
      'add browser chrome to product capture',
      'concatenate continuous recording',
      'burn scene captions',
    ]);
    expect(result.commands[1].args.join(' ')).toContain('overlay=0:0:shortest=1');
    expect(result.commands[2].args.join(' ')).toContain('concat=n=2:v=1:a=0');
    expect(result.commands[3].args.join(' ')).toContain("subtitles='C\\:/tmp/captions.srt'");
    expect(result.outputs.finalMp4).toMatch(/nodeslide-founder-roadshow\.mp4$/);
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
