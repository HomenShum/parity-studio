// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
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
  afterEach(cleanup);

  it('explains immutable sanitized sharing and exposes revocation', () => {
    render(
      <div className="nodeslide-studio">
        <PublicationDialog
          open
          publication={publication}
          shareUrl="https://example.com/?share=share-private&present=1"
          currentDeckVersion={5}
          busy={false}
          onClose={() => undefined}
          onCopy={() => undefined}
          onPublish={() => undefined}
          onRevoke={() => undefined}
        />
      </div>,
    );

    expect(screen.getByRole('dialog')).toHaveTextContent('immutable snapshot');
    expect(screen.getByRole('dialog')).toHaveTextContent('Speaker notes');
    expect(screen.getByRole('dialog')).toHaveTextContent('Version 4 remains published');
    expect(screen.getByRole('button', { name: 'Publish current version & copy' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Revoke link' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Published view-only link' })).toBeVisible();
  });
});
