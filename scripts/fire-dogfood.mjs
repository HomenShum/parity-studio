#!/usr/bin/env node
import { ConvexHttpClient } from 'convex/browser';
import fs from 'node:fs';
import path from 'node:path';

const promptPath = process.argv[2];
if (!promptPath) {
  console.error('Usage: node fire-dogfood.mjs <promptFile>');
  process.exit(1);
}
const prompt = fs.readFileSync(path.resolve(promptPath), 'utf8');

// Read prod URL from .env.local
const envText = fs.readFileSync(path.resolve('.env.local'), 'utf8');
// We're hitting prod, not dev — replace with prod URL
const prodUrl = 'https://blissful-pig-998.convex.cloud';

const client = new ConvexHttpClient(prodUrl);
console.log(`firing runs.start at ${prodUrl}`);
console.log(`prompt: ${prompt.length} chars (${prompt.slice(0, 80)}...)`);

const runId = await client.mutation('runs:start', {
  prompt,
  generateMockupFirst: true,
});
console.log(`runId=${runId}`);
console.log(`poll: npx convex run --prod runs:get '{"runId":"${runId}"}'`);
console.log(`source img: https://blissful-pig-998.convex.site/api/runs/${runId}/source`);
console.log(`zip: https://blissful-pig-998.convex.site/api/runs/${runId}/zip`);
