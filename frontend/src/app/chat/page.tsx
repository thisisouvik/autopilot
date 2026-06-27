import DashboardShell from "@/components/DashboardShell";
import ChatClient from "./ChatClient";
import { getSession } from "@/lib/session";
import { neon } from "@neondatabase/serverless";

export default async function ChatPage() {
  const session = await getSession();
  const sql = neon(process.env.DATABASE_URL!);

  // Fetch rules so the client knows which state to show (empty vs coach)
  const rules = await sql`
    SELECT r.* FROM "Rule" r
    JOIN "User" u ON r."userId" = u.id
    WHERE u."publicKey" = ${session.publicKey}
    ORDER BY r."createdAt" DESC
  `.catch(() => []);

  return (
    <DashboardShell publicKey={session.publicKey}>
      <ChatClient initialRules={rules as any} />
    </DashboardShell>
  );
}
