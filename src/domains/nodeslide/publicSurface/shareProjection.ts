import type { PublishedNodeSlide, Slide, SlideElement } from '../../../../shared/nodeslide';
import { renderSlideHtml } from '../slidelang/html';
import {
  type ExportableSnapshot,
  escapeHtml,
  isEmbeddedImageData,
  orderedExportElements,
  orderedSlides,
} from '../slidelang/utils';

/**
 * Mirrors `requireShareSlug` in convex/lib/nodeslideAccess.ts. The Convex query
 * remains the only authority on whether a slug resolves to a live publication;
 * this pattern exists so an obviously malformed URL is refused before the route
 * spends a backend round trip on it.
 */
const SHARE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SHARE_SLUG_LENGTH = 128;

/** A public projection is a reading surface, not a deck viewer: bound the work. */
const MAX_PROJECTED_SLIDES = 120;
const MAX_SUMMARY_LENGTH = 300;
const SUMMARY_SLIDE_SCAN = 8;

const HTML_HEADERS: Record<string, string> = {
  'content-type': 'text/html; charset=utf-8',
  // A revoked publication must stop being readable immediately. No shared cache
  // may keep a copy of a capability-scoped page after the owner withdraws it.
  'cache-control': 'no-store',
  // The share slug is a capability, not an address. Serving its content to a
  // link preview is the point; publishing it to an index is not.
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

export interface ShareProjectionRequest {
  /** Request URL. Absolute, or the path and query Node hands to a route. */
  url: string;
  /** Public origin used for the canonical and interactive-presenter links. */
  origin: string;
  /**
   * Reads the published deck for a slug. `null` means this deployment has no
   * backend binding, which is refused rather than answered with an empty page.
   */
  loadPublishedDeck: ((shareSlug: string) => Promise<PublishedNodeSlide | null>) | null;
}

export interface ShareProjectionResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Accepts the shared address in both forms it can arrive in: the public path
 * `/s/<slug>`, and the `?share=<slug>` query the vercel.json rewrite hands to
 * the route.
 */
export function parseShareSlug(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, 'https://nodeslide.invalid');
  } catch {
    return null;
  }
  const pathMatch = /^\/s\/([^/]+)\/?$/.exec(parsed.pathname);
  const raw = (parsed.searchParams.get('share') ?? decodePathSlug(pathMatch?.[1]))?.trim();
  if (!raw || raw.length > MAX_SHARE_SLUG_LENGTH || !SHARE_SLUG_PATTERN.test(raw)) return null;
  return raw;
}

function decodePathSlug(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

/**
 * Re-projects a published deck into the render input, dropping anything a
 * reading surface has no business carrying: speaker notes (already absent from
 * a published snapshot — this is the second lock), non-URL source records, and
 * embedded image payloads, which are megabytes a link preview never renders.
 */
export function publicRenderInput(published: PublishedNodeSlide): ExportableSnapshot {
  const snapshot = published.snapshot;
  return {
    deck: {
      toolchainVersion: snapshot.deck.toolchainVersion,
      id: snapshot.deck.id,
      title: snapshot.deck.title,
      theme: snapshot.deck.theme,
      slideOrder: [...snapshot.deck.slideOrder],
    },
    slides: snapshot.slides.map(publicSlide),
    elements: snapshot.elements.map(publicElement),
    sources: snapshot.sources.filter((source) => source.sourceType === 'url'),
  };
}

function publicSlide(slide: Slide): Slide {
  return {
    id: slide.id,
    deckId: slide.deckId,
    title: slide.title,
    ...(slide.section !== undefined ? { section: slide.section } : {}),
    background: slide.background,
    elementOrder: [...slide.elementOrder],
    version: slide.version,
  };
}

function publicElement(element: SlideElement): SlideElement {
  if (!isEmbeddedImageData(element.imageUrl)) return element;
  const { imageUrl: _embedded, ...rest } = element;
  return rest;
}

export function deckSummary(input: ExportableSnapshot): string {
  const parts: string[] = [];
  for (const slide of orderedSlides(input).slice(0, SUMMARY_SLIDE_SCAN)) {
    for (const element of orderedExportElements(input, slide)) {
      if (element.kind !== 'text') continue;
      const content = element.content?.replace(/\s+/g, ' ').trim();
      if (content) parts.push(content);
    }
    if (parts.join(' · ').length >= MAX_SUMMARY_LENGTH) break;
  }
  const summary = parts.join(' · ');
  if (summary.length <= MAX_SUMMARY_LENGTH) return summary;
  const clipped = summary.slice(0, MAX_SUMMARY_LENGTH);
  const boundary = clipped.lastIndexOf(' ');
  return `${(boundary > MAX_SUMMARY_LENGTH / 2 ? clipped.slice(0, boundary) : clipped).trimEnd()}…`;
}

const PAGE_STYLE = `
:root{color-scheme:dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#080a0e;color:#f7f4ec}
*{box-sizing:border-box}body{margin:0;padding:0 0 4rem}
.page{width:min(72rem,100% - 2rem);margin:0 auto}
header{padding:3rem 0 1.5rem;border-bottom:1px solid #2b323e}
.kicker{margin:0;font:600 .78rem/1.4 system-ui;letter-spacing:.12em;text-transform:uppercase;color:#f6b94a}
h1{margin:.5rem 0;font-size:clamp(1.7rem,4vw,2.6rem);line-height:1.15}
.meta{margin:0;color:#b9c0cb;font-size:.95rem}
.summary{margin:1rem 0 0;max-width:52rem;color:#dfe3ea;line-height:1.55}
a{color:#7dd3fc}
nav.outline{margin:2rem 0 0}
nav.outline h2{font-size:1rem;letter-spacing:.06em;text-transform:uppercase;color:#b9c0cb}
nav.outline ol{margin:0;padding-left:1.4rem;line-height:1.9}
main{display:grid;gap:2.5rem;padding:2.5rem 0}
main section{border-radius:.75rem}
footer{border-top:1px solid #2b323e;padding-top:1.5rem;color:#b9c0cb;font-size:.9rem;line-height:1.6}
`.trim();

function metaTag(name: string, content: string): string {
  return `<meta name="${name}" content="${escapeHtml(content)}"/>`;
}

function openGraphTag(property: string, content: string): string {
  return `<meta property="${property}" content="${escapeHtml(content)}"/>`;
}

function publicDeckPage(
  published: PublishedNodeSlide,
  canonicalUrl: string,
  appUrl: string,
): string {
  const input = publicRenderInput(published);
  const slides = orderedSlides(input);
  const projected = slides.slice(0, MAX_PROJECTED_SLIDES);
  const withheld = slides.length - projected.length;
  const title = published.snapshot.deck.title;
  const summary = deckSummary(input);
  const publishedOn = new Date(published.publication.publishedAt).toISOString().slice(0, 10);
  const outline = projected
    .map(
      (slide, index) =>
        `<li>${escapeHtml(slide.title || `Slide ${index + 1}`)}${slide.section ? ` <span class="meta">· ${escapeHtml(slide.section)}</span>` : ''}</li>`,
    )
    .join('');
  const sections = projected.map((slide) => renderSlideHtml(input, slide.id)).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(title)} — NodeSlide</title>
${metaTag('description', summary || `${slides.length} published slides.`)}
${metaTag('robots', 'noindex, nofollow')}
${metaTag('generator', published.snapshot.deck.toolchainVersion)}
${metaTag('nodeslide-deck-id', published.snapshot.deck.id)}
${metaTag('nodeslide-deck-version', String(published.publication.deckVersion))}
${metaTag('nodeslide-publication-revision', String(published.publication.revision))}
${openGraphTag('og:type', 'article')}
${openGraphTag('og:site_name', 'NodeSlide')}
${openGraphTag('og:title', title)}
${openGraphTag('og:description', summary || `${slides.length} published slides.`)}
${openGraphTag('og:url', canonicalUrl)}
${metaTag('twitter:card', 'summary')}
<link rel="canonical" href="${escapeHtml(canonicalUrl)}"/>
<style>${PAGE_STYLE}</style>
</head>
<body>
<div class="page">
<header>
<p class="kicker">Published presentation</p>
<h1>${escapeHtml(title)}</h1>
<p class="meta">${slides.length} slide${slides.length === 1 ? '' : 's'} · deck version ${published.publication.deckVersion} · publication ${published.publication.revision} · published ${publishedOn}</p>
${summary ? `<p class="summary">${escapeHtml(summary)}</p>` : ''}
<p class="meta"><a href="${escapeHtml(appUrl)}">Open the interactive presenter</a></p>
</header>
<nav class="outline" aria-label="Slide outline"><h2>Slides</h2><ol>${outline}</ol></nav>
<main>${sections}</main>
<footer>
<p>This page is a reading projection of a published NodeSlide deck. It shows the same published snapshot the presenter link shows${withheld > 0 ? `, and stops after the first ${MAX_PROJECTED_SLIDES} slides (${withheld} further slide${withheld === 1 ? '' : 's'} are in the presentation)` : ''}. Speaker notes and unpublished sources are not part of a published snapshot and are not shown here.</p>
</footer>
</div>
</body>
</html>`;
}

function refusalPage(title: string, detail: string, appUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(title)}</title>
${metaTag('description', detail)}
${metaTag('robots', 'noindex, nofollow')}
${openGraphTag('og:title', title)}
${openGraphTag('og:description', detail)}
<style>${PAGE_STYLE}</style>
</head>
<body>
<div class="page">
<header>
<p class="kicker">NodeSlide</p>
<h1>${escapeHtml(title)}</h1>
<p class="summary">${escapeHtml(detail)}</p>
<p class="meta"><a href="${escapeHtml(appUrl)}">Open NodeSlide</a></p>
</header>
</div>
</body>
</html>`;
}

function shareUrls(origin: string, shareSlug: string): { canonical: string; app: string } {
  const canonical = new URL(`/s/${encodeURIComponent(shareSlug)}`, origin);
  // The interactive presenter is still the SPA route. The projection links to
  // it rather than replacing it.
  const app = new URL('/', origin);
  app.searchParams.set('share', shareSlug);
  app.searchParams.set('present', '1');
  return { canonical: canonical.toString(), app: app.toString() };
}

/**
 * Resolves a shared-deck request into real HTML. Only an active publication is
 * rendered: `loadPublishedDeck` is `nodeslide.getPresenterSnapshot`, which
 * refuses anything unpublished, superseded, or revoked, and this route never
 * second-guesses that answer.
 */
export async function buildShareProjection(
  request: ShareProjectionRequest,
): Promise<ShareProjectionResponse> {
  const origin = request.origin;
  const shareSlug = parseShareSlug(request.url);
  if (!shareSlug) {
    return {
      status: 400,
      headers: HTML_HEADERS,
      body: refusalPage(
        'This presentation link is not readable',
        'The address is missing a share link or carries one this service cannot read. Ask the owner for a new view-only link.',
        new URL('/', origin).toString(),
      ),
    };
  }

  const { canonical, app } = shareUrls(origin, shareSlug);
  if (!request.loadPublishedDeck) {
    return {
      status: 503,
      headers: HTML_HEADERS,
      body: refusalPage(
        'This presentation cannot be read right now',
        'The publication service is not reachable from this deployment. The link itself may still be valid — open it in a browser.',
        app,
      ),
    };
  }

  let published: PublishedNodeSlide | null;
  try {
    published = await request.loadPublishedDeck(shareSlug);
  } catch {
    // The failure detail belongs in the deployment log, not in a public page.
    return {
      status: 502,
      headers: HTML_HEADERS,
      body: refusalPage(
        'This presentation cannot be read right now',
        'The publication service did not answer. The link itself may still be valid — open it in a browser.',
        app,
      ),
    };
  }

  if (!published) {
    return {
      status: 404,
      headers: HTML_HEADERS,
      body: refusalPage(
        'This presentation link is unavailable',
        'It may have been revoked, replaced, or copied incorrectly. Ask the owner for a new view-only link.',
        app,
      ),
    };
  }

  return {
    status: 200,
    headers: HTML_HEADERS,
    body: publicDeckPage(published, canonical, app),
  };
}
