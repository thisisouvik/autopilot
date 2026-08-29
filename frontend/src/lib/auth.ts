import { SignJWT, jwtVerify } from "jose";

// Session lifetime in seconds (7 days). Must stay in sync with the backend
// (backend/src/routes/auth.ts -> SESSION_TTL_SECONDS) so the cookie the backend
// sets and the token these helpers verify never disagree.
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// Tolerate small clock drift between the issuer (backend/Render) and the verifier
// (Vercel serverless or the browser). Without this a token issued on another
// machine a second or two ahead can be rejected as expired well before it really is.
const CLOCK_TOLERANCE_SECONDS = 60;

// The dev-only fallback MUST match the backend's dev fallback
// (backend/src/server.ts -> "super-secret-key-for-dev"). If they differ, login
// "succeeds" on the backend but every verify here fails => users are logged out
// immediately even though their token is valid.
const secretKey = process.env.JWT_SECRET || "super-secret-key-for-dev";
const encodedKey = new TextEncoder().encode(secretKey);

export async function signToken(payload: { publicKey: string }) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL_SECONDS)
    .sign(encodedKey);
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, encodedKey, {
      algorithms: ["HS256"],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    });
    return payload as { publicKey: string; iat: number; exp: number };
  } catch (error) {
    return null;
  }
}
