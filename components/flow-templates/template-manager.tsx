"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { flowToEnglish } from "@/lib/flows/english";
import {
  CreateFlowTemplateSchema,
  UpdateFlowTemplateSchema,
  PublishFlowTemplateSchema,
  type TemplateDefinition,
} from "@/lib/flow-templates/schema";
import {
  TemplateDraftSchema,
  TemplatePageSchema,
  VersionPageSchema,
  VersionSchema,
  type TemplateDraft,
  type TemplateVersion,
} from "@/lib/flow-templates/client-schema";
import {
  buttonClass,
  primaryClass,
  managementRequest,
  ManagementError,
} from "@/components/developer/api";
import { inputClass } from "@/components/builder/inputs/styles";
import { FieldPolicyNotice } from "@/components/builder/field-policy-notice";
import DeclarationEditor from "./declaration-editor";
import InstanceForm from "./instance-form";

const base = "/api/flow-templates";
type Summary = z.infer<typeof TemplatePageSchema>["items"][number];
type VersionSummary = z.infer<typeof VersionPageSchema>["items"][number];
export default function TemplateManager({
  ownerId,
  username,
  network,
  seedFlowId,
}: {
  ownerId: string;
  username: string;
  network: "testnet" | "mainnet";
  seedFlowId?: string;
}) {
  const [items, setItems] = useState<Summary[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [definition, setDefinition] = useState<TemplateDefinition | null>(null);
  const [flowId, setFlowId] = useState(seedFlowId ?? "");
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [versionNext, setVersionNext] = useState<string | null>(null);
  const [version, setVersion] = useState<TemplateVersion | null>(null);
  const [expiry, setExpiry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function action(run: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await run();
    } catch (e) {
      setError(
        e instanceof ManagementError
          ? e.message
          : e instanceof z.ZodError
            ? "Check the template fields and declared input values."
            : "The request could not be completed. Reload the saved draft before retrying a write.",
      );
      if (e instanceof ManagementError) setFields(e.fields);
      if (e instanceof z.ZodError) setFields(z.flattenError(e).fieldErrors);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function load(cursor?: string) {
    const data = await managementRequest(
      `${base}?limit=20${cursor ? `&cursor=${cursor}` : ""}`,
      TemplatePageSchema,
    );
    setItems((old) =>
      cursor ? [...old, ...data.items.filter((i) => !old.some((o) => o.id === i.id))] : data.items,
    );
    setNext(data.nextCursor);
  }
  useEffect(() => {
    void action(() => load());
  }, []);
  function edit(row: TemplateDraft) {
    setDraft(row);
    setName(row.name);
    setDescription(row.description ?? "");
    setDefinition(row.draft);
  }
  async function loadVersions(id: string, cursor?: string) {
    const data = await managementRequest(
      `${base}/${id}/versions?limit=20${cursor ? `&cursor=${cursor}` : ""}`,
      VersionPageSchema,
    );
    setVersions((old) => (cursor ? [...old, ...data.items] : data.items));
    setVersionNext(data.nextCursor);
  }
  async function open(id: string) {
    const row = await managementRequest(`${base}/${id}`, TemplateDraftSchema);
    setVersion(null);
    edit(row);
    await loadVersions(id);
  }
  async function importFlow() {
    const id = z.uuid().parse(flowId);
    const flow = await managementRequest(
      `/api/flows/${id}`,
      z.object({ name: z.string(), graph: FlowGraphSchema }),
    );
    setDefinition({ schemaVersion: 1, graph: flow.graph, inputs: [] });
    if (!draft) setName(flow.name);
    toast.success("Saved graph copied. Declare creation inputs before publishing.");
  }
  async function save() {
    if (!definition) throw new ManagementError("Choose a saved flow first");
    const body = draft
      ? UpdateFlowTemplateSchema.parse({
          expectedRevision: draft.draftRevision,
          name,
          description,
          definition,
        })
      : CreateFlowTemplateSchema.parse({ name, description, definition });
    const row = await managementRequest(draft ? `${base}/${draft.id}` : base, TemplateDraftSchema, {
      method: draft ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    edit(row);
    await load();
    toast.success("Private draft saved.");
  }
  const dirty =
    !!draft &&
    (name !== draft.name ||
      description !== (draft.description ?? "") ||
      JSON.stringify(definition) !== JSON.stringify(draft.draft));
  return (
    <div className="text-on-surface mt-6 space-y-6">
      <p className="text-on-surface-variant max-w-3xl">
        Private versions create separate contracts for each agreement. You are the instance owner;
        your wallet signs as admin and pays deployment fees. Creating an instance requires your
        authenticated account.
      </p>
      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <section className="space-y-3" aria-label="Private templates">
          <button
            className={primaryClass}
            disabled={busy}
            onClick={() => {
              setDraft(null);
              setVersion(null);
              setDefinition(null);
              setName("");
              setDescription("");
              setVersions([]);
            }}
          >
            New private template
          </button>
          <button className={buttonClass} disabled={busy} onClick={() => void action(() => load())}>
            Refresh templates
          </button>
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  className={`${buttonClass} w-full text-left`}
                  disabled={busy}
                  onClick={() => void action(() => open(item.id))}
                >
                  {item.name}
                  {item.retiredAt ? " · Retired" : ""}
                </button>
              </li>
            ))}
          </ul>
          {next ? (
            <button
              className={buttonClass}
              disabled={busy}
              onClick={() => void action(() => load(next))}
            >
              More templates
            </button>
          ) : null}
        </section>
        <div className="min-w-0 space-y-6">
          <section aria-label="Template draft" className="glass-panel space-y-4 rounded-xl p-5">
            <h2 className="text-xl font-semibold">
              {draft
                ? `${draft.name} · draft revision ${draft.draftRevision}`
                : "New private template"}
            </h2>
            {draft ? <p className="text-xs break-all">Template ID: {draft.id}</p> : null}
            <fieldset className="space-y-4" disabled={busy || !!draft?.retiredAt}>
              <label className="grid gap-1 text-sm">
                Template name
                <input
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                />
              </label>
              <label className="grid gap-1 text-sm">
                Description
                <input
                  className={inputClass}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={280}
                />
              </label>
              <p className="text-on-surface-variant text-sm">
                Build and save an exemplar in{" "}
                <a className="text-primary underline" href="/dashboard">
                  your flows
                </a>
                , then copy its saved graph here. Copying does not alter the source flow. Replacing
                the graph clears this draft’s declarations. Publication requires a configured
                deployable exemplar.
              </p>
              <label className="grid gap-1 text-sm">
                Saved flow ID
                <input
                  className={inputClass}
                  value={flowId}
                  onChange={(e) => setFlowId(e.target.value)}
                />
              </label>
              <button className={buttonClass} onClick={() => void action(importFlow)}>
                Copy saved graph
              </button>
              {definition ? (
                <>
                  <details>
                    <summary className="min-h-11 cursor-pointer py-2">
                      Exemplar terms and runtime modes
                    </summary>
                    <p className="text-sm leading-relaxed">{flowToEnglish(definition.graph)}</p>
                    <PolicyNotice graph={definition.graph} />
                  </details>
                  <DeclarationEditor
                    graph={definition.graph}
                    inputs={definition.inputs}
                    onChange={(inputs) => setDefinition({ ...definition, inputs })}
                    disabled={busy}
                  />
                  <button className={primaryClass} onClick={() => void action(save)}>
                    Save private draft
                  </button>
                </>
              ) : null}
            </fieldset>
            {draft ? (
              <>
                <button
                  className={buttonClass}
                  disabled={busy}
                  onClick={() => void action(() => open(draft.id))}
                >
                  Reload saved draft
                </button>
                <label className="grid gap-1 text-sm">
                  Version expiry (optional UTC ISO timestamp)
                  <input
                    className={inputClass}
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    disabled={busy || !!draft.retiredAt}
                  />
                </label>
                {dirty ? <p role="status">Save draft changes before publishing.</p> : null}
                <button
                  className={primaryClass}
                  disabled={busy || dirty || !!draft.retiredAt}
                  onClick={() =>
                    void action(async () => {
                      const body = PublishFlowTemplateSchema.parse({
                        expectedRevision: draft.draftRevision,
                        ...(expiry ? { expiresAt: expiry } : {}),
                      });
                      await managementRequest(`${base}/${draft.id}/versions`, VersionSchema, {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify(body),
                      });
                      await loadVersions(draft.id);
                      toast.success("Immutable private version published.");
                    })
                  }
                >
                  Publish immutable version
                </button>
                {!draft.retiredAt ? (
                  <button
                    className={buttonClass}
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Permanently retire this template? New publication and instances will stop. Existing evidence remains.",
                        )
                      )
                        void action(async () => {
                          await managementRequest(
                            `${base}/${draft.id}/retire`,
                            TemplateDraftSchema,
                            {
                              method: "POST",
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify({ confirm: "retire" }),
                            },
                          );
                          await open(draft.id);
                          await load();
                          toast.success("Template retired.");
                        });
                    }}
                  >
                    Retire template
                  </button>
                ) : (
                  <p>Retired. Existing instance recovery remains available.</p>
                )}
              </>
            ) : null}
          </section>
          {draft ? (
            <section aria-label="Published versions" className="space-y-4">
              <h2 className="text-xl font-semibold">Immutable versions</h2>
              <p className="text-sm">
                Select the exact version. Editing a draft or publishing another version never
                updates an existing instance.
              </p>
              <div className="flex flex-wrap gap-2">
                {versions.map((v) => (
                  <button
                    className={buttonClass}
                    key={v.id}
                    disabled={busy}
                    onClick={() =>
                      void action(async () =>
                        setVersion(
                          await managementRequest(
                            `${base}/${draft.id}/versions/${v.id}`,
                            VersionSchema,
                          ),
                        ),
                      )
                    }
                  >
                    Version {v.version} · {v.network.toUpperCase()}
                    {v.retiredAt ? " · Retired" : ""}
                  </button>
                ))}
              </div>
              {versionNext ? (
                <button
                  className={buttonClass}
                  disabled={busy}
                  onClick={() => void action(() => loadVersions(draft.id, versionNext))}
                >
                  More versions
                </button>
              ) : null}
              {version ? (
                <>
                  <p className="text-xs break-all">
                    Version {version.version} · {version.id} · Content hash {version.contentHash}
                    {version.expiresAt ? ` · Expires ${version.expiresAt}` : ""}
                  </p>
                  <InstanceForm
                    key={version.id}
                    ownerId={ownerId}
                    username={username}
                    network={network}
                    templateId={draft.id}
                    version={version}
                    retired={!!draft.retiredAt}
                  />
                  {!version.retiredAt ? (
                    <button
                      className={buttonClass}
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Permanently retire this version? Existing admitted instances remain recoverable.",
                          )
                        )
                          void action(async () => {
                            const updated = await managementRequest(
                              `${base}/${draft.id}/versions/${version.id}/retire`,
                              VersionSchema,
                              {
                                method: "POST",
                                headers: { "content-type": "application/json" },
                                body: JSON.stringify({ confirm: "retire" }),
                              },
                            );
                            setVersion(updated);
                            await loadVersions(draft.id);
                            toast.success("Version retired.");
                          });
                      }}
                    >
                      Retire selected version
                    </button>
                  ) : null}
                </>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
      {busy ? <p role="status">Working…</p> : null}
      {error ? (
        <div role="alert" className="text-error">
          <p>{error}</p>
          {Object.entries(fields).map(([key, values]) => (
            <p key={key}>
              {key}: {values.join(" ")}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PolicyNotice({ graph }: { graph: z.infer<typeof FlowGraphSchema> }) {
  return (
    <div>
      {graph.fieldPolicies ? <FieldPolicyNotice available /> : null}
      <p className="text-on-surface-variant mt-3 text-sm">
        {graph.fieldPolicies
          ? "Explicit lifetime field policies: constants stay fixed, execution inputs are supplied per payment, and only declared stored mutable fields permit admin updates on compatible contracts."
          : "This version has legacy configured behavior without v1 lifetime field policies. Creation inputs do not add runtime execution or mutation permissions."}{" "}
        Creation inputs are applied once at deployment; they grant no later edit authority.
      </p>
    </div>
  );
}
