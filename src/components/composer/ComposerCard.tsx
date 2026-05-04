import { useAction, useMutation } from 'convex/react';
import JSZip from 'jszip';
import { ArrowUp, ImagePlus, Package, Paperclip, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import {
  filesFromFigmaPayload,
  isLikelyFigmaBridgePath,
  parseFigmaBridgeJson,
} from '../../lib/figmaBridge';
import { useT } from '../../lib/i18n';
import type { ModelOverride, Tier } from '../../lib/modelRouting';
import {
  buildProjectManifest,
  discoverProjectSurfaces,
  entryForSurface,
} from '../../lib/projectSurfaces';
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
const MAX_FIGMA_JSON_BYTES = 2_000_000;

const TEXT_IMPORT_EXTENSIONS = new Set([
  'css',
  'html',
  'htm',
  'js',
  'jsx',
  'json',
  'md',
  'mjs',
  'svg',
  'ts',
  'tsx',
  'txt',
  'xml',
  'yml',
  'yaml',
]);

function normalizedZipPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function fileExtension(path: string): string {
  const cleanPath = path.split('?')[0] ?? path;
  return cleanPath.includes('.') ? (cleanPath.split('.').pop() ?? '').toLowerCase() : '';
}

function shouldPreserveProjectTextFile(path: string): boolean {
  if (path.startsWith('__MACOSX/')) return false;
  if (/^(README|SKILL|AGENTS|HANDOFF|DESIGN)\.md$/i.test(path)) return true;
  if (path === 'colors_and_type.css' || path === 'parity.project.json') return true;
  if (/^(\.claude|\.cursor|\.codex|\.windsurf)\//.test(path)) return true;
  if (/^(preview|explorations|scraps|assets)\//.test(path)) {
    return TEXT_IMPORT_EXTENSIONS.has(fileExtension(path));
  }
  return false;
}

function shouldUseAsFallbackDesignFile(path: string): boolean {
  if (
    path.startsWith('__MACOSX/') ||
    path.startsWith('node_modules/') ||
    path.startsWith('.git/')
  ) {
    return false;
  }
  if (!TEXT_IMPORT_EXTENSIONS.has(fileExtension(path))) return false;
  if (/^(index|preview|artifact|design|handoff|readme|skill)\.(html|htm|md)$/i.test(path)) {
    return true;
  }
  return /^(src|app|components|styles|assets|public|design_files)\//i.test(path);
}

function slugScore(slug: string, fileCount: number): number {
  const normalized = slug.toLowerCase();
  let score = fileCount;
  if (/(web|site|marketing|dashboard)/.test(normalized)) score += 10_000;
  if (/(workspace|editor|canvas)/.test(normalized)) score += 5_000;
  if (/(mobile|phone)/.test(normalized)) score += 2_000;
  return score;
}

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

    const isJson = f.name.toLowerCase().endsWith('.json') || f.type === 'application/json';
    if (isJson) {
      if (f.size > MAX_FIGMA_JSON_BYTES) {
        setError(`Figma JSON too large (${(f.size / 1_000_000).toFixed(1)} MB > 2 MB cap)`);
        return;
      }
      try {
        await importFigmaJson(await f.text(), f.name);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    // ZIP path - drop a canonical NodeBench-skill-style ui_kit zip and
    // skip generate + decompose entirely. The kit is parsed client-side
    // and every ui_kits/<slug>/ surface is preserved in the imported run.
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

      // Preserve every ui_kits/<slug> surface in one run. This lets users
      // drop Claude Design/Open CoDesign-style packs that include web,
      // mobile, workspace, and CLI variants instead of forcing one winner.
      const slugFiles = new Map<string, Map<string, string>>();
      const importedFiles: Record<string, string> = {};
      const fallbackDesignFiles = new Map<string, string>();
      let figmaBridgeRaw: string | null = null;
      const uploads: Array<{
        name: string;
        data: Uint8Array;
        mime: 'image/png' | 'image/jpeg' | 'image/webp';
      }> = [];
      let prompt: string | undefined;

      for (const [rawPath, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        const path = normalizedZipPath(rawPath);
        if (isLikelyFigmaBridgePath(path)) {
          const text = await entry.async('string').catch(() => '');
          if (text.length > 0 && text.length <= MAX_FIGMA_JSON_BYTES) {
            figmaBridgeRaw = text;
            importedFiles[path] = text;
          }
          continue;
        }
        const kitMatch = path.match(/^ui_kits\/([^/]+)\/(.+)$/);
        if (kitMatch) {
          const slug = kitMatch[1] as string;
          const rel = kitMatch[2] as string;
          const text = await entry.async('string').catch(() => '');
          if (text.length === 0 || text.length > MAX_KIT_FILE_BYTES) continue;
          if (!slugFiles.has(slug)) slugFiles.set(slug, new Map());
          const fullPath = `ui_kits/${slug}/${rel}`;
          (slugFiles.get(slug) as Map<string, string>).set(fullPath, text);
          importedFiles[fullPath] = text;
          continue;
        }
        if (shouldPreserveProjectTextFile(path)) {
          const text = await entry.async('string').catch(() => '');
          if (text.length > 0 && text.length <= MAX_KIT_FILE_BYTES) {
            importedFiles[path] = text;
            if (shouldUseAsFallbackDesignFile(path)) fallbackDesignFiles.set(path, text);
            if (path === 'SKILL.md') {
              const desc = text.match(/description:\s*([^\n]+)/i)?.[1];
              if (desc && !prompt) prompt = desc.trim();
            }
          }
          continue;
        }
        if (shouldUseAsFallbackDesignFile(path)) {
          const text = await entry.async('string').catch(() => '');
          if (text.length > 0 && text.length <= MAX_KIT_FILE_BYTES) {
            fallbackDesignFiles.set(path, text);
          }
          continue;
        }
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
            if (data.length <= MAX_INLINE_IMAGE_BYTES) {
              uploads.push({ name: upMatch[1] as string, data, mime });
            }
          }
        }
      }

      if (slugFiles.size === 0 && figmaBridgeRaw) {
        const parsed = parseFigmaBridgeJson(figmaBridgeRaw);
        const result = filesFromFigmaPayload(parsed, file.name.replace(/\.zip$/i, ''));
        Object.assign(importedFiles, result.files);
        for (const [path, text] of Object.entries(result.files)) {
          const kitMatch = path.match(/^ui_kits\/([^/]+)\/(.+)$/);
          if (!kitMatch) continue;
          const slug = kitMatch[1] as string;
          if (!slugFiles.has(slug)) slugFiles.set(slug, new Map());
          (slugFiles.get(slug) as Map<string, string>).set(path, text);
        }
        prompt =
          result.warnings.length > 0
            ? `Imported Figma bridge: ${result.slug}. ${result.warnings[0]}`
            : `Imported Figma bridge: ${result.slug}`;
      }

      if (slugFiles.size === 0 && fallbackDesignFiles.size > 0) {
        const fallbackSlug = 'imported-design';
        const fileMap = new Map<string, string>();
        for (const [path, text] of fallbackDesignFiles.entries()) {
          const targetPath = `ui_kits/${fallbackSlug}/${path}`;
          fileMap.set(targetPath, text);
          importedFiles[targetPath] = text;
        }
        const rootIndex = fallbackDesignFiles.get('index.html');
        const firstHtml = [...fallbackDesignFiles.entries()].find(([path]) =>
          /\.(html|htm)$/i.test(path),
        );
        const indexHtml = rootIndex ?? firstHtml?.[1];
        if (indexHtml) {
          const indexPath = `ui_kits/${fallbackSlug}/index.html`;
          fileMap.set(indexPath, indexHtml);
          importedFiles[indexPath] = indexHtml;
        }
        slugFiles.set(fallbackSlug, fileMap);
      }

      if (slugFiles.size === 0) {
        throw new Error(t('composer.noUiKitFolder'));
      }

      for (const [slug, fileMap] of slugFiles.entries()) {
        const indexPath = `ui_kits/${slug}/index.html`;
        if (fileMap.has(indexPath)) continue;
        const entryPath = entryForSurface(importedFiles, slug);
        const entryHtml = entryPath ? importedFiles[entryPath] : undefined;
        if (entryHtml !== undefined) {
          fileMap.set(indexPath, entryHtml);
          importedFiles[indexPath] = entryHtml;
        }
      }

      const ranked = [...slugFiles.entries()].sort((a, b) => {
        const delta = slugScore(b[0], b[1].size) - slugScore(a[0], a[1].size);
        return delta || a[0].localeCompare(b[0]);
      });
      const first = ranked[0];
      if (!first) throw new Error(t('composer.noUiKitFolder'));
      const [activeSlug] = first;
      const surfaces = discoverProjectSurfaces(importedFiles, activeSlug);
      importedFiles['parity.project.json'] = JSON.stringify(
        buildProjectManifest(
          surfaces,
          activeSlug,
          new Date().toISOString(),
          surfaces.length > 1 ? 'project-pack' : 'canonical-ui-kit-zip',
        ),
        null,
        2,
      );

      let sourceImageBase64: string | undefined;
      let sourceImageMimeType: 'image/png' | 'image/jpeg' | 'image/webp' | undefined;
      if (uploads.length > 0) {
        const firstUpload = uploads[0];
        if (firstUpload) {
          let bin = '';
          for (let i = 0; i < firstUpload.data.length; i += 1) {
            bin += String.fromCharCode(firstUpload.data[i] as number);
          }
          sourceImageBase64 = btoa(bin);
          sourceImageMimeType = firstUpload.mime;
        }
      }

      const runId = await startFromKit({
        slug: activeSlug,
        files: importedFiles,
        clientSessionId,
        ...(modelOverride ? { modelOverride } : { tier }),
        ...(sourceImageBase64 ? { sourceImageBase64 } : {}),
        ...(sourceImageMimeType ? { sourceImageMimeType } : {}),
        ...(prompt ? { prompt } : {}),
      });
      onRunStarted(runId);

      const importedCount = Object.keys(importedFiles).length;
      const note =
        surfaces.length > 1
          ? t('composer.importedWithOthers', {
              slug: activeSlug,
              count: importedCount,
              otherCount: surfaces.length - 1,
              plural: surfaces.length - 1 === 1 ? '' : 's',
              others: surfaces
                .filter((surface) => surface.slug !== activeSlug)
                .map((surface) => surface.slug)
                .join(', '),
            })
          : t('composer.imported', { slug: activeSlug, count: importedCount });
      setImageLabel(note);
    } finally {
      setBusy(false);
    }
  }

  async function importFigmaJson(raw: string, filename: string) {
    setBusy(true);
    try {
      const parsed = parseFigmaBridgeJson(raw);
      const result = filesFromFigmaPayload(parsed, filename.replace(/\.json$/i, ''));
      const surfaces = discoverProjectSurfaces(result.files, result.slug);
      result.files['parity.project.json'] = JSON.stringify(
        buildProjectManifest(surfaces, result.slug, new Date().toISOString(), 'project-pack'),
        null,
        2,
      );
      const runId = await startFromKit({
        slug: result.slug,
        files: result.files,
        clientSessionId,
        ...(modelOverride ? { modelOverride } : { tier }),
        prompt:
          result.warnings.length > 0
            ? `Imported Figma bridge: ${result.slug}. ${result.warnings[0]}`
            : `Imported Figma bridge: ${result.slug}`,
      });
      onRunStarted(runId);
      setImageLabel(`imported Figma bridge ${result.slug}`);
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
              accept="image/png,image/jpeg,image/webp,application/zip,application/json,.zip,.json"
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
