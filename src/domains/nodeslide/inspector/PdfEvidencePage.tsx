import type { PDFDocumentLoadingTask, PDFPageProxy } from 'pdfjs-dist';
import { useEffect, useRef, useState } from 'react';
import type { NodeSlideEvidenceBox } from '../../../../shared/nodeslide';
import { loadPdfEvidenceRuntime } from './pdfEvidenceRuntime';

export interface PdfEvidencePageProps {
  url: string;
  page: number;
  box?: NodeSlideEvidenceBox;
  label: string;
}

type PdfLoadState =
  | { status: 'loading' }
  | { status: 'ready'; page: PDFPageProxy; pageCount: number; annotationModeDisabled: number }
  | { status: 'error'; message: string };

interface RenderedPageSize {
  width: number;
  height: number;
}

export function PdfEvidencePage({ url, page, box, label }: PdfEvidencePageProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderSequence = useRef(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [loadState, setLoadState] = useState<PdfLoadState>({ status: 'loading' });
  const [renderedSize, setRenderedSize] = useState<RenderedPageSize | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const updateWidth = (width: number) => {
      if (Number.isFinite(width) && width > 0) setContainerWidth(Math.floor(width));
    };
    updateWidth(frame.clientWidth || frame.getBoundingClientRect().width || 640);
    if (typeof ResizeObserver === 'undefined') {
      const onResize = () => updateWidth(frame.clientWidth || frame.getBoundingClientRect().width);
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) updateWidth(width);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    setLoadState({ status: 'loading' });
    setRenderedSize(null);
    setRenderError(null);
    let loadingTask: PDFDocumentLoadingTask | undefined;
    void loadPdfEvidenceRuntime()
      .then(async (runtime) => {
        if (!active) return;
        loadingTask = runtime.getDocument({
          url,
          withCredentials: false,
          enableXfa: false,
          stopAtErrors: true,
          maxImageSize: 25_000_000,
          useWasm: false,
        });
        const pdfDocument = await loadingTask.promise;
        if (!Number.isInteger(page) || page < 1 || page > pdfDocument.numPages) {
          throw new Error('The recorded PDF page is outside this document.');
        }
        const pdfPage = await pdfDocument.getPage(page);
        if (active)
          setLoadState({
            status: 'ready',
            page: pdfPage,
            pageCount: pdfDocument.numPages,
            annotationModeDisabled: runtime.AnnotationMode.DISABLE,
          });
      })
      .catch(() => {
        if (active) {
          setLoadState({
            status: 'error',
            message: 'The selected PDF page could not be rendered. No region overlay is shown.',
          });
        }
      });
    return () => {
      active = false;
      renderSequence.current += 1;
      void loadingTask?.destroy();
    };
  }, [page, url]);

  useEffect(() => {
    if (loadState.status !== 'ready' || containerWidth <= 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sequence = ++renderSequence.current;
    const baseViewport = loadState.page.getViewport({ scale: 1 });
    if (
      !Number.isFinite(baseViewport.width) ||
      !Number.isFinite(baseViewport.height) ||
      baseViewport.width <= 0 ||
      baseViewport.height <= 0 ||
      baseViewport.width / baseViewport.height < 0.05 ||
      baseViewport.width / baseViewport.height > 20
    ) {
      setRenderedSize(null);
      setRenderError('The selected PDF page has invalid dimensions. No region overlay is shown.');
      return;
    }
    const viewport = loadState.page.getViewport({ scale: containerWidth / baseViewport.width });
    const outputScale = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
    if (
      !Number.isFinite(viewport.width) ||
      !Number.isFinite(viewport.height) ||
      viewport.width * viewport.height * outputScale * outputScale > 16_000_000
    ) {
      setRenderedSize(null);
      setRenderError(
        'The selected PDF page exceeds the safe render dimensions. No region overlay is shown.',
      );
      return;
    }
    setRenderedSize(null);
    canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
    canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const renderTask = loadState.page.render({
      canvas,
      viewport,
      annotationMode: loadState.annotationModeDisabled,
      ...(outputScale === 1 ? {} : { transform: [outputScale, 0, 0, outputScale, 0, 0] }),
    });
    void renderTask.promise
      .then(() => {
        if (sequence !== renderSequence.current) return;
        setRenderedSize({ width: viewport.width, height: viewport.height });
        setRenderError(null);
      })
      .catch(() => {
        if (sequence === renderSequence.current) {
          setRenderedSize(null);
          setRenderError(
            'The selected PDF page could not be rendered. No region overlay is shown.',
          );
        }
      });
    return () => {
      renderSequence.current += 1;
      renderTask.cancel();
    };
  }, [containerWidth, loadState]);

  const error = loadState.status === 'error' ? loadState.message : renderError;
  return (
    <div
      ref={frameRef}
      className="ns-waterfall-pdf-frame"
      data-region-precision={renderedSize && box ? 'normalized-pdf-page' : 'unavailable'}
      data-pdf-page={page}
    >
      {loadState.status === 'loading' ? (
        <p className="ns-waterfall-capture-state">Rendering selected PDF page...</p>
      ) : null}
      {error ? (
        <p className="ns-waterfall-geometry-state is-degraded" data-testid="trace-pdf-render-state">
          {error}
        </p>
      ) : null}
      {loadState.status === 'ready' ? (
        <div className="ns-waterfall-pdf-scroll" data-testid="trace-pdf-scroll-surface">
          <div
            className="ns-waterfall-pdf-page"
            data-testid="trace-pdf-page-surface"
            aria-label={`${label}, page ${page} of ${loadState.pageCount}`}
            style={renderedSize ?? undefined}
          >
            <canvas ref={canvasRef} />
            {renderedSize && box ? (
              <span
                className="ns-waterfall-evidence-box"
                data-testid="trace-pdf-evidence-box"
                data-region-precision="normalized-pdf-page"
                aria-hidden="true"
                style={normalizedBoxStyle(box)}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function normalizedBoxStyle(box: NodeSlideEvidenceBox) {
  return {
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.w * 100}%`,
    height: `${box.h * 100}%`,
  };
}
