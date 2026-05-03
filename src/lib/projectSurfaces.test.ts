import { describe, expect, it } from 'vitest';
import {
  activeSurfaceFor,
  buildProjectManifest,
  discoverProjectSurfaces,
  entryForSurface,
  surfaceTokenPath,
} from './projectSurfaces';

describe('projectSurfaces', () => {
  const files: Record<string, string> = {
    'ui_kits/nodebench-web/index.html': '<main>web</main>',
    'ui_kits/nodebench-web/tokens.css': ':root{}',
    'ui_kits/nodebench-mobile/index.html': '<main>mobile</main>',
    'ui_kits/nodebench-workspace/AI Workspace.html': '<main>workspace</main>',
    'ui_kits/nodebench-workspace/shared.css': ':root{}',
    'ui_kits/nodebench-mcp/index.html': '<main>cli</main>',
    'colors_and_type.css': ':root{}',
  };

  it('discovers every ui_kits slug instead of picking only the largest one', () => {
    const surfaces = discoverProjectSurfaces(files, 'nodebench-web');
    expect(surfaces.map((surface) => surface.slug)).toEqual([
      'nodebench-web',
      'nodebench-workspace',
      'nodebench-mobile',
      'nodebench-mcp',
    ]);
    expect(surfaces.find((surface) => surface.slug === 'nodebench-mobile')?.defaultDevice).toBe(
      'phone',
    );
  });

  it('uses root html files as entries when index.html is missing', () => {
    expect(entryForSurface(files, 'nodebench-workspace')).toBe(
      'ui_kits/nodebench-workspace/AI Workspace.html',
    );
  });

  it('resolves active surface and token paths from the selected slug', () => {
    const surface = activeSurfaceFor(files, 'nodebench-web', 'nodebench-workspace');
    expect(surface?.slug).toBe('nodebench-workspace');
    expect(surfaceTokenPath(files, surface)).toBe('ui_kits/nodebench-workspace/shared.css');
  });

  it('round-trips a project manifest that external agents can read', () => {
    const surfaces = discoverProjectSurfaces(files, 'nodebench-web');
    const manifest = buildProjectManifest(surfaces, 'nodebench-web', '2026-05-03T00:00:00.000Z');
    const withManifest = { ...files, 'parity.project.json': JSON.stringify(manifest) };
    expect(discoverProjectSurfaces(withManifest).map((surface) => surface.slug)).toContain(
      'nodebench-workspace',
    );
  });
});
