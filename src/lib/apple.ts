import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import { env } from "../config/env";
import { AppError } from "../middleware/errorHandler";

const client = jwksClient({
  jwksUri: "https://appleid.apple.com/auth/keys",
  cache: true,
  cacheMaxAge: 86400000,
});

async function getAppleSigningKey(kid: string): Promise<string> {
  const key = await client.getSigningKey(kid);
  return key.getPublicKey();
}

export async function verifyAppleIdToken(idToken: string) {
  if (env.APPLE_CLIENT_IDS.length === 0) {
    throw new AppError(
      "Apple Sign-In is not configured. Set APPLE_CLIENT_IDS to your iOS bundle ID.",
      503,
    );
  }

  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded?.header.kid) {
    throw new AppError("Invalid Apple token", 401);
  }

  try {
    const signingKey = await getAppleSigningKey(decoded.header.kid);
    const audiences = env.APPLE_CLIENT_IDS;
    const payload = jwt.verify(idToken, signingKey, {
      algorithms: ["RS256"],
      audience:
        audiences.length === 1
          ? audiences[0]
          : (audiences as [string, ...string[]]),
      issuer: "https://appleid.apple.com",
    }) as jwt.JwtPayload;

    if (!payload.sub) throw new AppError("Invalid Apple token", 401);

    const email =
      typeof payload.email === "string"
        ? payload.email.trim().toLowerCase()
        : null;
    const hint = email?.split("@")[0] ?? "Guest";

    return {
      appleId: payload.sub,
      email,
      name: hint,
      givenName: hint,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("Invalid Apple token", 401);
  }
}
