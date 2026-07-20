// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import {
  DeploymentUpdateBoundary,
  isDeploymentReloadCandidate,
  useDeploymentActionMonitor,
} from './DeploymentUpdateBoundary';

describe('deployment update recovery', () => {
  it('recognizes only Convex action disconnect and masked action errors', () => {
    expect(
      isDeploymentReloadCandidate(new Error('Connection lost while action was in flight')),
    ).toBe(true);
    expect(
      isDeploymentReloadCandidate(
        new Error('[CONVEX A(nodeslideAgent:createDeckFromBrief)] Server Error\nCalled by client'),
      ),
    ).toBe(true);
    expect(isDeploymentReloadCandidate({ data: { message: 'Server Error' } })).toBe(true);
    expect(isDeploymentReloadCandidate(new Error('The brief is invalid.'))).toBe(false);
    expect(isDeploymentReloadCandidate(new Error('[CONVEX Q(nodeslide:get)] Server Error'))).toBe(
      false,
    );
  });

  it('keeps the original rejection and offers an explicit reload', async () => {
    render(
      <DeploymentUpdateBoundary>
        <ActionProbe />
      </DeploymentUpdateBoundary>,
    );

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Run action' })));

    expect(screen.getByRole('alert').textContent).toContain(
      'no successful change is being claimed',
    );
    expect(screen.getByTestId('caught-action-error').textContent).toContain('Server Error');
    expect(
      (screen.getByRole('button', { name: 'Reload NodeSlide' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

function ActionProbe() {
  const monitor = useDeploymentActionMonitor();
  const [caught, setCaught] = useState('');
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void monitor(Promise.reject(new Error('Server Error'))).catch((error: unknown) => {
            setCaught(error instanceof Error ? error.message : 'unknown');
          });
        }}
      >
        Run action
      </button>
      <output data-testid="caught-action-error">{caught}</output>
    </>
  );
}
