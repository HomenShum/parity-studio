import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { NodeSlidePublication } from '../../../../shared/nodeslide';
import { PublicationDialog } from './PublicationDialog';

const publication: NodeSlidePublication = {
  id: 'publication:1',
  deckId: 'deck:1',
  shareSlug: 'share-private',
  revision: 1,
  deckVersion: 4,
  validationId: 'validation:4',
  status: 'active',
  publishedAt: 1,
};

describe('NodeSlide publication dialog', () => {
  it('explains immutable sanitized sharing and exposes revocation', () => {
    const markup = renderToStaticMarkup(
      <PublicationDialog
        open
        publication={publication}
        shareUrl="https://example.com/?share=share-private&amp;present=1"
        currentDeckVersion={5}
        busy={false}
        onClose={() => undefined}
        onCopy={() => undefined}
        onPublish={() => undefined}
        onRevoke={() => undefined}
      />,
    );

    expect(markup).toContain('immutable snapshot');
    expect(markup).toContain('Speaker notes');
    expect(markup).toContain('Version 4 remains published');
    expect(markup).toContain('Publish current version &amp; copy');
    expect(markup).toContain('Revoke link');
    expect(markup).toContain('Published view-only link');
  });
});
