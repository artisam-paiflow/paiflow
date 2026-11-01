import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePageSession } from "@/lib/auth";
import { env } from "@/lib/env";
import Topbar from "@/components/app/topbar";
import TemplateManager from "@/components/flow-templates/template-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Private templates · Paiflow" };
export default async function FlowTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePageSession();
  if (user.role === "SANDBOX") notFound();
  const query = await searchParams;
  const seed = z.uuid().safeParse(query.flowId);
  return (
    <>
      <Topbar username={user.username} />
      <main className="px-margin py-lg mx-auto max-w-6xl">
        <a className="text-primary inline-flex min-h-11 items-center underline" href="/dashboard">
          ← Your flows
        </a>
        <h1 className="font-display text-on-surface mt-2 text-4xl font-semibold">
          Private templates
        </h1>
        <TemplateManager
          ownerId={user.id}
          username={user.username}
          network={env().STELLAR_NETWORK}
          seedFlowId={seed.success ? seed.data : undefined}
        />
      </main>
    </>
  );
}
