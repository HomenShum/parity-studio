// @vitest-environment jsdom

import { Checkbox } from '@/components/ui/checkbox';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionExternalConsent } from './externalProviderConsent';

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState({}, '');
  window.name = '';
});

describe('useSessionExternalConsent', () => {
  it('keeps an affirmative Radix checkbox grant controlled by persisted session state', async () => {
    const user = userEvent.setup();
    render(<ConsentHarness />);

    const checkbox = screen.getByRole('checkbox', { name: 'Allow this session' });
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);

    expect(checkbox).toBeChecked();
    expect(screen.getByText('ready')).toBeVisible();
  });
});

function ConsentHarness() {
  const consent = useSessionExternalConsent();
  return (
    <div>
      <Checkbox
        id="session-consent"
        checked={consent.granted}
        onCheckedChange={(next) => consent.setGranted(next === true)}
      />
      <label htmlFor="session-consent">Allow this session</label>
      <span>{consent.granted ? 'ready' : 'blocked'}</span>
    </div>
  );
}
