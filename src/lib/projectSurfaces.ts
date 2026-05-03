export type ProjectSurfaceKind =
  | 'web'
  | 'mobile'
  | 'workspace'
  | 'cli'
  | 'design-system'
  | 'surface';

export type ProjectSurfaceDevice = 'desktop' | 'tablet' | 'phone';

export interface ProjectSurface {
  slug: string;
  label: string;
  kind: ProjectSurfaceKind;
  entry: string | null;
  defaultDevice: ProjectSurfaceDevice;
  fileCount: number;
  hasIndex: boolean;
}

export interface ProjectManifestSurface {
  slug: string;
  label: string;
  kind: ProjectSurfaceKind;
  entry: string | null;
  defaultDevice: ProjectSurfaceDevice;
}

export interface ProjectManifest {
  schemaVersion: 1;
  generator: 'parity-studio';
  activeSurface: string;
  source: {
    format: 'canonical-ui-kit-zip' | 'project-pack';
    importedAt: string;
  };
  surfaces: ProjectManifestSurface[];
}

const PROJECT_MANIFEST_PATH = 'parity.project.json';

export function slugFromPath(path: string): string | null {
  const match = path.match(/^ui_kits\/([^/]+)\//);
  return match?.[1] ?? null;
}

export function humanizeSurfaceSlug(slug: string): string {
  return slug
    .replace(/^nodebench[-_]/i, 'NodeBench ')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

export function inferSurfaceKind(slug: string): ProjectSurfaceKind {
  const normalized = slug.toLowerCase();
  if (/(mobile|phone|ios|android|casual-mobile)/.test(normalized)) return 'mobile';
  if (/(cli|mcp|terminal|command)/.test(normalized)) return 'cli';
  if (/(workspace|canvas|editor|agent)/.test(normalized)) return 'workspace';
  if (/(design-system|tokens|library)/.test(normalized)) return 'design-system';
  if (/(web|site|marketing|dashboard|casual)/.test(normalized)) return 'web';
  return 'surface';
}

export function defaultDeviceForSurface(kind: ProjectSurfaceKind): ProjectSurfaceDevice {
  if (kind === 'mobile') return 'phone';
  return 'desktop';
}

export function entryForSurface(files: Record<string, string>, slug: string): string | null {
  const root = `ui_kits/${slug}/`;
  const indexPath = `${root}index.html`;
  if (files[indexPath] !== undefined) return indexPath;

  const rootHtml = Object.keys(files)
    .filter((path) => path.startsWith(root) && path.slice(root.length).endsWith('.html'))
    .filter((path) => !path.slice(root.length).includes('/'))
    .sort((a, b) => a.localeCompare(b));
  const firstRootHtml = rootHtml[0];
  if (firstRootHtml) return firstRootHtml;

  const nestedHtml = Object.keys(files)
    .filter((path) => path.startsWith(root) && path.endsWith('.html'))
    .sort((a, b) => a.localeCompare(b));
  return nestedHtml[0] ?? null;
}

export function discoverProjectSurfaces(
  files: Record<string, string>,
  preferredSlug?: string | null,
): ProjectSurface[] {
  const manifest = parseProjectManifest(files[PROJECT_MANIFEST_PATH]);
  const slugSet = new Set<string>();
  for (const path of Object.keys(files)) {
    const slug = slugFromPath(path);
    if (slug) slugSet.add(slug);
  }
  for (const surface of manifest?.surfaces ?? []) {
    slugSet.add(surface.slug);
  }

  const surfaces = [...slugSet].map((slug) => {
    const manifestSurface = manifest?.surfaces.find((surface) => surface.slug === slug);
    const kind = manifestSurface?.kind ?? inferSurfaceKind(slug);
    const entry =
      manifestSurface?.entry && files[manifestSurface.entry] !== undefined
        ? manifestSurface.entry
        : entryForSurface(files, slug);
    const root = `ui_kits/${slug}/`;
    const fileCount = Object.keys(files).filter((path) => path.startsWith(root)).length;
    return {
      slug,
      label: manifestSurface?.label ?? humanizeSurfaceSlug(slug),
      kind,
      entry,
      defaultDevice: manifestSurface?.defaultDevice ?? defaultDeviceForSurface(kind),
      fileCount,
      hasIndex: files[`${root}index.html`] !== undefined,
    };
  });

  const activeSlug = preferredSlug ?? manifest?.activeSurface ?? null;
  return surfaces.sort((a, b) => {
    if (a.slug === activeSlug) return -1;
    if (b.slug === activeSlug) return 1;
    const kindRank = surfaceKindRank(a.kind) - surfaceKindRank(b.kind);
    if (kindRank !== 0) return kindRank;
    return a.label.localeCompare(b.label);
  });
}

export function activeSurfaceFor(
  files: Record<string, string>,
  fallbackSlug: string | null | undefined,
  requestedSlug?: string | null,
): ProjectSurface | null {
  const surfaces = discoverProjectSurfaces(files, requestedSlug ?? fallbackSlug);
  if (surfaces.length === 0) return null;
  const requested = requestedSlug
    ? surfaces.find((surface) => surface.slug === requestedSlug)
    : undefined;
  if (requested) return requested;
  const fallback = fallbackSlug ? surfaces.find((surface) => surface.slug === fallbackSlug) : null;
  return fallback ?? surfaces[0] ?? null;
}

export function surfaceTokenPath(
  files: Record<string, string>,
  surface: ProjectSurface | null,
): string | null {
  if (!surface) return null;
  const root = `ui_kits/${surface.slug}/`;
  const preferred = [`${root}tokens.css`, `${root}shared.css`, `${root}styles.css`];
  for (const path of preferred) {
    if (files[path] !== undefined) return path;
  }
  const rootCss = Object.keys(files)
    .filter((path) => path.startsWith(root) && path.endsWith('.css'))
    .sort((a, b) => cssRank(a) - cssRank(b) || a.localeCompare(b));
  if (rootCss[0]) return rootCss[0];
  return files['colors_and_type.css'] !== undefined ? 'colors_and_type.css' : null;
}

export function buildProjectManifest(
  surfaces: ProjectSurface[],
  activeSurface: string,
  importedAt: string,
  format: ProjectManifest['source']['format'] = 'project-pack',
): ProjectManifest {
  return {
    schemaVersion: 1,
    generator: 'parity-studio',
    activeSurface,
    source: { format, importedAt },
    surfaces: surfaces.map((surface) => ({
      slug: surface.slug,
      label: surface.label,
      kind: surface.kind,
      entry: surface.entry,
      defaultDevice: surface.defaultDevice,
    })),
  };
}

export function surfaceScopedPaths(files: Record<string, string>, surfaceSlug: string): string[] {
  const root = `ui_kits/${surfaceSlug}/`;
  return Object.keys(files)
    .filter((path) => path.startsWith(root))
    .sort((a, b) => a.localeCompare(b));
}

function parseProjectManifest(value: string | undefined): ProjectManifest | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ProjectManifest>;
    if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.surfaces)) return null;
    const surfaces = parsed.surfaces
      .filter((surface) => typeof surface?.slug === 'string' && surface.slug.length > 0)
      .map((surface) => {
        const kind = isProjectSurfaceKind(surface.kind)
          ? surface.kind
          : inferSurfaceKind(surface.slug);
        return {
          slug: surface.slug,
          label:
            typeof surface.label === 'string' && surface.label.length > 0
              ? surface.label
              : humanizeSurfaceSlug(surface.slug),
          kind,
          entry: typeof surface.entry === 'string' ? surface.entry : null,
          defaultDevice: isProjectSurfaceDevice(surface.defaultDevice)
            ? surface.defaultDevice
            : defaultDeviceForSurface(kind),
        };
      });
    if (surfaces.length === 0) return null;
    return {
      schemaVersion: 1,
      generator: 'parity-studio',
      activeSurface:
        typeof parsed.activeSurface === 'string' && parsed.activeSurface.length > 0
          ? parsed.activeSurface
          : (surfaces[0]?.slug ?? 'ui-kit'),
      source: {
        format:
          parsed.source?.format === 'canonical-ui-kit-zip'
            ? 'canonical-ui-kit-zip'
            : 'project-pack',
        importedAt:
          typeof parsed.source?.importedAt === 'string'
            ? parsed.source.importedAt
            : new Date(0).toISOString(),
      },
      surfaces,
    };
  } catch {
    return null;
  }
}

function isProjectSurfaceKind(value: unknown): value is ProjectSurfaceKind {
  return (
    value === 'web' ||
    value === 'mobile' ||
    value === 'workspace' ||
    value === 'cli' ||
    value === 'design-system' ||
    value === 'surface'
  );
}

function isProjectSurfaceDevice(value: unknown): value is ProjectSurfaceDevice {
  return value === 'desktop' || value === 'tablet' || value === 'phone';
}

function surfaceKindRank(kind: ProjectSurfaceKind): number {
  if (kind === 'web') return 0;
  if (kind === 'workspace') return 1;
  if (kind === 'mobile') return 2;
  if (kind === 'cli') return 3;
  if (kind === 'design-system') return 4;
  return 5;
}

function cssRank(path: string): number {
  const lower = path.toLowerCase();
  if (lower.endsWith('/tokens.css')) return 0;
  if (lower.endsWith('/shared.css')) return 1;
  if (lower.endsWith('/styles.css')) return 2;
  if (lower.includes('terminal')) return 3;
  return 4;
}
