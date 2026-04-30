export function findActiveKitFile(
  files: Record<string, string>,
  slug: string | undefined,
  filename: string,
): string | undefined {
  if (slug) {
    const exact = files[`ui_kits/${slug}/${filename}`];
    if (typeof exact === 'string') return exact;
  }

  for (const [path, content] of Object.entries(files)) {
    if (!path.startsWith('ui_kits/')) continue;
    if (slug && !path.startsWith(`ui_kits/${slug}/`)) continue;
    if (path.endsWith(`/${filename}`)) return content;
  }

  for (const [path, content] of Object.entries(files)) {
    if (path === filename || path.endsWith(`/${filename}`)) return content;
  }

  return undefined;
}

export function inferActiveKitSlug(files: Record<string, string>): string | undefined {
  for (const path of Object.keys(files)) {
    const match = path.match(/^ui_kits\/([^/]+)\//);
    if (match?.[1]) return match[1];
  }
  return undefined;
}
