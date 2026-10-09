import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import PipelineImplementations from "@/components/deploy/pipeline-implementations";

it("shows shared blocks on one contract row and keeps legacy associations explicit", () => {
  const streamer = {
    nodeId: "p",
    contractAddress: "CSTREAMER",
    templateKind: "STREAMER",
    implementation: {
      version: 1,
      bindings: [
        { blockId: "t", blockType: "on_schedule", role: "schedule" },
        { blockId: "p", blockType: "split", role: "distribution" },
      ],
    },
  };
  render(
    <PipelineImplementations
      network="testnet"
      pipeline={[
        streamer,
        streamer,
        { nodeId: "old", contractAddress: "CLEGACY", templateKind: "PAYER" },
      ]}
    />,
  );
  expect(screen.getAllByRole("listitem", { hidden: true })).toHaveLength(2);
  expect(screen.getByText("Schedule + Split")).toBeTruthy();
  expect(screen.getByText("Block associations unavailable")).toBeTruthy();
  expect(screen.getAllByRole("link", { hidden: true })[0]?.getAttribute("href")).toContain(
    "testnet",
  );
});

it("shows an absorbed Hold even when there are no balance rows", () => {
  render(
    <PipelineImplementations
      network={null}
      pipeline={[
        {
          nodeId: "c",
          contractAddress: "CLOCK",
          templateKind: "TIMELOCK",
          implementation: {
            version: 1,
            bindings: [
              { blockId: "c", blockType: "condition", role: "condition" },
              { blockId: "h", blockType: "hold", role: "strict_lock" },
            ],
          },
        },
      ]}
    />,
  );
  expect(screen.getByText("Condition + Hold until deadline")).toBeTruthy();
  expect(screen.queryByRole("link", { hidden: true })).toBeNull();
});

it("handles unknown metadata versions without guessing associations", () => {
  render(
    <PipelineImplementations
      network={null}
      pipeline={[
        {
          nodeId: "c",
          contractAddress: "CLOCK",
          templateKind: "TIMELOCK",
          implementation: { version: 2, bindings: [] },
        },
      ]}
    />,
  );
  expect(screen.getByText("Block associations unavailable")).toBeTruthy();
});
