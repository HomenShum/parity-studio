export function nodeslideHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

export function nodeslideStableId(prefix: string, ...parts: readonly string[]): string {
  return `${prefix}_${nodeslideHash(parts.join('\u001f'))}`;
}

export function nodeslideEventId(prefix: string, now: number, ...parts: readonly string[]): string {
  return `${prefix}_${now.toString(36)}_${nodeslideHash(parts.join('\u001f'))}`;
}

export function nodeslideSlug(value: string, suffix?: string): string {
  const stem = value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const safeStem = stem || 'deck';
  return suffix ? `${safeStem}-${suffix}` : safeStem;
}

export function nodeslideCleanText(value: string, maxLength: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}
