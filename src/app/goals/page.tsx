import DashboardShell from "@/components/DashboardShell";
import GoalsClient from "./GoalsClient";
import { getSession } from "@/lib/session";
import { neon } from "@neondatabase/serverless";
import { headers } from "next/headers";

export default async function GoalsPage() {
  const session = await getSession();
  const sql = neon(process.env.DATABASE_URL!);

  // Bootstrap Goal table on first visit
  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
  await fetch(`${protocol}://${host}/api/bootstrap`).catch(() => {});

  const [goalsRows, rulesRows] = await Promise.all([
    sql`
      SELECT g.* FROM "Goal" g
      JOIN "User" u ON g."userId" = u.id
      WHERE u."publicKey" = ${session.publicKey}
      ORDER BY g."createdAt" DESC
    `.catch(() => []),
    sql`
      SELECT r.* FROM "Rule" r
      JOIN "User" u ON r."userId" = u.id
      WHERE u."publicKey" = ${session.publicKey}
      ORDER BY r."createdAt" DESC
    `.catch(() => []),
  ]);

  return (
    <DashboardShell publicKey={session.publicKey}>
      <GoalsClient initialGoals={goalsRows as any} rules={rulesRows as any} />
    </DashboardShell>
  );
}
