// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGoldenNodeSlide } from '../../../../convex/lib/nodeslideSeed';
import type { PatchOperation } from '../../../../shared/nodeslide';
import { DesignInspector, imageFileToEmbeddedWebp } from './DesignInspector';

afterEach(cleanup);

function renderImageInspector(options: {
  onApplyPatch: (operations: PatchOperation[], summary: string) => unknown;
  onGenerateImage?: (
    prompt: string,
    aspect: 'landscape' | 'square' | 'portrait',
  ) => Promise<{ imageUrl: string; model: 'gpt-image-2'; requestId?: string }>;
}) {
  const { snapshot } = buildGoldenNodeSlide('parity-image-editor-test', 1_000);
  const imageElement = snapshot.elements.find((element) => element.kind === 'image');
  if (!imageElement) throw new Error('Golden deck fixture lost its image element.');
  imageElement.imageUrl = 'data:image/webp;base64,UklGRg==';
  imageElement.image = {
    placeholder: false,
    credit: 'Fixture asset',
    fit: 'cover',
    focalPoint: { x: 0.5, y: 0.5 },
  };
  const slide = snapshot.slides.find((candidate) => candidate.id === imageElement.slideId);
  if (!slide) throw new Error('Image element points at a missing slide.');
  return render(
    <DesignInspector
      slide={slide}
      slideElements={snapshot.elements.filter((element) => element.slideId === slide.id)}
      selectedElements={[imageElement]}
      theme={snapshot.deck.theme}
      activeTastePackId={null}
      activeProfileId={null}
      previewProfileId={null}
      profiles={[]}
      busy={false}
      onApplyTastePack={() => undefined}
      onApplyProfile={undefined}
      onPreviewProfile={undefined}
      onUploadSource={undefined}
      tasteProfile={null}
      tasteProfileLoading={false}
      onEvictTasteSignal={undefined}
      onOpenPreferenceEvidence={undefined}
      onClearTastePack={() => undefined}
      onApplyPatch={options.onApplyPatch}
      {...(options.onGenerateImage ? { onGenerateImage: options.onGenerateImage } : {})}
    />,
  );
}

describe('Design inspector image generation and framing', () => {
  it('keeps image ingestion within the patch envelope by resizing before accepting', async () => {
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 2_000, height: 1_000, close }),
    );
    const drawImage = vi.fn();
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const oversized = `data:image/webp;base64,${'A'.repeat(680_000)}`;
    const bounded = 'data:image/webp;base64,UklGRg==';
    const toDataUrl = vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValueOnce(oversized)
      .mockReturnValueOnce(oversized)
      .mockReturnValueOnce(oversized)
      .mockReturnValueOnce(oversized)
      .mockReturnValueOnce(bounded);

    try {
      const result = await imageFileToEmbeddedWebp(
        new File([new Uint8Array([1, 2, 3])], 'oversized.png', { type: 'image/png' }),
      );

      expect(result).toBe(bounded);
      expect(result.length).toBeLessThanOrEqual(680_000);
      expect(toDataUrl).toHaveBeenCalledTimes(5);
      expect(drawImage).toHaveBeenCalledTimes(2);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      getContext.mockRestore();
      toDataUrl.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('rejects unsupported image input before rasterization', async () => {
    const createBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', createBitmap);

    try {
      await expect(
        imageFileToEmbeddedWebp(new File(['<svg/>'], 'vector.svg', { type: 'image/svg+xml' })),
      ).rejects.toThrow('Choose a PNG, JPEG, WebP, or GIF image.');
      expect(createBitmap).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('labels BYOK-generated assets as illustrative and non-evidentiary', async () => {
    const user = userEvent.setup();
    const onApplyPatch = vi.fn<(operations: PatchOperation[], summary: string) => void>();
    const onGenerateImage = vi.fn().mockResolvedValue({
      imageUrl: 'data:image/webp;base64,UklGRg==',
      model: 'gpt-image-2' as const,
      requestId: 'req_123',
    });
    renderImageInspector({ onApplyPatch, onGenerateImage });

    expect(screen.getByText(/OpenAI bills the request/i)).toBeTruthy();
    expect(screen.getByText(/is not evidence/i)).toBeTruthy();
    await user.type(
      screen.getByTestId('illustrative-image-prompt'),
      'A translucent bridge over a calm harbor',
    );
    await user.click(screen.getByTestId('illustrative-image-generate-button'));

    await waitFor(() => expect(onApplyPatch).toHaveBeenCalledTimes(1));
    expect(onGenerateImage).toHaveBeenCalledWith(
      'A translucent bridge over a calm harbor',
      expect.stringMatching(/landscape|square|portrait/),
    );
    const [operations, summary] = onApplyPatch.mock.calls[0] ?? [[], ''];
    const update = operations.find((operation) => operation.op === 'update_image');
    if (update?.op !== 'update_image') throw new Error('Expected an update_image operation.');
    expect(update.imageUrl).toBe('data:image/webp;base64,UklGRg==');
    expect(update.altText).toContain('Illustrative image:');
    expect(update.credit).toContain('AI-generated illustrative image');
    expect(update.credit).toContain('gpt-image-2');
    expect(summary).toContain('explicitly labeled illustrative image');
  });

  it('proposes reversible fit and focal-point changes without replacing the asset', async () => {
    const user = userEvent.setup();
    const onApplyPatch = vi.fn<(operations: PatchOperation[], summary: string) => void>();
    renderImageInspector({ onApplyPatch });

    expect(screen.getByTestId('image-framing-controls')).toBeTruthy();
    await user.selectOptions(screen.getByTestId('image-fit-select'), 'contain');

    let [operations, summary] = onApplyPatch.mock.calls[0] ?? [[], ''];
    let update = operations.find((operation) => operation.op === 'update_image');
    if (update?.op !== 'update_image') throw new Error('Expected an update_image operation.');
    expect(update).toMatchObject({
      imageUrl: 'data:image/webp;base64,UklGRg==',
      fit: 'contain',
      focalPoint: { x: 0.5, y: 0.5 },
    });
    expect(summary).toContain('framing to contain');

    onApplyPatch.mockClear();
    const focusX = screen.getByText('Focus X').closest('label')?.querySelector('input');
    if (!focusX) throw new Error('Missing Focus X input.');
    await user.clear(focusX);
    await user.type(focusX, '18');
    await user.tab();

    [operations, summary] = onApplyPatch.mock.calls[0] ?? [[], ''];
    update = operations.find((operation) => operation.op === 'update_image');
    if (update?.op !== 'update_image') throw new Error('Expected an update_image operation.');
    expect(update).toMatchObject({
      imageUrl: 'data:image/webp;base64,UklGRg==',
      fit: 'cover',
      focalPoint: { x: 0.18, y: 0.5 },
    });
    expect(summary).toContain('horizontal focal point');
  });
});
