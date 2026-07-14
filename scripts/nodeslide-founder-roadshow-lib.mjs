import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const ROADSHOW_STORYBOARD_SCHEMA = 'nodeslide-roadshow-storyboard/v1';
export const ROADSHOW_CAPTIONS_SCHEMA = 'nodeslide-roadshow-captions/v1';
export const ROADSHOW_EVIDENCE_SCHEMA = 'nodeslide-roadshow-recorder-evidence/v1';

export const ROADSHOW_VIDEO = Object.freeze({
  width: 1920,
  height: 1080,
  browserChromeHeight: 72,
  appHeight: 1008,
  fps: 30,
  preRollMinimumMs: 5_000,
});

export const REQUIRED_ROADSHOW_SCENES = Object.freeze([
  'fresh_landing',
  'attach_evidence',
  'consent_model_web',
  'create_six_slide_deck',
  'inspect_editable_primitives',
  'one_element_edit',
  'compare_accept',
  'one_slide_edit',
  'bounded_multi_slide_edit',
  'chart_change',
  'math_change',
  'layout_change',
  'image_change',
  'trace_source_lineage',
  'persistent_memory',
  'present_share',
  'export_pptx_json',
]);

const HOOK_STATUSES = new Set(['implemented', 'pending-product-selector']);

export class RoadshowContractError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'RoadshowContractError';
    this.details = details;
  }
}

export class MissingRoadshowCapabilityError extends RoadshowContractError {
  constructor(sceneId, capability, selectors = []) {
    super(`Required scene "${sceneId}" cannot run: ${capability}`, {
      sceneId,
      capability,
      selectors,
    });
    this.name = 'MissingRoadshowCapabilityError';
  }
}

export async function readRoadshowJson(path) {
  const text = await readFile(path, 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new RoadshowContractError(`Invalid JSON in ${path}: ${error.message}`);
  }
}

export function validateRoadshowContract(storyboard, captionPlan) {
  const errors = [];
  if (storyboard?.schema !== ROADSHOW_STORYBOARD_SCHEMA) {
    errors.push(`storyboard.schema must be ${ROADSHOW_STORYBOARD_SCHEMA}`);
  }
  if (captionPlan?.schema !== ROADSHOW_CAPTIONS_SCHEMA) {
    errors.push(`captions.schema must be ${ROADSHOW_CAPTIONS_SCHEMA}`);
  }
  if (!Array.isArray(storyboard?.scenes)) errors.push('storyboard.scenes must be an array');
  if (!Array.isArray(captionPlan?.captions)) errors.push('captions.captions must be an array');
  if (errors.length) throw new RoadshowContractError(errors.join('; '), { errors });

  const sceneIds = storyboard.scenes.map((scene) => scene?.id);
  const captionIds = captionPlan.captions.map((caption) => caption?.sceneId);
  const duplicateScenes = duplicates(sceneIds);
  const duplicateCaptions = duplicates(captionIds);
  if (duplicateScenes.length) errors.push(`duplicate scene IDs: ${duplicateScenes.join(', ')}`);
  if (duplicateCaptions.length)
    errors.push(`duplicate caption scene IDs: ${duplicateCaptions.join(', ')}`);

  for (const required of REQUIRED_ROADSHOW_SCENES) {
    if (!sceneIds.includes(required)) errors.push(`missing required scene: ${required}`);
    if (!captionIds.includes(required)) errors.push(`missing required caption: ${required}`);
  }
  for (const extra of sceneIds.filter((id) => id && !REQUIRED_ROADSHOW_SCENES.includes(id))) {
    errors.push(`unknown scene ID: ${extra}`);
  }
  for (const extra of captionIds.filter((id) => id && !REQUIRED_ROADSHOW_SCENES.includes(id))) {
    errors.push(`caption references unknown scene: ${extra}`);
  }

  const orderedScenes = [...storyboard.scenes].sort((a, b) => a.sequence - b.sequence);
  orderedScenes.forEach((scene, index) => {
    if (!scene || typeof scene !== 'object') {
      errors.push(`scene ${index + 1} must be an object`);
      return;
    }
    if (scene.sequence !== index + 1) {
      errors.push(`scene ${scene.id ?? index + 1} must have sequence ${index + 1}`);
    }
    if (!scene.title?.trim()) errors.push(`scene ${scene.id} needs a title`);
    if (!scene.proof?.trim()) errors.push(`scene ${scene.id} needs a proof statement`);
    if (!HOOK_STATUSES.has(scene.hook?.status)) {
      errors.push(
        `scene ${scene.id} has unsupported hook status ${scene.hook?.status ?? '<none>'}`,
      );
    }
    if (!scene.hook?.name?.trim()) errors.push(`scene ${scene.id} needs a hook name`);
    if (scene.hook?.status === 'pending-product-selector' && !scene.hook?.reason?.trim()) {
      errors.push(`pending scene ${scene.id} must explain why it is blocked`);
    }
  });

  for (const caption of captionPlan.captions) {
    if (!caption?.text?.trim()) errors.push(`caption ${caption?.sceneId ?? '<unknown>'} is empty`);
    if (!Number.isFinite(caption?.minimumDurationMs) || caption.minimumDurationMs < 1_000) {
      errors.push(`caption ${caption?.sceneId ?? '<unknown>'} needs minimumDurationMs >= 1000`);
    }
  }

  if (errors.length) throw new RoadshowContractError(errors.join('; '), { errors });
  return {
    requiredSceneCount: REQUIRED_ROADSHOW_SCENES.length,
    sceneCount: orderedScenes.length,
    captionCount: captionPlan.captions.length,
    pendingHooks: pendingRoadshowHooks(storyboard),
  };
}

export function pendingRoadshowHooks(storyboard) {
  return (storyboard?.scenes ?? [])
    .filter((scene) => scene?.hook?.status !== 'implemented')
    .map((scene) => ({
      sceneId: scene.id,
      status: scene.hook?.status ?? 'missing',
      reason: scene.hook?.reason ?? 'No reason recorded.',
    }));
}

export function assertRoadshowLiveReady(storyboard) {
  const pending = pendingRoadshowHooks(storyboard);
  if (pending.length > 0) {
    throw new RoadshowContractError(
      `Live recording blocked by ${pending.length} required hook(s): ${pending
        .map((item) => item.sceneId)
        .join(', ')}`,
      { pendingHooks: pending },
    );
  }
  return true;
}

export function buildCaptionTimeline(sceneResults, captionPlan, preRollDurationMs) {
  if (!Number.isFinite(preRollDurationMs) || preRollDurationMs < 0) {
    throw new RoadshowContractError('preRollDurationMs must be a non-negative number');
  }
  const captionsByScene = new Map(
    captionPlan.captions.map((caption) => [caption.sceneId, caption]),
  );
  const ordered = [...sceneResults].sort((a, b) => a.startedAtMs - b.startedAtMs);
  const timeline = [];

  ordered.forEach((scene, index) => {
    const caption = captionsByScene.get(scene.id);
    if (!caption) throw new RoadshowContractError(`No caption for scene ${scene.id}`);
    if (scene.status !== 'passed') {
      throw new RoadshowContractError(`Cannot caption incomplete scene ${scene.id}`, { scene });
    }
    const startMs = Math.round(preRollDurationMs + scene.startedAtMs + 180);
    const desiredEndMs = Math.max(
      preRollDurationMs + scene.endedAtMs - 180,
      startMs + caption.minimumDurationMs,
    );
    const next = ordered[index + 1];
    const nextStartMs = next ? preRollDurationMs + next.startedAtMs : Number.POSITIVE_INFINITY;
    const endMs = Math.min(desiredEndMs, nextStartMs - 120);
    if (endMs - startMs < 900) {
      throw new RoadshowContractError(
        `Scene ${scene.id} is too short for a readable caption (${endMs - startMs}ms)`,
        { scene, caption },
      );
    }
    timeline.push({
      index: index + 1,
      sceneId: scene.id,
      startMs,
      endMs,
      text: caption.text.trim(),
    });
  });

  assertNonOverlappingTimeline(timeline);
  return timeline;
}

export function assertNonOverlappingTimeline(timeline) {
  let previousEnd = -1;
  for (const item of timeline) {
    if (!Number.isFinite(item.startMs) || !Number.isFinite(item.endMs)) {
      throw new RoadshowContractError(`Caption ${item.sceneId} has invalid timing`);
    }
    if (item.startMs < previousEnd) {
      throw new RoadshowContractError(`Caption ${item.sceneId} overlaps the prior caption`);
    }
    if (item.endMs <= item.startMs) {
      throw new RoadshowContractError(`Caption ${item.sceneId} ends before it starts`);
    }
    previousEnd = item.endMs;
  }
  return true;
}

export function buildSrt(timeline) {
  assertNonOverlappingTimeline(timeline);
  return `${timeline
    .map(
      (item, index) =>
        `${index + 1}\n${formatSrtTimestamp(item.startMs)} --> ${formatSrtTimestamp(item.endMs)}\n${sanitizeSrtText(item.text)}`,
    )
    .join('\n\n')}\n`;
}

export function formatSrtTimestamp(milliseconds) {
  const total = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1_000);
  const millis = total % 1_000;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(millis, 3)}`;
}

export function browserChromeMarkup(targetUrl, { editableAddress = true } = {}) {
  const disabled = editableAddress ? '' : 'readonly';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#f7f7f5;color:#111827;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.browser{width:100%;height:100%;background:#f7f7f5}.chrome{height:${ROADSHOW_VIDEO.browserChromeHeight}px;background:#e7e9ed;border-bottom:1px solid #c9cdd4;display:grid;grid-template-columns:132px 1fr 180px;align-items:center;gap:14px;padding:10px 16px;box-shadow:0 1px 0 rgba(255,255,255,.8) inset}.traffic{display:flex;gap:9px}.traffic i{width:13px;height:13px;border-radius:50%;display:block}.traffic i:nth-child(1){background:#ff5f57}.traffic i:nth-child(2){background:#febc2e}.traffic i:nth-child(3){background:#28c840}.address{height:44px;border:1px solid #c4c8cf;border-radius:12px;background:#fff;display:flex;align-items:center;padding:0 16px;box-shadow:0 1px 2px rgba(15,23,42,.08)}.address:focus-within{border-color:#b45f43;box-shadow:0 0 0 3px rgba(180,95,67,.14)}.address input{width:100%;border:0;outline:0;background:transparent;color:#111827;font:500 15px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace}.tab{justify-self:end;font-size:13px;color:#4b5563}.stage{height:calc(100% - ${ROADSHOW_VIDEO.browserChromeHeight}px);display:grid;place-items:center;background:linear-gradient(135deg,#faf8f4,#f1f3f6)}.stage span{font:600 13px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.12em;text-transform:uppercase;color:#8b5a48}.cursor{position:fixed;z-index:2147483647;width:28px;height:36px;left:50%;top:62%;pointer-events:none;filter:drop-shadow(0 2px 2px rgba(0,0,0,.28));transition:transform .55s cubic-bezier(.2,.8,.2,1)}.cursor svg{width:100%;height:100%;display:block}.cursor.is-clicking{transform:scale(.82)}
</style></head><body><main class="browser"><header class="chrome"><div class="traffic"><i></i><i></i><i></i></div><label class="address"><span style="position:absolute;width:1px;height:1px;overflow:hidden">Address</span><input aria-label="Address" ${disabled} value=""></label><div class="tab">NodeSlide · Founder roadshow</div></header><section class="stage"><span>Opening a fresh NodeSlide session</span></section></main><div id="__nodeslide_demo_cursor" class="cursor" aria-hidden="true"><svg viewBox="0 0 28 36"><path d="M2 2L23 21h-9l5 11-5 2-5-11-7 7z" fill="#fff" stroke="#111827" stroke-width="2" stroke-linejoin="round"/></svg></div><script>window.__roadshowTarget=${JSON.stringify(targetUrl)};</script></body></html>`;
}

export function buildFfmpegCommands({
  preRollRaw,
  productRaw,
  browserChromePng,
  captionsSrt,
  outputDir,
}) {
  const preRollMp4 = resolve(outputDir, '01-browser-preroll.mp4');
  const productFramedMp4 = resolve(outputDir, '02-product-framed.mp4');
  const continuousMp4 = resolve(outputDir, '03-continuous-unsubtitled.mp4');
  const finalMp4 = resolve(outputDir, 'nodeslide-founder-roadshow.mp4');
  const size = `${ROADSHOW_VIDEO.width}:${ROADSHOW_VIDEO.height}`;
  const appSize = `${ROADSHOW_VIDEO.width}:${ROADSHOW_VIDEO.appHeight}`;
  const chromeSize = `${ROADSHOW_VIDEO.width}:${ROADSHOW_VIDEO.browserChromeHeight}`;
  const common = [
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '19',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(ROADSHOW_VIDEO.fps),
  ];

  const normalizePreRoll = {
    label: 'normalize browser pre-roll',
    executable: 'ffmpeg',
    args: [
      '-y',
      '-i',
      preRollRaw,
      '-vf',
      `scale=${size}:force_original_aspect_ratio=decrease,pad=${size}:(ow-iw)/2:(oh-ih)/2:color=#e7e9ed,fps=${ROADSHOW_VIDEO.fps}`,
      ...common,
      preRollMp4,
    ],
  };
  const frameProduct = {
    label: 'add browser chrome to product capture',
    executable: 'ffmpeg',
    args: [
      '-y',
      '-i',
      productRaw,
      '-loop',
      '1',
      '-i',
      browserChromePng,
      '-filter_complex',
      `[0:v]scale=${appSize}:force_original_aspect_ratio=decrease,pad=${appSize}:(ow-iw)/2:(oh-ih)/2:color=#f7f7f5,fps=${ROADSHOW_VIDEO.fps}[app];[app]pad=${size}:0:${ROADSHOW_VIDEO.browserChromeHeight}:color=#e7e9ed[base];[1:v]scale=${chromeSize}[chrome];[base][chrome]overlay=0:0:shortest=1[outv]`,
      '-map',
      '[outv]',
      ...common,
      productFramedMp4,
    ],
  };
  const concat = {
    label: 'concatenate continuous recording',
    executable: 'ffmpeg',
    args: [
      '-y',
      '-i',
      preRollMp4,
      '-i',
      productFramedMp4,
      '-filter_complex',
      `[0:v]scale=${size},setsar=1,fps=${ROADSHOW_VIDEO.fps}[pre];[1:v]scale=${size},setsar=1,fps=${ROADSHOW_VIDEO.fps}[app];[pre][app]concat=n=2:v=1:a=0[outv]`,
      '-map',
      '[outv]',
      ...common,
      continuousMp4,
    ],
  };
  const burnCaptions = {
    label: 'burn scene captions',
    executable: 'ffmpeg',
    args: [
      '-y',
      '-i',
      continuousMp4,
      '-vf',
      `subtitles='${ffmpegFilterPath(captionsSrt)}':force_style='FontName=Arial,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00211B18,BackColour=&H990F172A,BorderStyle=3,Outline=1,Shadow=0,MarginV=48,Alignment=2'`,
      ...common,
      finalMp4,
    ],
  };

  return {
    commands: [normalizePreRoll, frameProduct, concat, burnCaptions],
    outputs: { preRollMp4, productFramedMp4, continuousMp4, finalMp4 },
  };
}

export function ffmpegFilterPath(path) {
  return resolve(path)
    .replaceAll('\\', '/')
    .replace(/^([A-Za-z]):/, '$1\\:')
    .replaceAll("'", "\\'")
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]');
}

export function recorderEvidenceSkeleton({ targetUrl, commitSha, mode, storyboard }) {
  return {
    schema: ROADSHOW_EVIDENCE_SCHEMA,
    createdAt: new Date().toISOString(),
    target: sanitizeEvidenceUrl(targetUrl),
    commitSha: commitSha ?? null,
    mode,
    backgroundSafe: true,
    syntheticOverlays: ['browser chrome', 'animated cursor', 'scene captions'],
    productStateSynthetic: false,
    requiredScenes: [...REQUIRED_ROADSHOW_SCENES],
    pendingHooks: pendingRoadshowHooks(storyboard),
    inputs: [],
    scenes: [],
    consoleErrors: [],
    pageErrors: [],
    downloads: [],
    outputs: {},
    verdict: 'pending',
  };
}

export function sanitizeEvidenceUrl(value) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|key|code|password|bypass/i.test(key))
        url.searchParams.set(key, '[redacted]');
    }
    return url.toString();
  } catch {
    return String(value).replace(
      /([?&](?:token|secret|key|code|password|bypass)[^=]*=)[^&]+/gi,
      '$1[redacted]',
    );
  }
}

function duplicates(values) {
  const seen = new Set();
  const duplicate = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate];
}

function sanitizeSrtText(value) {
  return String(value).replace(/\r?\n/g, ' ').replace(/-->/g, '→').trim();
}

function pad(value, width) {
  return String(value).padStart(width, '0');
}
