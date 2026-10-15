import { describe, expect, it, vi } from "vitest";
import { selectWallet } from "@/components/deploy/select-wallet";

describe("picker modal ownership", () => {
  it("abort closes its modal through the SDK event and permits a later picker", async () => {
    let open = false;
    const kit = {
      openModal: vi.fn(async (options: { onClosed: () => void }) => {
        if (open) throw Error("already open");
        open = true;
        const modal = document.createElement("stellar-wallets-modal");
        modal.addEventListener("modal-closed", () => {
          open = false;
          modal.remove();
          options.onClosed();
        });
        document.body.append(modal);
      }),
    };
    const controller = new AbortController();
    const pending = selectWallet(kit, controller.signal);
    await Promise.resolve();
    controller.abort();
    expect(await pending).toBeNull();
    expect(open).toBe(false);
    const nextController = new AbortController();
    const next = selectWallet(kit, nextController.signal);
    await Promise.resolve();
    nextController.abort();
    expect(await next).toBeNull();
    expect(open).toBe(false);
  });
  it("closes a modal that only renders after its attempt was aborted", async () => {
    let finish!: () => void;
    const kit = {
      openModal: async (options: { onClosed: () => void }) => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        const modal = document.createElement("stellar-wallets-modal");
        modal.addEventListener("modal-closed", () => {
          modal.remove();
          options.onClosed();
        });
        document.body.append(modal);
      },
    };
    const controller = new AbortController();
    const pending = selectWallet(kit, controller.signal);
    controller.abort();
    expect(await pending).toBeNull();
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector("stellar-wallets-modal")).toBeNull();
  });
});
