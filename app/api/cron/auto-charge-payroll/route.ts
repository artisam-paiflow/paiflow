import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { AppError, withErrorHandler } from "@/lib/errors";
import {
  preparePayrollChargeByRelayerTx,
  submitPayrollChargeByRelayerTx,
  readPayrollIsCancelled,
  readPayrollNextChargeAt,
  readPayrollEmployer,
  readPayrollAsset,
  readPayrollRecipients,
  readPayrollRelayer,
  prepareSubscriptionChargeByRelayerTx,
  submitSubscriptionChargeByRelayerTx,
  readSubscriptionIsCancelled,
  readSubscriptionNextChargeAt,
  readSubscriptionAmountPerPeriod,
  readSubscriptionSubscriber,
  readSubscriptionAsset,
  readSubscriptionRelayer,
  readSplitterDevRecipients,
} from "@/lib/stellar/relayer";
import { preparePayrollChargeByRelayerUnsigned } from "@/lib/stellar/invoke";
import { withRelayerLock } from "@/lib/stellar/client";
import { readTokenAllowance } from "@/lib/stellar/relayer";
import { stellarRelayerAddress, stellarPassphrase } from "@/lib/env";
import { ChargeRelayerMode, PayrollRunStatus } from "@prisma/client";
import { createOffRampJobsForPayrollRun } from "@/lib/offramp/jobs";

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
    message.includes("Insufficient") ||
    message.includes("PayrollEnded")
  );
}

async function buildDevRecipientRows(
  splitterContractAddress: string,
  subscriptionContractAddress: string,
): Promise<Array<{ address: string; amount: string }>> {
  const [raw, totalStroops] = await Promise.all([
    readSplitterDevRecipients(splitterContractAddress),
    readSubscriptionAmountPerPeriod(subscriptionContractAddress),
  ]);
  return raw.map((r) => {
    const fixed = BigInt(r.amount);
    if (fixed > 0n) {
      return { address: r.address, amount: fixed.toString() };
    }
    if (r.bps > 0) {
      return {
        address: r.address,
        amount: ((totalStroops * BigInt(r.bps)) / 10000n).toString(),
      };
    }
    return { address: r.address, amount: "0" };
  });
}

async function chargeDevPayrollDeployment(
  d: {
    id: string;
    offRampEnabled: boolean;
    chargeEndAt: Date | null;
  },
  subscriptionContractAddress: string,
  splitterContractAddress: string,
  now: Date,
): Promise<number> {
  if (d.chargeEndAt && d.chargeEndAt <= now) {
    await db.deployment.update({
      where: { id: d.id },
      data: { chargeRelayerMode: ChargeRelayerMode.MANUAL, nextChargeAt: null },
    });
    throw new Error("PayrollEnded");
  }

  const cancelled = await readSubscriptionIsCancelled(subscriptionContractAddress);
  if (cancelled) {
    await db.deployment.update({
      where: { id: d.id },
      data: { chargeRelayerMode: ChargeRelayerMode.MANUAL, nextChargeAt: null },
    });
    throw new Error("AlreadyCancelled");
  }

  const nextChargeAt = await readSubscriptionNextChargeAt(subscriptionContractAddress);
  const nextChargeDate = new Date(Number(nextChargeAt) * 1000);
  if (nextChargeDate > now) {
    await db.deployment.update({
      where: { id: d.id },
      data: { nextChargeAt: nextChargeDate },
    });
    throw new Error("NotYetDue");
  }

  const [subscriber, asset, amountPerPeriod] = await Promise.all([
    readSubscriptionSubscriber(subscriptionContractAddress),
    readSubscriptionAsset(subscriptionContractAddress),
    readSubscriptionAmountPerPeriod(subscriptionContractAddress),
  ]);

  const allowance = await readTokenAllowance({
    tokenContractAddress: asset,
    owner: subscriber,
    spender: subscriptionContractAddress,
  });
  if (allowance < amountPerPeriod) {
    throw new Error("Insufficient allowance");
  }

  const onChainRelayer = await readSubscriptionRelayer(subscriptionContractAddress);
  const expectedRelayer = stellarRelayerAddress();
  if (expectedRelayer && onChainRelayer !== expectedRelayer) {
    throw new Error(`Relayer mismatch: on-chain ${onChainRelayer}, configured ${expectedRelayer}`);
  }

  let chargedCount = 0;
  for (let i = 0; i < MAX_CATCHUP_PER_RUN; i++) {
    const currentNext = await readSubscriptionNextChargeAt(subscriptionContractAddress);
    if (new Date(Number(currentNext) * 1000) > now) break;

    const submit = await withRelayerLock(async () => {
      const { xdr } = await prepareSubscriptionChargeByRelayerTx(subscriptionContractAddress);
      return submitSubscriptionChargeByRelayerTx(xdr);
    });

    if (submit.status !== "SUCCESS") {
      throw new Error(submit.errorMessage ?? "Subscription charge submission failed");
    }

    const recipientRows = await buildDevRecipientRows(
      splitterContractAddress,
      subscriptionContractAddress,
    );
    const totalStroops = recipientRows.reduce((sum, r) => sum + BigInt(r.amount), 0n);

    const payrollRun = await db.payrollRun.create({
      data: {
        deploymentId: d.id,
        runAt: now,
        status: PayrollRunStatus.CHARGED,
        totalStroops: totalStroops.toString(),
        chargedAt: now,
      },
    });

    for (const r of recipientRows) {
      const employee = await db.employee.upsert({
        where: { deploymentId_address: { deploymentId: d.id, address: r.address } },
        create: {
          deploymentId: d.id,
          address: r.address,
          amountStroops: r.amount,
        },
        update: {
          amountStroops: r.amount,
        },
      });
      await db.payrollPayout.create({
        data: {
          payrollRunId: payrollRun.id,
          employeeId: employee.id,
          amountStroops: r.amount,
          txHash: submit.txHash,
        },
      });
    }

    if (d.offRampEnabled) {
      try {
        const created = await createOffRampJobsForPayrollRun(db, payrollRun.id);
        log.info(
          { deploymentId: d.id, payrollRunId: payrollRun.id, created: created.length },
          "Created off-ramp jobs for dev payroll run",
        );
      } catch (offRampErr) {
        const message = offRampErr instanceof Error ? offRampErr.message : String(offRampErr);
        log.warn(
          { deploymentId: d.id, payrollRunId: payrollRun.id, error: message },
          "Failed to create off-ramp jobs for dev payroll run",
        );
      }
    }

    chargedCount++;

    const next = await readSubscriptionNextChargeAt(subscriptionContractAddress);
    if (new Date(Number(next) * 1000) > now) break;
  }

  if (chargedCount === 0) {
    throw new Error("NotYetDue");
  }

  const next = await readSubscriptionNextChargeAt(subscriptionContractAddress);
  await db.deployment.update({
    where: { id: d.id },
    data: {
      lastChargedAt: new Date(),
      nextChargeAt: new Date(Number(next) * 1000),
    },
  });

  return chargedCount;
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
          notice: "STELLAR_RELAYER_ADDRESS is not configured; auto-charge payroll cron skipped",
        },
      });
    }

    const now = new Date();
    const deployments = await db.deployment.findMany({
      where: {
        status: "CONFIRMED",
        flow: { templateKind: "PAYROLL" },
        OR: [{ nextChargeAt: { lte: now } }, { nextChargeAt: null }],
      },
      include: { flow: { select: { templateKind: true } } },
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
      const payrollNode = pipeline?.find((n) => n.templateKind === "PAYROLL");
      const subscriptionDevNode = pipeline?.find((n) => n.templateKind === "SUBSCRIPTION_DEV");
      const splitterDevNode = pipeline?.find((n) => n.templateKind === "SPLITTER_DEV");

      const isMonolithic =
        payrollNode?.contractAddress &&
        (d.chargeRelayerMode === ChargeRelayerMode.PLATFORM ||
          d.chargeRelayerMode === ChargeRelayerMode.USER);
      const isDev = subscriptionDevNode?.contractAddress && splitterDevNode?.contractAddress;

      if (!isMonolithic && !isDev) {
        results.push({
          deploymentId: d.id,
          contractAddress:
            payrollNode?.contractAddress ?? subscriptionDevNode?.contractAddress ?? "",
          status: "skipped",
          error: "No chargeable payroll contract in pipeline",
        });
        continue;
      }

      let contractAddress = "";
      try {
        if (isDev) {
          contractAddress = subscriptionDevNode!.contractAddress;
          const devChargedCount = await chargeDevPayrollDeployment(
            d,
            contractAddress,
            splitterDevNode!.contractAddress,
            now,
          );
          platformCharged += devChargedCount;
          results.push({
            deploymentId: d.id,
            contractAddress,
            status: "charged",
          });
          continue;
        }

        contractAddress = payrollNode!.contractAddress;
        const cancelled = await readPayrollIsCancelled(contractAddress);
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

        const nextChargeAt = await readPayrollNextChargeAt(contractAddress);
        const nextChargeDate = new Date(Number(nextChargeAt) * 1000);
        if (nextChargeDate > now) {
          await db.deployment.update({
            where: { id: d.id },
            data: { nextChargeAt: nextChargeDate },
          });
          results.push({ deploymentId: d.id, contractAddress, status: "skipped" });
          continue;
        }

        const recipients = await readPayrollRecipients(contractAddress);
        const totalAmount = recipients.reduce((sum, r) => sum + BigInt(r.amount), 0n);
        const [employer, asset] = await Promise.all([
          readPayrollEmployer(contractAddress),
          readPayrollAsset(contractAddress),
        ]);
        const allowance = await readTokenAllowance({
          tokenContractAddress: asset,
          owner: employer,
          spender: contractAddress,
        });
        if (allowance < totalAmount) {
          results.push({
            deploymentId: d.id,
            contractAddress,
            status: "skipped",
            error: "Insufficient allowance",
          });
          continue;
        }

        const onChainRelayer = await readPayrollRelayer(contractAddress);
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

        const payrollRun = await db.payrollRun.create({
          data: {
            deploymentId: d.id,
            runAt: now,
            status: PayrollRunStatus.PENDING,
            totalStroops: totalAmount.toString(),
          },
        });

        let chargedCount = 0;
        if (d.chargeRelayerMode === ChargeRelayerMode.PLATFORM) {
          for (let i = 0; i < MAX_CATCHUP_PER_RUN; i++) {
            const submit = await withRelayerLock(async () => {
              const { xdr } = await preparePayrollChargeByRelayerTx(contractAddress);
              return submitPayrollChargeByRelayerTx(xdr);
            });

            if (submit.status === "SUCCESS") {
              chargedCount++;

              for (const r of recipients) {
                const employee = await db.employee.upsert({
                  where: {
                    deploymentId_address: {
                      deploymentId: d.id,
                      address: r.address,
                    },
                  },
                  create: {
                    deploymentId: d.id,
                    address: r.address,
                    amountStroops: r.amount,
                  },
                  update: {
                    amountStroops: r.amount,
                  },
                });
                await db.payrollPayout.create({
                  data: {
                    payrollRunId: payrollRun.id,
                    employeeId: employee.id,
                    amountStroops: r.amount,
                    txHash: submit.txHash,
                  },
                });
              }

              const next = await readPayrollNextChargeAt(contractAddress);
              if (new Date(Number(next) * 1000) > new Date()) break;
            } else {
              throw new Error(submit.errorMessage ?? "Platform charge submission failed");
            }
          }
        } else {
          if (!d.chargeRelayerUrl || !d.chargeRelayerAddress) {
            results.push({
              deploymentId: d.id,
              contractAddress,
              status: "failed",
              error: "USER relayer mode missing url or address",
            });
            continue;
          }

          for (let i = 0; i < MAX_CATCHUP_PER_RUN; i++) {
            const { xdr: unsignedXdr } = await preparePayrollChargeByRelayerUnsigned({
              contractAddress,
              relayerAddress: d.chargeRelayerAddress,
            });

            const body = {
              deploymentId: d.id,
              contractAddress,
              network: env().STELLAR_NETWORK,
              networkPassphrase: stellarPassphrase(),
              unsignedXdr,
            };

            const res = await fetch(d.chargeRelayerUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(d.chargeRelayerToken
                  ? { Authorization: `Bearer ${d.chargeRelayerToken}` }
                  : {}),
              },
              body: JSON.stringify(body),
            });

            if (!res.ok) {
              throw new Error(`User relayer returned ${res.status}: ${await res.text()}`);
            }

            const json = (await res.json()) as {
              status: string;
              txHash?: string;
              signedXdr?: string;
              errorMessage?: string;
            };

            if (json.status === "SUCCESS" && json.txHash) {
              chargedCount++;
            } else if (json.status === "PENDING" && json.signedXdr) {
              const submit = await submitPayrollChargeByRelayerTx(json.signedXdr);
              if (submit.status === "SUCCESS") {
                chargedCount++;
              } else {
                throw new Error(submit.errorMessage ?? "User relayer submission failed");
              }
            } else {
              throw new Error(json.errorMessage ?? "User relayer did not return success");
            }

            const next = await readPayrollNextChargeAt(contractAddress);
            if (new Date(Number(next) * 1000) > new Date()) break;
          }
        }

        const next = await readPayrollNextChargeAt(contractAddress);
        await db.deployment.update({
          where: { id: d.id },
          data: {
            lastChargedAt: new Date(),
            nextChargeAt: new Date(Number(next) * 1000),
          },
        });

        await db.payrollRun.update({
          where: { id: payrollRun.id },
          data: {
            status: PayrollRunStatus.CHARGED,
            chargedAt: new Date(),
          },
        });

        if (d.offRampEnabled) {
          try {
            const created = await createOffRampJobsForPayrollRun(db, payrollRun.id);
            log.info(
              { deploymentId: d.id, payrollRunId: payrollRun.id, created: created.length },
              "Created off-ramp jobs for payroll run",
            );
          } catch (offRampErr) {
            const message = offRampErr instanceof Error ? offRampErr.message : String(offRampErr);
            log.warn(
              { deploymentId: d.id, payrollRunId: payrollRun.id, error: message },
              "Failed to create off-ramp jobs for payroll run",
            );
          }
        }

        if (d.chargeRelayerMode === ChargeRelayerMode.PLATFORM) {
          platformCharged += chargedCount;
        } else {
          userCharged += chargedCount;
        }
        results.push({ deploymentId: d.id, contractAddress, status: "charged" });
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
            "Payroll charge failed",
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
        processed: deployments.length,
        details: results,
      },
    });
  });
}

export const GET = POST;
