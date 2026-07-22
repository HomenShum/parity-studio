// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
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

  it('reports no arena receipts instead of rendering placeholder candidates', async () => {
    const user = userEvent.setup();
    render(<AtlasGallery />);

    await user.click(screen.getByTestId('atlas-mode-model-compare'));
    expect(screen.getByTestId('atlas-empty-model-compare')).toBeInTheDocument();
    expect(screen.getByTestId('atlas-empty-status')).toHaveTextContent(
      'No arena receipts recorded yet.',
    );

    await user.click(screen.getByTestId('atlas-mode-harness-compare'));
    expect(screen.getByTestId('atlas-empty-harness-compare')).toBeInTheDocument();
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
