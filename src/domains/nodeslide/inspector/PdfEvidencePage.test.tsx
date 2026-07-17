// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfEvidencePage } from './PdfEvidencePage';

const pdfMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  getPage: vi.fn(),
  getViewport: vi.fn(),
  render: vi.fn(),
  cancelRender: vi.fn(),
  destroy: vi.fn(),
  loadRuntime: vi.fn(),
}));

vi.mock('./pdfEvidenceRuntime', () => ({
  loadPdfEvidenceRuntime: pdfMocks.loadRuntime,
}));

let resize: ((width: number) => void) | undefined;

beforeEach(() => {
  const page = {
    getViewport: pdfMocks.getViewport,
    render: pdfMocks.render,
  };
  const document = { numPages: 3, getPage: pdfMocks.getPage };
  pdfMocks.getViewport.mockImplementation(({ scale }: { scale: number }) => ({
    width: 600 * scale,
    height: 800 * scale,
  }));
  pdfMocks.render.mockReturnValue({
    promise: Promise.resolve(),
    cancel: pdfMocks.cancelRender,
  });
  pdfMocks.getPage.mockResolvedValue(page);
  pdfMocks.getDocument.mockReturnValue({
    promise: Promise.resolve(document),
    destroy: pdfMocks.destroy,
  });
  pdfMocks.loadRuntime.mockResolvedValue({
    AnnotationMode: { DISABLE: 0 },
    getDocument: pdfMocks.getDocument,
  });
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      constructor(
        private readonly callback: (entries: Array<{ contentRect: { width: number } }>) => void,
      ) {}
      observe() {
        resize = (width) => this.callback([{ contentRect: { width } }]);
        resize(300);
      }
      disconnect() {}
      unobserve() {}
    },
  );
});

afterEach(() => {
  cleanup();
  resize = undefined;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('PdfEvidencePage', () => {
  it('renders the recorded page, keeps the normalized overlay page-anchored, and rerenders on resize', async () => {
    render(
      <PdfEvidencePage
        url="https://storage.example.com/evidence.pdf"
        page={2}
        box={{ x: 0.1, y: 0.2, w: 0.3, h: 0.25, page: 2 }}
        label="PDF evidence"
      />,
    );

    const overlay = await screen.findByTestId('trace-pdf-evidence-box');
    expect(pdfMocks.getDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://storage.example.com/evidence.pdf',
        withCredentials: false,
        enableXfa: false,
        stopAtErrors: true,
        useWasm: false,
      }),
    );
    expect(pdfMocks.getPage).toHaveBeenCalledWith(2);
    expect(pdfMocks.render).toHaveBeenCalledWith(
      expect.objectContaining({ annotationMode: 0, canvas: expect.any(HTMLCanvasElement) }),
    );
    expect(overlay.style.left).toBe('10%');
    expect(overlay.style.top).toBe('20%');
    expect(overlay.style.width).toBe('30%');
    expect(overlay.style.height).toBe('25%');
    expect(screen.getByTestId('trace-pdf-page-surface').getAttribute('aria-label')).toContain(
      'page 2 of 3',
    );
    expect(screen.getByTestId('trace-pdf-page-surface').getAttribute('style')).toContain(
      'width: 300px',
    );

    const scrollSurface = screen.getByTestId('trace-pdf-scroll-surface');
    fireEvent.scroll(scrollSurface, { target: { scrollTop: 180 } });
    expect(screen.getByTestId('trace-pdf-page-surface').contains(overlay)).toBe(true);

    resize?.(450);
    await waitFor(() => expect(pdfMocks.render).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTestId('trace-pdf-page-surface').getAttribute('style')).toContain(
        'width: 450px',
      ),
    );
    expect(overlay.style.left).toBe('10%');
  });

  it('fails closed when the recorded page is outside the document', async () => {
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage: pdfMocks.getPage }),
      destroy: pdfMocks.destroy,
    });
    render(
      <PdfEvidencePage
        url="https://storage.example.com/evidence.pdf"
        page={4}
        box={{ x: 0.1, y: 0.2, w: 0.3, h: 0.25, page: 4 }}
        label="PDF evidence"
      />,
    );

    expect((await screen.findByTestId('trace-pdf-render-state')).textContent).toContain(
      'could not be rendered. No region overlay is shown',
    );
    expect(screen.queryByTestId('trace-pdf-evidence-box')).toBeNull();
    expect(pdfMocks.getPage).not.toHaveBeenCalled();
  });
});
