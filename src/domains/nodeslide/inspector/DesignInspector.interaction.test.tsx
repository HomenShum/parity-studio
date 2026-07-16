// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import type { Slide, SlideElement, ThemeSpec } from '../../../../shared/nodeslide';
import { DesignInspector } from './DesignInspector';

describe('NodeSlide Design inspector text persistence', () => {
  it('reports a failed native text commit instead of implying the edit persisted', async () => {
    const user = userEvent.setup();
    const text: SlideElement = {
      id: 'headline-1',
      slideId: 'slide-1',
      name: 'Headline',
      role: 'headline',
      kind: 'text',
      content: 'Before',
      bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.2 },
      rotation: 0,
      style: { fontSize: 32 },
      sourceIds: [],
      locked: false,
      exportCapabilities: ['web_native', 'pptx_editable'],
      version: 1,
    };
    const slide: Slide = {
      id: 'slide-1',
      deckId: 'deck-1',
      title: 'Before',
      background: '#ffffff',
      elementOrder: [text.id],
      version: 1,
    };
    render(
      <DesignInspector
        slide={slide}
        slideElements={[text]}
        selectedElements={[text]}
        theme={theme()}
        activeTastePackId={null}
        activeProfileId={null}
        previewProfileId={null}
        profiles={[]}
        busy={false}
        onApplyTastePack={() => {}}
        onApplyProfile={undefined}
        onPreviewProfile={undefined}
        onUploadSource={undefined}
        tasteProfile={null}
        tasteProfileLoading={false}
        onEvictTasteSignal={undefined}
        onOpenPreferenceEvidence={undefined}
        onClearTastePack={() => {}}
        onApplyPatch={async () => false}
      />,
    );

    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'After');
    await user.tab();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('This text edit was not committed'),
    );
  });
});

function theme(): ThemeSpec {
  return {
    id: 'test-theme',
    name: 'Test theme',
    mode: 'light',
    colors: {
      canvas: '#ffffff',
      ink: '#111111',
      muted: '#666666',
      accent: '#b44a2d',
      accentSoft: '#f2ded3',
      insight: '#e5e9d6',
      insightInk: '#34452c',
      trace: '#7566a8',
      border: '#ded7cc',
    },
    typography: { display: 'serif', body: 'sans-serif', data: 'monospace' },
    defaultRadius: 12,
    spacingUnit: 8,
  };
}
