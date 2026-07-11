import { renderToStaticMarkup } from 'react-dom/server';
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
    const markup = renderToStaticMarkup(
      <OwnerCapabilityRecoveryDialog open recovery={recovery} onClose={() => undefined} />,
    );

    expect(markup).toContain('type="password"');
    expect(markup).toContain('value="owner-secret-capability"');
    expect(markup).toContain('grants full edit access');
    expect(markup).toContain('paste it into this deck');
    expect(markup).toContain('Copy recovery key');
  });

  it('renders nothing when closed', () => {
    expect(
      renderToStaticMarkup(
        <OwnerCapabilityRecoveryDialog
          open={false}
          recovery={recovery}
          onClose={() => undefined}
        />,
      ),
    ).toBe('');
  });
});
