import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { validateFlow } from "@/lib/flows/validate";
import { isPendingAddress } from "@/lib/flows/schema";
import type { FlowGraph, FlowNode } from "@/lib/flows/schema";
import { applyPatch, autoConnectOrphans, stripZeroBpsRecipients } from "@/lib/ai/normalize";
import { callGroq } from "@/lib/ai/groq";
import {
  buildSystemPrompt,
  buildUserMessage,
  buildCorrectionPrompt,
  EditResponseSchema,
} from "@/lib/ai/prompts";
import { getAddressBook } from "@/lib/address-book";
import type { PatchOp } from "@/lib/ai/prompts";

const BodySchema = z.object({
  message: z.string().min(1).max(2000),
});

function autoResolvePending(
  graph: FlowGraph,
  addressBook: Array<{ label: string; address: string }>,
): { graph: FlowGraph; resolvedCount: number } {
  let resolvedCount = 0;
  const nodes = graph.nodes.map((n) => {
    if (n.type === "split") {
      const recipients = n.config.recipients.map((r) => {
        if (isPendingAddress(r.address) && r.label) {
          const lbl = r.label;
          const entry = addressBook.find((e) => e.label.toLowerCase() === lbl.toLowerCase());
          if (entry) {
            resolvedCount++;
            return { ...r, address: entry.address };
          }
        }
        return r;
      });
      return { ...n, config: { ...n.config, recipients } } as FlowNode;
    }
    if (n.type === "pay" && isPendingAddress(n.config.recipient)) {
      const entry = addressBook.find((e) => e.label === "unnamed");
      if (entry) {
        resolvedCount++;
        return { ...n, config: { ...n.config, recipient: entry.address } } as FlowNode;
      }
    }
    return n;
  });
  return { graph: { ...graph, nodes }, resolvedCount };
}

async function tryEdit(
  graph: FlowGraph,
  instruction: string,
  addressBook: Array<{ label: string; address: string }>,
): Promise<{
  patch: unknown[];
  explanation: string;
  patchedGraph: FlowGraph;
  missingAddresses: string[];
}> {
  const system = buildSystemPrompt();
  const userMsg = buildUserMessage(graph, instruction, addressBook);

  const raw = await callGroq(
    [
      { role: "system", content: system },
      { role: "user", content: userMsg },
    ],
    { responseFormat: "json_object" },
  );

  const parsed = EditResponseSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new AppError("VALIDATION", "AI returned an invalid patch structure", {
      ai: issues,
    });
  }

  const { patch, explanation, missingAddresses } = parsed.data;

  if (!patch.length) {
    return { patch: [], explanation, patchedGraph: graph, missingAddresses: [] };
  }

  let patchedGraph: FlowGraph;
  try {
    patchedGraph = applyPatch(graph, patch);
    patchedGraph = autoConnectOrphans(patchedGraph);
    patchedGraph = stripZeroBpsRecipients(patchedGraph);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Patch application failed";
    throw new AppError("VALIDATION", msg, {
      patch: [msg],
    });
  }

  // Auto-resolve any PENDING:label addresses that match the address book
  const { graph: resolvedGraph } = autoResolvePending(patchedGraph, addressBook);
  patchedGraph = resolvedGraph;

  const v = validateFlow(patchedGraph);
  if (!v.ok) {
    const errorMessages = v.errors.map((e) => `${e.path}: ${e.message}`);
    throw new AppError("VALIDATION", "The AI patch would create an invalid flow", {
      patch: errorMessages,
      _rawPatch: [JSON.stringify(patch)],
    });
  }

  // Filter missingAddresses to only include labels still pending (not auto-resolved)
  const stillPending = (missingAddresses ?? []).filter((label) => {
    const resolved = addressBook.some((e) => e.label.toLowerCase() === label.toLowerCase());
    return !resolved;
  });

  return { patch, explanation, patchedGraph, missingAddresses: stillPending };
}

async function retryEdit(
  graph: FlowGraph,
  instruction: string,
  previousPatch: unknown[],
  previousErrors: string[],
  addressBook: Array<{ label: string; address: string }>,
): Promise<{
  patch: unknown[];
  explanation: string;
  patchedGraph: FlowGraph;
  missingAddresses: string[];
}> {
  const system = buildSystemPrompt();
  const userMsg = buildCorrectionPrompt(
    graph,
    instruction,
    previousPatch,
    previousErrors,
    addressBook,
  );

  const raw = await callGroq(
    [
      { role: "system", content: system },
      { role: "user", content: userMsg },
    ],
    { responseFormat: "json_object" },
  );

  const parsed = EditResponseSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new AppError("VALIDATION", "AI returned an invalid patch structure on retry", {
      ai: issues,
    });
  }

  const { patch, explanation, missingAddresses } = parsed.data;

  if (!patch.length) {
    return { patch: [], explanation, patchedGraph: graph, missingAddresses: [] };
  }

  let patchedGraph: FlowGraph;
  try {
    patchedGraph = applyPatch(graph, patch);
    patchedGraph = autoConnectOrphans(patchedGraph);
    patchedGraph = stripZeroBpsRecipients(patchedGraph);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Patch application failed";
    throw new AppError("VALIDATION", `Retry failed: ${msg}`, {
      patch: [msg],
    });
  }

  const { graph: resolvedGraph } = autoResolvePending(patchedGraph, addressBook);
  patchedGraph = resolvedGraph;

  const v = validateFlow(patchedGraph);
  if (!v.ok) {
    const errorMessages = v.errors.map((e) => `${e.path}: ${e.message}`);
    throw new AppError(
      "VALIDATION",
      "The AI couldn't produce a valid patch. Try describing your change differently.",
      {
        patch: errorMessages,
      },
    );
  }

  const stillPending = (missingAddresses ?? []).filter((label) => {
    const resolved = addressBook.some((e) => e.label.toLowerCase() === label.toLowerCase());
    return !resolved;
  });

  return { patch, explanation, patchedGraph, missingAddresses: stillPending };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;

    const rl = await rateLimit(`flow:edit:${user.id}`, 10, 60);
    if (!rl.ok) throw new AppError("RATE_LIMITED", "Too many editing requests. Slow down.");

    const flow = await db.flow.findFirst({ where: { id, ownerId: user.id } });
    if (!flow) throw new AppError("NOT_FOUND", "Flow not found");

    const body = BodySchema.parse(await req.json());
    const graph = flow.graph as FlowGraph;
    const addressBook = await getAddressBook(user.id);

    let result: Awaited<ReturnType<typeof tryEdit>>;
    try {
      result = await tryEdit(graph, body.message, addressBook);
    } catch (firstErr) {
      if (firstErr instanceof AppError && firstErr.code === "VALIDATION") {
        const allErrors: string[] = [];
        let firstPatch: unknown[] = [];
        if (firstErr.fields) {
          for (const [key, val] of Object.entries(firstErr.fields)) {
            if (key === "_rawPatch" && Array.isArray(val) && val.length > 0) {
              try {
                firstPatch = JSON.parse(val[0]!);
              } catch {
                /* ignore parse errors */
              }
            } else if (Array.isArray(val)) {
              allErrors.push(...val);
            }
          }
        }
        if (allErrors.length === 0) {
          allErrors.push(firstErr.message);
        }
        result = await retryEdit(graph, body.message, firstPatch, allErrors, addressBook);
      } else {
        throw firstErr;
      }
    }

    const { patch, explanation, missingAddresses } = result;

    if (!patch.length) {
      return NextResponse.json({
        data: { patch: [], explanation, applied: false, missingAddresses: [] },
      });
    }

    const v = validateFlow(result.patchedGraph);
    if (!v.ok) {
      const fieldErrors = Object.fromEntries(v.errors.map((e) => [e.path, [e.message]]));
      throw new AppError("VALIDATION", "Patched flow is invalid", fieldErrors);
    }

    return NextResponse.json({
      data: {
        patch,
        explanation,
        applied: true,
        missingAddresses,
        templateKind: v.templateKind,
      },
    });
  });
}
