[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / PaiflowTemplate

# Class: PaiflowTemplate

An explicitly granted private template. Construction performs no request.

## Constructors

### Constructor

> **new PaiflowTemplate**(`transport`: [`PaiflowTransport`](PaiflowTransport.md), `templateId`: `string`): `PaiflowTemplate`

#### Parameters

##### transport

[`PaiflowTransport`](PaiflowTransport.md)

##### templateId

`string`

#### Returns

`PaiflowTemplate`

## Properties

### instances

> `readonly` **instances**: \{ `events`: (`instanceId`: `string`, `query?`: [`InstanceEventsQuery`](../interfaces/InstanceEventsQuery.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `hasMore`: `boolean`; `items`: \{ `data`: `unknown`; `eventId`: `string`; `id`: `string`; `kind`: `string`; `ledger`: `number`; `occurredAt`: `string`; `txHash`: `string`; \}[]; `nextCursor`: `string` \| `null`; \}\>\>; `get`: (`instanceId`: `string`, `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `contractAddress`: `string` \| `null`; `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `pipeline`: \{ `contractAddress`: `string`; `nodeId`: `string`; `templateKind`: `string`; \}[]; `prepared`: \{ `expiresAt`: `string`; `feeStroops`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \} \| `null`; `serviceState`: `"ACTIVE"` \| `"RETIRING"` \| `"RETIRED"`; `sourceAccount`: `string`; `status`: `"FAILED"` \| `"DRAFT"` \| `"BUILDING"` \| `"PENDING_SIGNATURE"` \| `"SUBMITTED"` \| `"CONFIRMED"`; `templateId`: `string`; `templateVersionId`: `string`; `txHash`: `string` \| `null`; \}\>\>; `list`: (`query?`: [`InstanceListQuery`](../interfaces/InstanceListQuery.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<[`InstanceList`](../interfaces/InstanceList.md)\>\>; `prepare`: (`versionId`: `string`, `body`: [`InstancePrepareInput`](../interfaces/InstancePrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `contractAddress`: `string` \| `null`; `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `pipeline`: \{ `contractAddress`: `string`; `nodeId`: `string`; `templateKind`: `string`; \}[]; `prepared`: \{ `expiresAt`: `string`; `feeStroops`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \} \| `null`; `serviceState`: `"ACTIVE"` \| `"RETIRING"` \| `"RETIRED"`; `sourceAccount`: `string`; `status`: `"FAILED"` \| `"DRAFT"` \| `"BUILDING"` \| `"PENDING_SIGNATURE"` \| `"SUBMITTED"` \| `"CONFIRMED"`; `templateId`: `string`; `templateVersionId`: `string`; `txHash`: `string` \| `null`; \}\>\>; `reconcile`: (`instanceId`: `string`, `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `contractAddress`: `string` \| `null`; `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `pipeline`: \{ `contractAddress`: `string`; `nodeId`: `string`; `templateKind`: `string`; \}[]; `prepared`: \{ `expiresAt`: `string`; `feeStroops`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \} \| `null`; `serviceState`: `"ACTIVE"` \| `"RETIRING"` \| `"RETIRED"`; `sourceAccount`: `string`; `status`: `"FAILED"` \| `"DRAFT"` \| `"BUILDING"` \| `"PENDING_SIGNATURE"` \| `"SUBMITTED"` \| `"CONFIRMED"`; `templateId`: `string`; `templateVersionId`: `string`; `txHash`: `string` \| `null`; \}\>\>; `sign`: (`prepared`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `contractAddress`: `string` \| `null`; `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `pipeline`: \{ `contractAddress`: `string`; `nodeId`: `string`; `templateKind`: `string`; \}[]; `prepared`: \{ `expiresAt`: `string`; `feeStroops`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \} \| `null`; `serviceState`: `"ACTIVE"` \| `"RETIRING"` \| `"RETIRED"`; `sourceAccount`: `string`; `status`: `"FAILED"` \| `"DRAFT"` \| `"BUILDING"` \| `"PENDING_SIGNATURE"` \| `"SUBMITTED"` \| `"CONFIRMED"`; `templateId`: `string`; `templateVersionId`: `string`; `txHash`: `string` \| `null`; \}\>, `signer`: [`SignTransaction`](../type-aliases/SignTransaction.md), `options`: [`SignOptions`](../interfaces/SignOptions.md)) => `Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `contractAddress`: `string` \| `null`; `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `pipeline`: \{ `contractAddress`: `string`; `nodeId`: `string`; `templateKind`: `string`; \}[]; `prepared`: \{ `expiresAt`: `string`; `feeStroops`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \} \| `null`; `serviceState`: `"ACTIVE"` \| `"RETIRING"` \| `"RETIRED"`; `sourceAccount`: `string`; `status`: `"FAILED"` \| `"DRAFT"` \| `"BUILDING"` \| `"PENDING_SIGNATURE"` \| `"SUBMITTED"` \| `"CONFIRMED"`; `templateId`: `string`; `templateVersionId`: `string`; `txHash`: `string` \| `null`; \}\>; `submission`: \{ `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>; `submit`: (`instanceId`: `string`, `body`: \{ `signedXdr`: `string`; \}, `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `contractAddress`: `string` \| `null`; `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `pipeline`: \{ `contractAddress`: `string`; `nodeId`: `string`; `templateKind`: `string`; \}[]; `prepared`: \{ `expiresAt`: `string`; `feeStroops`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \} \| `null`; `serviceState`: `"ACTIVE"` \| `"RETIRING"` \| `"RETIRED"`; `sourceAccount`: `string`; `status`: `"FAILED"` \| `"DRAFT"` \| `"BUILDING"` \| `"PENDING_SIGNATURE"` \| `"SUBMITTED"` \| `"CONFIRMED"`; `templateId`: `string`; `templateVersionId`: `string`; `txHash`: `string` \| `null`; \}\>\>; \}

#### events

> **events**: (`instanceId`: `string`, `query?`: [`InstanceEventsQuery`](../interfaces/InstanceEventsQuery.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `hasMore`: `boolean`; `items`: \{ `data`: `unknown`; `eventId`: `string`; `id`: `string`; `kind`: `string`; `ledger`: `number`; `occurredAt`: `string`; `txHash`: `string`; \}[]; `nextCursor`: `string` \| `null`; \}\>\>

##### Parameters

###### instanceId

`string`

###### query?

[`InstanceEventsQuery`](../interfaces/InstanceEventsQuery.md) = `{}`

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `hasMore`: `boolean`; `items`: \{ `data`: `unknown`; `eventId`: `string`; `id`: `string`; `kind`: `string`; `ledger`: `number`; `occurredAt`: `string`; `txHash`: `string`; \}[]; `nextCursor`: `string` \| `null`; \}\>\>

#### get

> **get**: (`instanceId`: `string`, `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `contractAddress`: `string` \| `null`; `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `pipeline`: \{ `contractAddress`: `string`; `nodeId`: `string`; `templateKind`: `string`; \}[]; `prepared`: \{ `expiresAt`: `string`; `feeStroops`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \} \| `null`; `serviceState`: `"ACTIVE"` \| `"RETIRING"` \| `"RETIRED"`; `sourceAccount`: `string`; `status`: `"FAILED"` \| `"DRAFT"` \| `"BUILDING"` \| `"PENDING_SIGNATURE"` \| `"SUBMITTED"` \| `"CONFIRMED"`; `templateId`: `string`; `templateVersionId`: `string`; `txHash`: `string` \| `null`; \}\>\>

##### Parameters

###### instanceId

`string`

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `contractAddress`: `string` \| `null`; `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `pipeline`: \{ `contractAddress`: `string`; `nodeId`: `string`; `templateKind`: `string`; \}[]; `prepared`: \{ `expiresAt`: `string`; `feeStroops`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \} \| `null`; `serviceState`: `"ACTIVE"` \| `"RETIRING"` \| `"RETIRED"`; `sourceAccount`: `string`; `status`: `"FAILED"` \| `"DRAFT"` \| `"BUILDING"` \| `"PENDING_SIGNATURE"` \| `"SUBMITTED"` \| `"CONFIRMED"`; `templateId`: `string`; `templateVersionId`: `string`; `txHash`: `string` \| `null`; \}\>\>

#### list

> **list**: (`query?`: [`InstanceListQuery`](../interfaces/InstanceListQuery.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<[`InstanceList`](../interfaces/InstanceList.md)\>\>

##### Parameters

###### query?

[`InstanceListQuery`](../interfaces/InstanceListQuery.md) = `{}`

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<[`InstanceList`](../interfaces/InstanceList.md)\>\>

#### prepare

> **prepare**: (`versionId`: `string`, `body`: [`InstancePrepareInput`](../interfaces/InstancePrepareInput.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `contractAddress`: `string` \| `null`; `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `pipeline`: \{ `contractAddress`: `string`; `nodeId`: `string`; `templateKind`: `string`; \}[]; `prepared`: \{ `expiresAt`: `string`; `feeStroops`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \} \| `null`; `serviceState`: `"ACTIVE"` \| `"RETIRING"` \| `"RETIRED"`; `sourceAccount`: `string`; `status`: `"FAILED"` \| `"DRAFT"` \| `"BUILDING"` \| `"PENDING_SIGNATURE"` \| `"SUBMITTED"` \| `"CONFIRMED"`; `templateId`: `string`; `templateVersionId`: `string`; `txHash`: `string` \| `null`; \}\>\>

##### Parameters

###### versionId

`string`

###### body

[`InstancePrepareInput`](../interfaces/InstancePrepareInput.md)

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `contractAddress`: `string` \| `null`; `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `pipeline`: \{ `contractAddress`: `string`; `nodeId`: `string`; `templateKind`: `string`; \}[]; `prepared`: \{ `expiresAt`: `string`; `feeStroops`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \} \| `null`; `serviceState`: `"ACTIVE"` \| `"RETIRING"` \| `"RETIRED"`; `sourceAccount`: `string`; `status`: `"FAILED"` \| `"DRAFT"` \| `"BUILDING"` \| `"PENDING_SIGNATURE"` \| `"SUBMITTED"` \| `"CONFIRMED"`; `templateId`: `string`; `templateVersionId`: `string`; `txHash`: `string` \| `null`; \}\>\>

#### reconcile

> **reconcile**: (`instanceId`: `string`, `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `contractAddress`: `string` \| `null`; `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `pipeline`: \{ `contractAddress`: `string`; `nodeId`: `string`; `templateKind`: `string`; \}[]; `prepared`: \{ `expiresAt`: `string`; `feeStroops`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \} \| `null`; `serviceState`: `"ACTIVE"` \| `"RETIRING"` \| `"RETIRED"`; `sourceAccount`: `string`; `status`: `"FAILED"` \| `"DRAFT"` \| `"BUILDING"` \| `"PENDING_SIGNATURE"` \| `"SUBMITTED"` \| `"CONFIRMED"`; `templateId`: `string`; `templateVersionId`: `string`; `txHash`: `string` \| `null`; \}\>\>

##### Parameters

###### instanceId

`string`

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `contractAddress`: `string` \| `null`; `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `pipeline`: \{ `contractAddress`: `string`; `nodeId`: `string`; `templateKind`: `string`; \}[]; `prepared`: \{ `expiresAt`: `string`; `feeStroops`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \} \| `null`; `serviceState`: `"ACTIVE"` \| `"RETIRING"` \| `"RETIRED"`; `sourceAccount`: `string`; `status`: `"FAILED"` \| `"DRAFT"` \| `"BUILDING"` \| `"PENDING_SIGNATURE"` \| `"SUBMITTED"` \| `"CONFIRMED"`; `templateId`: `string`; `templateVersionId`: `string`; `txHash`: `string` \| `null`; \}\>\>

#### sign

> **sign**: (`prepared`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `contractAddress`: `string` \| `null`; `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `pipeline`: \{ `contractAddress`: `string`; `nodeId`: `string`; `templateKind`: `string`; \}[]; `prepared`: \{ `expiresAt`: `string`; `feeStroops`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \} \| `null`; `serviceState`: `"ACTIVE"` \| `"RETIRING"` \| `"RETIRED"`; `sourceAccount`: `string`; `status`: `"FAILED"` \| `"DRAFT"` \| `"BUILDING"` \| `"PENDING_SIGNATURE"` \| `"SUBMITTED"` \| `"CONFIRMED"`; `templateId`: `string`; `templateVersionId`: `string`; `txHash`: `string` \| `null`; \}\>, `signer`: [`SignTransaction`](../type-aliases/SignTransaction.md), `options`: [`SignOptions`](../interfaces/SignOptions.md)) => `Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `contractAddress`: `string` \| `null`; `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `pipeline`: \{ `contractAddress`: `string`; `nodeId`: `string`; `templateKind`: `string`; \}[]; `prepared`: \{ `expiresAt`: `string`; `feeStroops`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \} \| `null`; `serviceState`: `"ACTIVE"` \| `"RETIRING"` \| `"RETIRED"`; `sourceAccount`: `string`; `status`: `"FAILED"` \| `"DRAFT"` \| `"BUILDING"` \| `"PENDING_SIGNATURE"` \| `"SUBMITTED"` \| `"CONFIRMED"`; `templateId`: `string`; `templateVersionId`: `string`; `txHash`: `string` \| `null`; \}\>; `submission`: \{ `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>

Sign the retained exact preparation once. This helper never submits or polls.

##### Parameters

###### prepared

[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `contractAddress`: `string` \| `null`; `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `pipeline`: \{ `contractAddress`: `string`; `nodeId`: `string`; `templateKind`: `string`; \}[]; `prepared`: \{ `expiresAt`: `string`; `feeStroops`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \} \| `null`; `serviceState`: `"ACTIVE"` \| `"RETIRING"` \| `"RETIRED"`; `sourceAccount`: `string`; `status`: `"FAILED"` \| `"DRAFT"` \| `"BUILDING"` \| `"PENDING_SIGNATURE"` \| `"SUBMITTED"` \| `"CONFIRMED"`; `templateId`: `string`; `templateVersionId`: `string`; `txHash`: `string` \| `null`; \}\>

###### signer

[`SignTransaction`](../type-aliases/SignTransaction.md)

###### options

[`SignOptions`](../interfaces/SignOptions.md)

##### Returns

`Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `contractAddress`: `string` \| `null`; `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `pipeline`: \{ `contractAddress`: `string`; `nodeId`: `string`; `templateKind`: `string`; \}[]; `prepared`: \{ `expiresAt`: `string`; `feeStroops`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \} \| `null`; `serviceState`: `"ACTIVE"` \| `"RETIRING"` \| `"RETIRED"`; `sourceAccount`: `string`; `status`: `"FAILED"` \| `"DRAFT"` \| `"BUILDING"` \| `"PENDING_SIGNATURE"` \| `"SUBMITTED"` \| `"CONFIRMED"`; `templateId`: `string`; `templateVersionId`: `string`; `txHash`: `string` \| `null`; \}\>; `submission`: \{ `signedXdr`: `string`; \}; `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>

#### submit

> **submit**: (`instanceId`: `string`, `body`: \{ `signedXdr`: `string`; \}, `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `contractAddress`: `string` \| `null`; `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `pipeline`: \{ `contractAddress`: `string`; `nodeId`: `string`; `templateKind`: `string`; \}[]; `prepared`: \{ `expiresAt`: `string`; `feeStroops`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \} \| `null`; `serviceState`: `"ACTIVE"` \| `"RETIRING"` \| `"RETIRED"`; `sourceAccount`: `string`; `status`: `"FAILED"` \| `"DRAFT"` \| `"BUILDING"` \| `"PENDING_SIGNATURE"` \| `"SUBMITTED"` \| `"CONFIRMED"`; `templateId`: `string`; `templateVersionId`: `string`; `txHash`: `string` \| `null`; \}\>\>

##### Parameters

###### instanceId

`string`

###### body

###### signedXdr

`string`

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `contractAddress`: `string` \| `null`; `deploymentId`: `string`; `network`: `"testnet"` \| `"mainnet"`; `pipeline`: \{ `contractAddress`: `string`; `nodeId`: `string`; `templateKind`: `string`; \}[]; `prepared`: \{ `expiresAt`: `string`; `feeStroops`: `string`; `networkPassphrase`: `"Test SDF Network ; September 2015"` \| `"Public Global Stellar Network ; September 2015"`; `txHash`: `string`; `xdr`: `string`; \} \| `null`; `serviceState`: `"ACTIVE"` \| `"RETIRING"` \| `"RETIRED"`; `sourceAccount`: `string`; `status`: `"FAILED"` \| `"DRAFT"` \| `"BUILDING"` \| `"PENDING_SIGNATURE"` \| `"SUBMITTED"` \| `"CONFIRMED"`; `templateId`: `string`; `templateVersionId`: `string`; `txHash`: `string` \| `null`; \}\>\>

---

### templateId

> `readonly` **templateId**: `string`
