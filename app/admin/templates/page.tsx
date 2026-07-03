import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import Topbar from "@/components/app/topbar";
import { Role } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function AdminTemplates() {
  const user = await requireSession({ role: Role.ADMIN });
  const templates = await db.contractTemplate.findMany({
    orderBy: [{ network: "asc" }, { kind: "asc" }],
  });
  return (
    <>
      <Topbar username={user.username} />
      <main className="px-margin py-lg mx-auto max-w-6xl">
        <p className="text-label-sm text-on-surface-variant font-mono">
          / ADMIN · CONTRACT TEMPLATES
        </p>
        <h1 className="font-display text-on-surface mt-2 text-[40px] leading-[1.1] font-semibold tracking-[-0.02em]">
          Templates.
        </h1>
        <p className="text-body-md text-on-surface-variant mt-3 max-w-2xl">
          Pre-uploaded Soroban WASMs that Paiflow instantiates when you deploy a flow. Re-upload via{" "}
          <code className="border-outline-variant/30 bg-surface-container-low/40 text-label-sm text-on-surface rounded border px-1.5 py-0.5 font-mono">
            pnpm contracts:upload
          </code>
          .
        </p>

        <div className="glass-panel mt-md overflow-hidden rounded-xl">
          <div className="gap-md bg-surface-container/60 px-md text-label-sm text-on-surface-variant grid grid-cols-[1fr_1fr_2fr_1fr] py-2.5 font-mono">
            <span>KIND</span>
            <span>NETWORK</span>
            <span>WASM HASH</span>
            <span className="text-right">UPLOADED</span>
          </div>
          <div className="divide-outline-variant/10 divide-y">
            {templates.map((t) => (
              <div
                key={t.id}
                className="gap-md px-md text-body-md hover:bg-surface-container-high/40 grid grid-cols-[1fr_1fr_2fr_1fr] py-2.5 transition-colors"
              >
                <span className="text-on-surface">{t.kind}</span>
                <span className="text-label-sm text-on-surface-variant font-mono">
                  {t.network?.toUpperCase()}
                </span>
                <span className="text-label-sm text-on-surface truncate font-mono">
                  {t.wasmHash}
                </span>
                <span className="text-label-sm text-on-surface-variant text-right font-mono">
                  {new Date(t.uploadedAt).toLocaleString()}
                </span>
              </div>
            ))}
            {templates.length === 0 && (
              <div className="px-md py-md text-label-sm text-on-surface-variant font-mono">
                NO TEMPLATES REGISTERED. RUN{" "}
                <code className="text-on-surface font-mono">pnpm contracts:upload</code>.
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
