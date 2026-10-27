[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / Paiflow

# Class: Paiflow

Node-only client. Construction never requests a demo token or opens a connection.

## Constructors

### Constructor

> **new Paiflow**(`options`: [`PaiflowOptions`](../interfaces/PaiflowOptions.md)): `Paiflow`

#### Parameters

##### options

[`PaiflowOptions`](../interfaces/PaiflowOptions.md)

#### Returns

`Paiflow`

## Properties

### deployments

> `readonly` **deployments**: \{ `list`: (`query?`: [`ListDeploymentsQuery`](../interfaces/ListDeploymentsQuery.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `items`: \{ `flowName`: `string`; `id`: `string`; `network`: `"testnet"` \| `"mainnet"`; \}[]; `nextCursor`: `string` \| `null`; \}\>\>; `pages`: (`query?`: [`ListDeploymentsQuery`](../interfaces/ListDeploymentsQuery.md), `options?`: [`DeploymentPagesOptions`](../interfaces/DeploymentPagesOptions.md)) => `AsyncGenerator`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `items`: \{ `flowName`: `string`; `id`: `string`; `network`: `"testnet"` \| `"mainnet"`; \}[]; `nextCursor`: `string` \| `null`; \}\>\>; \}

Scoped list and bounded pages. Selection changes apply to subsequent requests.

#### list

> **list**: (`query?`: [`ListDeploymentsQuery`](../interfaces/ListDeploymentsQuery.md), `options?`: [`RequestOptions`](../interfaces/RequestOptions.md)) => `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `items`: \{ `flowName`: `string`; `id`: `string`; `network`: `"testnet"` \| `"mainnet"`; \}[]; `nextCursor`: `string` \| `null`; \}\>\>

##### Parameters

###### query?

[`ListDeploymentsQuery`](../interfaces/ListDeploymentsQuery.md) = `{}`

###### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

##### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `items`: \{ `flowName`: `string`; `id`: `string`; `network`: `"testnet"` \| `"mainnet"`; \}[]; `nextCursor`: `string` \| `null`; \}\>\>

#### pages

> **pages**: (`query?`: [`ListDeploymentsQuery`](../interfaces/ListDeploymentsQuery.md), `options?`: [`DeploymentPagesOptions`](../interfaces/DeploymentPagesOptions.md)) => `AsyncGenerator`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `items`: \{ `flowName`: `string`; `id`: `string`; `network`: `"testnet"` \| `"mainnet"`; \}[]; `nextCursor`: `string` \| `null`; \}\>\>

##### Parameters

###### query?

[`ListDeploymentsQuery`](../interfaces/ListDeploymentsQuery.md) = `{}`

###### options?

[`DeploymentPagesOptions`](../interfaces/DeploymentPagesOptions.md) = `{}`

##### Returns

`AsyncGenerator`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `items`: \{ `flowName`: `string`; `id`: `string`; `network`: `"testnet"` \| `"mainnet"`; \}[]; `nextCursor`: `string` \| `null`; \}\>\>

---

### transport

> `readonly` **transport**: [`PaiflowTransport`](PaiflowTransport.md)

## Methods

### createDemoToken()

> **createDemoToken**(`options?`: [`RequestOptions`](../interfaces/RequestOptions.md)): `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `deploymentId`: `string`; `expiresAt`: `string`; `token`: `string`; \}\>\>

Explicit opt-in to anonymous short-lived demo-token creation. Never retried.

#### Parameters

##### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

#### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `deploymentId`: `string`; `expiresAt`: `string`; `token`: `string`; \}\>\>

---

### deployment()

> **deployment**(`deploymentId`: `string`): [`PaiflowDeployment`](PaiflowDeployment.md)

Bind workflow methods to an existing deployment; this does not fetch or deploy it.

#### Parameters

##### deploymentId

`string`

Existing deployment UUID explicitly allowed by the credential.

#### Returns

[`PaiflowDeployment`](PaiflowDeployment.md)

A deployment client sharing this transport.

---

### getOpenApi()

> **getOpenApi**(`options?`: [`RequestOptions`](../interfaces/RequestOptions.md)): `Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `info`: \{ `title`: `string`; `version`: `string`; \}; `openapi`: `string`; `paths`: `Record`\<`string`, `unknown`\>; \}\>\>

Read the public raw API specification without forwarding the token.

#### Parameters

##### options?

[`RequestOptions`](../interfaces/RequestOptions.md)

#### Returns

`Promise`\<[`ApiResponse`](../interfaces/ApiResponse.md)\<\{ `info`: \{ `title`: `string`; `version`: `string`; \}; `openapi`: `string`; `paths`: `Record`\<`string`, `unknown`\>; \}\>\>
