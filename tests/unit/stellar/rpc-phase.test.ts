import { afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/log", () => ({ log: mock }));
import { observeRpcPhase } from "@/lib/stellar/rpc-phase";
import { withInteractiveRpcBudget } from "@/lib/stellar/interactive-rpc-budget";

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("records phase timing and remaining budget without upstream error contents", async () => {
  vi.useFakeTimers();
  const error = new Error("private upstream payload, credential, signed envelope");
  await withInteractiveRpcBudget(async () => {
    const failed = observeRpcPhase(
      "execution.getters",
      "deployment",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw error;
      },
      0,
    );
    const assertion = expect(failed).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
  }, 100);
  expect(mock.warn).toHaveBeenCalledWith(
    {
      phase: "execution.getters",
      deploymentId: "deployment",
      attempt: 0,
      elapsedMs: 10,
      remainingRpcMs: 90,
      outcome: "failure",
      category: "unavailable",
    },
    "RPC phase failed",
  );
  expect(JSON.stringify(mock.warn.mock.calls)).not.toContain(error.message);
  expect(mock.info).not.toHaveBeenCalled();
});

it("does not dispatch a phase after deadline expiry", async () => {
  const work = vi.fn();
  await expect(
    withInteractiveRpcBudget(() => observeRpcPhase("execution.opening", "deployment", work), 0),
  ).rejects.toMatchObject({ code: "RPC_DEADLINE" });
  expect(work).not.toHaveBeenCalled();
  expect(mock.warn).toHaveBeenCalledWith(
    expect.objectContaining({ category: "deadline", remainingRpcMs: 0 }),
    "RPC phase failed",
  );
});

it("refuses a phase that finishes beyond its budget instead of logging success", async () => {
  vi.useFakeTimers();
  const reading = withInteractiveRpcBudget(
    () =>
      observeRpcPhase(
        "execution.closing",
        "deployment",
        () => new Promise((resolve) => setTimeout(() => resolve("late result"), 30)),
      ),
    25,
  );
  const refused = expect(reading).rejects.toMatchObject({ code: "RPC_DEADLINE" });
  await vi.advanceTimersByTimeAsync(30);
  await refused;
  expect(mock.info).not.toHaveBeenCalled();
  expect(mock.warn).toHaveBeenCalledWith(
    expect.objectContaining({ category: "deadline", elapsedMs: 30 }),
    "RPC phase failed",
  );
});
