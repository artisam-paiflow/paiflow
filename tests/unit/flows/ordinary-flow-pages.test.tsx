import { beforeEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
const mocks = vi.hoisted(() => ({
  flow: vi.fn(),
  user: vi.fn(),
  session: vi.fn(),
  builder: vi.fn(),
  hash: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
}));
vi.mock("@/lib/auth", () => ({ requirePageSession: mocks.session }));
vi.mock("@/lib/db", () => ({
  db: { flow: { findFirst: mocks.flow }, user: { findUnique: mocks.user } },
}));
vi.mock("@/lib/env", () => ({
  env: () => ({ STELLAR_NETWORK: "testnet" }),
  soroswapRouterAddress: () => undefined,
}));
vi.mock("@/lib/features", () => ({
  serverFeatures: () => ({ aiAssistant: true, oracleCondition: true }),
}));
vi.mock("@/lib/stellar/config", () => ({ getWasmHash: mocks.hash }));
vi.mock("@/components/app/topbar", () => ({ default: () => null }));
vi.mock("@/components/builder/builder-client", () => ({
  default: (props: unknown) => {
    mocks.builder(props);
    return null;
  },
}));
import Page from "@/app/flows/[flowId]/page";
const id = "12271227-1227-4227-8227-122712271227",
  graph = () => ({
    generation: "conditional-v2",
    conditionalPolicies: { version: 2, nodes: [] },
    nodes: [],
    edges: [],
    positions: {},
    notify: { mode: "off", sendTo: "" },
  });
beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ id, username: "Owner", role: "USER" });
  mocks.user.mockResolvedValue({ email: "owner@example.com" });
  mocks.hash.mockResolvedValue(undefined);
  mocks.flow.mockResolvedValue({ id, name: "Conditional draft", graph: graph() });
});
it("ordinary builder server data preserves explicit generation and all draft metadata", async () => {
  render(await Page({ params: Promise.resolve({ flowId: id }) }));
  expect(mocks.builder).toHaveBeenCalledWith(
    expect.objectContaining({ initialGraph: graph(), network: "testnet" }),
  );
});
it("unknown conditional generation never becomes an empty legacy autosave draft", async () => {
  mocks.flow.mockResolvedValue({
    id,
    name: "Malformed",
    graph: { ...graph(), generation: "conditional-v3" },
  });
  await expect(Page({ params: Promise.resolve({ flowId: id }) })).rejects.toThrow("not found");
  expect(mocks.builder).not.toHaveBeenCalled();
});
it("malformed conditional declarations fail closed instead of stripping to v1", async () => {
  mocks.flow.mockResolvedValue({
    id,
    name: "Malformed",
    graph: { ...graph(), conditionalPolicies: { version: 1, nodes: [] } },
  });
  await expect(Page({ params: Promise.resolve({ flowId: id }) })).rejects.toThrow("not found");
});
it("retained ordinary immediate drafts reopen with the existing graph format", async () => {
  mocks.flow.mockResolvedValue({ id, name: "Legacy", graph: { nodes: [], edges: [] } });
  render(await Page({ params: Promise.resolve({ flowId: id }) }));
  expect(mocks.builder).toHaveBeenCalledWith(
    expect.objectContaining({ initialGraph: { nodes: [], edges: [] } }),
  );
});
it("sandbox server data retains conditional metadata while disabling notification addresses", async () => {
  mocks.session.mockResolvedValue({ id, username: "Sandbox", role: "SANDBOX" });
  mocks.flow.mockResolvedValue({
    id,
    name: "Sandbox",
    graph: { ...graph(), notify: { mode: "every_transaction", sendTo: "private@example.com" } },
  });
  render(await Page({ params: Promise.resolve({ flowId: id }) }));
  expect(mocks.builder).toHaveBeenCalledWith(
    expect.objectContaining({ sandbox: true, initialGraph: graph() }),
  );
});
