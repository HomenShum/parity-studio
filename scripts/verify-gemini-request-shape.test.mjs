// Request-shape proof for the three Gemini demo-video verifiers (model-defaults SPEC A.0 rule 6, A.2.7).
// Each script is run as a real subprocess with a preload that stubs `fetch` (and ffprobe), then the generateContent
// request it built is read back: the model in the URL is the SPEC 1.2 id, and the body carries no sampling keys
// (`temperature` is deprecated on Gemini 3.6+). No network, no key, no spend.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const PRELOAD = String.raw`
import { appendFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
const cp = createRequire(import.meta.url)('node:child_process');
cp.spawnSync = () => ({ status: 0, stdout: '60\n', stderr: '' }); // ffprobe: a 60 s video
syncBuiltinESMExports();
const file = { name: 'files/x', uri: 'https://fake.invalid/files/x', mimeType: 'video/mp4', state: 'ACTIVE' };
globalThis.fetch = async (url, init) => {
  const u = String(url);
  appendFileSync(process.env.FAKE_LOG, JSON.stringify({ url: u, body: typeof init?.body === 'string' ? init.body : null }) + '\n');
  if (u.endsWith('/upload/v1beta/files')) return new Response('{}', { status: 200, headers: { 'x-goog-upload-url': 'https://fake.invalid/upload' } });
  if (u === 'https://fake.invalid/upload') return Response.json({ file });
  if (u.includes('/v1beta/files/x')) return Response.json(file);
  if (u.includes(':generateContent')) return Response.json({ candidates: [{ content: { parts: [{ text: '{"pass":false}' }] } }] });
  return new Response('unexpected request', { status: 500 });
};
`;

const SCRIPTS = [
  'verify-demo-video-gemini.mjs',
  'verify-current-workflows-demo-gemini.mjs',
  'verify-readme-proof-demo-gemini.mjs',
];

function runScript(script, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gemini-shape-'));
  const preload = join(dir, 'preload.mjs');
  const video = join(dir, 'demo.mp4');
  const log = join(dir, 'requests.jsonl');
  writeFileSync(preload, PRELOAD);
  writeFileSync(video, 'not a real video');
  writeFileSync(log, '');
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      pathToFileURL(preload).href,
      fileURLToPath(new URL(script, import.meta.url)),
      video,
    ],
    {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, GEMINI_API_KEY: 'test-key-not-real', FAKE_LOG: log, ...env },
    },
  );
  const requests = readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { result, requests };
}

describe('Gemini verifier scripts build a SPEC 1.2 request', () => {
  for (const script of SCRIPTS) {
    it(`${script}: gemini-3.8-flash, no sampling keys`, () => {
      const { result, requests } = runScript(script);
      const generate = requests.filter((r) => r.url.includes(':generateContent'));
      expect(generate, `${script} stderr: ${result.stderr}`).toHaveLength(1);
      expect(generate[0].url).toContain('/models/gemini-3.8-flash:generateContent');
      const body = JSON.parse(generate[0].body);
      expect(JSON.stringify(body)).not.toMatch(/temperature|topP|top_p|topK|top_k/);
      expect(Object.keys(body.generationConfig ?? {})).toEqual(['responseMimeType']);
    });

    it(`${script}: GEMINI_VIDEO_MODEL still overrides the default`, () => {
      const { requests } = runScript(script, { GEMINI_VIDEO_MODEL: 'gemini-3.6-flash' });
      const generate = requests.find((r) => r.url.includes(':generateContent'));
      expect(generate?.url).toContain('/models/gemini-3.6-flash:generateContent');
    });
  }
});
