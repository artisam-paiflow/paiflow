import { Paiflow, signPrepared } from "@paiflow/sdk";
import type { SignRequest, SignedSubmission } from "@paiflow/sdk";
import { paymentHandlers } from "./payment-server.js";
import type { Order, PaymentDependencies } from "./payment-server.js";

export interface DeploymentOrder extends Order {
  deploymentId: string; // immutable server-side order assignment
}
export interface SelectedPaymentDependencies extends Omit<
  PaymentDependencies,
  "deployment" | "withOrder"
> {
  withOrder<T>(
    id: string,
    fn: (order: DeploymentOrder, save: () => Promise<void>) => Promise<T>,
  ): Promise<T>;
}

// Node server configuration only. Inject existing exported-client options for
// local fixtures; production uses a fixed trusted HTTPS origin and secret store.
export function selectedDeployments(client: Paiflow, deploymentIds: readonly [string, string]) {
  if (deploymentIds[0] === deploymentIds[1]) throw new Error("Select two distinct deployments");
  const selected = deploymentIds.map((id) => client.deployment(id));
  return {
    async read(signal?: AbortSignal) {
      const discovered = new Set<string>();
      for await (const page of client.deployments.pages({ limit: 20 }, { maxPages: 100, signal })) {
        for (const item of page.data.items) discovered.add(item.id);
      }
      // Discovery is informational, never authorization to pick another ID.
      if (deploymentIds.some((id) => !discovered.has(id)))
        throw new Error("Selected deployment unavailable; owner must check explicit grants");
      return Promise.all(
        selected.map(async (deployment) => ({
          deploymentId: deployment.deploymentId,
          capabilities: await deployment.capabilities.get({ signal }),
          balances: await deployment.balances.get({ signal }),
        })),
      );
    },
    // READ_OPERATE required. Your server must authorize the business action first.
    // Order persistence must also bind each order to this fixed deployment.
    payment(deploymentId: string, dependencies: SelectedPaymentDependencies) {
      const deployment = selected.find((item) => item.deploymentId === deploymentId);
      if (!deployment) throw new Error("Deployment outside application selection");
      return paymentHandlers({
        ...dependencies,
        deployment,
        withOrder: (id, fn) =>
          dependencies.withOrder(id, (order, save) => {
            if (order.deploymentId !== deploymentId)
              throw new Error("Order belongs to another deployment");
            return fn(order, save);
          }),
      });
    },
  };
}

// Explicit one-shot orchestration for a trusted caller. The callback is a bridge
// to the caller-owned wallet, with amount/recipients/network shown for consent.
// No customer keys, bearer credentials or signed envelopes go to logs.
// For browser routes use payment-browser.ts; it renders the required network chip.
export async function operateOnce(
  handlers: ReturnType<typeof paymentHandlers>,
  prepareRequest: Request,
  submitRequest: (signedXdr: string) => Request,
  consentAndSign: (
    review: Awaited<ReturnType<ReturnType<typeof paymentHandlers>["prepare"]>>,
    signing: SignRequest,
  ) => Promise<SignedSubmission>,
) {
  const review = await handlers.prepare(prepareRequest);
  const signed = await signPrepared(
    review.preparation,
    (signing) => consentAndSign(review, signing),
    {
      walletAddress: review.walletAddress,
    },
  );
  // Server submit binds the wallet result to the persisted original envelope,
  // saves hash/envelope before sending and verifies the business receipt.
  return handlers.submit(submitRequest(signed.submission.signedXdr));
}

// Your consuming app loads this from its own validated server configuration and
// secret manager. The example never imports the Paiflow app's lib/env.ts or
// reads a secret directly from process.env.
export interface DeveloperServerConfig {
  baseUrl: string;
  token: string;
  deploymentIds: readonly [string, string];
}
export async function readConfiguredDeployments(
  config: DeveloperServerConfig,
  signal?: AbortSignal,
) {
  const client = new Paiflow({ baseUrl: config.baseUrl, token: config.token });
  return selectedDeployments(client, config.deploymentIds).read(signal);
}
