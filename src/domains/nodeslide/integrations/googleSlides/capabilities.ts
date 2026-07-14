import type { PresentationSyncCapabilities } from '../syncContracts';

export const GOOGLE_SLIDES_SYNC_CAPABILITIES: PresentationSyncCapabilities = {
  provider: 'google_slides',
  readPresentation: 'supported',
  inboundPatchPlanning: 'supported',
  outboundWritePlanning: 'conditional',
  revisionGuardedWrites: 'supported',
  structuralSlides: 'supported',
  structuralElements: 'conditional',
  text: 'supported',
  geometry: 'conditional',
  styling: 'conditional',
  images: 'conditional',
  charts: 'unsupported',
  groups: 'unsupported',
  comments: 'unsupported',
  limitations: [
    'Outbound writes require a revisionId returned for the same user by presentations.get.',
    'Google group transforms, tables, charts, theme inheritance, and rich text runs are normalized lossily and are never silently overwritten.',
    'Google image contentUrl values are temporary read URLs and are not imported into NodeSlide as durable image sources.',
    'The Slides API cannot rename a presentation; title pushes require a separate Drive integration.',
    'This foundation returns plans only. Inbound changes must use nodeslide.proposePatch and remain unapplied until human acceptance; remote plans require an authenticated caller to execute batchUpdate.',
  ],
};
