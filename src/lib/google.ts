import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env";
import { AppError } from "../middleware/errorHandler";

const client = new OAuth2Client();

export async function verifyGoogleIdToken(idToken: string) {
  if (env.GOOGLE_CLIENT_IDS.length === 0) {
    throw new AppError(
      "Google Sign-In is not configured. Set GOOGLE_CLIENT_IDS to your OAuth client IDs.",
      503,
    );
  }

  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_IDS,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub) throw new AppError("Invalid Google token", 401);

    const email = payload.email?.trim().toLowerCase() ?? null;
    const name =
      payload.name?.trim() ||
      payload.given_name?.trim() ||
      (email ? email.split("@")[0] : "Guest") ||
      "Guest";

    return {
      googleId: payload.sub,
      email,
      name,
      givenName: payload.given_name?.trim() || name.split(" ")[0] || name,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("Invalid Google token", 401);
  }
}
