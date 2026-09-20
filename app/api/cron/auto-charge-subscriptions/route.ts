import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { withErrorHandler } from "@/lib/errors";
import { assertPublicUrl, UnsafeUrlError } from "@/lib/net/assert-public-url";
import { createContractReadCache } from "@/lib/contract-read-cache";
import {
  prepareSubscriptionChargeByRelayerTx,
  submitSubscriptionChargeByRelayerTx,
  readSubscriptionIsCancelled,
  readSubscriptionNextChargeAt,
  readSubscriptionAmountPerPeriod,
  readSubscriptionSubscriber,
  readSubscriptionAsset,
  readSubscriptionRelayer,
  readTokenAllowance,
} from "@/lib/stellar/relayer";
import { prepareSubscriptionChargeByRelayerUnsigned } from "@/lib/stellar/invoke";
import { TENANT_RELAYER_TIMEOUT_MS, withRelayerLock } from "@/lib/stellar/client";
import { stellarPassphrase, stellarRelayerAddress } from "@/lib/env";
import { ChargeRelayerMode } from "@prisma/client";
import { requireCronSecret } from "@/lib/auth/cron-secret";

export const dynamic = "force-dynamic";

const MAX_CATCHUP_PER_RUN = Math.min(50, Math.max(1, env().SUBSCRIPTION_MAX_CATCHUP_PER_RUN));

type ResultDetail = {
  deploymentId: string;
  contractAddress: string;
  status: "charged" | "skipped" | "failed";
  error?: string;
};

/**
 * A failure the tenant's own relayer endpoint caused. Marked by class, never by
 * message text: `isExpectedSkipError` below matches on substrings, so a relayer
 * answering with "insufficient" could otherwise get its own failed charge
 * reclassified as an expected skip (#581).
 */
class RelayerResponseError extends Error {}

/**
 * The tenant's relayer response is untrusted input — `signedXdr` is handed
 * straight to the submitter — so it gets a schema like any other boundary.
 * `errorMessage` is deliberately absent: it was a read-back channel for a
 * response body the tenant's endpoint chose.
 */
const RelayerChargeResponseSchema = z.object({
  status: z.enum(["SUCCESS", "PENDING", "FAILED"]),
  txHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .optional(),
  signedXdr: z.string().max(65536).optional(),
});

/** `res.json()` on a non-JSON body throws a SyntaxError carrying a fragment of
 * that body, which must not reach a reported message. */
async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** We deliberately never read a failed relayer response, but an undrained body
 * keeps undici's socket out of the pool until GC, and this loop runs up to
 * MAX_CATCHUP_PER_RUN times per deployment. */
async function discardBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // Already consumed or errored; nothing to release.
  }
}

function isExpectedSkipError(message: string): boolean {
  return (
    message.includes("AlreadyCancelled") ||
    message.includes("NotYetDue") ||
    message.includes("Unauthorized") ||
    message.includes("non-existent contract function") ||
    message.includes("MissingValue") ||
    message.includes("insufficient") ||
    message.includes("Insufficient")
  );
}

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    requireCronSecret(req);

    if (!stellarRelayerAddress()) {
      return NextResponse.json({
        data: {
          platformCharged: 0,
          userCharged: 0,
          skipped: 0,
          failed: 0,
          details: [],
          notice: "STELLAR_RELAYER_ADDRESS is not configured; auto-charge cron skipped",
        },
      });
    }

    const now = new Date();
    const deployments = await db.deployment.findMany({
      where: {
        status: "CONFIRMED",
        flow: { templateKind: { not: "PAYROLL" } },
        chargeRelayerMode: { in: [ChargeRelayerMode.PLATFORM, ChargeRelayerMode.USER] },
        OR: [{ nextChargeAt: { lte: now } }, { nextChargeAt: null }],
      },
      select: {
        id: true,
        chargeEndAt: true,
        chargeRelayerMode: true,
        chargeRelayerAddress: true,
        chargeRelayerUrl: true,
        chargeRelayerToken: true,
        nextChargeAt: true,
        pipelineSnapshot: true,
      },
    });

    const results: ResultDetail[] = [];
    let platformCharged = 0;
    let userCharged = 0;

    const readCache = createContractReadCache();
    // Only cache reads with no on-chain setters. NOTE: SUBSCRIPTION_DEV exposes
    // set_amount/update_subscriber, so for dev deployments these cached readers
    // are bypassed below in favor of fresh reads. Every subscription variant
    // exposes set_relayer, so the relayer is never cached (a stale value would
    // defeat the relayer-mismatch safety check right after a rotation).
    const readSubscriptionAmountPerPeriodCached = readCache(
      "subscription:amountPerPeriod",
      readSubscriptionAmountPerPeriod,
      (addr) => addr,
    );
    const readSubscriptionSubscriberCached = readCache(
      "subscription:subscriber",
      readSubscriptionSubscriber,
      (addr) => addr,
    );
    const readSubscriptionAssetCached = readCache(
      "subscription:asset",
      readSubscriptionAsset,
      (addr) => addr,
    );

    for (const d of deployments) {
      const pipeline = d.pipelineSnapshot as Array<{
        nodeId: string;
        contractAddress: string;
        templateKind: string;
      }> | null;
      // Match the immutable SUBSCRIPTION trigger and the mutable
      // SUBSCRIPTION_DEV variant used by dev-mode subscriptions. PAYROLL flows
      // are handled exclusively by the auto-charge-payroll cron.
      const node = pipeline?.find(
        (n) => n.templateKind === "SUBSCRIPTION" || n.templateKind === "SUBSCRIPTION_DEV",
      );
      const contractAddress = node?.contractAddress;
      if (!contractAddress) {
        results.push({
          deploymentId: d.id,
          contractAddress: "",
          status: "skipped",
          error: "No subscription contract in pipeline",
        });
        continue;
      }

      try {
        // Stop scheduling cancelled or expired subscriptions.
        const [cancelled, nextChargeAt] = await Promise.all([
          readSubscriptionIsCancelled(contractAddress),
          readSubscriptionNextChargeAt(contractAddress),
        ]);

        if (cancelled) {
          await db.deployment.update({
            where: { id: d.id },
            data: { chargeRelayerMode: ChargeRelayerMode.MANUAL, nextChargeAt: null },
          });
          results.push({ deploymentId: d.id, contractAddress, status: "skipped" });
          continue;
        }

        if (d.chargeEndAt && d.chargeEndAt <= now) {
          await db.deployment.update({
            where: { id: d.id },
            data: { chargeRelayerMode: ChargeRelayerMode.MANUAL, nextChargeAt: null },
          });
          results.push({ deploymentId: d.id, contractAddress, status: "skipped" });
          continue;
        }

        // Verify the on-chain schedule is actually due.
        const nextChargeDate = new Date(Number(nextChargeAt) * 1000);
        if (nextChargeDate > now) {
          await db.deployment.update({
            where: { id: d.id },
            data: { nextChargeAt: nextChargeDate },
          });
          results.push({ deploymentId: d.id, contractAddress, status: "skipped" });
          continue;
        }

        // SUBSCRIPTION_DEV amount/subscriber are admin-mutable on-chain, so
        // read them fresh for dev deployments; the immutable SUBSCRIPTION
        // variant can use the cached readers.
        const isDevSubscription = node.templateKind === "SUBSCRIPTION_DEV";
        const [amountPerPeriod, subscriber, asset, onChainRelayer] = await Promise.all([
          isDevSubscription
            ? readSubscriptionAmountPerPeriod(contractAddress)
            : readSubscriptionAmountPerPeriodCached(contractAddress),
          isDevSubscription
            ? readSubscriptionSubscriber(contractAddress)
            : readSubscriptionSubscriberCached(contractAddress),
          readSubscriptionAssetCached(contractAddress),
          readSubscriptionRelayer(contractAddress),
        ]);

        const allowance = await readTokenAllowance({
          tokenContractAddress: asset,
          owner: subscriber,
          spender: contractAddress,
        });
        if (allowance < amountPerPeriod) {
          results.push({
            deploymentId: d.id,
            contractAddress,
            status: "skipped",
            error: "Insufficient allowance",
          });
          continue;
        }

        // Verify the configured relayer matches the on-chain relayer so we
        // don't waste fees on transactions that will fail auth.
        const expectedRelayer =
          d.chargeRelayerMode === ChargeRelayerMode.PLATFORM
            ? stellarRelayerAddress()
            : d.chargeRelayerAddress;
        if (expectedRelayer && onChainRelayer !== expectedRelayer) {
          results.push({
            deploymentId: d.id,
            contractAddress,
            status: "skipped",
            error: `Relayer mismatch: on-chain ${onChainRelayer}, configured ${expectedRelayer}`,
          });
          continue;
        }

        let chargedCount = 0;
        if (d.chargeRelayerMode === ChargeRelayerMode.PLATFORM) {
          for (let i = 0; i < MAX_CATCHUP_PER_RUN; i++) {
            const submit = await withRelayerLock(async () => {
              const { xdr } = await prepareSubscriptionChargeByRelayerTx(contractAddress);
              return submitSubscriptionChargeByRelayerTx(xdr);
            });

            if (submit.status === "SUCCESS") {
              chargedCount++;
              const next = await readSubscriptionNextChargeAt(contractAddress);
              if (new Date(Number(next) * 1000) > new Date()) break;
            } else {
              throw new Error(submit.errorMessage ?? "Platform charge submission failed");
            }
          }
          platformCharged += chargedCount;
        } else {
          // USER relayer mode
          if (!d.chargeRelayerUrl || !d.chargeRelayerAddress) {
            results.push({
              deploymentId: d.id,
              contractAddress,
              status: "failed",
              error: "User relayer URL or address not configured",
            });
            continue;
          }

          // Check the stored URL again here, not just where it was saved: DNS
          // can change under us, and rows predate this check (#581). Once per
          // deployment rather than once per iteration, because undici pools the
          // connection — iterations 2…n reuse the socket iteration 1 opened and
          // never re-resolve.
          let relayerUrl: URL;
          try {
            relayerUrl = await assertPublicUrl(d.chargeRelayerUrl, {
              subject: "Relayer URL",
              field: "chargeRelayerUrl",
            });
          } catch (err) {
            const unsafe = err instanceof UnsafeUrlError ? err : null;
            const message = unsafe?.message ?? "Relayer URL could not be validated";
            if (unsafe?.terminal) {
              // `nextChargeAt` is already in the past, so this deployment would
              // otherwise come back every tick. Only for a deterministic
              // refusal: one EAI_AGAIN must not switch off a tenant.
              await db.deployment.update({
                where: { id: d.id },
                data: { chargeRelayerMode: ChargeRelayerMode.MANUAL, nextChargeAt: null },
              });
            }
            log.warn(
              {
                deploymentId: d.id,
                contractAddress,
                reason: unsafe?.reason ?? "unknown",
                terminal: unsafe?.terminal ?? false,
              },
              "Tenant relayer URL refused",
            );
            results.push({ deploymentId: d.id, contractAddress, status: "failed", error: message });
            continue;
          }

          for (let i = 0; i < MAX_CATCHUP_PER_RUN; i++) {
            const { xdr: unsignedXdr } = await prepareSubscriptionChargeByRelayerUnsigned({
              contractAddress,
              relayerAddress: d.chargeRelayerAddress,
            });

            const headers: Record<string, string> = {
              "Content-Type": "application/json",
            };
            if (d.chargeRelayerToken) {
              headers["Authorization"] = `Bearer ${d.chargeRelayerToken}`;
            }

            let response: Response;
            try {
              response = await fetch(relayerUrl, {
                method: "POST",
                headers,
                body: JSON.stringify({
                  deploymentId: d.id,
                  contractAddress,
                  network: env().STELLAR_NETWORK,
                  networkPassphrase: stellarPassphrase(),
                  unsignedXdr,
                }),
                // Tenant-supplied endpoint: one that black-holes the connection
                // must not stall the charge loop for every other customer.
                signal: AbortSignal.timeout(TENANT_RELAYER_TIMEOUT_MS),
                // Not "error", which surfaces as an opaque `TypeError: fetch
                // failed`. "manual" does not follow the hop either, and lets us
                // say what happened. Following it would defeat the URL check
                // above and forward the tenant's bearer token to the new host.
                redirect: "manual",
              });
            } catch (err) {
              const name = err instanceof Error ? err.name : "";
              // The message the tenant gets is fixed, so log the real cause —
              // otherwise a bug on our side is indistinguishable from an
              // unreachable endpoint.
              log.warn({ deploymentId: d.id, contractAddress, err }, "Tenant relayer fetch failed");
              throw new RelayerResponseError(
                name === "TimeoutError" || name === "AbortError"
                  ? `User relayer did not respond within ${TENANT_RELAYER_TIMEOUT_MS}ms`
                  : "User relayer could not be reached",
              );
            }

            // Nothing upstream-controlled may reach an Error message: it is
            // reported and logged, and on the payroll side persisted for the
            // owner to read back, which is what made this a read-capable SSRF
            // (#581). A status code is a number; a body is not.
            if (response.status >= 300 && response.status < 400) {
              await discardBody(response);
              throw new RelayerResponseError(
                `User relayer returned a redirect (${response.status}); redirects are not followed`,
              );
            }
            if (!response.ok) {
              await discardBody(response);
              log.warn(
                { deploymentId: d.id, contractAddress, status: response.status },
                "Tenant relayer rejected charge",
              );
              throw new RelayerResponseError(`User relayer returned ${response.status}`);
            }

            const parsed = RelayerChargeResponseSchema.safeParse(await readJson(response));
            if (!parsed.success) {
              throw new RelayerResponseError("User relayer returned an unrecognised payload");
            }
            const body = parsed.data;

            if (body.status === "SUCCESS" && body.txHash) {
              chargedCount++;
            } else if (body.status === "PENDING" && body.signedXdr) {
              const submit = await submitSubscriptionChargeByRelayerTx(body.signedXdr);
              if (submit.status === "SUCCESS") {
                chargedCount++;
              } else {
                throw new Error(submit.errorMessage ?? "User relayer signed tx submission failed");
              }
            } else {
              throw new RelayerResponseError("User relayer did not return a success payload");
            }

            const next = await readSubscriptionNextChargeAt(contractAddress);
            if (new Date(Number(next) * 1000) > new Date()) break;
          }
          userCharged += chargedCount;
        }

        if (chargedCount > 0) {
          const next = await readSubscriptionNextChargeAt(contractAddress);
          await db.deployment.update({
            where: { id: d.id },
            data: {
              lastChargedAt: new Date(),
              nextChargeAt: new Date(Number(next) * 1000),
            },
          });
          results.push({
            deploymentId: d.id,
            contractAddress,
            status: "charged",
          });
        } else {
          results.push({
            deploymentId: d.id,
            contractAddress,
            status: "skipped",
            error: "No charges executed",
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof RelayerResponseError) {
          // Never `skipped`: a tenant must not be able to pick a status code or
          // payload that reclassifies its own failed charge.
          log.warn(
            { deploymentId: d.id, contractAddress, error: message },
            "Tenant relayer charge failed",
          );
          results.push({
            deploymentId: d.id,
            contractAddress,
            status: "failed",
            error: message,
          });
        } else if (isExpectedSkipError(message)) {
          results.push({
            deploymentId: d.id,
            contractAddress,
            status: "skipped",
            error: message,
          });
        } else {
          log.warn(
            { deploymentId: d.id, contractAddress, error: message },
            "Auto-charge subscription failed",
          );
          results.push({
            deploymentId: d.id,
            contractAddress,
            status: "failed",
            error: message,
          });
        }
      }
    }

    return NextResponse.json({
      data: {
        platformCharged,
        userCharged,
        skipped: results.filter((r) => r.status === "skipped").length,
        failed: results.filter((r) => r.status === "failed").length,
        details: results,
      },
    });
  });
}

export const GET = POST;
