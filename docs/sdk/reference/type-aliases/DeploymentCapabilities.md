[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / DeploymentCapabilities

# Type Alias: DeploymentCapabilities

> **DeploymentCapabilities** = \{ `configurationSource`: `"deployment_snapshot"`; `deploymentId`: `string`; `inputAsset`: \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"native"`; `symbol?`: `undefined`; \} \| \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"known"`; `symbol`: `"USDC"`; \} \| \{ `code`: `string`; `issuer`: `string`; `kind`: `"custom"`; `symbol?`: `undefined`; \} \| `null`; `network`: `"testnet"` \| `"mainnet"`; `operations`: \{ `balances`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `events`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `execute`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `funding`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `payouts`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `releaseEarly`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `scheduleControls`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `scheduleState`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `subscriptionAllowance`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `subscriptionCancel`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `subscriptionReactivate`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `subscriptionState`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `swapQuote`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `transactions`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `webhook`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; \}; `triggerType`: `"unknown"` \| `"deposit"` \| `"webhook"` \| `"subscription"` \| `"payroll"` \| `"schedule"` \| `"oracle"`; \}

Supported/conditional integration operations; not proof of live readiness.

## Properties

### configurationSource

> **configurationSource**: `"deployment_snapshot"`

---

### deploymentId

> **deploymentId**: `string`

---

### inputAsset

> **inputAsset**: \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"native"`; `symbol?`: `undefined`; \} \| \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"known"`; `symbol`: `"USDC"`; \} \| \{ `code`: `string`; `issuer`: `string`; `kind`: `"custom"`; `symbol?`: `undefined`; \} \| `null`

---

### network

> **network**: `"testnet"` \| `"mainnet"`

---

### operations

> **operations**: \{ `balances`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `events`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `execute`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `funding`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `payouts`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `releaseEarly`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `scheduleControls`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `scheduleState`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `subscriptionAllowance`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `subscriptionCancel`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `subscriptionReactivate`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `subscriptionState`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `swapQuote`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `transactions`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; `webhook`: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}; \}

#### balances

> **balances**: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}

##### balances.authentication

> **authentication**: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`

##### balances.nodeIds

> **nodeIds**: `string`[]

##### balances.requirements

> **requirements**: `string`[]

##### balances.status

> **status**: `"conditional"` \| `"supported"` \| `"unsupported"`

#### events

> **events**: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}

##### events.authentication

> **authentication**: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`

##### events.nodeIds

> **nodeIds**: `string`[]

##### events.requirements

> **requirements**: `string`[]

##### events.status

> **status**: `"conditional"` \| `"supported"` \| `"unsupported"`

#### execute

> **execute**: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}

##### execute.authentication

> **authentication**: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`

##### execute.nodeIds

> **nodeIds**: `string`[]

##### execute.requirements

> **requirements**: `string`[]

##### execute.status

> **status**: `"conditional"` \| `"supported"` \| `"unsupported"`

#### funding

> **funding**: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}

##### funding.authentication

> **authentication**: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`

##### funding.nodeIds

> **nodeIds**: `string`[]

##### funding.requirements

> **requirements**: `string`[]

##### funding.status

> **status**: `"conditional"` \| `"supported"` \| `"unsupported"`

#### payouts

> **payouts**: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}

##### payouts.authentication

> **authentication**: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`

##### payouts.nodeIds

> **nodeIds**: `string`[]

##### payouts.requirements

> **requirements**: `string`[]

##### payouts.status

> **status**: `"conditional"` \| `"supported"` \| `"unsupported"`

#### releaseEarly

> **releaseEarly**: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}

##### releaseEarly.authentication

> **authentication**: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`

##### releaseEarly.nodeIds

> **nodeIds**: `string`[]

##### releaseEarly.requirements

> **requirements**: `string`[]

##### releaseEarly.status

> **status**: `"conditional"` \| `"supported"` \| `"unsupported"`

#### scheduleControls

> **scheduleControls**: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}

##### scheduleControls.authentication

> **authentication**: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`

##### scheduleControls.nodeIds

> **nodeIds**: `string`[]

##### scheduleControls.requirements

> **requirements**: `string`[]

##### scheduleControls.status

> **status**: `"conditional"` \| `"supported"` \| `"unsupported"`

#### scheduleState

> **scheduleState**: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}

##### scheduleState.authentication

> **authentication**: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`

##### scheduleState.nodeIds

> **nodeIds**: `string`[]

##### scheduleState.requirements

> **requirements**: `string`[]

##### scheduleState.status

> **status**: `"conditional"` \| `"supported"` \| `"unsupported"`

#### subscriptionAllowance

> **subscriptionAllowance**: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}

##### subscriptionAllowance.authentication

> **authentication**: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`

##### subscriptionAllowance.nodeIds

> **nodeIds**: `string`[]

##### subscriptionAllowance.requirements

> **requirements**: `string`[]

##### subscriptionAllowance.status

> **status**: `"conditional"` \| `"supported"` \| `"unsupported"`

#### subscriptionCancel

> **subscriptionCancel**: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}

##### subscriptionCancel.authentication

> **authentication**: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`

##### subscriptionCancel.nodeIds

> **nodeIds**: `string`[]

##### subscriptionCancel.requirements

> **requirements**: `string`[]

##### subscriptionCancel.status

> **status**: `"conditional"` \| `"supported"` \| `"unsupported"`

#### subscriptionReactivate

> **subscriptionReactivate**: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}

##### subscriptionReactivate.authentication

> **authentication**: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`

##### subscriptionReactivate.nodeIds

> **nodeIds**: `string`[]

##### subscriptionReactivate.requirements

> **requirements**: `string`[]

##### subscriptionReactivate.status

> **status**: `"conditional"` \| `"supported"` \| `"unsupported"`

#### subscriptionState

> **subscriptionState**: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}

##### subscriptionState.authentication

> **authentication**: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`

##### subscriptionState.nodeIds

> **nodeIds**: `string`[]

##### subscriptionState.requirements

> **requirements**: `string`[]

##### subscriptionState.status

> **status**: `"conditional"` \| `"supported"` \| `"unsupported"`

#### swapQuote

> **swapQuote**: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}

##### swapQuote.authentication

> **authentication**: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`

##### swapQuote.nodeIds

> **nodeIds**: `string`[]

##### swapQuote.requirements

> **requirements**: `string`[]

##### swapQuote.status

> **status**: `"conditional"` \| `"supported"` \| `"unsupported"`

#### transactions

> **transactions**: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}

##### transactions.authentication

> **authentication**: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`

##### transactions.nodeIds

> **nodeIds**: `string`[]

##### transactions.requirements

> **requirements**: `string`[]

##### transactions.status

> **status**: `"conditional"` \| `"supported"` \| `"unsupported"`

#### webhook

> **webhook**: \{ `authentication`: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`; `nodeIds`: `string`[]; `requirements`: `string`[]; `status`: `"conditional"` \| `"supported"` \| `"unsupported"`; \}

##### webhook.authentication

> **authentication**: `"deployment_token"` \| `"webhook_secret"` \| `"subscriber_wallet"`

##### webhook.nodeIds

> **nodeIds**: `string`[]

##### webhook.requirements

> **requirements**: `string`[]

##### webhook.status

> **status**: `"conditional"` \| `"supported"` \| `"unsupported"`

---

### triggerType

> **triggerType**: `"unknown"` \| `"deposit"` \| `"webhook"` \| `"subscription"` \| `"payroll"` \| `"schedule"` \| `"oracle"`
