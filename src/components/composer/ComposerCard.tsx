import { useAction, useMutation } from 'convex/react';
import { ArrowUp, ImagePlus, Paperclip, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

interface ComposerCardProps {
  onRunStarted: (runId: Id<'runs'>) => void;
}

const MAX_INLINE_IMAGE_BYTES = 2_000_000;

/**
 * Composer — replaces the legacy InputBar at the bottom of the pipeline rail.
 *
 * - prompt textarea (auto-grow), ↵ submits
 * - paperclip → file picker (image upload)
 * - sparkles → in-app gpt-image-2 generation from the typed prompt
 * - submit button (terracotta circle ↑)
 * - model picker pill below ("gpt-5.4 ▾", visual-only for now)
 */
export function ComposerCard({ onRunStarted }: ComposerCardProps) {
  const startRun = useMutation(api.runs.start);
  const generateImage = useAction(api.generation.generateSourceImage);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [prompt, setPrompt] = useState('');
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<'image/png' | 'image/jpeg' | 'image/webp' | null>(null);
  const [imageLabel, setImageLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_INLINE_IMAGE_BYTES) {
      setError(`image too large (${(f.size / 1_000_000).toFixed(1)} MB > 2 MB cap)`);
      return;
    }
    const mime =
      f.type === 'image/png' || f.type === 'image/jpeg' || f.type === 'image/webp'
        ? (f.type as 'image/png' | 'image/jpeg' | 'image/webp')
        : null;
    if (!mime) {
      setError('only png / jpeg / webp supported');
      return;
    }
    const buf = await f.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    setImageBase64(b64);
    setImageMime(mime);
    setImageLabel(f.name);
  }

  async function onGenImage() {
    if (prompt.trim().length === 0) {
      setError('type a prompt first, then click sparkles to generate an image');
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
      setError('add a prompt or an image to generate');
      return;
    }
    setBusy(true);
    try {
      const args: {
        prompt?: string;
        sourceImageBase64?: string;
        sourceImageMimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
      } = {};
      if (prompt.trim().length > 0) args.prompt = prompt.trim();
      if (imageBase64 !== null && imageMime !== null) {
        args.sourceImageBase64 = imageBase64;
        args.sourceImageMimeType = imageMime;
      }
      const runId = await startRun(args);
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-soft)',
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
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
          placeholder="Describe a design… try 'Pitch deck for a fintech startup'"
          aria-label="Describe the design"
          style={{
            resize: 'none',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--font-size-body)',
            color: 'var(--color-text-primary)',
            lineHeight: 'var(--leading-snug)',
            minHeight: 60,
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
              aria-label="Attach an image"
              title="Attach image (png/jpeg/webp ≤ 2 MB)"
              style={iconBtnStyle}
            >
              <Paperclip size={14} />
            </button>
            <button
              type="button"
              onClick={onGenImage}
              disabled={genBusy || prompt.trim().length === 0}
              aria-label="Generate image with gpt-image-2"
              title="Generate a source image from the prompt"
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
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={onPickFile}
            />
          </div>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            aria-label={busy ? 'Starting run…' : 'Generate'}
            style={{
              display: 'inline-grid',
              placeItems: 'center',
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: canSubmit ? 'var(--color-accent)' : 'var(--color-surface-active)',
              border: 'none',
              color: canSubmit ? 'var(--color-on-accent)' : 'var(--color-text-faint)',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              transition: 'background var(--duration-faster) var(--ease-out)',
            }}
          >
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
        <span>{error ?? 'cmd/ctrl + ⏎ to run · ~$0.10–0.80 per pipeline'}</span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 8px',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-pill)',
            color: 'var(--color-text-secondary)',
          }}
        >
          gpt-5.4 ▾
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
