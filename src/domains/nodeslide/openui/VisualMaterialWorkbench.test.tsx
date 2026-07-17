/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { buildGoldenNodeSlide } from '../../../../convex/lib/nodeslideSeed';
import type { PatchOperation } from '../../../../shared/nodeslide';
import { VisualMaterialWorkbench } from './VisualMaterialWorkbench';

afterEach(cleanup);

describe('VisualMaterialWorkbench interaction', () => {
  it('routes the allowlisted OpenUI action into exactly one unapplied proposal', async () => {
    const { snapshot } = buildGoldenNodeSlide('openui-workbench-interaction', 1_700_000_000_000);
    const slide = snapshot.slides[0];
    if (!slide) throw new Error('Expected a golden fixture slide.');
    let callCount = 0;
    let proposedOperations: PatchOperation[] | undefined;
    const onPropose = async (operations: PatchOperation[]) => {
      callCount += 1;
      proposedOperations = operations;
    };

    render(<VisualMaterialWorkbench deck={snapshot.deck} slide={slide} onPropose={onPropose} />);

    fireEvent.click(screen.getByRole('button', { name: /Visual material lab/i }));
    const action = screen.getByTestId('openui-create-proposal');
    fireEvent.click(action);
    fireEvent.click(action);

    await waitFor(() => expect(callCount).toBe(1));
    expect(proposedOperations).toHaveLength(1);
    expect(proposedOperations?.[0]?.op).toBe('add_slide');
    expect(screen.getByTestId('openui-proposal-status').textContent).toContain(
      'The deck is unchanged until you accept it.',
    );
  });
});
