/**
 * Login API route.
 *
 * Uses the @neondatabase/serverless neon() HTTP driver directly instead of
 * Prisma for this route. This connects over HTTPS (port 443), not TCP port
 * 5432, so it works regardless of IPv4/IPv6 routing or Cloudflare WARP.
 */
import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { signToken } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { publicKey } = body;

    if (!publicKey || typeof publicKey !== "string") {
      return NextResponse.json(
        { error: "Public key is required" },
        { status: 400 }
      );
    }

    // Connect via HTTP (not TCP port 5432)
    const sql = neon(process.env.DATABASE_URL!);

    // Upsert user — create if new, return existing if not
    const rows = await sql`
      INSERT INTO "User" (id, "publicKey", "createdAt", "updatedAt")
      VALUES (
        gen_random_uuid(),
        ${publicKey},
        NOW(),
        NOW()
      )
      ON CONFLICT ("publicKey")
      DO UPDATE SET "updatedAt" = NOW()
      RETURNING id, "publicKey", "createdAt"
    `;

    const user = rows[0];
    if (!user) {
      throw new Error("Failed to upsert user record.");
    }

    // Issue JWT
    const token = await signToken({ publicKey: user.publicKey });

    // Return session as HTTP-only cookie
    const response = NextResponse.json(
      { success: true, user: { publicKey: user.publicKey } },
      { status: 200 }
    );

    response.cookies.set({
      name: "session",
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Login API Error:", message);
    return NextResponse.json(
      {
        error: "Authentication failed. Please try again.",
        detail: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status: 500 }
    );
  }
}
