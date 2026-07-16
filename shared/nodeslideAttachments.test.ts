import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  NodeSlideDataAttachment,
  NodeSlideStoredAttachmentFormat,
  NodeSlideStoredAttachmentMetadata,
} from './nodeslideAttachments';

describe('NodeSlide attachment contracts', () => {
  it('keeps the small inline attachment contract unchanged', () => {
    const inline: NodeSlideDataAttachment = {
      title: 'metrics.csv',
      format: 'csv',
      content: 'label,value\nA,1',
    };

    expect(inline).toEqual({
      title: 'metrics.csv',
      format: 'csv',
      content: 'label,value\nA,1',
    });
  });

  it('exposes binary-backed metadata without a storage locator', () => {
    const metadata: NodeSlideStoredAttachmentMetadata = {
      id: 'upload_1',
      deckId: 'deck_1',
      clientSessionId: 'session_1',
      fileName: 'brief.pdf',
      format: 'pdf',
      contentType: 'application/pdf',
      byteSize: 1_024,
      contentDigest: 'digest',
      lifecycleStatus: 'registered',
      securityStatus: 'approved',
      quarantineStatus: 'released',
      modelAccessAllowed: true,
      createdAt: 1,
      updatedAt: 2,
    };

    expect(metadata).not.toHaveProperty('storageId');
    expect(metadata).not.toHaveProperty('url');
    expectTypeOf<NodeSlideStoredAttachmentFormat>().toEqualTypeOf<
      | 'csv'
      | 'json'
      | 'txt'
      | 'md'
      | 'pdf'
      | 'docx'
      | 'xlsx'
      | 'png'
      | 'jpeg'
      | 'webp'
      | 'gif'
      | 'pptx'
    >();
  });
});
