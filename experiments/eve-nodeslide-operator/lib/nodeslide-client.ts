import { NodeSlideAgentClient } from '@parity/nodeslide-agent-client';

let singleton: NodeSlideAgentClient | undefined;

export function nodeSlideClient(): NodeSlideAgentClient {
  if (singleton) return singleton;
  const convexUrl = process.env.PARITY_CONVEX_URL;
  const ownerAccessKey = process.env.NODESLIDE_OWNER_ACCESS_KEY;
  if (!convexUrl) throw new Error('PARITY_CONVEX_URL is required.');
  if (!ownerAccessKey) throw new Error('NODESLIDE_OWNER_ACCESS_KEY is required.');
  singleton = new NodeSlideAgentClient({ convexUrl, ownerAccessKey });
  return singleton;
}
