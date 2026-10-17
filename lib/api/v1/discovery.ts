import "server-only";
import { db } from "@/lib/db";
import { DeveloperTokenListQuerySchema } from "@/lib/developer-tokens/schema";
import type { ApiCredentialAuth } from "./auth";

/** Only explicitly authorized, currently eligible deployments; cursor is a bound, never a lookup. */
export async function discoverDeployments(auth: ApiCredentialAuth, query: URLSearchParams) {
  const { cursor, limit } = DeveloperTokenListQuerySchema.parse(Object.fromEntries(query));
  const rows = await db.deployment.findMany({
    where: {
      ownerId: auth.ownerId,
      status: "CONFIRMED",
      serviceState: "ACTIVE",
      ...(cursor ? { id: { gt: cursor } } : {}),
      ...(auth.tokenType === "developer_token"
        ? { developerTokenGrants: { some: { tokenId: auth.token.id } } }
        : { id: auth.token.deploymentId, ...(cursor ? { AND: { id: { gt: cursor } } } : {}) }),
    },
    select: { id: true, network: true, flow: { select: { name: true } } },
    orderBy: { id: "asc" },
    take: limit + 1,
  });
  const more = rows.length > limit;
  const items = rows.slice(0, limit).map(({ flow, ...row }) => ({ ...row, flowName: flow.name }));
  return { items, nextCursor: more ? items.at(-1)!.id : null };
}
