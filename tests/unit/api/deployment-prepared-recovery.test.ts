import type { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const { findFirst, session, recover } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  session: vi.fn(),
  recover: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { deployment: { findFirst } } }));
vi.mock("@/lib/auth", () => ({ requireSession: session }));
vi.mock("@/lib/stellar/deployment-recovery", () => ({ preparedDeploymentRecovery: recover }));
vi.mock("@/lib/deployments/service-route", () => ({
  deploymentServiceRoute: (handler: unknown) => handler,
}));
import { GET } from "@/app/api/deployments/[id]/route";
import { AppError } from "@/lib/errors";
const context = () => ({ params: Promise.resolve({ id: "deployment-id" }) });
beforeEach(() => {
  vi.resetAllMocks();
  session.mockResolvedValue({ id: "owner-id" });
});
it("requires authentication before reading recovery material", async () => {
  session.mockRejectedValue(new AppError("UNAUTHENTICATED", "Login required"));
  expect((await GET({} as NextRequest, context())).status).toBe(401);
  expect(findFirst).not.toHaveBeenCalled();
  expect(recover).not.toHaveBeenCalled();
});
it("scopes the owner read before preparing recovery metadata", async () => {
  findFirst.mockResolvedValue(null);
  expect((await GET({} as NextRequest, context())).status).toBe(404);
  expect(findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: "deployment-id", ownerId: "owner-id", serviceState: { not: "RETIRED" } },
    }),
  );
  expect(recover).not.toHaveBeenCalled();
});
it("retiring deployments do not expose or compute prepared recovery material", async () => {
  findFirst.mockResolvedValue({
    id: "deployment-id",
    serviceState: "RETIRING",
    unsignedXdr: "owner-unsigned-material",
    webhookSecret: "private-webhook-material",
  });
  const response = await GET({} as NextRequest, context());
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(body).not.toContain("owner-unsigned-material");
  expect(body).not.toContain("private-webhook-material");
  expect(recover).not.toHaveBeenCalled();
});
it("adds recovery metadata only to an owned active deployment response", async () => {
  const deployment = { id: "deployment-id", serviceState: "ACTIVE", status: "PENDING_SIGNATURE" };
  findFirst.mockResolvedValue(deployment);
  recover.mockResolvedValue({ status: "BLOCKED" });
  const response = await GET({} as NextRequest, context());
  expect((await response.json()).data.preparedRecovery).toEqual({ status: "BLOCKED" });
  expect(recover).toHaveBeenCalledWith(deployment);
});
