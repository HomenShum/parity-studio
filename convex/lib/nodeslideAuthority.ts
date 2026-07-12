import { nodeslideContentDigest } from './nodeslideIds';

/** Keeps authorization observably ahead of quota consumption in action orchestration. */
export async function authorizeBeforeConsumingQuota<Authorized>(args: {
  authorize: () => Promise<Authorized>;
  consume: (authorized: Authorized) => Promise<void>;
}): Promise<Authorized> {
  const authorized = await args.authorize();
  await args.consume(authorized);
  return authorized;
}

/** Full SHA-256 partition; owner capabilities never enter quota keys directly. */
export function nodeSlideActorQuotaKey(namespace: string, ownerAccessKey: string): string {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(namespace)) throw new Error('Invalid quota namespace.');
  return `${namespace}:${nodeslideContentDigest(ownerAccessKey)}`;
}
