// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { NODESLIDE_ATLAS_RECEIPT_PROJECTION } from '../../../../shared/nodeslideAtlasReceipts';
import { NODESLIDE_ATLAS_ARCHETYPES } from '../../../../shared/nodeslideAtlasRegistry';
import { AtlasGallery } from './AtlasGallery';

afterEach(cleanup);

describe('Atlas Gallery: a builder looking for the right slide', () => {
  it('opens on the gallery with every archetype listed', () => {
    render(<AtlasGallery />);
    expect(screen.getByTestId('atlas-gallery')).toBeInTheDocument();
    expect(screen.getByTestId('atlas-count')).toHaveTextContent(
      `${NODESLIDE_ATLAS_ARCHETYPES.length} archetypes`,
    );
    expect(screen.queryByTestId('atlas-truncated')).not.toBeInTheDocument();
  });

  it('narrows to the architecture archetype when the builder describes the job', async () => {
    const user = userEvent.setup();
    render(<AtlasGallery />);
    await user.type(screen.getByTestId('atlas-search'), 'architecture');
    expect(screen.getByTestId('atlas-card-systems.architecture')).toBeInTheDocument();
    expect(screen.queryByTestId('atlas-card-narrative.hero-thesis')).not.toBeInTheDocument();
  });

  it('filters to archetypes that demand a real chart', async () => {
    const user = userEvent.setup();
    render(<AtlasGallery />);
    await user.selectOptions(screen.getByTestId('atlas-kind'), 'chart');
    expect(screen.getByTestId('atlas-card-data.trend-line')).toBeInTheDocument();
    expect(screen.queryByTestId('atlas-card-narrative.hero-thesis')).not.toBeInTheDocument();
  });

  it('says so plainly when no archetype matches', async () => {
    const user = userEvent.setup();
    render(<AtlasGallery />);
    await user.type(screen.getByTestId('atlas-search'), 'zzzznothing');
    expect(screen.getByTestId('atlas-count')).toHaveTextContent('No archetype matches');
  });

  it('shows the required artifact and the substitutes that will be rejected', async () => {
    const user = userEvent.setup();
    render(<AtlasGallery />);
    await user.click(screen.getByTestId('atlas-card-systems.architecture'));
    const detail = screen.getByTestId('atlas-detail');
    expect(within(detail).getByText('diagram')).toBeInTheDocument();
    expect(within(detail).getByText('prose-as-architecture')).toBeInTheDocument();
  });

  it('renders the per-lane licence matrix with real gate decisions', async () => {
    const user = userEvent.setup();
    render(<AtlasGallery />);
    await user.click(screen.getByTestId('atlas-card-systems.architecture'));
    expect(screen.getByTestId('atlas-usage-mobbin-display-thumbnail')).toHaveTextContent('allow');
    expect(screen.getByTestId('atlas-usage-mobbin-rag-index')).toHaveTextContent('deny');
    expect(screen.getByTestId('atlas-usage-mobbin-model-training')).toHaveTextContent('deny');
    expect(screen.getByTestId('atlas-usage-uiverse-cache')).toHaveTextContent('allow');
    expect(screen.getByTestId('atlas-usage-uiverse-model-training')).toHaveTextContent('deny');
  });

  it('marks the restricted commercial lane as restricted, not approved', () => {
    render(<AtlasGallery />);
    expect(screen.getByTestId('atlas-source-status-commercial-template-library')).toHaveTextContent(
      'restricted',
    );
    expect(screen.getByTestId('atlas-source-status-uiverse')).toHaveTextContent('approved');
  });

  /**
   * This test used to assert "No arena receipts recorded yet." on both tabs. That was honest when
   * written and became a false statement the moment 84 receipts were projected into the same repo:
   * the surface was claiming emptiness while the data sat beside it. The two tabs now diverge for
   * a real reason — the producer varies, the harness does not.
   */
  it('shows the real receipts under Model Compare', async () => {
    const user = userEvent.setup();
    render(<AtlasGallery />);

    await user.click(screen.getByTestId('atlas-mode-model-compare'));
    expect(screen.queryByTestId('atlas-empty-model-compare')).not.toBeInTheDocument();
    expect(screen.getByTestId('atlas-receipt-summary')).toHaveTextContent(
      `${NODESLIDE_ATLAS_RECEIPT_PROJECTION.totals.receipts} receipts`,
    );
    expect(screen.getAllByTestId(/^atlas-maturity-/)).toHaveLength(
      NODESLIDE_ATLAS_RECEIPT_PROJECTION.totals.recipes,
    );
  });

  it('never displays certified, and says why on the surface', async () => {
    const user = userEvent.setup();
    render(<AtlasGallery />);
    await user.click(screen.getByTestId('atlas-mode-model-compare'));

    for (const cell of screen.getAllByTestId(/^atlas-maturity-/)) {
      expect(cell.textContent).not.toBe('certified');
    }
    expect(screen.getByTestId('atlas-certified-note')).toHaveTextContent(/human blind preference/);
  });

  it('names the projection it is reading, so the numbers are traceable', async () => {
    const user = userEvent.setup();
    render(<AtlasGallery />);
    await user.click(screen.getByTestId('atlas-mode-model-compare'));
    expect(screen.getByTestId('atlas-projection-provenance')).toHaveTextContent(
      NODESLIDE_ATLAS_RECEIPT_PROJECTION.meta.sourceCommit?.slice(0, 12) ?? 'unknown',
    );
  });

  it('keeps Harness Compare empty, but for the true reason', async () => {
    const user = userEvent.setup();
    render(<AtlasGallery />);

    await user.click(screen.getByTestId('atlas-mode-harness-compare'));
    expect(screen.getByTestId('atlas-empty-harness-compare')).toBeInTheDocument();
    // One harness version is not a comparison — and that is a different fact from "no receipts".
    expect(screen.getByTestId('atlas-empty-status')).toHaveTextContent('one harness version');
    expect(screen.getByTestId('atlas-empty-status')).not.toHaveTextContent(
      'No arena receipts recorded yet.',
    );
  });

  it('returns to the gallery after visiting a compare mode', async () => {
    const user = userEvent.setup();
    render(<AtlasGallery />);
    await user.click(screen.getByTestId('atlas-mode-model-compare'));
    await user.click(screen.getByTestId('atlas-mode-gallery'));
    expect(screen.getByTestId('atlas-count')).toHaveTextContent(
      `${NODESLIDE_ATLAS_ARCHETYPES.length} archetypes`,
    );
    expect(screen.queryByTestId('atlas-truncated')).not.toBeInTheDocument();
  });
});
