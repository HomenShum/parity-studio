// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import {
  type OwnerCapabilityRecovery,
  OwnerCapabilityRecoveryDialog,
} from './OwnerCapabilityRecoveryDialog';

const recovery: OwnerCapabilityRecovery = {
  deckId: 'deck:private',
  deckTitle: 'Private plan',
  ownerAccessKey: 'owner-secret-capability',
};

describe('NodeSlide owner capability recovery dialog', () => {
  it('keeps the capability masked while explaining how to restore it', () => {
    render(<OwnerCapabilityRecoveryDialog open recovery={recovery} onClose={() => undefined} />);

    expect(screen.getByLabelText('Owner recovery key')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Owner recovery key')).toHaveValue('owner-secret-capability');
    expect(screen.getByText(/grants full edit access/)).toBeInTheDocument();
    expect(screen.getByText(/paste it into this deck/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy recovery key/i })).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <OwnerCapabilityRecoveryDialog open={false} recovery={recovery} onClose={() => undefined} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
