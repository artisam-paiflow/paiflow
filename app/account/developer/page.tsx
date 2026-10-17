import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth";
import Topbar from "@/components/app/topbar";
import DeveloperTokenPanel from "@/components/developer/token-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Developer API · Paiflow" };

export default async function DeveloperPage() {
  const user = await requirePageSession();
  if (user.role === "SANDBOX") notFound();
  return (
    <>
      <Topbar username={user.username} />
      <main className="px-margin py-lg mx-auto max-w-4xl">
        <p className="text-on-surface-muted font-mono text-sm">/ ACCOUNT · DEVELOPER API</p>
        <h1 className="font-display text-on-surface mt-2 text-4xl font-semibold">Developer API</h1>
        <DeveloperTokenPanel />
      </main>
    </>
  );
}
