import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyApprovedDesign } from './applyApprovedDesign';

const files = {
  'ui_kits/demo/index.html': '<main>Demo</main>',
  'ui_kits/demo/tokens.css': ':root{--color-accent:#d95f3f;}',
  'ui_kits/demo/components/Button.tsx':
    'export function Button(){ return <button>Start</button>; }',
};

describe('applyApprovedDesign', () => {
  it('plans inferred staging writes in dry-run mode by default', async () => {
    const result = await applyApprovedDesign({ uiKitFiles: files, projectRoot: '.', slug: 'demo' });
    expect(result.dryRun).toBe(true);
    expect(result.operations.some((op) => op.toPath.endsWith('components/Button.tsx'))).toBe(true);
    expect(result.writtenCount).toBe(0);
  });

  it('writes explicit approved mappings when dryRun is false', async () => {
    const root = await mkdtemp(join(tmpdir(), 'parity-apply-'));
    const result = await applyApprovedDesign({
      uiKitFiles: files,
      projectRoot: root,
      slug: 'demo',
      dryRun: false,
      mappings: [
        {
          fromPath: 'ui_kits/demo/components/Button.tsx',
          toPath: 'src/components/Button.tsx',
        },
      ],
    });
    expect(result.writtenCount).toBe(1);
    await expect(readFile(join(root, 'src/components/Button.tsx'), 'utf8')).resolves.toContain(
      'function Button',
    );
  });

  it('rejects targets outside the project root or secret paths', async () => {
    await expect(
      applyApprovedDesign({
        uiKitFiles: files,
        projectRoot: '.',
        mappings: [{ fromPath: 'ui_kits/demo/index.html', toPath: '../escape.html' }],
      }),
    ).rejects.toThrow(/escapes projectRoot/);

    await expect(
      applyApprovedDesign({
        uiKitFiles: files,
        projectRoot: '.',
        mappings: [{ fromPath: 'ui_kits/demo/index.html', toPath: '.env.local' }],
      }),
    ).rejects.toThrow(/forbidden/);
  });
});
