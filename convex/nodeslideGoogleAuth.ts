import { v } from 'convex/values';
import { internal } from './_generated/api';
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from './_generated/server';
import { isOwnerAccessKey, requireOwnerAccess } from './lib/nodeslideAccess';
import {
  NODESLIDE_GOOGLE_OAUTH_SESSION_MS,
  NODESLIDE_GOOGLE_SCOPE,
  allowedNodeSlideOrigins,
  decryptOAuthSecret,
  encryptOAuthSecret,
  randomBase64Url,
  resolveNodeSlideGoogleOAuthConfig,
  safeNodeSlideReturnTo,
  sha256Base64Url,
  withGoogleOAuthResult,
} from './lib/nodeslideGoogleOAuth';

const PROVIDER = 'google_slides' as const;
const GOOGLE_AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const TOKEN_TIMEOUT_MS = 20_000;

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

interface GoogleOAuthSessionGrant {
  version: 1;
  codeVerifier: string;
  ownerAccessKey: string;
}

export const getStatus = query({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args) => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const credential = await ctx.db
      .query('nodeslide_oauth_credentials')
      .withIndex('by_deck_provider', (index) =>
        index.eq('deckId', deck.id).eq('provider', PROVIDER),
      )
      .unique();
    return credential && credential.revokedAt === undefined
      ? {
          connected: true as const,
          provider: PROVIDER,
          scopes: credential.scopes,
          updatedAt: credential.updatedAt,
          accessTokenExpiresAt: credential.accessTokenExpiresAt,
        }
      : { connected: false as const, provider: PROVIDER };
  },
});

export const begin = action({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    returnTo: v.string(),
  },
  handler: async (ctx, args): Promise<{ authorizationUrl: string; expiresAt: number }> => {
    await ctx.runQuery(internal.nodeslideGoogleAuth.validateOwner, {
      deckId: args.deckId,
      ownerAccessKey: args.ownerAccessKey,
    });
    const config = requireGoogleOAuthConfig();
    const returnTo = safeNodeSlideReturnTo(args.returnTo, config.allowedOrigins);
    const state = randomBase64Url();
    const codeVerifier = randomBase64Url(48);
    const [stateDigest, codeChallenge, codeVerifierCiphertext] = await Promise.all([
      sha256Base64Url(state),
      sha256Base64Url(codeVerifier),
      encryptOAuthSecret(
        serializeGoogleOAuthSessionGrant({
          version: 1,
          codeVerifier,
          ownerAccessKey: args.ownerAccessKey,
        }),
        config.encryptionKey,
      ),
    ]);
    const expiresAt = Date.now() + NODESLIDE_GOOGLE_OAUTH_SESSION_MS;
    await ctx.runMutation(internal.nodeslideGoogleAuth.storeSession, {
      stateDigest,
      deckId: args.deckId,
      ownerAccessKey: args.ownerAccessKey,
      codeVerifierCiphertext,
      returnTo,
      expiresAt,
    });

    const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_URL);
    authorizationUrl.searchParams.set('client_id', config.clientId);
    authorizationUrl.searchParams.set('redirect_uri', config.redirectUri);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('scope', NODESLIDE_GOOGLE_SCOPE);
    authorizationUrl.searchParams.set('access_type', 'offline');
    authorizationUrl.searchParams.set('include_granted_scopes', 'true');
    authorizationUrl.searchParams.set('prompt', 'consent');
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('code_challenge', codeChallenge);
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');
    return { authorizationUrl: authorizationUrl.toString(), expiresAt };
  },
});

export const disconnect = action({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args): Promise<{ disconnected: boolean; providerRevoked: boolean }> => {
    const credential = await ctx.runQuery(
      internal.nodeslideGoogleAuth.readCredentialForOwner,
      args,
    );
    if (!credential) return { disconnected: true, providerRevoked: true };
    let providerRevoked = false;
    try {
      const config = requireGoogleOAuthConfig();
      const encryptedToken = credential.refreshTokenCiphertext ?? credential.accessTokenCiphertext;
      const token = await decryptOAuthSecret(encryptedToken, config.encryptionKey);
      const response = await fetchWithTimeout(
        GOOGLE_REVOKE_URL,
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }),
        },
        TOKEN_TIMEOUT_MS,
      );
      providerRevoked = response.ok;
    } catch {
      providerRevoked = false;
    }
    await ctx.runMutation(internal.nodeslideGoogleAuth.revokeCredential, {
      deckId: args.deckId,
      ownerAccessKey: args.ownerAccessKey,
    });
    return { disconnected: true, providerRevoked };
  },
});

export const complete = internalAction({
  args: {
    state: v.string(),
    code: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ redirectTo: string }> => {
    const stateDigest = await sha256Base64Url(args.state);
    const session = await ctx.runQuery(internal.nodeslideGoogleAuth.readSession, { stateDigest });
    if (!session || session.consumedAt !== undefined || session.expiresAt <= Date.now()) {
      return {
        redirectTo: withGoogleOAuthResult(googleOAuthFallbackOrigin(), 'expired'),
      };
    }
    if (args.error || !args.code) {
      await ctx.runMutation(internal.nodeslideGoogleAuth.consumeSession, { stateDigest });
      return { redirectTo: withGoogleOAuthResult(session.returnTo, 'denied') };
    }

    let exchangedTokenForRevocation: string | undefined;
    try {
      const config = requireGoogleOAuthConfig();
      const grant = parseGoogleOAuthSessionGrant(
        await decryptOAuthSecret(session.codeVerifierCiphertext, config.encryptionKey),
      );
      await ctx.runQuery(internal.nodeslideGoogleAuth.validateOwner, {
        deckId: session.deckId,
        ownerAccessKey: grant.ownerAccessKey,
      });
      const response = await fetchWithTimeout(
        GOOGLE_TOKEN_URL,
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code: args.code,
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code_verifier: grant.codeVerifier,
            grant_type: 'authorization_code',
            redirect_uri: config.redirectUri,
          }),
        },
        TOKEN_TIMEOUT_MS,
      );
      const token = (await response.json()) as GoogleTokenResponse;
      if (
        !response.ok ||
        !token.access_token ||
        !Number.isFinite(token.expires_in) ||
        (token.expires_in ?? 0) <= 0
      ) {
        throw new Error('Google OAuth token exchange failed.');
      }
      exchangedTokenForRevocation = token.refresh_token ?? token.access_token;
      const scopes = normalizeScopes(token.scope);
      if (!scopes.includes(NODESLIDE_GOOGLE_SCOPE)) {
        throw new Error('Google OAuth did not grant the required per-file scope.');
      }
      const [accessTokenCiphertext, refreshTokenCiphertext] = await Promise.all([
        encryptOAuthSecret(token.access_token, config.encryptionKey),
        token.refresh_token
          ? encryptOAuthSecret(token.refresh_token, config.encryptionKey)
          : Promise.resolve(undefined),
      ]);
      await ctx.runMutation(internal.nodeslideGoogleAuth.storeCredential, {
        stateDigest,
        deckId: session.deckId,
        ownerAccessKey: grant.ownerAccessKey,
        accessTokenCiphertext,
        ...(refreshTokenCiphertext ? { refreshTokenCiphertext } : {}),
        accessTokenExpiresAt: Date.now() + (token.expires_in ?? 0) * 1000,
        scopes,
        tokenType: token.token_type ?? 'Bearer',
      });
      exchangedTokenForRevocation = undefined;
      return { redirectTo: withGoogleOAuthResult(session.returnTo, 'connected') };
    } catch {
      if (exchangedTokenForRevocation) {
        await revokeGoogleToken(exchangedTokenForRevocation).catch(() => undefined);
      }
      await ctx.runMutation(internal.nodeslideGoogleAuth.consumeSession, { stateDigest });
      return { redirectTo: withGoogleOAuthResult(session.returnTo, 'failed') };
    }
  },
});

export const validateOwner = internalQuery({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args): Promise<{ deckId: string }> => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    return { deckId: deck.id };
  },
});

export const storeSession = internalMutation({
  args: {
    stateDigest: v.string(),
    deckId: v.string(),
    ownerAccessKey: v.string(),
    codeVerifierCiphertext: v.string(),
    returnTo: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const now = Date.now();
    const oldSessions = await ctx.db
      .query('nodeslide_oauth_sessions')
      .withIndex('by_deck_created', (index) => index.eq('deckId', args.deckId))
      .collect();
    await Promise.all(
      oldSessions
        .filter((session) => session.expiresAt <= now || session.consumedAt !== undefined)
        .map((session) => ctx.db.delete(session._id)),
    );
    await ctx.db.insert('nodeslide_oauth_sessions', {
      stateDigest: args.stateDigest,
      deckId: args.deckId,
      codeVerifierCiphertext: args.codeVerifierCiphertext,
      returnTo: args.returnTo,
      expiresAt: args.expiresAt,
      provider: PROVIDER,
      createdAt: now,
    });
  },
});

export const readSession = internalQuery({
  args: { stateDigest: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query('nodeslide_oauth_sessions')
      .withIndex('by_state_digest', (index) => index.eq('stateDigest', args.stateDigest))
      .unique(),
});

export const consumeSession = internalMutation({
  args: { stateDigest: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const session = await ctx.db
      .query('nodeslide_oauth_sessions')
      .withIndex('by_state_digest', (index) => index.eq('stateDigest', args.stateDigest))
      .unique();
    if (session && session.consumedAt === undefined) {
      await ctx.db.patch(session._id, { consumedAt: Date.now() });
    }
  },
});

export const storeCredential = internalMutation({
  args: {
    stateDigest: v.string(),
    deckId: v.string(),
    ownerAccessKey: v.string(),
    accessTokenCiphertext: v.string(),
    refreshTokenCiphertext: v.optional(v.string()),
    accessTokenExpiresAt: v.number(),
    scopes: v.array(v.string()),
    tokenType: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const session = await ctx.db
      .query('nodeslide_oauth_sessions')
      .withIndex('by_state_digest', (index) => index.eq('stateDigest', args.stateDigest))
      .unique();
    if (
      !session ||
      session.deckId !== args.deckId ||
      session.consumedAt !== undefined ||
      session.expiresAt <= Date.now()
    ) {
      throw new Error('OAuth session is unavailable.');
    }
    const now = Date.now();
    const existing = await ctx.db
      .query('nodeslide_oauth_credentials')
      .withIndex('by_deck_provider', (index) =>
        index.eq('deckId', args.deckId).eq('provider', PROVIDER),
      )
      .unique();
    const refreshTokenCiphertext = args.refreshTokenCiphertext ?? existing?.refreshTokenCiphertext;
    const credential = {
      deckId: args.deckId,
      provider: PROVIDER,
      accessTokenCiphertext: args.accessTokenCiphertext,
      ...(refreshTokenCiphertext ? { refreshTokenCiphertext } : {}),
      accessTokenExpiresAt: args.accessTokenExpiresAt,
      scopes: args.scopes,
      tokenType: args.tokenType,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    await ctx.db.insert('nodeslide_oauth_credentials', { ...credential, createdAt: now });
    await ctx.db.patch(session._id, { consumedAt: now });
  },
});

export const readCredentialForOwner = internalQuery({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args) => {
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const credential = await ctx.db
      .query('nodeslide_oauth_credentials')
      .withIndex('by_deck_provider', (index) =>
        index.eq('deckId', deck.id).eq('provider', PROVIDER),
      )
      .unique();
    if (!credential || credential.revokedAt !== undefined) return null;
    return {
      accessTokenCiphertext: credential.accessTokenCiphertext,
      ...(credential.refreshTokenCiphertext
        ? { refreshTokenCiphertext: credential.refreshTokenCiphertext }
        : {}),
    };
  },
});

export const revokeCredential = internalMutation({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args): Promise<void> => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const credential = await ctx.db
      .query('nodeslide_oauth_credentials')
      .withIndex('by_deck_provider', (index) =>
        index.eq('deckId', args.deckId).eq('provider', PROVIDER),
      )
      .unique();
    if (credential && credential.revokedAt === undefined) {
      const now = Date.now();
      await ctx.db.patch(credential._id, { revokedAt: now, updatedAt: now });
    }
  },
});

function requireGoogleOAuthConfig() {
  return resolveNodeSlideGoogleOAuthConfig({
    clientId: process.env['GOOGLE_CLIENT_ID'],
    clientSecret: process.env['GOOGLE_CLIENT_SECRET'],
    encryptionKey: process.env['NODESLIDE_OAUTH_TOKEN_ENCRYPTION_KEY'],
    redirectUri: process.env['NODESLIDE_GOOGLE_REDIRECT_URI'],
    allowedOrigins: process.env['NODESLIDE_APP_ORIGINS'],
  });
}

function googleOAuthFallbackOrigin(): string {
  try {
    return (
      allowedNodeSlideOrigins(process.env['NODESLIDE_APP_ORIGINS'])[0] ??
      'https://parity-studio.vercel.app'
    );
  } catch {
    return 'https://parity-studio.vercel.app';
  }
}

function normalizeScopes(value: string | undefined): string[] {
  const scopes = (value ?? NODESLIDE_GOOGLE_SCOPE).split(/\s+/u).filter(Boolean);
  return [...new Set(scopes)].sort();
}

function serializeGoogleOAuthSessionGrant(grant: GoogleOAuthSessionGrant): string {
  return JSON.stringify(grant);
}

function parseGoogleOAuthSessionGrant(value: string): GoogleOAuthSessionGrant {
  try {
    const grant = JSON.parse(value) as Partial<GoogleOAuthSessionGrant>;
    if (
      grant.version !== 1 ||
      typeof grant.codeVerifier !== 'string' ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(grant.codeVerifier) ||
      typeof grant.ownerAccessKey !== 'string' ||
      !isOwnerAccessKey(grant.ownerAccessKey)
    ) {
      throw new Error();
    }
    return grant as GoogleOAuthSessionGrant;
  } catch {
    throw new Error('OAuth session is unavailable.');
  }
}

async function revokeGoogleToken(token: string): Promise<void> {
  await fetchWithTimeout(
    GOOGLE_REVOKE_URL,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    },
    TOKEN_TIMEOUT_MS,
  );
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
