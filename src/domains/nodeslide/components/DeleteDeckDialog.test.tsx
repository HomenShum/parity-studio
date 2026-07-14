import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DeleteDeckDialog, deleteDeckConfirmationMatches } from './DeleteDeckDialog';

describe('DeleteDeckDialog', () => {
  it('requires an exact, case-sensitive deck title', () => {
    expect(deleteDeckConfirmationMatches('Board update', 'Board update')).toBe(true);
    expect(deleteDeckConfirmationMatches('board update', 'Board update')).toBe(false);
    expect(deleteDeckConfirmationMatches('Board update ', 'Board update')).toBe(false);
    expect(deleteDeckConfirmationMatches('', '')).toBe(false);
  });

  it('explains the permanent scope and starts with deletion disabled', () => {
    const markup = renderToStaticMarkup(
      <DeleteDeckDialog
        open
        deckTitle="Board update"
        deleting={false}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );

    expect(markup).toContain('Permanent data deletion');
    expect(markup).toContain('slides, sources, history, comments, agent data');
    expect(markup).toContain('cannot be undone');
    expect(markup).toContain('Board update');
    expect(markup).toContain('data-testid="delete-deck-confirm"');
    expect(markup).toMatch(/disabled=""[^>]*data-testid="delete-deck-confirm"/);
  });

  it('renders nothing when closed', () => {
    expect(
      renderToStaticMarkup(
        <DeleteDeckDialog
          open={false}
          deckTitle="Board update"
          deleting={false}
          onCancel={() => undefined}
          onConfirm={() => undefined}
        />,
      ),
    ).toBe('');
  });
});
