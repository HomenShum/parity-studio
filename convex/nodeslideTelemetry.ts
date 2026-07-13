'use node';

import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';
import {
  nodeSlideOtlpEndpoint,
  nodeSlideOtlpTracePayload,
  parseOtlpHeaders,
} from './lib/nodeslideOtlp';

export const exportRunOtlpInternal = internalAction({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    const snapshot = await ctx.runQuery(
      internal.nodeslide.getAgentTelemetryForExportInternal,
      args,
    );
    if (!snapshot) return null;
    const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT']?.trim();
    if (!endpoint) {
      await ctx.runMutation(internal.nodeslide.markAgentTelemetryExportInternal, {
        runId: args.runId,
        status: 'skipped',
      });
      return 'skipped';
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(nodeSlideOtlpEndpoint(endpoint), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...parseOtlpHeaders(process.env['OTEL_EXPORTER_OTLP_HEADERS']),
        },
        body: JSON.stringify(nodeSlideOtlpTracePayload(snapshot)),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`OTLP collector returned HTTP ${response.status}.`);
      await ctx.runMutation(internal.nodeslide.markAgentTelemetryExportInternal, {
        runId: args.runId,
        status: 'exported',
      });
      return 'exported';
    } catch (error) {
      await ctx.runMutation(internal.nodeslide.markAgentTelemetryExportInternal, {
        runId: args.runId,
        status: 'failed',
        error: error instanceof Error ? error.message.slice(0, 300) : 'OTLP export failed.',
      });
      return 'failed';
    } finally {
      clearTimeout(timer);
    }
  },
});
