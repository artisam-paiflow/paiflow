**@paiflow/sdk — method and type reference**

---

# SDK method and type reference

Generated from the public `@paiflow/sdk` entry point. Start with the
[SDK README](https://github.com/artisam-paiflow/paiflow/blob/develop/packages/sdk/README.md) for installation, configuration,
credential permissions, typed errors and workflow/recovery rules. The
[coverage matrix](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/sdk/contract.md#endpoint-matrix) maps methods to HTTP routes;
[OpenAPI and Postman](https://github.com/artisam-paiflow/paiflow/blob/develop/docs/api/README.md) remain the direct HTTP references.

Use `Paiflow` to create a Node client, then `client.deployment(id)` to access
`PaiflowDeployment` namespaces. Namespace properties below expand into individual
methods with parameters and return types. Public methods omit the configured bearer
credential; webhook methods require their own explicit secret. A credential grants
API access, never wallet consent or application order ownership.

HTTP methods return `ApiResponse<T>`. Persist preparation metadata and the original
signed envelope before submission. No method retries automatically. Unknown finality,
local expiry and missing events never permit a replacement payment. See the README
for each workflow's explicit reconciliation protocol and bounded testnet evidence.

This reference describes the source tree; package versions and hosted capabilities
advance separately. Regenerate with `pnpm sdk:docs`; CI runs the read-only
`pnpm sdk:docs:check`. Do not edit generated files directly.

## Classes

- [Paiflow](classes/Paiflow.md)
- [PaiflowAbortError](classes/PaiflowAbortError.md)
- [PaiflowApiError](classes/PaiflowApiError.md)
- [PaiflowDeployment](classes/PaiflowDeployment.md)
- [PaiflowMalformedResponseError](classes/PaiflowMalformedResponseError.md)
- [PaiflowSigningError](classes/PaiflowSigningError.md)
- [PaiflowTimeoutError](classes/PaiflowTimeoutError.md)
- [PaiflowTransport](classes/PaiflowTransport.md)
- [PaiflowTransportError](classes/PaiflowTransportError.md)

## Interfaces

- [AllowancePrepareInput](interfaces/AllowancePrepareInput.md)
- [AllowanceStatusInput](interfaces/AllowanceStatusInput.md)
- [AllowanceSubmitInput](interfaces/AllowanceSubmitInput.md)
- [ApiResponse](interfaces/ApiResponse.md)
- [DeploymentPagesOptions](interfaces/DeploymentPagesOptions.md)
- [EventPagesOptions](interfaces/EventPagesOptions.md)
- [ExecutePrepareInput](interfaces/ExecutePrepareInput.md)
- [ExecuteSubmitOptions](interfaces/ExecuteSubmitOptions.md)
- [FundingPrepareInput](interfaces/FundingPrepareInput.md)
- [FundingReconcileInput](interfaces/FundingReconcileInput.md)
- [FundingSubmitInput](interfaces/FundingSubmitInput.md)
- [JsonRequest](interfaces/JsonRequest.md)
- [ListDeploymentsQuery](interfaces/ListDeploymentsQuery.md)
- [ListEventsQuery](interfaces/ListEventsQuery.md)
- [PaiflowOptions](interfaces/PaiflowOptions.md)
- [PaymentUrlOptions](interfaces/PaymentUrlOptions.md)
- [PreparedEnvelope](interfaces/PreparedEnvelope.md)
- [PublicPaymentPrepareInput](interfaces/PublicPaymentPrepareInput.md)
- [ReleaseEarlyInput](interfaces/ReleaseEarlyInput.md)
- [RequestOptions](interfaces/RequestOptions.md)
- [ResponseMetadata](interfaces/ResponseMetadata.md)
- [SchedulePreparedBase](interfaces/SchedulePreparedBase.md)
- [SchedulePrepareInput](interfaces/SchedulePrepareInput.md)
- [ScheduleReconcileInput](interfaces/ScheduleReconcileInput.md)
- [ScheduleStateQuery](interfaces/ScheduleStateQuery.md)
- [ScheduleSubmitInput](interfaces/ScheduleSubmitInput.md)
- [SignedSubmission](interfaces/SignedSubmission.md)
- [SignOptions](interfaces/SignOptions.md)
- [SignRequest](interfaces/SignRequest.md)
- [SubscriptionPrepareInput](interfaces/SubscriptionPrepareInput.md)
- [SubscriptionReconcileInput](interfaces/SubscriptionReconcileInput.md)
- [SubscriptionSubmitInput](interfaces/SubscriptionSubmitInput.md)
- [SwapQuoteQuery](interfaces/SwapQuoteQuery.md)
- [WebhookEscrowInput](interfaces/WebhookEscrowInput.md)
- [WebhookNativeInput](interfaces/WebhookNativeInput.md)
- [WebhookTriggerOptions](interfaces/WebhookTriggerOptions.md)
- [WebhookUnkeyedOptions](interfaces/WebhookUnkeyedOptions.md)

## Type Aliases

- [AllowancePrepared](type-aliases/AllowancePrepared.md)
- [AllowanceState](type-aliases/AllowanceState.md)
- [AllowanceStatus](type-aliases/AllowanceStatus.md)
- [ContractEventItem](type-aliases/ContractEventItem.md)
- [DemoToken](type-aliases/DemoToken.md)
- [DeploymentBalances](type-aliases/DeploymentBalances.md)
- [DeploymentCapabilities](type-aliases/DeploymentCapabilities.md)
- [DeploymentSummary](type-aliases/DeploymentSummary.md)
- [ExecutePrepared](type-aliases/ExecutePrepared.md)
- [ExecuteSubmitted](type-aliases/ExecuteSubmitted.md)
- [FundingAction](type-aliases/FundingAction.md)
- [FundingDiscovery](type-aliases/FundingDiscovery.md)
- [FundingPrepared](type-aliases/FundingPrepared.md)
- [FundingReconciled](type-aliases/FundingReconciled.md)
- [FundingSubmitted](type-aliases/FundingSubmitted.md)
- [ListDeploymentsResponse](type-aliases/ListDeploymentsResponse.md)
- [ListEventsResponse](type-aliases/ListEventsResponse.md)
- [OpenApiDocument](type-aliases/OpenApiDocument.md)
- [PreparedSigner](type-aliases/PreparedSigner.md)
- [PublicEmbedActivity](type-aliases/PublicEmbedActivity.md)
- [PublicEmbedEvent](type-aliases/PublicEmbedEvent.md)
- [PublicEmbedMessage](type-aliases/PublicEmbedMessage.md)
- [PublicPaymentPrepared](type-aliases/PublicPaymentPrepared.md)
- [PublicPaymentStatus](type-aliases/PublicPaymentStatus.md)
- [PublicPaymentSubmitted](type-aliases/PublicPaymentSubmitted.md)
- [PublicScheduleState](type-aliases/PublicScheduleState.md)
- [Released](type-aliases/Released.md)
- [RequestAuth](type-aliases/RequestAuth.md)
- [ScheduleAction](type-aliases/ScheduleAction.md)
- [SchedulePrepared](type-aliases/SchedulePrepared.md)
- [ScheduleReconciled](type-aliases/ScheduleReconciled.md)
- [ScheduleState](type-aliases/ScheduleState.md)
- [ScheduleSubmitted](type-aliases/ScheduleSubmitted.md)
- [SignTransaction](type-aliases/SignTransaction.md)
- [SubscriptionAction](type-aliases/SubscriptionAction.md)
- [SubscriptionPrepared](type-aliases/SubscriptionPrepared.md)
- [SubscriptionReconciled](type-aliases/SubscriptionReconciled.md)
- [SubscriptionState](type-aliases/SubscriptionState.md)
- [SubscriptionSubmitted](type-aliases/SubscriptionSubmitted.md)
- [SwapQuote](type-aliases/SwapQuote.md)
- [TransactionStatus](type-aliases/TransactionStatus.md)
- [WebhookAttempt](type-aliases/WebhookAttempt.md)
- [WebhookTriggerInput](type-aliases/WebhookTriggerInput.md)
- [WebhookUnkeyedResult](type-aliases/WebhookUnkeyedResult.md)

## Functions

- [signPrepared](functions/signPrepared.md)
