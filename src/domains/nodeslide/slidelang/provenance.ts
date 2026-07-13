import type { DeckSnapshot, Slide, SlideElement, SourceRecord } from '../../../../shared/nodeslide';
import { orderedExportElements } from './utils';

export interface SlideSourceReference {
  id: string;
  source?: SourceRecord;
}

export function elementSourceIds(element: SlideElement): string[] {
  const sourceIds = new Set(element.sourceIds);
  if (element.chart?.sourceId) sourceIds.add(element.chart.sourceId);
  if (element.math?.sourceId) sourceIds.add(element.math.sourceId);
  if (element.image?.sourceId) sourceIds.add(element.image.sourceId);
  return [...sourceIds];
}

export function slideSourceReferences(
  snapshot: DeckSnapshot,
  slide: Slide,
): SlideSourceReference[] {
  const sourcesById = new Map(snapshot.sources.map((source) => [source.id, source]));
  const sourceIds = new Set<string>();
  for (const element of orderedExportElements(snapshot, slide)) {
    for (const sourceId of elementSourceIds(element)) sourceIds.add(sourceId);
  }
  return [...sourceIds].map((id) => {
    const source = sourcesById.get(id);
    return source ? { id, source } : { id };
  });
}
