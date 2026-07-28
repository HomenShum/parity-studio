import { mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type FullConfig, request } from 'playwright/test';

export default async function vercelBypassGlobalSetup(
  config: FullConfig,
): Promise<(() => Promise<void>) | undefined> {
  const secret = process.env['VERCEL_AUTOMATION_BYPASS_SECRET']?.trim();
  const project = config.projects[0];
  const baseURL = project?.use.baseURL;
  const storageState = project?.use.storageState;
  if (!secret || typeof baseURL !== 'string' || typeof storageState !== 'string') return undefined;

  await mkdir(dirname(storageState), { recursive: true });
  const bypassRequest = await request.newContext({
    baseURL,
    extraHTTPHeaders: {
      'x-vercel-protection-bypass': secret,
      'x-vercel-set-bypass-cookie': 'true',
    },
  });
  try {
    const response = await getSameOriginBypassResponse(bypassRequest, baseURL);
    const body = await response.text();
    if (!response.ok() || !servedTheApplication(body)) {
      throw new Error(
        'The protected preview bypass did not return the application shell; it most likely returned the deployment protection page.',
      );
    }
    const savedState = await bypassRequest.storageState({ path: storageState });
    if (savedState.cookies.length === 0) {
      throw new Error('The protected preview bypass did not issue a browser cookie.');
    }
  } catch (error) {
    await rm(storageState, { force: true });
    throw error;
  } finally {
    await bypassRequest.dispose();
  }

  return async () => {
    await rm(storageState, { force: true });
  };
}

/**
 * What this preflight has to prove is that the bypass secret got us past Vercel's deployment
 * protection and to the app — not which app it is. It used to test the body for the string
 * "nodeslide", which was the `<title>`, so renaming the product in Phase 4 of the decoupling plan
 * failed a check about authentication. A sensor that a rename can break was never measuring the
 * thing it was named after.
 *
 * The application shell is a Vite SPA: an empty root element plus a module script. Vercel's
 * protection page is server-rendered and has neither.
 */
function servedTheApplication(body: string): boolean {
  return /<div\s+id="root"/i.test(body) && /<script[^>]+type="module"/i.test(body);
}

async function getSameOriginBypassResponse(
  bypassRequest: Awaited<ReturnType<typeof request.newContext>>,
  baseURL: string,
) {
  const allowedOrigin = new URL(baseURL).origin;
  let target = new URL('/', baseURL).toString();
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    const response = await bypassRequest.get(target, { maxRedirects: 0 });
    if (response.status() < 300 || response.status() >= 400) return response;
    const location = response.headers()['location'];
    if (!location) throw new Error('The protected preview returned an invalid redirect.');
    const next = new URL(location, response.url());
    if (next.origin !== allowedOrigin) {
      throw new Error('The protected preview attempted a cross-origin bypass redirect.');
    }
    target = next.toString();
  }
  throw new Error('The protected preview exceeded the bypass redirect limit.');
}
