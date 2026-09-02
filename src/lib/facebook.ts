import { env } from "../config/env";
import { AppError } from "../middleware/errorHandler";

const GRAPH_VERSION = "v21.0";
const GRAPH_API = `https://graph.facebook.com/${GRAPH_VERSION}`;

export type FacebookIdentity = {
  facebookId: string;
  email: string | null;
  name: string;
  givenName: string;
};

type DebugTokenResponse = {
  data?: {
    app_id?: string;
    is_valid?: boolean;
    user_id?: string;
    expires_at?: number;
  };
};

type MeResponse = {
  id?: string;
  name?: string;
  email?: string;
  first_name?: string;
};

/**
 * Verifies a Facebook access token server-side.
 *
 * The client never sees the app secret: the token is validated against
 * `debug_token` (which confirms it was minted for *this* app, preventing token
 * substitution from another app) and the profile is then read with that token.
 */
export async function verifyFacebookAccessToken(
  accessToken: string,
): Promise<FacebookIdentity> {
  const appId = env.FACEBOOK_APP_ID;
  const appSecret = env.FACEBOOK_APP_SECRET;

  if (!appId || !appSecret) {
    throw new AppError(
      "Facebook Sign-In is not configured. Set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET.",
      503,
    );
  }

  const debug = await graphGet<DebugTokenResponse>("/debug_token", {
    input_token: accessToken,
    access_token: `${appId}|${appSecret}`,
  });

  if (!debug.data?.is_valid || debug.data.app_id !== appId || !debug.data.user_id) {
    throw new AppError("Invalid Facebook token", 401);
  }

  const profile = await graphGet<MeResponse>("/me", {
    fields: "id,name,email,first_name",
    access_token: accessToken,
  });

  if (!profile.id || profile.id !== debug.data.user_id) {
    throw new AppError("Invalid Facebook token", 401);
  }

  const email = profile.email?.trim().toLowerCase() || null;
  const name =
    profile.name?.trim() ||
    profile.first_name?.trim() ||
    (email ? email.split("@")[0] : "Guest") ||
    "Guest";

  return {
    facebookId: profile.id,
    email,
    name,
    givenName: profile.first_name?.trim() || name.split(" ")[0] || name,
  };
}

async function graphGet<T>(
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const url = new URL(`${GRAPH_API}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new AppError("Could not reach Facebook. Try again.", 502);
  }

  if (!res.ok) {
    throw new AppError("Invalid Facebook token", 401);
  }

  return (await res.json()) as T;
}
