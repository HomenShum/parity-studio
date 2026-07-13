import type { DeckSnapshot, ExportCapability, SlideElement } from '../../../../shared/nodeslide';
import type { ElementCapabilityReport } from './types';
import { isEmbeddedImageData } from './utils';

const CAPABILITY_ORDER: ExportCapability[] = [
  'web_native',
  'pptx_editable',
  'pptx_static_fallback',
  'google_importable',
  'web_only',
];

function orderedCapabilities(capabilities: Iterable<ExportCapability>): ExportCapability[] {
  const values = new Set(capabilities);
  return CAPABILITY_ORDER.filter((capability) => values.has(capability));
}

export function getElementCapability(element: SlideElement): ElementCapabilityReport {
  const declared = orderedCapabilities(element.exportCapabilities);
  let effective: ExportCapability[];
  let web: ElementCapabilityReport['web'];
  let pptx: ElementCapabilityReport['pptx'];
  let googleSlides: ElementCapabilityReport['googleSlides'];
  const warnings: string[] = [];

  if (element.kind === 'image') {
    if (element.image?.placeholder && !element.imageUrl?.trim()) {
      effective = ['web_native', 'pptx_editable', 'google_importable'];
      web = 'native';
      pptx = 'native';
      googleSlides = 'native';
    } else if (isEmbeddedImageData(element.imageUrl)) {
      effective = ['web_native', 'pptx_static_fallback', 'google_importable'];
      web = 'native';
      pptx = 'static_fallback';
      googleSlides = 'static_fallback';
    } else {
      effective = ['pptx_static_fallback'];
      web = 'static_fallback';
      pptx = 'static_fallback';
      googleSlides = 'static_fallback';
      warnings.push(
        'The zero-cost adapter does not fetch remote image assets; self-contained HTML and PPTX use a labeled placeholder.',
      );
    }
  } else if (element.kind === 'chart' && !element.chart) {
    effective = ['web_native', 'pptx_static_fallback', 'google_importable'];
    web = 'static_fallback';
    pptx = 'static_fallback';
    googleSlides = 'static_fallback';
    warnings.push('Chart data is missing, so exports use a labeled editable placeholder.');
  } else if (element.kind === 'math' && !element.math?.expression.trim()) {
    effective = ['web_native', 'pptx_static_fallback', 'google_importable'];
    web = 'static_fallback';
    pptx = 'static_fallback';
    googleSlides = 'static_fallback';
    warnings.push('Math expression is missing, so exports use a labeled editable placeholder.');
  } else if (element.kind === 'video') {
    effective = ['web_native', 'pptx_static_fallback', 'google_importable'];
    web = element.video?.url.trim() ? 'native' : 'static_fallback';
    pptx = 'static_fallback';
    googleSlides = 'static_fallback';
    warnings.push(
      'Video plays natively on the web; PowerPoint and Google Slides receive an explicit linked-media placeholder.',
    );
  } else {
    effective = ['web_native', 'pptx_editable', 'google_importable'];
    web = 'native';
    pptx = 'native';
    googleSlides = 'native';
  }

  const effectiveSet = new Set(effective);
  for (const capability of declared) {
    if (!effectiveSet.has(capability)) {
      warnings.push(
        `Element declares ${capability}, but the local adapter cannot honor that capability for ${element.kind}.`,
      );
    }
  }

  return {
    elementId: element.id,
    kind: element.kind,
    declared,
    effective: orderedCapabilities(effective),
    web,
    pptx,
    googleSlides,
    warnings: [...new Set(warnings)].sort((left, right) => left.localeCompare(right)),
  };
}

export function getCapabilityReports(snapshot: DeckSnapshot): ElementCapabilityReport[] {
  return snapshot.elements
    .map(getElementCapability)
    .sort((left, right) => left.elementId.localeCompare(right.elementId));
}

export function getCapabilityWarnings(snapshot: DeckSnapshot): string[] {
  return getCapabilityReports(snapshot).flatMap((report) =>
    report.warnings.map((warning) => `${report.elementId}: ${warning}`),
  );
}
