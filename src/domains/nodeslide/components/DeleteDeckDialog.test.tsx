// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeAll, describe, expect, it } from 'vitest';
import { DeleteDeckDialog, deleteDeckConfirmationMatches } from './DeleteDeckDialog';

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = false;
    },
  });
});

describe('DeleteDeckDialog', () => {
  it('requires an exact, case-sensitive deck title', () => {
    expect(deleteDeckConfirmationMatches('Board update', 'Board update')).toBe(true);
    expect(deleteDeckConfirmationMatches('board update', 'Board update')).toBe(false);
    expect(deleteDeckConfirmationMatches('Board update ', 'Board update')).toBe(false);
    expect(deleteDeckConfirmationMatches('', '')).toBe(false);
  });

  it('explains the permanent scope and starts with deletion disabled', () => {
    render(
      <DeleteDeckDialog
        open
        deckTitle="Board update"
        deleting={false}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );

    expect(screen.getByText('Permanent data deletion')).toBeInTheDocument();
    expect(
      screen.getByText(/deck-scoped memories, role stages, source refresh plans, sync state/),
    ).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
    expect(screen.getByText('Board update')).toBeInTheDocument();
    expect(screen.getByTestId('delete-deck-confirm')).toBeDisabled();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <DeleteDeckDialog
        open={false}
        deckTitle="Board update"
        deleting={false}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
