'use node';

import OpenAI from 'openai';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';

/**
 * Stage 0 (optional): generate a SOURCE MOCKUP image from a text prompt via
 * gpt-image-2. The downstream generate stage uses this image as the visual
 * reference for HTML synthesis.
 *
 * Why gpt-image-2 specifically: HTTP 200 verified on api.openai.com on
 * 2026-04-27. Quality 'high' at 1536x1024 produces ~1.5MB PNGs that the
 * vision-capable LLM stages can consume directly via base64 inlining.
 *
 * Cost reference (OpenAI pricing as of 2026-04):
 *   gpt-image-2 high     1024x1024  ~$0.10
 *                        1536x1024  ~$0.16  (default — better aspect for app UI)
 *                        1024x1536  ~$0.16
 *   gpt-image-2 medium   1024x1024  ~$0.04
 *
 * Persists to Convex Storage so the workflow journal stays small (storageId
 * is a few bytes) and the image survives workflow replays.
 */
export const generateSourceImage = internalAction({
  args: {
    runId: v.id('runs'),
    prompt: v.string(),
    quality: v.optional(v.union(v.literal('high'), v.literal('medium'))),
    size: v.optional(
      v.union(v.literal('1024x1024'), v.literal('1536x1024'), v.literal('1024x1536')),
    ),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stageStartedAt = Date.now();
    await ctx.runMutation(internal.runs.updateStatus, { runId: args.runId, status: 'generating' });

    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      await ctx.runMutation(internal.runs.updateStatus, {
        runId: args.runId,
        status: 'failed',
        errorMessage: 'imageGen requires OPENAI_API_KEY in Convex env',
      });
      throw new Error('OPENAI_API_KEY missing');
    }

    const model = args.model ?? 'gpt-image-2';
    const quality = args.quality ?? 'high';
    const size = args.size ?? '1536x1024';

    const client = new OpenAI({ apiKey });
    const result = await client.images.generate({
      model,
      prompt: args.prompt,
      size,
      quality,
      n: 1,
    });

    const data = result.data?.[0];
    const b64 = data?.b64_json;
    if (b64 === undefined) {
      throw new Error(`gpt-image-2 returned no b64_json. Full response keys: ${Object.keys(result).join(',')}`);
    }

    // Decode + persist to Convex Storage
    const buffer = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const blob = new Blob([buffer], { type: 'image/png' });
    const storageId = await ctx.storage.store(blob);

    // Cost estimate (OpenAI doesn't return cost in image responses)
    const costMicroUsdEstimate = (() => {
      if (quality === 'high') {
        return size === '1024x1024' ? 100_000 : 160_000; // $0.10 / $0.16
      }
      return size === '1024x1024' ? 40_000 : 64_000; // $0.04 / $0.064
    })();

    const latencyMs = Date.now() - stageStartedAt;

    // Persist storageId on the run so downstream stages + UI can use it
    await ctx.runMutation(internal.runs.setSourceImageStorageId, {
      runId: args.runId,
      storageId,
    });

    await ctx.runMutation(internal.runs.recordStageTelemetry, {
      runId: args.runId,
      stage: 'image-gen',
      modelId: model,
      provider: 'openai',
      costMicroUsd: costMicroUsdEstimate,
      latencyMs,
      stageStartedAt,
    });

    return {
      storageId,
      sizeBytes: buffer.byteLength,
      base64: b64,
      mimeType: 'image/png' as const,
      costMicroUsd: costMicroUsdEstimate,
      latencyMs,
    };
  },
});
