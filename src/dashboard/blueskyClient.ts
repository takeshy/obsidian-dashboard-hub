// AT Protocol transport for Bluesky posting: app-password sessions over
// Obsidian's requestUrl (no CORS restrictions, works on desktop and mobile).
import { requestUrl } from "obsidian";
import { t } from "src/i18n";
import type { BlueskyApi, BlueskyApiResponse } from "./bluesky";

export const DEFAULT_BLUESKY_SERVICE = "https://bsky.social";

export interface BlueskyCredentials { handle: string; appPassword: string; service: string }
interface BlueskySession { did: string; handle: string; accessJwt: string; refreshJwt: string }

export function normalizeBlueskyService(value: unknown): string {
  const trimmed = (typeof value === "string" ? value : "").trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_BLUESKY_SERVICE;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function blueskyCredentials(settings: { handle?: unknown; appPassword?: unknown; service?: unknown }): BlueskyCredentials | null {
  const handle = (typeof settings.handle === "string" ? settings.handle : "").trim();
  const appPassword = (typeof settings.appPassword === "string" ? settings.appPassword : "").trim();
  if (!handle || !appPassword) return null;
  return { handle, appPassword, service: normalizeBlueskyService(settings.service) };
}

interface SessionCacheEntry { key: string; session: BlueskySession }
let sessionCache: SessionCacheEntry | null = null;

export function clearBlueskySession(): void {
  sessionCache = null;
}

function sessionKey(credentials: BlueskyCredentials): string {
  return JSON.stringify([credentials.service, credentials.handle, credentials.appPassword]);
}

async function xrpc(service: string, method: string, path: string, options: { auth?: string; body?: unknown; contentType?: string } = {}): Promise<BlueskyApiResponse> {
  const response = await requestUrl({
    url: `${service}/xrpc/${path}`,
    method,
    headers: {
      ...(options.contentType ? { "Content-Type": options.contentType } : {}),
      ...(options.auth ? { Authorization: `Bearer ${options.auth}` } : {}),
    },
    body: typeof options.body === "string" || options.body instanceof ArrayBuffer ? options.body : JSON.stringify(options.body),
    throw: false,
  });
  let json: any = null;
  try { json = response.json; } catch { json = null; }
  return { status: response.status, json };
}

function isAuthExpired(response: BlueskyApiResponse): boolean {
  return response.status === 401 || response.json?.error === "ExpiredToken";
}

async function createBlueskySession(credentials: BlueskyCredentials): Promise<BlueskySession> {
  const response = await xrpc(credentials.service, "POST", "com.atproto.server.createSession", {
    body: { identifier: credentials.handle, password: credentials.appPassword },
    contentType: "application/json",
  });
  if (response.status !== 200 || !response.json?.accessJwt || !response.json?.did) {
    throw new Error(t("bluesky.connectError"));
  }
  return {
    did: response.json.did,
    handle: response.json.handle || credentials.handle,
    accessJwt: response.json.accessJwt,
    refreshJwt: response.json.refreshJwt ?? "",
  };
}

async function ensureSession(credentials: BlueskyCredentials): Promise<BlueskySession> {
  const key = sessionKey(credentials);
  if (sessionCache?.key === key) return sessionCache.session;
  const session = await createBlueskySession(credentials);
  sessionCache = { key, session };
  return session;
}

/** Sign in once to confirm the credentials; the session is kept for the next publish. */
export async function verifyBluesky(credentials: BlueskyCredentials): Promise<string> {
  clearBlueskySession();
  return (await ensureSession(credentials)).handle;
}

export interface BlueskyConnection { api: BlueskyApi; did: string; handle: string }

/** An authenticated Bluesky API. Auth failures refresh the session once, then surface as 401. */
export async function connectBluesky(credentials: BlueskyCredentials): Promise<BlueskyConnection> {
  let session = await ensureSession(credentials);
  const withRetry = async (send: (token: string) => Promise<BlueskyApiResponse>): Promise<BlueskyApiResponse> => {
    let response = await send(session.accessJwt);
    if (isAuthExpired(response)) {
      clearBlueskySession();
      session = await ensureSession(credentials);
      response = await send(session.accessJwt);
    }
    return response;
  };
  return {
    api: {
      async get(path, params) {
        const query = Object.entries(params).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
        return withRetry(token => xrpc(credentials.service, "GET", `${path}?${query}`, { auth: token }));
      },
      async post(path, body, contentType = "application/json") {
        return withRetry(token => xrpc(credentials.service, "POST", path, {
          auth: token,
          body: contentType === "application/json" && body !== null && typeof body === "object" ? JSON.stringify(body) : body as string | ArrayBuffer,
          contentType,
        }));
      },
    },
    did: session.did,
    handle: session.handle,
  };
}
