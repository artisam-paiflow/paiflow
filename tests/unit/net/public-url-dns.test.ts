/**
 * The default resolver wiring, in its own file because `vi.mock` of a builtin is
 * hoisted and file-scoped — mixing it with the injected-lookup cases in
 * `public-url.test.ts` would make those meaningless.
 *
 * `all: true` matters: without it a name answering with one public and one
 * private address would be judged on whichever came first.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLookup } = vi.hoisted(() => ({ mockLookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mockLookup }));

import { assertPublicUrl, UnsafeUrlError } from "@/lib/net/assert-public-url";

describe("assertPublicUrl (default resolver)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks node:dns/promises for every address", async () => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const url = await assertPublicUrl("https://relayer.example.com/charge");
    expect(url.toString()).toBe("https://relayer.example.com/charge");
    expect(mockLookup).toHaveBeenCalledWith("relayer.example.com", {
      all: true,
      verbatim: true,
    });
  });

  it("throws a 422 UnsafeUrlError naming the field, when the host is private", async () => {
    mockLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    await expect(
      assertPublicUrl("https://relayer.example.com/charge", {
        subject: "Relayer URL",
        field: "chargeRelayerUrl",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      status: 422,
      reason: "private-address",
    });
  });

  it("marks a private address terminal and a lookup failure transient", async () => {
    mockLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    const privateErr = await assertPublicUrl("https://relayer.example.com/").catch((e) => e);
    expect(privateErr).toBeInstanceOf(UnsafeUrlError);
    expect((privateErr as UnsafeUrlError).terminal).toBe(true);

    mockLookup.mockRejectedValue(Object.assign(new Error("boom"), { code: "EAI_AGAIN" }));
    const transientErr = await assertPublicUrl("https://relayer.example.com/").catch((e) => e);
    expect((transientErr as UnsafeUrlError).reason).toBe("unresolvable");
    expect((transientErr as UnsafeUrlError).terminal).toBe(false);
  });

  it("puts the same message in fields as in message, and never the resolved address", async () => {
    mockLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    const err = (await assertPublicUrl("https://relayer.example.com/", {
      subject: "Relayer URL",
      field: "url",
    }).catch((e) => e)) as UnsafeUrlError;
    expect(err.message).toContain("Relayer URL must be a public https:// endpoint");
    expect(err.fields?.url).toEqual([err.message]);
    expect(err.message).not.toContain("10.0.0.5");
  });

  it("does not resolve at all for an IP literal", async () => {
    await expect(
      assertPublicUrl("https://169.254.169.254/latest/meta-data/"),
    ).rejects.toMatchObject({ reason: "ip-literal" });
    expect(mockLookup).not.toHaveBeenCalled();
  });
});
