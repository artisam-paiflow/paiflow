import { beforeEach, describe, expect, it, vi } from "vitest";
import { FlowGraphSchema, type FlowGraph } from "@/lib/flows/schema";
import { STARTER_GRAPH } from "@/lib/flows/starter";
const mocks = vi.hoisted(() => ({
  deployment: vi.fn(),
  events: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  send: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    deployment: { findUnique: mocks.deployment },
    contractEvent: { findMany: mocks.events },
    emailNotification: { createMany: mocks.create, update: mocks.update },
  },
}));
vi.mock("@/lib/mail", () => ({ sendEmail: mocks.send }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.limit }));
import { sendEmailNotificationsForTransactions } from "@/lib/flow-notifications";
let graph: FlowGraph;
let rows: ReturnType<typeof event>[];
const claims = new Set<string>();
function event(
  id: string,
  kind: string,
  decodedData: Record<string, unknown>,
  txHash = "tx-one",
  contractAddress = "root",
) {
  return { id, eventId: id, kind, ledger: 50, txHash, decodedData, payload: { contractAddress } };
}
const dispatch = () =>
  sendEmailNotificationsForTransactions({
    deploymentId: "deployment",
    startLedger: 50,
    throughLedger: 50,
  });
function recipientAddress(i: number) {
  const split = graph.nodes.find((n) => n.type === "split");
  if (split?.type !== "split") throw new Error("fixture");
  return split.config.recipients[i]!.address;
}
beforeEach(() => {
  vi.clearAllMocks();
  claims.clear();
  graph = FlowGraphSchema.parse(structuredClone(STARTER_GRAPH));
  graph.notify = { mode: "every_transaction", sendTo: "owner@example.com" };
  rows = [
    event("0", "RECEIVE", { amount: "1000000000", asset: "USDC" }),
    event(
      "1",
      "PAYOUT",
      { recipient: recipientAddress(0), payment: "400000000", asset: "USDC" },
      "tx-one",
      "split",
    ),
    event(
      "2",
      "PAYOUT",
      { recipient: recipientAddress(1), payment: "600000000", asset: "USDC" },
      "tx-one",
      "split",
    ),
  ];
  mocks.deployment.mockImplementation(async () => ({
    owner: { role: "USER" },
    flow: { name: "Rent split" },
    graphSnapshot: graph,
    network: "testnet",
    pipelineSnapshot: [
      { nodeId: graph.nodes[0]!.id, contractAddress: "root" },
      { nodeId: graph.nodes[1]!.id, contractAddress: "split" },
    ],
  }));
  mocks.events.mockImplementation(async () => rows);
  mocks.create.mockImplementation(
    async ({
      data,
    }: {
      data: {
        deliveryKey: string;
      }[];
    }) => {
      const key = data[0]!.deliveryKey;
      if (claims.has(key)) return { count: 0 };
      claims.add(key);
      return { count: 1 };
    },
  );
  mocks.update.mockResolvedValue({});
  mocks.send.mockResolvedValue({ ok: true, id: "mail" });
  mocks.limit.mockResolvedValue({ ok: true, shared: true });
});
describe("persisted transaction notifications", () => {
  it("sends one owner summary for a multi-payout transaction", async () => {
    await dispatch();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const mail = mocks.send.mock.calls[0]![0];
    expect(mail.text).toContain("Received 100 USDC");
    expect(mail.text).toContain("Paid 40 USDC");
    expect(mail.text).toContain("Paid 60 USDC");
    expect(mail.text).toContain("TESTNET");
    expect(mail.text).toContain("/testnet/tx/tx-one");
    expect(mail.text).toContain("/deployments/deployment");
    expect(mail.subject).toMatch(/^Rent split:/);
    expect(mocks.events).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deploymentId: "deployment", ledger: { gte: 50, lte: 50 } },
      }),
    );
  });
  it("sends nothing on a second poll", async () => {
    await dispatch();
    await dispatch();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("claims atomically across concurrent dispatches", async () => {
    await Promise.all([dispatch(), dispatch()]);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("does not resend a failed delivery on retry", async () => {
    mocks.send.mockResolvedValue({ ok: false, error: { message: "private@example.com rejected" } });
    await dispatch();
    await dispatch();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "failed", error: "Email delivery failed" } }),
    );
  });
  it("a recipient receives only their own payout and no owner page link", async () => {
    graph.notify!.mode = "off";
    const split = graph.nodes.find((n) => n.type === "split");
    if (split?.type === "split") split.config.recipients[0]!.email = "recipient@example.com";
    await dispatch();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const mail = mocks.send.mock.calls[0]![0];
    expect(mail.to).toBe("recipient@example.com");
    expect(mail.text).toContain("40 USDC");
    expect(mail.text).not.toContain("60 USDC");
    expect(mail.text).not.toContain("100 USDC");
    expect(mail.text).not.toContain("/deployments/");
  });
  it("a later relayer transaction gets its own summary", async () => {
    rows.push(
      event(
        "3",
        "PAYOUT",
        { recipient: recipientAddress(0), payment: "200000000", asset: "USDC" },
        "tx-two",
        "split",
      ),
    );
    await dispatch();
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send.mock.calls[1]![0].text).toContain("tx-two");
  });
  it("shortfalls_only ignores regular payouts", async () => {
    graph.notify!.mode = "shortfalls_only";
    await dispatch();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("shortfalls_only reports a shortfall", async () => {
    graph.notify!.mode = "shortfalls_only";
    rows.push(
      event("4", "SHORTFALL", {
        amount: "10000000",
        balance: "10000000",
        needed: "20000000",
        remaining: "10000000",
        asset: "USDC",
      }),
    );
    await dispatch();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0]![0].text).toContain("1 USDC still needed");
  });
  it.each(["", "invalid"])("empty or invalid sendTo %s never sends", async (sendTo) => {
    graph.notify!.sendTo = sendTo;
    await dispatch();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("old graphs with no notify stay off", async () => {
    delete graph.notify;
    await dispatch();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("off sends no owner email", async () => {
    graph.notify!.mode = "off";
    await dispatch();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("sandbox sends no emails even with crafted recipient settings", async () => {
    mocks.deployment.mockResolvedValue({
      owner: { role: "SANDBOX" },
      flow: { name: "X" },
      graphSnapshot: graph,
      network: "testnet",
    });
    await dispatch();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.events).not.toHaveBeenCalled();
  });
  it("enforces the deployment cap and persists skipped delivery", async () => {
    mocks.limit.mockResolvedValue({ ok: false, shared: true });
    await dispatch();
    await dispatch();
    expect(mocks.limit).toHaveBeenCalledWith("email:deployment:deployment", 30, 3600);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "skipped" } }),
    );
  });
  it("migrates running deployment snapshots before resolving recipients", async () => {
    graph.notify!.mode = "off";
    graph.nodes.push({
      id: "email",
      type: "email_notify",
      config: {
        recipients: [{ address: recipientAddress(0), email: "legacy@example.com" }],
        subject: "Old subject",
        body: "Old body",
      },
    });
    await dispatch();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0]![0].to).toBe("legacy@example.com");
    expect(mocks.send.mock.calls[0]![0].text).not.toContain("Old body");
  });
  it("escapes HTML in generated summaries", async () => {
    rows[0]!.decodedData.asset = "<asset>";
    mocks.deployment.mockResolvedValue({
      owner: { role: "USER" },
      flow: { name: "Escape" },
      graphSnapshot: graph,
      network: "testnet",
      pipelineSnapshot: [],
    });
    await dispatch();
    expect(mocks.send.mock.calls[0]![0].html).toContain("&lt;asset&gt;");
  });
  it("summarises a Hold receive with its date", async () => {
    graph.nodes.push(
      {
        id: "lock",
        type: "condition",
        config: { kind: "time_before", at: "2026-12-01T00:00:00Z" },
      },
      { id: "hold", type: "hold", config: {} },
    );
    graph.edges.push({ id: "hold-edge", source: "lock", target: "hold", sourceHandle: "true" });
    mocks.deployment.mockImplementation(async () => ({
      owner: { role: "USER" },
      flow: { name: "Hold" },
      graphSnapshot: graph,
      network: "mainnet",
      pipelineSnapshot: [{ nodeId: "lock", contractAddress: "lock-contract" }],
    }));
    rows = [
      event("held", "RECEIVE", { amount: "400000000", asset: "USDC" }, "tx-one", "lock-contract"),
    ];
    await dispatch();
    const text = mocks.send.mock.calls[0]![0].text;
    expect(text).toContain("40 USDC held until 2026-12-01");
    expect(text).toContain("MAINNET");
    expect(text).toContain("/public/tx/");
  });
});
