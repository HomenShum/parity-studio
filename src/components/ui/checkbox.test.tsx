// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Checkbox } from './checkbox';

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

describe('Checkbox', () => {
  it('supports a controlled affirmative click inside a form', async () => {
    const user = userEvent.setup();
    render(<ControlledCheckbox />);

    const checkbox = screen.getByRole('checkbox', { name: 'Allow this session' });
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);

    expect(checkbox).toBeChecked();
  });
});

function ControlledCheckbox() {
  const [checked, setChecked] = useState(false);
  return (
    <form>
      <Checkbox
        id="controlled-checkbox"
        checked={checked}
        onCheckedChange={(next) => setChecked(next === true)}
      />
      <label htmlFor="controlled-checkbox">Allow this session</label>
    </form>
  );
}
