import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyToken } from "@/lib/auth";

export default async function Dashboard() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("session")?.value;

  if (!sessionToken) {
    redirect("/onboarding");
  }

  const payload = await verifyToken(sessionToken);

  if (!payload) {
    redirect("/onboarding");
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-black">
      <div className="glass-panel p-12 rounded-3xl max-w-2xl w-full border border-white/10">
        <h1 className="text-4xl font-bold text-white mb-4">
          Welcome to AutoPilot
        </h1>
        <p className="text-gray-400 mb-8">
          You are logged in with wallet:
        </p>
        <div className="bg-white/5 p-4 rounded-xl font-mono text-sm text-green-400 break-all mb-8 border border-white/5">
          {payload.publicKey}
        </div>
        
        <p className="text-sm text-gray-500">
          This is your protected dashboard. More features coming soon.
        </p>
      </div>
    </div>
  );
}
