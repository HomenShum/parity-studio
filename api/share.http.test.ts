import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  NODESLIDE_SCHEMA_VERSION,
  NODESLIDE_TOOLCHAIN_VERSION,
  type PublishedNodeSlide,
  type SlideElement,
} from '../shared/nodeslide';
import handler from './share';

/**
 * Serves the share route over a real socket, against a stand-in for the Convex
 * deployment that speaks the same wire contract `ConvexHttpClient` uses. This is
 * the local equivalent of the deployed request: HTTP in, HTML out, with the
 * published-only rule enforced by the query rather than by the route.
 */

const PUBLISHED_SLUG = 'share-1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b';
const REVOKED_SLUG = 'share-90817263544536271809aabbccddeeff0011';

const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process?.env;

let convexServer: Server;
let routeServer: Server;
let routeOrigin = '';
let savedConvexUrl: string | undefined;

function element(
  slideId: string,
  id: string,
  role: string,
  content: string,
  y: number,
): SlideElement {
  return {
    id,
    slideId,
    name: `${role} on ${slideId}`,
    kind: 'text',
    role,
    bbox: { x: 0.07, y, width: 0.8, height: 0.18 },
    rotation: 0,
    content,
    style: { fontSize: role === 'title' ? 52 : 26, color: '#f7f4ec' },
    sourceIds: ['source:filing'],
    locked: false,
    exportCapabilities: ['pptx', 'html'],
    version: 1,
  };
}

function publishedFixture(): PublishedNodeSlide {
  const deckId = 'deck:series-a-diligence';
  const slides = [
    { id: 'slide:thesis', title: 'Why this wedge wins', section: 'Thesis' },
    { id: 'slide:evidence', title: 'What the pipeline data shows', section: 'Evidence' },
    { id: 'slide:ask', title: 'The ask, and what it buys', section: 'Ask' },
  ];
  return {
    publication: {
      id: 'publication:7',
      deckId,
      shareSlug: PUBLISHED_SLUG,
      revision: 3,
      deckVersion: 12,
      validationId: 'validation:9',
      status: 'active',
      publishedAt: 1_760_000_000_000,
    },
    snapshot: {
      deck: {
        schemaVersion: NODESLIDE_SCHEMA_VERSION,
        toolchainVersion: NODESLIDE_TOOLCHAIN_VERSION,
        id: deckId,
        title: 'Series A diligence review',
        theme: {
          id: 'theme:night',
          name: 'Night signal',
          mode: 'dark',
          colors: {
            canvas: '#10131a',
            ink: '#f7f4ec',
            muted: '#b9c0cb',
            accent: '#f6b94a',
            accentSoft: '#3b3222',
            insight: '#d9f99d',
            insightInk: '#17210b',
            trace: '#7dd3fc',
            border: '#3a4351',
          },
          typography: { display: 'Aptos Display', body: 'Aptos', data: 'Aptos Mono' },
          defaultRadius: 16,
          spacingUnit: 8,
        },
        slideOrder: slides.map((slide) => slide.id),
        version: 12,
        status: 'published',
        createdAt: 1_759_000_000_000,
        updatedAt: 1_759_900_000_000,
      },
      slides: slides.map((slide) => ({
        id: slide.id,
        deckId,
        title: slide.title,
        section: slide.section,
        background: '#10131a',
        elementOrder: [`${slide.id}:title`, `${slide.id}:body`],
        version: 4,
      })),
      elements: slides.flatMap((slide) => [
        element(slide.id, `${slide.id}:title`, 'title', slide.title, 0.09),
        element(
          slide.id,
          `${slide.id}:body`,
          'body',
          `${slide.section}: the published snapshot carries this text, so a reader that never runs JavaScript still learns what the deck argues.`,
          0.34,
        ),
      ]),
      sources: [
        {
          id: 'source:filing',
          deckId,
          title: 'Quarterly filing extract',
          url: 'https://example.com/filing',
          sourceType: 'url',
          retrievedAt: 1_759_000_000_000,
          citation: 'Example Corp, Quarterly filing, 2026.',
        },
      ],
    },
  };
}

function readBody(request: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk) => {
      body += String(chunk);
    });
    request.on('end', () => resolve(body));
  });
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
}

beforeAll(async () => {
  convexServer = createServer((request, response) => {
    void (async () => {
      const payload = JSON.parse((await readBody(request)) || '{}');
      // Only the published presenter query is answerable, exactly as in production.
      if (request.url !== '/api/query' || payload.path !== 'nodeslide:getPresenterSnapshot') {
        response.writeHead(404).end('{}');
        return;
      }
      const shareSlug = payload.args?.[0]?.shareSlug;
      const value = shareSlug === PUBLISHED_SLUG ? publishedFixture() : null;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'success', value, logLines: [] }));
    })();
  });
  const convexPort = await listen(convexServer);
  savedConvexUrl = processEnv?.['VITE_CONVEX_URL'];
  if (processEnv) processEnv['VITE_CONVEX_URL'] = `http://127.0.0.1:${convexPort}`;

  routeServer = createServer((request, response) => {
    void handler(request, response);
  });
  const routePort = await listen(routeServer);
  routeOrigin = `http://127.0.0.1:${routePort}`;
});

afterAll(async () => {
  if (processEnv) {
    // biome-ignore lint/performance/noDelete: assigning undefined to process.env stores the string "undefined"; only delete removes the binding.
    if (savedConvexUrl === undefined) delete processEnv['VITE_CONVEX_URL'];
    else processEnv['VITE_CONVEX_URL'] = savedConvexUrl;
  }
  await Promise.all(
    [convexServer, routeServer].map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

function visibleText(html: string): string {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('the share route over real HTTP', () => {
  it('returns the published deck as HTML a reader can consume without JavaScript', async () => {
    const response = await fetch(`${routeOrigin}/s/${PUBLISHED_SLUG}`, {
      // fetch refuses to set Host; the Vercel proxy forwards the reader's host here.
      headers: { 'x-forwarded-host': 'nodeslide.vercel.app' },
    });
    const html = await response.text();
    const text = visibleText(html);

    console.log(
      `[share-projection] published: status=${response.status} bytes=${Buffer.byteLength(html)} visible-body-text-chars=${text.length}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(text.length).toBeGreaterThan(500);
    expect(text).toContain('Series A diligence review');
    expect(text).toContain('Why this wedge wins');
    expect(text).toContain('The ask, and what it buys');
    expect(html).toContain('<link rel="canonical" href="https://nodeslide.vercel.app/s/');
  });

  it('refuses a slug the publication query does not resolve', async () => {
    const response = await fetch(`${routeOrigin}/s/${REVOKED_SLUG}`, {
      // fetch refuses to set Host; the Vercel proxy forwards the reader's host here.
      headers: { 'x-forwarded-host': 'nodeslide.vercel.app' },
    });
    const html = await response.text();

    console.log(
      `[share-projection] revoked: status=${response.status} bytes=${Buffer.byteLength(html)} visible-body-text-chars=${visibleText(html).length}`,
    );

    expect(response.status).toBe(404);
    expect(html).toContain('This presentation link is unavailable');
    expect(html).not.toContain('Series A diligence review');
  });
});
