import { useState } from 'react';

/**
 * InputBar — DOM/CSS verbatim from platform-generated parity-studio/index.html.
 * Source-image upload + free-text prompt + Generate button. Convex `runs:start`
 * mutation wires in next pass; for now the click logs intent honestly.
 */
export function InputBar() {
  const [prompt, setPrompt] = useState('');
  const [imageName, setImageName] = useState<string | null>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setImageName(f.name);
  }

  async function onRun() {
    // TODO(v0.0.3): wire to Convex `runs:start` mutation with prompt + storage id
    console.warn('runs:start not wired yet', { prompt, imageName });
  }

  const canRun = prompt.trim().length > 0 || imageName !== null;

  return (
    <>
      <div className="input-section">
        <label className="source-button">
          <span aria-hidden="true">+</span>
          <span>{imageName ?? 'source image'}</span>
          <input
            type="file"
            accept="image/*"
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
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canRun) {
              void onRun();
            }
          }}
        />
        <button
          type="button"
          className="generate-button"
          disabled={!canRun}
          onClick={onRun}
        >
          Generate
        </button>
      </div>
      <div className="help-text">
        <span>cmd/ctrl + enter to run</span>
        <span>est. cost $0.10-0.80 per full pipeline</span>
      </div>
    </>
  );
}
