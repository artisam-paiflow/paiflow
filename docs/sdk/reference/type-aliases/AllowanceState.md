[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / AllowanceState

# Type Alias: AllowanceState

> **AllowanceState** = \{ `allowance`: `string`; `asset`: \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"native"`; `symbol?`: `undefined`; \} \| \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"known"`; `symbol`: `"USDC"`; \} \| \{ `code`: `string`; `issuer`: `string`; `kind`: `"custom"`; `symbol?`: `undefined`; \} \| `null`; `assetLabel`: `string`; `contractAddress`: `string`; `deploymentId`: `string`; `flowName`: `string`; `isCancelled`: `boolean`; `network`: `"testnet"` \| `"mainnet"`; `setupRequired`: `boolean`; `subscriber`: `string` \| `null`; `tokenContractAddress`: `string`; \}

Public subscriber state snapshot; no snapshot guarantees current eligibility.

## Properties

### allowance

> **allowance**: `string`

---

### asset

> **asset**: \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"native"`; `symbol?`: `undefined`; \} \| \{ `code?`: `undefined`; `issuer?`: `undefined`; `kind`: `"known"`; `symbol`: `"USDC"`; \} \| \{ `code`: `string`; `issuer`: `string`; `kind`: `"custom"`; `symbol?`: `undefined`; \} \| `null`

---

### assetLabel

> **assetLabel**: `string`

---

### contractAddress

> **contractAddress**: `string`

---

### deploymentId

> **deploymentId**: `string`

---

### flowName

> **flowName**: `string`

---

### isCancelled

> **isCancelled**: `boolean`

---

### network

> **network**: `"testnet"` \| `"mainnet"`

---

### setupRequired

> **setupRequired**: `boolean`

---

### subscriber

> **subscriber**: `string` \| `null`

---

### tokenContractAddress

> **tokenContractAddress**: `string`
