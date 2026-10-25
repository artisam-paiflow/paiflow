[**@paiflow/sdk — method and type reference**](../README.md)

---

[@paiflow/sdk — method and type reference](../README.md) / signPrepared

# Function: signPrepared()

> **signPrepared**\<`T` _extends_ [`PreparedEnvelope`](../interfaces/PreparedEnvelope.md)\>(`prepared`: [`ApiResponse`](../interfaces/ApiResponse.md)\<`T`\>, `signer`: [`SignTransaction`](../type-aliases/SignTransaction.md), `options`: [`SignOptions`](../interfaces/SignOptions.md)): `Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<`T`\>; `submission`: [`SignedSubmission`](../interfaces/SignedSubmission.md); `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>

Sign a saved execute/public-payment preparation once, without submitting.

## Type Parameters

### T

`T` _extends_ [`PreparedEnvelope`](../interfaces/PreparedEnvelope.md)

## Parameters

### prepared

[`ApiResponse`](../interfaces/ApiResponse.md)\<`T`\>

Original API response, retained with its history metadata.

### signer

[`SignTransaction`](../type-aliases/SignTransaction.md)

Wallet callback that signs the unchanged original envelope.

### options

[`SignOptions`](../interfaces/SignOptions.md)

Wallet/network checks, cancellation and a signing deadline.

## Returns

`Promise`\<\{ `preparation`: [`ApiResponse`](../interfaces/ApiResponse.md)\<`T`\>; `submission`: [`SignedSubmission`](../interfaces/SignedSubmission.md); `submissionOptions`: [`RequestOptions`](../interfaces/RequestOptions.md); \}\>

Original preparation plus signed submission and preparation-history correlation.

## Remarks

This helper does not parse XDR or prove order price, recipients or finality.
