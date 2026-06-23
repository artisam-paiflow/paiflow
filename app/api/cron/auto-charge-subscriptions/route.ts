import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { AppError, withErrorHandler } from "@/lib/errors";
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
import { withRelayerLock } from "@/lib/stellar/client";
import { stellarPassphrase, stellarRelayerAddress } from "@/lib/env";
import { ChargeRelayerMode } from "@prisma/client";

export const dynamic = "force-dynamic";

const MAX_CATCHUP_PER_RUN = 5;

type ResultDetail = {
  deploymentId: string;
  contractAddress: string;
  status: "charged" | "skipped" | "failed";
  error?: string;
};

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
    const secret = env().CRON_SECRET;
    if (secret && req.headers.get("x-cron-secret") !== secret) {
      throw new AppError("FORBIDDEN", "Bad cron secret");
    }

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
        chargeRelayerMode: { in: [ChargeRelayerMode.PLATFORM, ChargeRelayerMode.USER] },
        OR: [{ nextChargeAt: { lte: now } }, { nextChargeAt: null }],
      },
    });

    const results: ResultDetail[] = [];
    let platformCharged = 0;
    let userCharged = 0;

    for (const d of deployments) {
      const pipeline = d.pipelineSnapshot as Array<{
        nodeId: string;
        contractAddress: string;
        templateKind: string;
      }> | null;
      const node = pipeline?.find((n) => n.templateKind === "SUBSCRIPTION");
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
        const cancelled = await readSubscriptionIsCancelled(contractAddress);
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
        const nextChargeAt = await readSubscriptionNextChargeAt(contractAddress);
        const nextChargeDate = new Date(Number(nextChargeAt) * 1000);
        if (nextChargeDate > now) {
          await db.deployment.update({
            where: { id: d.id },
            data: { nextChargeAt: nextChargeDate },
          });
          results.push({ deploymentId: d.id, contractAddress, status: "skipped" });
          continue;
        }

        const amountPerPeriod = await readSubscriptionAmountPerPeriod(contractAddress);
        const [subscriber, asset] = await Promise.all([
          readSubscriptionSubscriber(contractAddress),
          readSubscriptionAsset(contractAddress),
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
        const onChainRelayer = await readSubscriptionRelayer(contractAddress);
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

            const response = await fetch(d.chargeRelayerUrl, {
              method: "POST",
              headers,
              body: JSON.stringify({
                deploymentId: d.id,
                contractAddress,
                network: env().STELLAR_NETWORK,
                networkPassphrase: stellarPassphrase(),
                unsignedXdr,
              }),
            });

            if (!response.ok) {
              const text = await response.text();
              throw new Error(`User relayer returned ${response.status}: ${text}`);
            }

            const body = (await response.json()) as {
              status?: string;
              txHash?: string;
              signedXdr?: string;
              errorMessage?: string;
            };

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
              throw new Error(body.errorMessage ?? "User relayer did not return a success payload");
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
        if (isExpectedSkipError(message)) {
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
