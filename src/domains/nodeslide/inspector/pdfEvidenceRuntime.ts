/// <reference path="./vite-url-modules.d.ts" />

import pdfModuleUrl from 'pdfjs-dist/build/pdf.min.mjs?url';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export type PdfEvidenceRuntime = typeof import('pdfjs-dist');

/** Loads the parser and its worker from build-owned, same-origin assets only after PDF selection. */
export async function loadPdfEvidenceRuntime(): Promise<PdfEvidenceRuntime> {
  const runtime = (await import(/* @vite-ignore */ pdfModuleUrl)) as PdfEvidenceRuntime;
  runtime.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  return runtime;
}
