// POST /api/account/disconnect — clear session + pause all rules
import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { getUserFromRequest } from "@/lib/getUser";

export async function POST() {
  const user = await getUserFromRequest();

  if (user) {
    const sql = neon(process.env.DATABASE_URL!);
    // Pause all active rules for this user
    await sql`
      UPDATE "Rule"
      SET status = 'paused', "updatedAt" = NOW()
      WHERE "userId" = ${user.id}::uuid AND status = 'active'
    `;
  }

  // Clear the session cookie
  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: "session",
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0, // expire immediately
  });
  return response;
}
