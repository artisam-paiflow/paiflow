[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / PaiflowDeployment

# Class: PaiflowDeployment

Existing-deployment workflows. API access never substitutes for wallet consent.

## Constructors

### Constructor

> **new PaiflowDeployment**(`transport`: [`PaiflowTransport`](PaiflowTransport.md), `deploymentId`: `string`): `PaiflowDeployment`

#### Parameters

##### transport

[`PaiflowTransport`](PaiflowTransport.md)

##### deploymentId

`string`

#### Returns

`PaiflowDeployment`

## Properties

### balances

> `readonly` **balances**: \{ `get`: (`options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `deploymentId`: `string`; `freshness`: \{ `attemptedAt`: `string`; `cached`: `boolean`; `status`: `"stale"` \| `"fresh"` \| `"partial"`; `totalsComplete`: `boolean`; \}; `network`: `"testnet"` \| `"mainnet"`; `nodes`: \{ `balanceStroops`: `string` \| `null`; `contractAddress`: `string`; `error?`: `string`; `nodeId`: `string`; `readAt`: `string` \| `null`; `stale`: `boolean`; `templateKind`: `string`; `tokenContract`: `string` \| `null`; \}[]; `totals`: \{ `balanceStroops`: `string`; `tokenContract`: `string`; \}[]; \}\>\>; \}

Live/cached balances with freshness, stale nodes and completeness visible.

#### get

> **get**: (`options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `deploymentId`: `string`; `freshness`: \{ `attemptedAt`: `string`; `cached`: `boolean`; `status`: `"stale"` \| `"fresh"` \| `"partial"`; `totalsComplete`: `boolean`; \}; `network`: `"testnet"` \| `"mainnet"`; `nodes`: \{ `balanceStroops`: `string` \| `null`; `contractAddress`: `string`; `error?`: `string`; `nodeId`: `string`; `readAt`: `string` \| `null`; `stale`: `boolean`; `templateKind`: `string`; `tokenContract`: `string` \| `null`; \}[]; `totals`: \{ `balanceStroops`: `string`; `tokenContract`: `string`; \}[]; \}\>\>

##### Parameters

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `deploymentId`: `string`; `freshness`: \{ `attemptedAt`: `string`; `cached`: `boolean`; `status`: `"stale"` \| `"fresh"` \| `"partial"`; `totalsComplete`: `boolean`; \}; `network`: `"testnet"` \| `"mainnet"`; `nodes`: \{ `balanceStroops`: `string` \| `null`; `contractAddress`: `string`; `error?`: `string`; `nodeId`: `string`; `readAt`: `string` \| `null`; `stale`: `boolean`; `templateKind`: `string`; `tokenContract`: `string` \| `null`; \}[]; `totals`: \{ `balanceStroops`: `string`; `tokenContract`: `string`; \}[]; \}\>\>

---

### capabilities

> `readonly` **capabilities**: \{ `get`: (`options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `configurationSource`: `"deployment_snapshot"`; `deploymentId`: `string`; `inputAsset`: \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"native"`; `symbol?`: `undefined`; \} \| \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"known"`; `symbol`: `"USDC"`; \} \| \{ `code`: `string`; `issuer`: `string`; `kind`: `"custom"`; `symbol?`: `undefined`; \} \| `null`; `network`: `"testnet"` \| `"mainnet"`; `operations`: \{ `balances`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `events`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `execute`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `funding`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `payouts`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `releaseEarly`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `scheduleControls`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `scheduleState`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `subscriptionAllowance`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `subscriptionCancel`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `subscriptionReactivate`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `subscriptionState`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `swapQuote`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `transactions`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `webhook`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; \}; `triggerType`: `"unknown"` \| `"deposit"` \| `"webhook"` \| `"subscription"` \| `"payroll"` \| `"schedule"` \| `"oracle"`; \}\>\>; \}

Read supported/conditional operations; capability is not live execution readiness.

#### get

> **get**: (`options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `configurationSource`: `"deployment_snapshot"`; `deploymentId`: `string`; `inputAsset`: \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"native"`; `symbol?`: `undefined`; \} \| \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"known"`; `symbol`: `"USDC"`; \} \| \{ `code`: `string`; `issuer`: `string`; `kind`: `"custom"`; `symbol?`: `undefined`; \} \| `null`; `network`: `"testnet"` \| `"mainnet"`; `operations`: \{ `balances`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `events`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `execute`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `funding`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `payouts`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `releaseEarly`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `scheduleControls`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `scheduleState`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `subscriptionAllowance`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `subscriptionCancel`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `subscriptionReactivate`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `subscriptionState`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `swapQuote`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `transactions`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `webhook`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; \}; `triggerType`: `"unknown"` \| `"deposit"` \| `"webhook"` \| `"subscription"` \| `"payroll"` \| `"schedule"` \| `"oracle"`; \}\>\>

##### Parameters

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `configurationSource`: `"deployment_snapshot"`; `deploymentId`: `string`; `inputAsset`: \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"native"`; `symbol?`: `undefined`; \} \| \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"known"`; `symbol`: `"USDC"`; \} \| \{ `code`: `string`; `issuer`: `string`; `kind`: `"custom"`; `symbol?`: `undefined`; \} \| `null`; `network`: `"testnet"` \| `"mainnet"`; `operations`: \{ `balances`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `events`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `execute`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `funding`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `payouts`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `releaseEarly`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `scheduleControls`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `scheduleState`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `subscriptionAllowance`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `subscriptionCancel`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `subscriptionReactivate`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `subscriptionState`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `swapQuote`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `transactions`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `webhook`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; \}; `triggerType`: `"unknown"` \| `"deposit"` \| `"webhook"` \| `"subscription"` \| `"payroll"` \| `"schedule"` \| `"oracle"`; \}\>\>

---

### deploymentId

> `readonly` **deploymentId**: `string`

---

### embed

> `readonly` **embed**: \{ `activity`: (`options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `events`: \{ `amountStroops?`: `string`; `eventId`: `string`; `kind`: `string`; `ledger`: `number`; `occurredAt`: `string`; `txHash`: `string`; \}[]; \}\>\>; `stream`: (`options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `AsyncGenerator`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<[`PublicEmbedMessage`](../type-aliases/PublicEmbedMessage.md)\>, `any`, `any`\>; \}

Public activity/snapshot stream; explicit reconnect is required after stream closure.

#### activity

> **activity**: (`options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `events`: \{ `amountStroops?`: `string`; `eventId`: `string`; `kind`: `string`; `ledger`: `number`; `occurredAt`: `string`; `txHash`: `string`; \}[]; \}\>\>

##### Parameters

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `events`: \{ `amountStroops?`: `string`; `eventId`: `string`; `kind`: `string`; `ledger`: `number`; `occurredAt`: `string`; `txHash`: `string`; \}[]; \}\>\>

#### stream

> **stream**: (`options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `AsyncGenerator`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<[`PublicEmbedMessage`](../type-aliases/PublicEmbedMessage.md)\>, `any`, `any`\>

##### Parameters

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

##### Returns

`AsyncGenerator`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<[`PublicEmbedMessage`](../type-aliases/PublicEmbedMessage.md)\>, `any`, `any`\>

---

### events

> `readonly` **events**: \{ `list`: (`query?`: [`ListEventsQuery`](../interfaces/ListEventsQuery.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `hasMore`: `boolean`; `items`: \{ `data`: `unknown`; `eventId`: `string`; `id`: `string`; `kind`: `string`; `ledger`: `number`; `occurredAt`: `string`; `topic`: `string` \| `null`; `txHash`: `string`; \}[]; `nextCursor`: `string` \| `null`; \}\>\>; `pages`: (`query?`: [`ListEventsQuery`](../interfaces/ListEventsQuery.md), `options?`: [`EventPagesOptions`](../interfaces/EventPagesOptions.md)) => `AsyncGenerator`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `hasMore`: `boolean`; `items`: \{ `data`: `unknown`; `eventId`: `string`; `id`: `string`; `kind`: `string`; `ledger`: `number`; `occurredAt`: `string`; `topic`: `string` \| `null`; `txHash`: `string`; \}[]; `nextCursor`: `string` \| `null`; \}\>\>; \}

Indexed event list or bounded deduplicating pages; events may lag chain finality.

#### list

> **list**: (`query?`: [`ListEventsQuery`](../interfaces/ListEventsQuery.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `hasMore`: `boolean`; `items`: \{ `data`: `unknown`; `eventId`: `string`; `id`: `string`; `kind`: `string`; `ledger`: `number`; `occurredAt`: `string`; `topic`: `string` \| `null`; `txHash`: `string`; \}[]; `nextCursor`: `string` \| `null`; \}\>\>

##### Parameters

###### query?

[`ListEventsQuery`](../interfaces/ListEventsQuery.md) = `{}`

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `hasMore`: `boolean`; `items`: \{ `data`: `unknown`; `eventId`: `string`; `id`: `string`; `kind`: `string`; `ledger`: `number`; `occurredAt`: `string`; `topic`: `string` \| `null`; `txHash`: `string`; \}[]; `nextCursor`: `string` \| `null`; \}\>\>

#### pages

> **pages**: (`query?`: [`ListEventsQuery`](../interfaces/ListEventsQuery.md), `options?`: [`EventPagesOptions`](../interfaces/EventPagesOptions.md)) => `AsyncGenerator`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `hasMore`: `boolean`; `items`: \{ `data`: `unknown`; `eventId`: `string`; `id`: `string`; `kind`: `string`; `ledger`: `number`; `occurredAt`: `string`; `topic`: `string` \| `null`; `txHash`: `string`; \}[]; `nextCursor`: `string` \| `null`; \}\>\>

##### Parameters

###### query?

[`ListEventsQuery`](../interfaces/ListEventsQuery.md) = `{}`

###### options?

[`EventPagesOptions`](../interfaces/EventPagesOptions.md) = `{}`

##### Returns

`AsyncGenerator`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `hasMore`: `boolean`; `items`: \{ `data`: `unknown`; `eventId`: `string`; `id`: `string`; `kind`: `string`; `ledger`: `number`; `occurredAt`: `string`; `topic`: `string` \| `null`; `txHash`: `string`; \}[]; `nextCursor`: `string` \| `null`; \}\>\>

---

### execute

> `readonly` **execute**: \{ `prepare`: (`body`: [`ExecutePrepareInput`](../interfaces/ExecutePrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `expiresAt`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `xdr`: `string`; \}\>\>; `submit`: (`body`: [`SignedSubmission`](../interfaces/SignedSubmission.md), `options?`: [`ExecuteSubmitOptions`](../interfaces/ExecuteSubmitOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"`; `txHash`: `string`; \}\>\>; \}

Token-authenticated prepare and explicit submit; preserve the original envelope.

#### prepare

> **prepare**: (`body`: [`ExecutePrepareInput`](../interfaces/ExecutePrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `expiresAt`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `xdr`: `string`; \}\>\>

##### Parameters

###### body

[`ExecutePrepareInput`](../interfaces/ExecutePrepareInput.md)

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `expiresAt`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `xdr`: `string`; \}\>\>

#### submit

> **submit**: (`body`: [`SignedSubmission`](../interfaces/SignedSubmission.md), `options?`: [`ExecuteSubmitOptions`](../interfaces/ExecuteSubmitOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"`; `txHash`: `string`; \}\>\>

##### Parameters

###### body

[`SignedSubmission`](../interfaces/SignedSubmission.md)

###### options?

[`ExecuteSubmitOptions`](../interfaces/ExecuteSubmitOptions.md) = `{}`

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"`; `txHash`: `string`; \}\>\>

---

### funding

> `readonly` **funding**: \{ `get`: (`options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `nodes`: \{ `action`: `"schedule.fund"` \| `"webhook.fund"`; `authorization`: `"funding_wallet"`; `contractAddress`: `string`; `effect`: `string`; `nodeId`: `string`; `templateKind`: `"STREAMER"` \| `"WEBHOOK"`; `tokenContractAddress`: `string`; \}[]; \}\>\>; `prepare`: (`body`: [`FundingPrepareInput`](../interfaces/FundingPrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"schedule.fund"` \| `"webhook.fund"`; `amountStroops`: `string`; `expiresAt`: `string`; `fromAddress`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `xdr`: `string`; \}\>\>; `reconcile`: (`body`: [`FundingReconcileInput`](../interfaces/FundingReconcileInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"schedule.fund"` \| `"webhook.fund"`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}\>\>; `signPrepared`: (`prepared`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"schedule.fund"` \| `"webhook.fund"`; `amountStroops`: `string`; `expiresAt`: `string`; `fromAddress`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `xdr`: `string`; \}\>, `signer`: [`SignTransaction`](../type-aliases/SignTransaction.md), `options`: [`SignOptions`](../interfaces/SignOptions.md)) => `Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"schedule.fund"` \| `"webhook.fund"`; `amountStroops`: `string`; `expiresAt`: `string`; `fromAddress`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `xdr`: `string`; \}\>; `submission`: \{ `action`: `"schedule.fund"` \| `"webhook.fund"`; `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>; `submit`: (`body`: [`FundingSubmitInput`](../interfaces/FundingSubmitInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>; \}

Schedule/Webhook top-ups, not payouts. Reconcile the original intent after uncertainty.

#### get

> **get**: (`options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `nodes`: \{ `action`: `"schedule.fund"` \| `"webhook.fund"`; `authorization`: `"funding_wallet"`; `contractAddress`: `string`; `effect`: `string`; `nodeId`: `string`; `templateKind`: `"STREAMER"` \| `"WEBHOOK"`; `tokenContractAddress`: `string`; \}[]; \}\>\>

##### Parameters

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `nodes`: \{ `action`: `"schedule.fund"` \| `"webhook.fund"`; `authorization`: `"funding_wallet"`; `contractAddress`: `string`; `effect`: `string`; `nodeId`: `string`; `templateKind`: `"STREAMER"` \| `"WEBHOOK"`; `tokenContractAddress`: `string`; \}[]; \}\>\>

#### prepare

> **prepare**: (`body`: [`FundingPrepareInput`](../interfaces/FundingPrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"schedule.fund"` \| `"webhook.fund"`; `amountStroops`: `string`; `expiresAt`: `string`; `fromAddress`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `xdr`: `string`; \}\>\>

Reserve and prepare one wallet-authorized operation. Persist this preparation before signing.

##### Parameters

###### body

[`FundingPrepareInput`](../interfaces/FundingPrepareInput.md)

Explicit node/wallet or subscriber inputs; a token supplies no wallet consent.

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

Timeout, cancellation and request correlation.

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"schedule.fund"` \| `"webhook.fund"`; `amountStroops`: `string`; `expiresAt`: `string`; `fromAddress`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `xdr`: `string`; \}\>\>

Original intent, transaction and unsigned envelope; no submission occurs.

#### reconcile

> **reconcile**: (`body`: [`FundingReconcileInput`](../interfaces/FundingReconcileInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"schedule.fund"` \| `"webhook.fund"`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}\>\>

Reconcile the original reserved operation explicitly, without creating a replacement.

##### Parameters

###### body

[`FundingReconcileInput`](../interfaces/FundingReconcileInput.md)

The original intent (and funding action where required).

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

Timeout, cancellation and correlation.

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"schedule.fund"` \| `"webhook.fund"`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}\>\>

Server finality/reservation evidence; elapsed time never permits replacement.

#### signPrepared

> **signPrepared**: (`prepared`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"schedule.fund"` \| `"webhook.fund"`; `amountStroops`: `string`; `expiresAt`: `string`; `fromAddress`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `xdr`: `string`; \}\>, `signer`: [`SignTransaction`](../type-aliases/SignTransaction.md), `options`: [`SignOptions`](../interfaces/SignOptions.md)) => `Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"schedule.fund"` \| `"webhook.fund"`; `amountStroops`: `string`; `expiresAt`: `string`; `fromAddress`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `xdr`: `string`; \}\>; `submission`: \{ `action`: `"schedule.fund"` \| `"webhook.fund"`; `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>

Ask the wallet to sign once; never submits, retries or checks finality.

##### Parameters

###### prepared

[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"schedule.fund"` \| `"webhook.fund"`; `amountStroops`: `string`; `expiresAt`: `string`; `fromAddress`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `xdr`: `string`; \}\>

Saved original preparation response, including history metadata.

###### signer

[`SignTransaction`](../type-aliases/SignTransaction.md)

Application callback signing the unchanged envelope with the supplied passphrase.

###### options

[`SignOptions`](../interfaces/SignOptions.md)

Expected wallet/network, cancellation and signing deadline.

##### Returns

`Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"schedule.fund"` \| `"webhook.fund"`; `amountStroops`: `string`; `expiresAt`: `string`; `fromAddress`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `xdr`: `string`; \}\>; `submission`: \{ `action`: `"schedule.fund"` \| `"webhook.fund"`; `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>

Preserved preparation and explicit submission arguments/history options.

#### submit

> **submit**: (`body`: [`FundingSubmitInput`](../interfaces/FundingSubmitInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>

Submit the unchanged signed envelope for the original reserved intent. Never retried.

##### Parameters

###### body

[`FundingSubmitInput`](../interfaces/FundingSubmitInput.md)

Original intent and wallet-signed XDR; do not rebuild after uncertainty.

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

Request options; retain the original preparationRequestId.

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>

Submission status; HTTP success alone is not financial success.

---

### publicPayment

> `readonly` **publicPayment**: \{ `prepare`: (`body`: [`PublicPaymentPrepareInput`](../interfaces/PublicPaymentPrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `xdr`: `string`; \}\>\>; `status`: (`txHash`: `string`, `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `errorMessage?`: `string`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"`; `txHash`: `string`; \}\>\>; `submit`: (`body`: [`SignedSubmission`](../interfaces/SignedSubmission.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `status?`: `"PENDING"`; `txHash`: `string`; \}\>\>; \}

Anonymous payment helpers; public SUCCESS is global chain status, not an order receipt.

#### prepare

> **prepare**: (`body`: [`PublicPaymentPrepareInput`](../interfaces/PublicPaymentPrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `xdr`: `string`; \}\>\>

##### Parameters

###### body

[`PublicPaymentPrepareInput`](../interfaces/PublicPaymentPrepareInput.md)

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `xdr`: `string`; \}\>\>

#### status

> **status**: (`txHash`: `string`, `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `errorMessage?`: `string`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"`; `txHash`: `string`; \}\>\>

##### Parameters

###### txHash

`string`

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `errorMessage?`: `string`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"`; `txHash`: `string`; \}\>\>

#### submit

> **submit**: (`body`: [`SignedSubmission`](../interfaces/SignedSubmission.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `status?`: `"PENDING"`; `txHash`: `string`; \}\>\>

##### Parameters

###### body

[`SignedSubmission`](../interfaces/SignedSubmission.md)

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `status?`: `"PENDING"`; `txHash`: `string`; \}\>\>

---

### publicSchedule

> `readonly` **publicSchedule**: \{ `get`: (`options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `available`: `string`; `paused`: `boolean`; `retrieveAllowed`: `boolean`; \}\>\>; \}

Public legacy streamer state, with no bearer token.

#### get

> **get**: (`options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `available`: `string`; `paused`: `boolean`; `retrieveAllowed`: `boolean`; \}\>\>

##### Parameters

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `available`: `string`; `paused`: `boolean`; `retrieveAllowed`: `boolean`; \}\>\>

---

### releaseEarly

> `readonly` **releaseEarly**: (`value?`: [`ReleaseEarlyInput`](../interfaces/ReleaseEarlyInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `ledger?`: `number`; `nodeId`: `string`; `txHash`: `string`; \}\>\>

Explicit relayer-backed timelock release. Authorise your application user first.

#### Parameters

##### value?

[`ReleaseEarlyInput`](../interfaces/ReleaseEarlyInput.md) = `{}`

##### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

#### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `ledger?`: `number`; `nodeId`: `string`; `txHash`: `string`; \}\>\>

---

### schedule

> `readonly` **schedule**: \{ `get`: (`query?`: [`ScheduleStateQuery`](../interfaces/ScheduleStateQuery.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `availableStroops`: `string`; `balanceStroops`: `string`; `claimedStroops`: `string`; `contractAddress`: `string`; `controlEligibility`: \{ `pause`: `boolean`; `resume`: `boolean`; `retrieve`: `boolean`; `walletProtocolSupported`: `boolean`; \}; `controller`: `string`; `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `nodeId`: `string`; `pauseAllowed`: `boolean`; `paused`: `boolean`; `readAt`: `string`; `retrievableStroops`: `string`; `retrievalRecipient`: `string`; `retrieveAllowed`: `boolean`; `tokenContractAddress`: `string`; `unvestedStroops`: `string`; \}\>\>; `pause`: \{ `prepare`: (`body`: [`SchedulePrepareInput`](../interfaces/SchedulePrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"pause"`\>\>\>; `reconcile`: (`body`: [`ScheduleReconcileInput`](../interfaces/ScheduleReconcileInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"pause"`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `replacementAllowed`: `boolean`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}\>\>; `signPrepared`: (`prepared`: [`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"pause"`\>\>, `signer`: [`SignTransaction`](../type-aliases/SignTransaction.md), `options`: [`SignOptions`](../interfaces/SignOptions.md)) => `Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"pause"`\>\>; `submission`: \{ `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>; `submit`: (`body`: [`ScheduleSubmitInput`](../interfaces/ScheduleSubmitInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>; \}; `resume`: \{ `prepare`: (`body`: [`SchedulePrepareInput`](../interfaces/SchedulePrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"resume"`\>\>\>; `reconcile`: (`body`: [`ScheduleReconcileInput`](../interfaces/ScheduleReconcileInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"resume"`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `replacementAllowed`: `boolean`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}\>\>; `signPrepared`: (`prepared`: [`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"resume"`\>\>, `signer`: [`SignTransaction`](../type-aliases/SignTransaction.md), `options`: [`SignOptions`](../interfaces/SignOptions.md)) => `Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"resume"`\>\>; `submission`: \{ `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>; `submit`: (`body`: [`ScheduleSubmitInput`](../interfaces/ScheduleSubmitInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>; \}; `retrieve`: \{ `prepare`: (`body`: [`SchedulePrepareInput`](../interfaces/SchedulePrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"retrieve"`\> & \{ `estimatedAmountStroops`: `string`; `recipient`: `string`; `tokenContractAddress`: `string`; \}\>\>; `reconcile`: (`body`: [`ScheduleReconcileInput`](../interfaces/ScheduleReconcileInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"retrieve"`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `replacementAllowed`: `boolean`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}\>\>; `signPrepared`: (`prepared`: [`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"retrieve"`\> & \{ `estimatedAmountStroops`: `string`; `recipient`: `string`; `tokenContractAddress`: `string`; \}\>, `signer`: [`SignTransaction`](../type-aliases/SignTransaction.md), `options`: [`SignOptions`](../interfaces/SignOptions.md)) => `Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"retrieve"`\> & \{ `estimatedAmountStroops`: `string`; `recipient`: `string`; `tokenContractAddress`: `string`; \}\>; `submission`: \{ `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>; `submit`: (`body`: [`ScheduleSubmitInput`](../interfaces/ScheduleSubmitInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>; \}; \}

Controller-signed pause/resume/retrieve and explicit original-intent recovery.

#### get

> **get**: (`query?`: [`ScheduleStateQuery`](../interfaces/ScheduleStateQuery.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `availableStroops`: `string`; `balanceStroops`: `string`; `claimedStroops`: `string`; `contractAddress`: `string`; `controlEligibility`: \{ `pause`: `boolean`; `resume`: `boolean`; `retrieve`: `boolean`; `walletProtocolSupported`: `boolean`; \}; `controller`: `string`; `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `nodeId`: `string`; `pauseAllowed`: `boolean`; `paused`: `boolean`; `readAt`: `string`; `retrievableStroops`: `string`; `retrievalRecipient`: `string`; `retrieveAllowed`: `boolean`; `tokenContractAddress`: `string`; `unvestedStroops`: `string`; \}\>\>

##### Parameters

###### query?

[`ScheduleStateQuery`](../interfaces/ScheduleStateQuery.md) = `{}`

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `availableStroops`: `string`; `balanceStroops`: `string`; `claimedStroops`: `string`; `contractAddress`: `string`; `controlEligibility`: \{ `pause`: `boolean`; `resume`: `boolean`; `retrieve`: `boolean`; `walletProtocolSupported`: `boolean`; \}; `controller`: `string`; `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `nodeId`: `string`; `pauseAllowed`: `boolean`; `paused`: `boolean`; `readAt`: `string`; `retrievableStroops`: `string`; `retrievalRecipient`: `string`; `retrieveAllowed`: `boolean`; `tokenContractAddress`: `string`; `unvestedStroops`: `string`; \}\>\>

#### pause

> **pause**: \{ `prepare`: (`body`: [`SchedulePrepareInput`](../interfaces/SchedulePrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"pause"`\>\>\>; `reconcile`: (`body`: [`ScheduleReconcileInput`](../interfaces/ScheduleReconcileInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"pause"`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `replacementAllowed`: `boolean`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}\>\>; `signPrepared`: (`prepared`: [`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"pause"`\>\>, `signer`: [`SignTransaction`](../type-aliases/SignTransaction.md), `options`: [`SignOptions`](../interfaces/SignOptions.md)) => `Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"pause"`\>\>; `submission`: \{ `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>; `submit`: (`body`: [`ScheduleSubmitInput`](../interfaces/ScheduleSubmitInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>; \}

##### pause.prepare

> **prepare**: (`body`: [`SchedulePrepareInput`](../interfaces/SchedulePrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"pause"`\>\>\>

Reserve and prepare one wallet-authorized operation. Persist this preparation before signing.

###### Parameters

###### body

[`SchedulePrepareInput`](../interfaces/SchedulePrepareInput.md)

Explicit node/wallet or subscriber inputs; a token supplies no wallet consent.

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

Timeout, cancellation and request correlation.

###### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"pause"`\>\>\>

Original intent, transaction and unsigned envelope; no submission occurs.

##### pause.reconcile

> **reconcile**: (`body`: [`ScheduleReconcileInput`](../interfaces/ScheduleReconcileInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"pause"`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `replacementAllowed`: `boolean`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}\>\>

Reconcile the original reserved operation explicitly, without creating a replacement.

###### Parameters

###### body

[`ScheduleReconcileInput`](../interfaces/ScheduleReconcileInput.md)

The original intent (and funding action where required).

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

Timeout, cancellation and correlation.

###### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"pause"`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `replacementAllowed`: `boolean`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}\>\>

Server finality/reservation evidence; elapsed time never permits replacement.

##### pause.signPrepared

> **signPrepared**: (`prepared`: [`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"pause"`\>\>, `signer`: [`SignTransaction`](../type-aliases/SignTransaction.md), `options`: [`SignOptions`](../interfaces/SignOptions.md)) => `Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"pause"`\>\>; `submission`: \{ `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>

Ask the wallet to sign once; never submits, retries or checks finality.

###### Parameters

###### prepared

[`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"pause"`\>\>

Saved original preparation response, including history metadata.

###### signer

[`SignTransaction`](../type-aliases/SignTransaction.md)

Application callback signing the unchanged envelope with the supplied passphrase.

###### options

[`SignOptions`](../interfaces/SignOptions.md)

Expected wallet/network, cancellation and signing deadline.

###### Returns

`Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"pause"`\>\>; `submission`: \{ `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>

Preserved preparation and explicit submission arguments/history options.

##### pause.submit

> **submit**: (`body`: [`ScheduleSubmitInput`](../interfaces/ScheduleSubmitInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>

Submit the unchanged signed envelope for the original reserved intent. Never retried.

###### Parameters

###### body

[`ScheduleSubmitInput`](../interfaces/ScheduleSubmitInput.md)

Original intent and wallet-signed XDR; do not rebuild after uncertainty.

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

Request options; retain the original preparationRequestId.

###### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>

Submission status; HTTP success alone is not financial success.

#### resume

> **resume**: \{ `prepare`: (`body`: [`SchedulePrepareInput`](../interfaces/SchedulePrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"resume"`\>\>\>; `reconcile`: (`body`: [`ScheduleReconcileInput`](../interfaces/ScheduleReconcileInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"resume"`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `replacementAllowed`: `boolean`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}\>\>; `signPrepared`: (`prepared`: [`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"resume"`\>\>, `signer`: [`SignTransaction`](../type-aliases/SignTransaction.md), `options`: [`SignOptions`](../interfaces/SignOptions.md)) => `Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"resume"`\>\>; `submission`: \{ `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>; `submit`: (`body`: [`ScheduleSubmitInput`](../interfaces/ScheduleSubmitInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>; \}

##### resume.prepare

> **prepare**: (`body`: [`SchedulePrepareInput`](../interfaces/SchedulePrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"resume"`\>\>\>

Reserve and prepare one wallet-authorized operation. Persist this preparation before signing.

###### Parameters

###### body

[`SchedulePrepareInput`](../interfaces/SchedulePrepareInput.md)

Explicit node/wallet or subscriber inputs; a token supplies no wallet consent.

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

Timeout, cancellation and request correlation.

###### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"resume"`\>\>\>

Original intent, transaction and unsigned envelope; no submission occurs.

##### resume.reconcile

> **reconcile**: (`body`: [`ScheduleReconcileInput`](../interfaces/ScheduleReconcileInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"resume"`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `replacementAllowed`: `boolean`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}\>\>

Reconcile the original reserved operation explicitly, without creating a replacement.

###### Parameters

###### body

[`ScheduleReconcileInput`](../interfaces/ScheduleReconcileInput.md)

The original intent (and funding action where required).

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

Timeout, cancellation and correlation.

###### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"resume"`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `replacementAllowed`: `boolean`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}\>\>

Server finality/reservation evidence; elapsed time never permits replacement.

##### resume.signPrepared

> **signPrepared**: (`prepared`: [`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"resume"`\>\>, `signer`: [`SignTransaction`](../type-aliases/SignTransaction.md), `options`: [`SignOptions`](../interfaces/SignOptions.md)) => `Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"resume"`\>\>; `submission`: \{ `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>

Ask the wallet to sign once; never submits, retries or checks finality.

###### Parameters

###### prepared

[`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"resume"`\>\>

Saved original preparation response, including history metadata.

###### signer

[`SignTransaction`](../type-aliases/SignTransaction.md)

Application callback signing the unchanged envelope with the supplied passphrase.

###### options

[`SignOptions`](../interfaces/SignOptions.md)

Expected wallet/network, cancellation and signing deadline.

###### Returns

`Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"resume"`\>\>; `submission`: \{ `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>

Preserved preparation and explicit submission arguments/history options.

##### resume.submit

> **submit**: (`body`: [`ScheduleSubmitInput`](../interfaces/ScheduleSubmitInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>

Submit the unchanged signed envelope for the original reserved intent. Never retried.

###### Parameters

###### body

[`ScheduleSubmitInput`](../interfaces/ScheduleSubmitInput.md)

Original intent and wallet-signed XDR; do not rebuild after uncertainty.

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

Request options; retain the original preparationRequestId.

###### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>

Submission status; HTTP success alone is not financial success.

#### retrieve

> **retrieve**: \{ `prepare`: (`body`: [`SchedulePrepareInput`](../interfaces/SchedulePrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"retrieve"`\> & \{ `estimatedAmountStroops`: `string`; `recipient`: `string`; `tokenContractAddress`: `string`; \}\>\>; `reconcile`: (`body`: [`ScheduleReconcileInput`](../interfaces/ScheduleReconcileInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"retrieve"`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `replacementAllowed`: `boolean`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}\>\>; `signPrepared`: (`prepared`: [`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"retrieve"`\> & \{ `estimatedAmountStroops`: `string`; `recipient`: `string`; `tokenContractAddress`: `string`; \}\>, `signer`: [`SignTransaction`](../type-aliases/SignTransaction.md), `options`: [`SignOptions`](../interfaces/SignOptions.md)) => `Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"retrieve"`\> & \{ `estimatedAmountStroops`: `string`; `recipient`: `string`; `tokenContractAddress`: `string`; \}\>; `submission`: \{ `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>; `submit`: (`body`: [`ScheduleSubmitInput`](../interfaces/ScheduleSubmitInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>; \}

##### retrieve.prepare

> **prepare**: (`body`: [`SchedulePrepareInput`](../interfaces/SchedulePrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"retrieve"`\> & \{ `estimatedAmountStroops`: `string`; `recipient`: `string`; `tokenContractAddress`: `string`; \}\>\>

Reserve and prepare one wallet-authorized operation. Persist this preparation before signing.

###### Parameters

###### body

[`SchedulePrepareInput`](../interfaces/SchedulePrepareInput.md)

Explicit node/wallet or subscriber inputs; a token supplies no wallet consent.

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

Timeout, cancellation and request correlation.

###### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"retrieve"`\> & \{ `estimatedAmountStroops`: `string`; `recipient`: `string`; `tokenContractAddress`: `string`; \}\>\>

Original intent, transaction and unsigned envelope; no submission occurs.

##### retrieve.reconcile

> **reconcile**: (`body`: [`ScheduleReconcileInput`](../interfaces/ScheduleReconcileInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"retrieve"`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `replacementAllowed`: `boolean`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}\>\>

Reconcile the original reserved operation explicitly, without creating a replacement.

###### Parameters

###### body

[`ScheduleReconcileInput`](../interfaces/ScheduleReconcileInput.md)

The original intent (and funding action where required).

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

Timeout, cancellation and correlation.

###### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"retrieve"`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `replacementAllowed`: `boolean`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}\>\>

Server finality/reservation evidence; elapsed time never permits replacement.

##### retrieve.signPrepared

> **signPrepared**: (`prepared`: [`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"retrieve"`\> & \{ `estimatedAmountStroops`: `string`; `recipient`: `string`; `tokenContractAddress`: `string`; \}\>, `signer`: [`SignTransaction`](../type-aliases/SignTransaction.md), `options`: [`SignOptions`](../interfaces/SignOptions.md)) => `Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"retrieve"`\> & \{ `estimatedAmountStroops`: `string`; `recipient`: `string`; `tokenContractAddress`: `string`; \}\>; `submission`: \{ `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>

Ask the wallet to sign once; never submits, retries or checks finality.

###### Parameters

###### prepared

[`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"retrieve"`\> & \{ `estimatedAmountStroops`: `string`; `recipient`: `string`; `tokenContractAddress`: `string`; \}\>

Saved original preparation response, including history metadata.

###### signer

[`SignTransaction`](../type-aliases/SignTransaction.md)

Application callback signing the unchanged envelope with the supplied passphrase.

###### options

[`SignOptions`](../interfaces/SignOptions.md)

Expected wallet/network, cancellation and signing deadline.

###### Returns

`Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<[`SchedulePreparedBase`](../interfaces/SchedulePreparedBase.md)\<`"retrieve"`\> & \{ `estimatedAmountStroops`: `string`; `recipient`: `string`; `tokenContractAddress`: `string`; \}\>; `submission`: \{ `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>

Preserved preparation and explicit submission arguments/history options.

##### retrieve.submit

> **submit**: (`body`: [`ScheduleSubmitInput`](../interfaces/ScheduleSubmitInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>

Submit the unchanged signed envelope for the original reserved intent. Never retried.

###### Parameters

###### body

[`ScheduleSubmitInput`](../interfaces/ScheduleSubmitInput.md)

Original intent and wallet-signed XDR; do not rebuild after uncertainty.

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

Request options; retain the original preparationRequestId.

###### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>

Submission status; HTTP success alone is not financial success.

---

### subscription

> `readonly` **subscription**: \{ `allowance`: \{ `get`: (`options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `allowance`: `string`; `asset`: \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"native"`; `symbol?`: `undefined`; \} \| \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"known"`; `symbol`: `"USDC"`; \} \| \{ `code`: `string`; `issuer`: `string`; `kind`: `"custom"`; `symbol?`: `undefined`; \} \| `null`; `assetLabel`: `string`; `contractAddress`: `string`; `deploymentId`: `string`; `flowName`: `string`; `isCancelled`: `boolean`; `network`: `"testnet"` \| `"mainnet"`; `setupRequired`: `boolean`; `subscriber`: `string` \| `null`; `tokenContractAddress`: `string`; \}\>\>; `prepare`: (`body`: [`AllowancePrepareInput`](../interfaces/AllowancePrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `allowance`: `string`; `intent`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \}\>\>; `signPrepared`: (`prepared`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `allowance`: `string`; `intent`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \}\>, `state`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `allowance`: `string`; `asset`: \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"native"`; `symbol?`: `undefined`; \} \| \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"known"`; `symbol`: `"USDC"`; \} \| \{ `code`: `string`; `issuer`: `string`; `kind`: `"custom"`; `symbol?`: `undefined`; \} \| `null`; `assetLabel`: `string`; `contractAddress`: `string`; `deploymentId`: `string`; `flowName`: `string`; `isCancelled`: `boolean`; `network`: `"testnet"` \| `"mainnet"`; `setupRequired`: `boolean`; `subscriber`: `string` \| `null`; `tokenContractAddress`: `string`; \}\>, `signer`: [`SignTransaction`](../type-aliases/SignTransaction.md), `options`: [`SignOptions`](../interfaces/SignOptions.md)) => `Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `allowance`: `string`; `intent`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \}\>; `submission`: \{ `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>; `status`: (`query`: [`AllowanceStatusInput`](../interfaces/AllowanceStatusInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `errorMessage?`: `string`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"`; `txHash`: `string`; \}\>\>; `submit`: (`body`: [`AllowanceSubmitInput`](../interfaces/AllowanceSubmitInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `errorMessage?`: `string`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"`; `txHash`: `string`; \}\>\>; \}; `cancel`: \{ `prepare`: (`body`: [`SubscriptionPrepareInput`](../interfaces/SubscriptionPrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.cancel"`; `contractAddress`: `string`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `walletAddress`: `string`; `xdr`: `string`; \}\>\>; `reconcile`: (`body`: [`SubscriptionReconcileInput`](../interfaces/SubscriptionReconcileInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.cancel"`; `intent`: `string`; `ledger`: `number` \| `null`; `replacementAllowed`: `boolean`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}\>\>; `signPrepared`: (`prepared`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.cancel"`; `contractAddress`: `string`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `walletAddress`: `string`; `xdr`: `string`; \}\>, `signer`: [`SignTransaction`](../type-aliases/SignTransaction.md), `options`: [`SignOptions`](../interfaces/SignOptions.md)) => `Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.cancel"`; `contractAddress`: `string`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `walletAddress`: `string`; `xdr`: `string`; \}\>; `submission`: \{ `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>; `submit`: (`body`: [`SubscriptionSubmitInput`](../interfaces/SubscriptionSubmitInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>; \}; `get`: (`options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `allowance`: `string`; `asset`: \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"native"`; `symbol?`: `undefined`; \} \| \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"known"`; `symbol`: `"USDC"`; \} \| \{ `code`: `string`; `issuer`: `string`; `kind`: `"custom"`; `symbol?`: `undefined`; \} \| `null`; `assetLabel`: `string`; `contractAddress`: `string`; `deploymentId`: `string`; `flowName`: `string`; `isCancelled`: `boolean`; `network`: `"testnet"` \| `"mainnet"`; `setupRequired`: `boolean`; `subscriber`: `string` \| `null`; `templateKind`: `"SUBSCRIPTION"` \| `"SUBSCRIPTION_DEV"`; `tokenContractAddress`: `string`; \}\>\>; `reactivate`: \{ `prepare`: (`body`: [`SubscriptionPrepareInput`](../interfaces/SubscriptionPrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.reactivate"`; `contractAddress`: `string`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `walletAddress`: `string`; `xdr`: `string`; \}\>\>; `reconcile`: (`body`: [`SubscriptionReconcileInput`](../interfaces/SubscriptionReconcileInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.reactivate"`; `intent`: `string`; `ledger`: `number` \| `null`; `replacementAllowed`: `boolean`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}\>\>; `signPrepared`: (`prepared`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.reactivate"`; `contractAddress`: `string`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `walletAddress`: `string`; `xdr`: `string`; \}\>, `signer`: [`SignTransaction`](../type-aliases/SignTransaction.md), `options`: [`SignOptions`](../interfaces/SignOptions.md)) => `Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.reactivate"`; `contractAddress`: `string`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `walletAddress`: `string`; `xdr`: `string`; \}\>; `submission`: \{ `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>; `submit`: (`body`: [`SubscriptionSubmitInput`](../interfaces/SubscriptionSubmitInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>; \}; \}

Subscriber controls and public allowance consent; never charges automatically.

#### allowance

> **allowance**: \{ `get`: (`options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `allowance`: `string`; `asset`: \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"native"`; `symbol?`: `undefined`; \} \| \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"known"`; `symbol`: `"USDC"`; \} \| \{ `code`: `string`; `issuer`: `string`; `kind`: `"custom"`; `symbol?`: `undefined`; \} \| `null`; `assetLabel`: `string`; `contractAddress`: `string`; `deploymentId`: `string`; `flowName`: `string`; `isCancelled`: `boolean`; `network`: `"testnet"` \| `"mainnet"`; `setupRequired`: `boolean`; `subscriber`: `string` \| `null`; `tokenContractAddress`: `string`; \}\>\>; `prepare`: (`body`: [`AllowancePrepareInput`](../interfaces/AllowancePrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `allowance`: `string`; `intent`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \}\>\>; `signPrepared`: (`prepared`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `allowance`: `string`; `intent`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \}\>, `state`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `allowance`: `string`; `asset`: \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"native"`; `symbol?`: `undefined`; \} \| \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"known"`; `symbol`: `"USDC"`; \} \| \{ `code`: `string`; `issuer`: `string`; `kind`: `"custom"`; `symbol?`: `undefined`; \} \| `null`; `assetLabel`: `string`; `contractAddress`: `string`; `deploymentId`: `string`; `flowName`: `string`; `isCancelled`: `boolean`; `network`: `"testnet"` \| `"mainnet"`; `setupRequired`: `boolean`; `subscriber`: `string` \| `null`; `tokenContractAddress`: `string`; \}\>, `signer`: [`SignTransaction`](../type-aliases/SignTransaction.md), `options`: [`SignOptions`](../interfaces/SignOptions.md)) => `Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `allowance`: `string`; `intent`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \}\>; `submission`: \{ `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>; `status`: (`query`: [`AllowanceStatusInput`](../interfaces/AllowanceStatusInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `errorMessage?`: `string`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"`; `txHash`: `string`; \}\>\>; `submit`: (`body`: [`AllowanceSubmitInput`](../interfaces/AllowanceSubmitInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `errorMessage?`: `string`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"`; `txHash`: `string`; \}\>\>; \}

##### allowance.get

> **get**: (`options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `allowance`: `string`; `asset`: \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"native"`; `symbol?`: `undefined`; \} \| \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"known"`; `symbol`: `"USDC"`; \} \| \{ `code`: `string`; `issuer`: `string`; `kind`: `"custom"`; `symbol?`: `undefined`; \} \| `null`; `assetLabel`: `string`; `contractAddress`: `string`; `deploymentId`: `string`; `flowName`: `string`; `isCancelled`: `boolean`; `network`: `"testnet"` \| `"mainnet"`; `setupRequired`: `boolean`; `subscriber`: `string` \| `null`; `tokenContractAddress`: `string`; \}\>\>

###### Parameters

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

###### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `allowance`: `string`; `asset`: \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"native"`; `symbol?`: `undefined`; \} \| \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"known"`; `symbol`: `"USDC"`; \} \| \{ `code`: `string`; `issuer`: `string`; `kind`: `"custom"`; `symbol?`: `undefined`; \} \| `null`; `assetLabel`: `string`; `contractAddress`: `string`; `deploymentId`: `string`; `flowName`: `string`; `isCancelled`: `boolean`; `network`: `"testnet"` \| `"mainnet"`; `setupRequired`: `boolean`; `subscriber`: `string` \| `null`; `tokenContractAddress`: `string`; \}\>\>

##### allowance.prepare

> **prepare**: (`body`: [`AllowancePrepareInput`](../interfaces/AllowancePrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `allowance`: `string`; `intent`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \}\>\>

Reserve and prepare one wallet-authorized operation. Persist this preparation before signing.

###### Parameters

###### body

[`AllowancePrepareInput`](../interfaces/AllowancePrepareInput.md)

Explicit node/wallet or subscriber inputs; a token supplies no wallet consent.

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

Timeout, cancellation and request correlation.

###### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `allowance`: `string`; `intent`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \}\>\>

Original intent, transaction and unsigned envelope; no submission occurs.

##### allowance.signPrepared

> **signPrepared**: (`prepared`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `allowance`: `string`; `intent`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \}\>, `state`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `allowance`: `string`; `asset`: \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"native"`; `symbol?`: `undefined`; \} \| \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"known"`; `symbol`: `"USDC"`; \} \| \{ `code`: `string`; `issuer`: `string`; `kind`: `"custom"`; `symbol?`: `undefined`; \} \| `null`; `assetLabel`: `string`; `contractAddress`: `string`; `deploymentId`: `string`; `flowName`: `string`; `isCancelled`: `boolean`; `network`: `"testnet"` \| `"mainnet"`; `setupRequired`: `boolean`; `subscriber`: `string` \| `null`; `tokenContractAddress`: `string`; \}\>, `signer`: [`SignTransaction`](../type-aliases/SignTransaction.md), `options`: [`SignOptions`](../interfaces/SignOptions.md)) => `Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `allowance`: `string`; `intent`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \}\>; `submission`: \{ `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>

Ask the wallet to sign once; never submits, retries or checks finality.

###### Parameters

###### prepared

[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `allowance`: `string`; `intent`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \}\>

Saved original preparation response, including history metadata.

###### state

[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `allowance`: `string`; `asset`: \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"native"`; `symbol?`: `undefined`; \} \| \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"known"`; `symbol`: `"USDC"`; \} \| \{ `code`: `string`; `issuer`: `string`; `kind`: `"custom"`; `symbol?`: `undefined`; \} \| `null`; `assetLabel`: `string`; `contractAddress`: `string`; `deploymentId`: `string`; `flowName`: `string`; `isCancelled`: `boolean`; `network`: `"testnet"` \| `"mainnet"`; `setupRequired`: `boolean`; `subscriber`: `string` \| `null`; `tokenContractAddress`: `string`; \}\>

###### signer

[`SignTransaction`](../type-aliases/SignTransaction.md)

Application callback signing the unchanged envelope with the supplied passphrase.

###### options

[`SignOptions`](../interfaces/SignOptions.md)

Expected wallet/network, cancellation and signing deadline.

###### Returns

`Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `allowance`: `string`; `intent`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \}\>; `submission`: \{ `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>

Preserved preparation and explicit submission arguments/history options.

##### allowance.status

> **status**: (`query`: [`AllowanceStatusInput`](../interfaces/AllowanceStatusInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `errorMessage?`: `string`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"`; `txHash`: `string`; \}\>\>

###### Parameters

###### query

[`AllowanceStatusInput`](../interfaces/AllowanceStatusInput.md)

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

###### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `errorMessage?`: `string`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"`; `txHash`: `string`; \}\>\>

##### allowance.submit

> **submit**: (`body`: [`AllowanceSubmitInput`](../interfaces/AllowanceSubmitInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `errorMessage?`: `string`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"`; `txHash`: `string`; \}\>\>

Submit the unchanged signed envelope for the original reserved intent. Never retried.

###### Parameters

###### body

[`AllowanceSubmitInput`](../interfaces/AllowanceSubmitInput.md)

Original intent and wallet-signed XDR; do not rebuild after uncertainty.

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

Request options; retain the original preparationRequestId.

###### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `errorMessage?`: `string`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"`; `txHash`: `string`; \}\>\>

Submission status; HTTP success alone is not financial success.

#### cancel

> **cancel**: \{ `prepare`: (`body`: [`SubscriptionPrepareInput`](../interfaces/SubscriptionPrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.cancel"`; `contractAddress`: `string`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `walletAddress`: `string`; `xdr`: `string`; \}\>\>; `reconcile`: (`body`: [`SubscriptionReconcileInput`](../interfaces/SubscriptionReconcileInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.cancel"`; `intent`: `string`; `ledger`: `number` \| `null`; `replacementAllowed`: `boolean`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}\>\>; `signPrepared`: (`prepared`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.cancel"`; `contractAddress`: `string`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `walletAddress`: `string`; `xdr`: `string`; \}\>, `signer`: [`SignTransaction`](../type-aliases/SignTransaction.md), `options`: [`SignOptions`](../interfaces/SignOptions.md)) => `Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.cancel"`; `contractAddress`: `string`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `walletAddress`: `string`; `xdr`: `string`; \}\>; `submission`: \{ `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>; `submit`: (`body`: [`SubscriptionSubmitInput`](../interfaces/SubscriptionSubmitInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>; \}

##### cancel.prepare

> **prepare**: (`body`: [`SubscriptionPrepareInput`](../interfaces/SubscriptionPrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.cancel"`; `contractAddress`: `string`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `walletAddress`: `string`; `xdr`: `string`; \}\>\>

Reserve and prepare one wallet-authorized operation. Persist this preparation before signing.

###### Parameters

###### body

[`SubscriptionPrepareInput`](../interfaces/SubscriptionPrepareInput.md)

Explicit node/wallet or subscriber inputs; a token supplies no wallet consent.

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

Timeout, cancellation and request correlation.

###### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.cancel"`; `contractAddress`: `string`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `walletAddress`: `string`; `xdr`: `string`; \}\>\>

Original intent, transaction and unsigned envelope; no submission occurs.

##### cancel.reconcile

> **reconcile**: (`body`: [`SubscriptionReconcileInput`](../interfaces/SubscriptionReconcileInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.cancel"`; `intent`: `string`; `ledger`: `number` \| `null`; `replacementAllowed`: `boolean`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}\>\>

Reconcile the original reserved operation explicitly, without creating a replacement.

###### Parameters

###### body

[`SubscriptionReconcileInput`](../interfaces/SubscriptionReconcileInput.md)

The original intent (and funding action where required).

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

Timeout, cancellation and correlation.

###### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.cancel"`; `intent`: `string`; `ledger`: `number` \| `null`; `replacementAllowed`: `boolean`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}\>\>

Server finality/reservation evidence; elapsed time never permits replacement.

##### cancel.signPrepared

> **signPrepared**: (`prepared`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.cancel"`; `contractAddress`: `string`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `walletAddress`: `string`; `xdr`: `string`; \}\>, `signer`: [`SignTransaction`](../type-aliases/SignTransaction.md), `options`: [`SignOptions`](../interfaces/SignOptions.md)) => `Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.cancel"`; `contractAddress`: `string`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `walletAddress`: `string`; `xdr`: `string`; \}\>; `submission`: \{ `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>

Ask the wallet to sign once; never submits, retries or checks finality.

###### Parameters

###### prepared

[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.cancel"`; `contractAddress`: `string`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `walletAddress`: `string`; `xdr`: `string`; \}\>

Saved original preparation response, including history metadata.

###### signer

[`SignTransaction`](../type-aliases/SignTransaction.md)

Application callback signing the unchanged envelope with the supplied passphrase.

###### options

[`SignOptions`](../interfaces/SignOptions.md)

Expected wallet/network, cancellation and signing deadline.

###### Returns

`Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.cancel"`; `contractAddress`: `string`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `walletAddress`: `string`; `xdr`: `string`; \}\>; `submission`: \{ `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>

Preserved preparation and explicit submission arguments/history options.

##### cancel.submit

> **submit**: (`body`: [`SubscriptionSubmitInput`](../interfaces/SubscriptionSubmitInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>

Submit the unchanged signed envelope for the original reserved intent. Never retried.

###### Parameters

###### body

[`SubscriptionSubmitInput`](../interfaces/SubscriptionSubmitInput.md)

Original intent and wallet-signed XDR; do not rebuild after uncertainty.

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

Request options; retain the original preparationRequestId.

###### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>

Submission status; HTTP success alone is not financial success.

#### get

> **get**: (`options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `allowance`: `string`; `asset`: \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"native"`; `symbol?`: `undefined`; \} \| \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"known"`; `symbol`: `"USDC"`; \} \| \{ `code`: `string`; `issuer`: `string`; `kind`: `"custom"`; `symbol?`: `undefined`; \} \| `null`; `assetLabel`: `string`; `contractAddress`: `string`; `deploymentId`: `string`; `flowName`: `string`; `isCancelled`: `boolean`; `network`: `"testnet"` \| `"mainnet"`; `setupRequired`: `boolean`; `subscriber`: `string` \| `null`; `templateKind`: `"SUBSCRIPTION"` \| `"SUBSCRIPTION_DEV"`; `tokenContractAddress`: `string`; \}\>\>

##### Parameters

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `allowance`: `string`; `asset`: \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"native"`; `symbol?`: `undefined`; \} \| \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"known"`; `symbol`: `"USDC"`; \} \| \{ `code`: `string`; `issuer`: `string`; `kind`: `"custom"`; `symbol?`: `undefined`; \} \| `null`; `assetLabel`: `string`; `contractAddress`: `string`; `deploymentId`: `string`; `flowName`: `string`; `isCancelled`: `boolean`; `network`: `"testnet"` \| `"mainnet"`; `setupRequired`: `boolean`; `subscriber`: `string` \| `null`; `templateKind`: `"SUBSCRIPTION"` \| `"SUBSCRIPTION_DEV"`; `tokenContractAddress`: `string`; \}\>\>

#### reactivate

> **reactivate**: \{ `prepare`: (`body`: [`SubscriptionPrepareInput`](../interfaces/SubscriptionPrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.reactivate"`; `contractAddress`: `string`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `walletAddress`: `string`; `xdr`: `string`; \}\>\>; `reconcile`: (`body`: [`SubscriptionReconcileInput`](../interfaces/SubscriptionReconcileInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.reactivate"`; `intent`: `string`; `ledger`: `number` \| `null`; `replacementAllowed`: `boolean`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}\>\>; `signPrepared`: (`prepared`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.reactivate"`; `contractAddress`: `string`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `walletAddress`: `string`; `xdr`: `string`; \}\>, `signer`: [`SignTransaction`](../type-aliases/SignTransaction.md), `options`: [`SignOptions`](../interfaces/SignOptions.md)) => `Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.reactivate"`; `contractAddress`: `string`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `walletAddress`: `string`; `xdr`: `string`; \}\>; `submission`: \{ `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>; `submit`: (`body`: [`SubscriptionSubmitInput`](../interfaces/SubscriptionSubmitInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>; \}

##### reactivate.prepare

> **prepare**: (`body`: [`SubscriptionPrepareInput`](../interfaces/SubscriptionPrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.reactivate"`; `contractAddress`: `string`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `walletAddress`: `string`; `xdr`: `string`; \}\>\>

Reserve and prepare one wallet-authorized operation. Persist this preparation before signing.

###### Parameters

###### body

[`SubscriptionPrepareInput`](../interfaces/SubscriptionPrepareInput.md)

Explicit node/wallet or subscriber inputs; a token supplies no wallet consent.

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

Timeout, cancellation and request correlation.

###### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.reactivate"`; `contractAddress`: `string`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `walletAddress`: `string`; `xdr`: `string`; \}\>\>

Original intent, transaction and unsigned envelope; no submission occurs.

##### reactivate.reconcile

> **reconcile**: (`body`: [`SubscriptionReconcileInput`](../interfaces/SubscriptionReconcileInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.reactivate"`; `intent`: `string`; `ledger`: `number` \| `null`; `replacementAllowed`: `boolean`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}\>\>

Reconcile the original reserved operation explicitly, without creating a replacement.

###### Parameters

###### body

[`SubscriptionReconcileInput`](../interfaces/SubscriptionReconcileInput.md)

The original intent (and funding action where required).

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

Timeout, cancellation and correlation.

###### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.reactivate"`; `intent`: `string`; `ledger`: `number` \| `null`; `replacementAllowed`: `boolean`; `state`: `"SUCCESS"` \| `"FAILED"` \| `"PREPARED"` \| `"SUBMITTING"` \| `"EXPIRED"`; `txHash`: `string`; \}\>\>

Server finality/reservation evidence; elapsed time never permits replacement.

##### reactivate.signPrepared

> **signPrepared**: (`prepared`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.reactivate"`; `contractAddress`: `string`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `walletAddress`: `string`; `xdr`: `string`; \}\>, `signer`: [`SignTransaction`](../type-aliases/SignTransaction.md), `options`: [`SignOptions`](../interfaces/SignOptions.md)) => `Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.reactivate"`; `contractAddress`: `string`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `walletAddress`: `string`; `xdr`: `string`; \}\>; `submission`: \{ `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>

Ask the wallet to sign once; never submits, retries or checks finality.

###### Parameters

###### prepared

[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.reactivate"`; `contractAddress`: `string`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `walletAddress`: `string`; `xdr`: `string`; \}\>

Saved original preparation response, including history metadata.

###### signer

[`SignTransaction`](../type-aliases/SignTransaction.md)

Application callback signing the unchanged envelope with the supplied passphrase.

###### options

[`SignOptions`](../interfaces/SignOptions.md)

Expected wallet/network, cancellation and signing deadline.

###### Returns

`Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `action`: `"subscription.reactivate"`; `contractAddress`: `string`; `expiresAt`: `string`; `intent`: `string`; `network`: `"testnet"` \| `"mainnet"`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `nodeId`: `string`; `tokenContractAddress`: `string`; `txHash`: `string`; `walletAddress`: `string`; `xdr`: `string`; \}\>; `submission`: \{ `intent`: `string`; `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>

Preserved preparation and explicit submission arguments/history options.

##### reactivate.submit

> **submit**: (`body`: [`SubscriptionSubmitInput`](../interfaces/SubscriptionSubmitInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>

Submit the unchanged signed envelope for the original reserved intent. Never retried.

###### Parameters

###### body

[`SubscriptionSubmitInput`](../interfaces/SubscriptionSubmitInput.md)

Original intent and wallet-signed XDR; do not rebuild after uncertainty.

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

Request options; retain the original preparationRequestId.

###### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>

Submission status; HTTP success alone is not financial success.

---

### swap

> `readonly` **swap**: \{ `quote`: (`query`: [`SwapQuoteQuery`](../interfaces/SwapQuoteQuery.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `amountInStroops`: `string`; `amountOutMinStroops`: `string`; `amountOutStroops`: `string`; `assetInContractAddress`: `string`; `assetOutContractAddress`: `string`; `contractAddress`: `string`; `deploymentId`: `string`; `estimate`: `true`; `freshness`: `"live"`; `meetsMinimumAtQuote`: `boolean`; `network`: `"testnet"` \| `"mainnet"`; `nodeId`: `string`; `pairAddress`: `string`; `quotedAt`: `string`; `readStartedAt`: `string`; `routerAddress`: `string`; `scope`: `"selected_node"`; `slippageBps`: `number`; \}\>\>; \}

Estimate one deployed Swap node, without executing a swap.

#### quote

> **quote**: (`query`: [`SwapQuoteQuery`](../interfaces/SwapQuoteQuery.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `amountInStroops`: `string`; `amountOutMinStroops`: `string`; `amountOutStroops`: `string`; `assetInContractAddress`: `string`; `assetOutContractAddress`: `string`; `contractAddress`: `string`; `deploymentId`: `string`; `estimate`: `true`; `freshness`: `"live"`; `meetsMinimumAtQuote`: `boolean`; `network`: `"testnet"` \| `"mainnet"`; `nodeId`: `string`; `pairAddress`: `string`; `quotedAt`: `string`; `readStartedAt`: `string`; `routerAddress`: `string`; `scope`: `"selected_node"`; `slippageBps`: `number`; \}\>\>

##### Parameters

###### query

[`SwapQuoteQuery`](../interfaces/SwapQuoteQuery.md)

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `amountInStroops`: `string`; `amountOutMinStroops`: `string`; `amountOutStroops`: `string`; `assetInContractAddress`: `string`; `assetOutContractAddress`: `string`; `contractAddress`: `string`; `deploymentId`: `string`; `estimate`: `true`; `freshness`: `"live"`; `meetsMinimumAtQuote`: `boolean`; `network`: `"testnet"` \| `"mainnet"`; `nodeId`: `string`; `pairAddress`: `string`; `quotedAt`: `string`; `readStartedAt`: `string`; `routerAddress`: `string`; `scope`: `"selected_node"`; `slippageBps`: `number`; \}\>\>

---

### transactions

> `readonly` **transactions**: \{ `get`: (`txHash`: `string`, `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>; \}

Read attributable transaction status; UNKNOWN/REJECTED do not permit replacement.

#### get

> **get**: (`txHash`: `string`, `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>

##### Parameters

###### txHash

`string`

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash`: `string`; \}\>\>

---

### transport

> `readonly` **transport**: [`PaiflowTransport`](PaiflowTransport.md)

---

### urls

> `readonly` **urls**: \{ `allowance`: () => `string`; `embed`: () => `string`; `payment`: (`options?`: [`PaymentUrlOptions`](../interfaces/PaymentUrlOptions.md)) => `string`; \}

Hosted URLs only; never include bearer tokens or establish eligibility.

#### allowance

> **allowance**: () => `string`

##### Returns

`string`

#### embed

> **embed**: () => `string`

##### Returns

`string`

#### payment

> **payment**: (`options?`: [`PaymentUrlOptions`](../interfaces/PaymentUrlOptions.md)) => `string`

##### Parameters

###### options?

[`PaymentUrlOptions`](../interfaces/PaymentUrlOptions.md) = `{}`

##### Returns

`string`

---

### webhook

> `readonly` **webhook**: \{ `trigger`: (`value`: [`WebhookTriggerInput`](../type-aliases/WebhookTriggerInput.md), `options`: [`WebhookTriggerOptions`](../interfaces/WebhookTriggerOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `attemptId`: `string`; `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash?`: `string`; \}\>\>; `triggerUnkeyed`: (`value`: [`WebhookTriggerInput`](../type-aliases/WebhookTriggerInput.md), `options`: [`WebhookUnkeyedOptions`](../interfaces/WebhookUnkeyedOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `status?`: `"PENDING"`; `txHash`: `string`; \}\>\>; \}

Explicit webhook secret; persist keyed event identity and never replace uncertain callbacks.

#### trigger

> **trigger**: (`value`: [`WebhookTriggerInput`](../type-aliases/WebhookTriggerInput.md), `options`: [`WebhookTriggerOptions`](../interfaces/WebhookTriggerOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `attemptId`: `string`; `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash?`: `string`; \}\>\>

No automatic retries or key generation. UNKNOWN without a hash requires operator review.

##### Parameters

###### value

[`WebhookTriggerInput`](../type-aliases/WebhookTriggerInput.md)

###### options

[`WebhookTriggerOptions`](../interfaces/WebhookTriggerOptions.md)

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `attemptId`: `string`; `error?`: \{ `code`: `string`; `message`: `string`; \}; `ledger?`: `number`; `network`: `"testnet"` \| `"mainnet"`; `status`: `"SUCCESS"` \| `"FAILED"` \| `"PENDING"` \| `"UNKNOWN"` \| `"REJECTED"`; `txHash?`: `string`; \}\>\>

#### triggerUnkeyed

> **triggerUnkeyed**: (`value`: [`WebhookTriggerInput`](../type-aliases/WebhookTriggerInput.md), `options`: [`WebhookUnkeyedOptions`](../interfaces/WebhookUnkeyedOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `status?`: `"PENDING"`; `txHash`: `string`; \}\>\>

Legacy compatibility: every call can pay again. Never replay after an uncertain result.

##### Parameters

###### value

[`WebhookTriggerInput`](../type-aliases/WebhookTriggerInput.md)

###### options

[`WebhookUnkeyedOptions`](../interfaces/WebhookUnkeyedOptions.md)

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `status?`: `"PENDING"`; `txHash`: `string`; \}\>\>
