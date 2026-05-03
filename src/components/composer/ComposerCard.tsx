import { useAction, useMutation } from 'convex/react';
import JSZip from 'jszip';
import { ArrowUp, ImagePlus, Package, Paperclip, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { useT } from '../../lib/i18n';
import type { ModelOverride, Tier } from '../../lib/modelRouting';
import { getOrCreateSessionId } from '../../lib/sessionIdentity';
import { ModelRoutePicker } from '../model/ModelRoutePicker';

interface ComposerCardProps {
  onRunStarted: (runId: Id<'runs'>) => void;
  clientSessionId?: string;
  variant?: 'compact' | 'launch';
}

const MAX_INLINE_IMAGE_BYTES = 2_000_000;
// Skill-pack zips can be 10–20 MB (lots of preview HTMLs + uploads). Cap
// them slightly above the largest known canonical bundle. Pure code +
// styles inside a kit is small; bytes are dominated by uploads/ + scraps/.
const MAX_KIT_ZIP_BYTES = 30_000_000;
// Per-file content cap inside the kit. Files above this get rejected so
// the run row's `files` map stays manageable. 200 KB matches patchFile.
const MAX_KIT_FILE_BYTES = 200_000;

/**
 * Composer - source/new-run entry point at the bottom of the agent rail.
 *
 * - prompt textarea (auto-grow), ↵ submits
 * - paperclip → file picker (image upload)
 * - sparkles → in-app gpt-image-2 generation from the typed prompt
 * - submit button (terracotta circle ↑)
 * - model picker pill below ("gpt-5.4 ▾", visual-only for now)
 */
export function ComposerCard({
  onRunStarted,
  clientSessionId = getOrCreateSessionId(),
  variant = 'compact',
}: ComposerCardProps) {
  const t = useT();
  const startRun = useMutation(api.runs.start);
  const startFromKit = useMutation(api.runs.startFromKit);
  const generateImage = useAction(api.generation.generateSourceImage);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [prompt, setPrompt] = useState('');
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<'image/png' | 'image/jpeg' | 'image/webp' | null>(
    null,
  );
  const [imageLabel, setImageLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tier, setTier] = useState<Tier>('balanced');
  const [modelOverride, setModelOverride] = useState<ModelOverride | null>(null);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const f = e.target.files?.[0];
    if (!f) return;

    // ZIP path — drop a canonical NodeBench-skill-style ui_kit zip and
    // skip generate + decompose entirely. The kit is parsed client-side
    // and the largest ui_kits/<slug>/ folder is selected as the active
    // run. Other slugs are noted in error if present so the user knows
    // they were preserved upstream.
    const isZip = f.name.toLowerCase().endsWith('.zip') || f.type === 'application/zip';
    if (isZip) {
      if (f.size > MAX_KIT_ZIP_BYTES) {
        setError(t('composer.zipTooLarge', { size: (f.size / 1_000_000).toFixed(1) }));
        return;
      }
      try {
        await importKitZip(f);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    if (f.size > MAX_INLINE_IMAGE_BYTES) {
      setError(t('composer.imageTooLarge', { size: (f.size / 1_000_000).toFixed(1) }));
      return;
    }
    const mime =
      f.type === 'image/png' || f.type === 'image/jpeg' || f.type === 'image/webp'
        ? (f.type as 'image/png' | 'image/jpeg' | 'image/webp')
        : null;
    if (!mime) {
      setError(t('composer.onlySupported'));
      return;
    }
    const buf = await f.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    setImageBase64(b64);
    setImageMime(mime);
    setImageLabel(f.name);
  }

  async function importKitZip(file: File) {
    setBusy(true);
    try {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());

      // Group entries by ui_kits/<slug>/ prefix. The canonical shape ships
      // multiple slugs in one zip (nodebench-web, nodebench-mobile, etc.);
      // we pick the largest by file count for the active run.
      const slugFiles = new Map<string, Map<string, string>>();
      const uploads: Array<{
        name: string;
        data: Uint8Array;
        mime: 'image/png' | 'image/jpeg' | 'image/webp';
      }> = [];
      let prompt: string | undefined;

      for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        // ui_kits/<slug>/...
        const kitMatch = path.match(/^ui_kits\/([^/]+)\/(.+)$/);
        if (kitMatch) {
          const slug = kitMatch[1] as string;
          const rel = kitMatch[2] as string;
          // skip oversized files but don't fail the whole import
          const text = await entry.async('string').catch(() => '');
          if (text.length === 0 || text.length > MAX_KIT_FILE_BYTES) continue;
          if (!slugFiles.has(slug)) slugFiles.set(slug, new Map());
          (slugFiles.get(slug) as Map<string, string>).set(`ui_kits/${slug}/${rel}`, text);
          continue;
        }
        // uploads/ — capture first png/jpg/webp as the source image
        const upMatch = path.match(/^uploads?\/(.+)$/);
        if (upMatch) {
          const ext = (upMatch[1] as string).toLowerCase().split('.').pop() ?? '';
          const mime: 'image/png' | 'image/jpeg' | 'image/webp' | null =
            ext === 'png'
              ? 'image/png'
              : ext === 'jpg' || ext === 'jpeg'
                ? 'image/jpeg'
                : ext === 'webp'
                  ? 'image/webp'
                  : null;
          if (mime) {
            const data = await entry.async('uint8array');
            // cap at 2 MB so the runs row stays sane
            if (data.length <= MAX_INLINE_IMAGE_BYTES) {
              uploads.push({ name: upMatch[1] as string, data, mime });
            }
          }
          continue;
        }
        // SKILL.md description — pull as the run's prompt for provenance
        if (path === 'SKILL.md' || path === 'README.md') {
          const text = await entry.async('string').catch(() => '');
          if (path === 'SKILL.md') {
            const desc = text.match(/description:\s*([^\n]+)/i)?.[1];
            if (desc && !prompt) prompt = desc.trim();
          }
        }
      }

      if (slugFiles.size === 0) {
        throw new Error(t('composer.noUiKitFolder'));
      }

      // Pick the largest slug by file count
      const ranked = [...slugFiles.entries()].sort((a, b) => b[1].size - a[1].size);
      const [activeSlug, activeFiles] = ranked[0] as [string, Map<string, string>];
      const otherSlugs = ranked.slice(1).map(([s]) => s);

      // Encode first usable upload as base64 for the popover
      let sourceImageBase64: string | undefined;
      let sourceImageMimeType: 'image/png' | 'image/jpeg' | 'image/webp' | undefined;
      if (uploads.length > 0) {
        const first = uploads[0];
        if (first) {
          let bin = '';
          for (let i = 0; i < first.data.length; i += 1) {
            bin += String.fromCharCode(first.data[i] as number);
          }
          sourceImageBase64 = btoa(bin);
          sourceImageMimeType = first.mime;
        }
      }

      const filesObj: Record<string, string> = {};
      for (const [k, v] of activeFiles.entries()) filesObj[k] = v;

      const runId = await startFromKit({
        slug: activeSlug,
        files: filesObj,
        clientSessionId,
        ...(modelOverride ? { modelOverride } : { tier }),
        ...(sourceImageBase64 ? { sourceImageBase64 } : {}),
        ...(sourceImageMimeType ? { sourceImageMimeType } : {}),
        ...(prompt ? { prompt } : {}),
      });
      onRunStarted(runId);

      const note =
        otherSlugs.length > 0
          ? t('composer.importedWithOthers', {
              slug: activeSlug,
              count: activeFiles.size,
              otherCount: otherSlugs.length,
              plural: otherSlugs.length === 1 ? '' : 's',
              others: otherSlugs.join(', '),
            })
          : t('composer.imported', { slug: activeSlug, count: activeFiles.size });
      setImageLabel(note);
    } finally {
      setBusy(false);
    }
  }

  async function onGenImage() {
    if (prompt.trim().length === 0) {
      setError(t('composer.typePromptFirst'));
      return;
    }
    setError(null);
    setGenBusy(true);
    try {
      const result = await generateImage({ prompt: prompt.trim() });
      setImageBase64(result.base64);
      setImageMime(result.mimeType);
      const usd = (result.costMicroUsd / 1_000_000).toFixed(3);
      const tag = result.costSource === 'usage' ? '' : '~';
      setImageLabel(`gpt-image-2 ${tag}$${usd}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenBusy(false);
    }
  }

  async function onSubmit() {
    setError(null);
    if (busy || genBusy) return;
    if (prompt.trim().length === 0 && imageBase64 === null) {
      setError(t('composer.addPromptOrImage'));
      return;
    }
    setBusy(true);
    try {
      const args: {
        prompt?: string;
        sourceImageBase64?: string;
        sourceImageMimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
        tier?: Tier;
        modelOverride?: ModelOverride;
      } = {};
      if (prompt.trim().length > 0) args.prompt = prompt.trim();
      if (modelOverride) args.modelOverride = modelOverride;
      else args.tier = tier;
      if (imageBase64 !== null && imageMime !== null) {
        args.sourceImageBase64 = imageBase64;
        args.sourceImageMimeType = imageMime;
      }
      const runId = await startRun({ ...args, clientSessionId });
      onRunStarted(runId);
      setPrompt('');
      setImageBase64(null);
      setImageMime(null);
      setImageLabel(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = !busy && !genBusy && (prompt.trim().length > 0 || imageBase64 !== null);
  const launch = variant === 'launch';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        style={{
          background: launch
            ? 'linear-gradient(180deg, color-mix(in srgb, var(--color-surface) 88%, white), var(--color-surface))'
            : 'var(--color-surface)',
          border: `1px solid ${launch ? 'var(--color-border)' : 'var(--color-border-subtle)'}`,
          borderRadius: launch ? '24px' : 'var(--radius-lg)',
          boxShadow: launch ? 'var(--shadow-elevated)' : 'var(--shadow-soft)',
          padding: launch ? 16 : 12,
          display: 'flex',
          flexDirection: 'column',
          gap: launch ? 12 : 8,
        }}
      >
        <ModelRoutePicker
          tier={tier}
          modelOverride={modelOverride}
          onRouter={(nextTier) => {
            setTier(nextTier);
            setModelOverride(null);
          }}
          onCustom={(nextOverride) => setModelOverride(nextOverride)}
          placement="down"
          width="100%"
        />
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSubmit) {
              e.preventDefault();
              void onSubmit();
            }
          }}
          rows={3}
          placeholder={launch ? t('composer.launchPlaceholder') : t('composer.placeholder')}
          aria-label={t('composer.describeDesign')}
          style={{
            resize: 'none',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontFamily: 'var(--font-sans)',
            fontSize: launch ? 17 : 'var(--font-size-body)',
            color: 'var(--color-text-primary)',
            lineHeight: 'var(--leading-snug)',
            minHeight: launch ? 116 : 60,
          }}
          disabled={busy}
        />
        {imageLabel ? (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              alignSelf: 'flex-start',
              padding: '3px 10px',
              borderRadius: 'var(--radius-pill)',
              background: 'var(--color-accent-soft)',
              color: 'var(--color-accent)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
            }}
          >
            <ImagePlus size={11} aria-hidden />
            {imageLabel}
          </div>
        ) : null}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 2,
          }}
        >
          <div style={{ display: 'inline-flex', gap: 4 }}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label={t('composer.attach')}
              title={t('composer.attachTitle')}
              style={iconBtnStyle}
            >
              <Paperclip size={14} />
            </button>
            <span
              aria-hidden
              style={{
                ...iconBtnStyle,
                cursor: 'default',
                color: 'var(--color-text-faint)',
                fontSize: 9,
                width: 'auto',
                paddingLeft: 2,
                paddingRight: 2,
                fontFamily: 'var(--font-mono)',
              }}
              title={t('composer.zipTitle')}
            >
              <Package size={12} />
            </span>
            <button
              type="button"
              onClick={onGenImage}
              disabled={genBusy || prompt.trim().length === 0}
              aria-label={t('composer.generateImage')}
              title={t('composer.generateImageTitle')}
              style={{
                ...iconBtnStyle,
                color: genBusy ? 'var(--color-text-faint)' : 'var(--color-text-secondary)',
                opacity: prompt.trim().length === 0 ? 0.5 : 1,
              }}
            >
              <Sparkles size={14} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/zip,.zip"
              hidden
              onChange={onPickFile}
            />
          </div>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            aria-label={busy ? t('composer.startingRun') : t('composer.generate')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              width: launch ? 'auto' : 32,
              minWidth: launch ? 124 : 32,
              height: launch ? 38 : 32,
              padding: launch ? '0 15px' : 0,
              borderRadius: launch ? 'var(--radius-pill)' : '50%',
              background: canSubmit ? 'var(--color-accent)' : 'var(--color-surface-active)',
              border: 'none',
              color: canSubmit ? 'var(--color-on-accent)' : 'var(--color-text-faint)',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--font-size-body-sm)',
              fontWeight: 820,
              transition: 'background var(--duration-faster) var(--ease-out)',
            }}
          >
            {launch ? (
              <span>{busy ? t('composer.startingRun') : t('composer.startRun')}</span>
            ) : null}
            <ArrowUp size={14} />
          </button>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--color-text-faint)',
        }}
      >
        <span>{error ?? t('composer.helper')}</span>
        <span>
          {modelOverride
            ? `${modelOverride.provider}/${modelOverride.modelId}`
            : t('composer.routerSuffix', { tier })}
        </span>
      </div>
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  display: 'inline-grid',
  placeItems: 'center',
  width: 28,
  height: 28,
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-secondary)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
};
