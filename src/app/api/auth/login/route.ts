import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { signToken } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { publicKey } = body;

    if (!publicKey) {
      return NextResponse.json(
        { error: "Public key is required" },
        { status: 400 }
      );
    }

    // Upsert user in the database
    // This creates the user if they don't exist, or returns them if they do
    const user = await prisma.user.upsert({
      where: { publicKey },
      update: {}, // No updates needed on login
      create: { publicKey },
    });

    // Create JWT session token
    const token = await signToken({ publicKey: user.publicKey });

    // Set the token as an HTTP-only cookie
    const response = NextResponse.json(
      { success: true, user: { publicKey: user.publicKey } },
      { status: 200 }
    );

    // Cookie configuration: HTTP-only, secure in production, strict same-site
    response.cookies.set({
      name: "session",
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Login API Error:", message);
    return NextResponse.json(
      {
        error: "Internal server error during authentication",
        detail: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status: 500 }
    );
  }
}
