import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { ExecutionArgumentsSchema } from "@/lib/flows/field-policies";
import { parseExecutionArguments } from "@/packages/sdk/src/execution";
const recipient = Keypair.random().publicKey();
const pay = { kind: "pay", nodeId: "pay", recipient };
const row = {
  rowId: "worker",
  recipient,
  allocation: { kind: "fixed", amountStroops: "9007199254740993" },
};
const corpus: unknown[] = [
  { version: 1, inputs: [] },
  { version: 1, inputs: [pay] },
  {
    version: 1,
    inputs: [{ kind: "split", nodeId: "split", rows: [], additionalRecipients: [row] }],
  },
  {
    version: 1,
    inputs: [
      {
        kind: "split",
        nodeId: "split",
        rows: [{ rowId: "row", allocation: { kind: "percentage", bps: 10_000 } }],
      },
    ],
  },
  { version: 2, inputs: [pay] },
  { version: 1, inputs: [pay, pay] },
  { version: 1, inputs: [{ ...pay, amountStroops: "1" }] },
  { version: 1, inputs: [{ ...pay, recipient: "PENDING:worker" }] },
  {
    version: 1,
    inputs: [{ kind: "split", nodeId: "split", rows: [row], additionalRecipients: [row] }],
  },
  ...["0", "01", "1.1", "-1", "1e2", (2n ** 127n).toString(), 1].map((amountStroops) => ({
    version: 1,
    inputs: [
      {
        kind: "split",
        nodeId: "split",
        rows: [{ rowId: "row", allocation: { kind: "fixed", amountStroops } }],
      },
    ],
  })),
];
describe("SDK/API execution wire agreement", () => {
  corpus.forEach((value, index) =>
    it(`shares realistic/adversarial result ${index + 1}`, () => {
      const parsed = ExecutionArgumentsSchema.safeParse(value);
      if (parsed.success) expect(parseExecutionArguments(value)).toEqual(parsed.data);
      else expect(() => parseExecutionArguments(value)).toThrow();
    }),
  );
});
