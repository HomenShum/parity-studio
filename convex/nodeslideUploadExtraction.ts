'use node';

import { v } from 'convex/values';
import { internal } from './_generated/api';
import { action } from './_generated/server';
import { nodeslideContentDigest } from './lib/nodeslideIds';
import {
  canonicalNodeSlideUploadDigest,
  extractNodeSlidePdfText,
} from './lib/nodeslidePdfExtraction';

/** Node-runtime PDF extractor. Only approved, owner/session-bound storage can reach it. */
export const materializeApprovedPdfUpload = action({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    clientSessionId: v.string(),
    uploadId: v.string(),
  },
  handler: async (ctx, args): Promise<{ id: string; kind: 'source'; label: string }> => {
    const upload = await ctx.runQuery(
      internal.nodeslideUploads.getApprovedUploadForMaterializationInternal,
      args,
    );
    if (!upload || upload.format !== 'pdf') {
      throw new Error('NodeSlide approved PDF upload is unavailable.');
    }
    const blob = await ctx.storage.get(upload.storageId);
    if (!blob) throw new Error('NodeSlide approved PDF storage is unavailable.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const digest = nodeslideContentDigest(bytes);
    if (digest !== canonicalNodeSlideUploadDigest(upload.contentDigest)) {
      throw new Error('Stored PDF digest no longer matches its approved upload receipt.');
    }
    const extracted = await extractNodeSlidePdfText(bytes);
    return ctx.runMutation(internal.nodeslide.attachStoredDataSourceInternal, {
      deckId: args.deckId,
      ownerAccessKey: args.ownerAccessKey,
      title: upload.fileName,
      format: 'pdf',
      preview: `PDF pages: ${extracted.pageCount}\n${extracted.preview}`,
      previewTruncated: extracted.truncated,
      contentDigest: digest,
      byteSize: bytes.byteLength,
    });
  },
});
