import DashboardShell from "@/components/DashboardShell";
import ChatClient from "./ChatClient";
import { getSession } from "@/lib/session";

export default async function ChatPage() {
  const session = await getSession();

  return (
    <DashboardShell publicKey={session.publicKey}>
      <ChatClient />
    </DashboardShell>
  );
}
