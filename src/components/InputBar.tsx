import { useMutation } from 'convex/react';
import { useState } from 'react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

/**
 * InputBar — wired to Convex `runs:start` mutation.
 *
 * Source-image upload reads the file as base64 and passes it inline (capped
 * at 2 MB by the schema convention; for larger files use Convex Storage via
 * the dashboard upload flow, which is a follow-up).
 */
interface InputBarProps {
  onRunStarted: (runId: Id<'runs'>) => void;
}

const MAX_INLINE_IMAGE_BYTES = 2_000_000;

export function InputBar({ onRunStarted }: InputBarProps) {
  const startRun = useMutation(api.runs.start);
  const [prompt, setPrompt] = useState('');
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<'image/png' | 'image/jpeg' | 'image/webp' | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
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
    setImageName(f.name);
  }

  async function onRun() {
    setError(null);
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
      // Optional: clear the prompt so subsequent runs feel fresh
      setPrompt('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const canRun = !busy && (prompt.trim().length > 0 || imageBase64 !== null);

  return (
    <>
      <div className="input-section">
        <label className="source-button">
          <span aria-hidden="true">+</span>
          <span>{imageName ?? 'source image'}</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={onFile}
            aria-label="Upload source image for the pipeline"
          />
        </label>
        <input
          type="text"
          className="input-field"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="describe the UI. or just upload a sketch..."
          aria-label="Describe the UI to generate"
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canRun) {
              void onRun();
            }
          }}
        />
        <button type="button" className="generate-button" disabled={!canRun} onClick={onRun}>
          {busy ? 'Starting...' : 'Generate'}
        </button>
      </div>
      <div className="help-text">
        <span>{error ?? 'cmd/ctrl + enter to run'}</span>
        <span>est. cost $0.10-0.80 per full pipeline</span>
      </div>
    </>
  );
}
