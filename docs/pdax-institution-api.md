# PDAX Institution API — Fiat Off-Ramp

Base URL: `https://api.pdax.ph` (confirm UAT base URL with PDAX).

## Configuration

The app defaults to a built-in mock off-ramp provider. To use the real PDAX API,
set `OFFRAMP_PROVIDER=pdax` and provide your PDAX Institution credentials:

| Env variable             | Required | Description                                        |
| ------------------------ | -------- | -------------------------------------------------- |
| `OFFRAMP_PROVIDER`       | yes      | Set to `pdax` (default is `mock`).                 |
| `OFFRAMP_API_URL`        | no       | Override base URL, e.g. PDAX UAT sandbox.          |
| `OFFRAMP_USERNAME`       | yes      | PDAX account username.                             |
| `OFFRAMP_ACCESS_TOKEN`   | yes      | Current PDAX access token.                         |
| `OFFRAMP_ID_TOKEN`       | yes      | Current PDAX id token (sent as `id_token` header). |
| `OFFRAMP_REFRESH_TOKEN`  | yes      | Used to refresh the access token when it expires.  |
| `OFFRAMP_WEBHOOK_SECRET` | no       | Secret for validating PDAX webhooks.               |

Authentication:

- All endpoints require two headers:
  - `Authorization: Bearer <access_token>`
  - `id_token: <id_token>`
- The app reads `OFFRAMP_ACCESS_TOKEN` and `OFFRAMP_ID_TOKEN` from env.
- When a request returns `401`, the app calls `PUT /pdax-institution/v1/refresh-token` (using `OFFRAMP_REFRESH_TOKEN` and `OFFRAMP_USERNAME`) to obtain a new `access_token` and `id_token`, then retries the original request once.

---

## PUT Refresh Token

Refresh an expired access token.

```http
PUT /pdax-institution/v1/refresh-token
Authorization: Bearer <current-access-token>
id_token: <current-id-token>
Content-Type: application/json
```

### Body

| Parameter      | Type   | Required | Description           |
| -------------- | ------ | -------- | --------------------- |
| `username`     | string | yes      | PDAX account username |
| `refreshToken` | string | yes      | Refresh token         |

### Response

Returns a new access token and id token (and optionally a new refresh token). The app accepts both snake_case and camelCase response keys.

Example:

```json
{
  "access_token": "<new-access-token>",
  "id_token": "<new-id-token>",
  "refresh_token": "<new-refresh-token>"
}
```

---

## POST Firm Quote v2

Get a firm quote for the desired trading pair. The quote returned by this endpoint can be accepted by calling `POST Order`.

```http
POST /pdax-institution/v2/trade/quote
Authorization: Bearer <access-token>
id_token: <id-token>
Content-Type: application/json
```

### Body

| Parameter        | Type   | Required | Description                                         |
| ---------------- | ------ | -------- | --------------------------------------------------- |
| `side`           | string | yes      | Counterparty action — `buy` or `sell`               |
| `quote_currency` | string | yes      | The crypto asset you want to buy or sell            |
| `base_currency`  | string | yes      | PHP asset                                           |
| `currency`       | string | yes      | The currency of which you want to receive           |
| `quantity`       | string | yes      | Quantity to buy or sell. Quantity step rules apply. |

### Response

| Key              | Type    | Description                                                                 |
| ---------------- | ------- | --------------------------------------------------------------------------- |
| `quote_id`       | string  | Firm quote reference ID                                                     |
| `expires_at`     | string  | Quote validity in ISO timestamp. Firm quotes are only valid for 15 seconds. |
| `quote_currency` | string  | The crypto asset you want to buy or sell                                    |
| `base_currency`  | string  | PHP asset                                                                   |
| `side`           | string  | Counterparty action — buy or sell                                           |
| `base_quantity`  | decimal | Quantity of the asset you are buying or selling                             |
| `price`          | decimal | Quoted unit price                                                           |
| `total_amount`   | decimal | Total amount                                                                |

---

## POST Order

Accept a firm quote and place an order. If successful, the trade is executed.

```http
POST /pdax-institution/v1/trade
Authorization: Bearer <access-token>
id_token: <id-token>
Content-Type: application/json
```

### Body

| Parameter        | Type   | Required | Description                            |
| ---------------- | ------ | -------- | -------------------------------------- |
| `quote_id`       | string | yes      | ID of the firm quote to accept         |
| `side`           | string | yes      | Counterparty action — `buy` or `sell`  |
| `idempotency_id` | string | yes      | User-generated UUID v4 for idempotency |

### Response

| Key              | Type    | Description                           |
| ---------------- | ------- | ------------------------------------- |
| `order_id`       | number  | Order ID                              |
| `status`         | string  | `successful`, `failed`, `IN PROGRESS` |
| `quote_currency` | string  | The crypto asset                      |
| `base_currency`  | string  | PHP asset                             |
| `side`           | string  | Counterparty action                   |
| `base_quantity`  | decimal | Order quantity as per firm quote      |
| `price`          | decimal | Quoted unit price                     |
| `total_amount`   | decimal | Total amount                          |
| `created_at`     | string  | Created time                          |
| `updated_at`     | string  | Updated time                          |

---

## POST Fiat Withdraw

Withdraw fiat from your PDAX account to yourself or a beneficiary.

```http
POST /pdax-institution/v1/fiat/withdraw
Authorization: Bearer <access-token>
id_token: <id-token>
Content-Type: application/json
```

Notes:

- For fields grouped as `a`, `b`, or `c`, provide one complete combination.
- Required fields depend on whether amount is `>= 50,000 PHP` or `< 50,000 PHP`.
- Bank code must come from PDAX's accepted bank code list.
- Channel is determined by PDAX based on amount and availability.

### Body

#### Sender

| Parameter                         | Type   | Description                                       | >= 50k       | < 50k    |
| --------------------------------- | ------ | ------------------------------------------------- | ------------ | -------- |
| `identifier`                      | String | Unique identifier supplied by client              | Required     | Required |
| `sender_first_name`               | String | Sender first name                                 | Required     | Required |
| `sender_middle_name`              | String | Sender middle name. Use `n.a.` if not applicable. | Required     | Required |
| `sender_last_name`                | String | Sender last name                                  | Required     | Required |
| `sender_country_origin`           | String | Country where sender is physically located        | Required     | Required |
| `sender_address_line_one`         | String | Address line 1                                    | a / Optional | Optional |
| `sender_address_line_two`         | String | Address line 2                                    | a / Optional | Optional |
| `sender_city`                     | String | City                                              | a / Optional | Optional |
| `sender_province`                 | String | Province                                          | a / Optional | Optional |
| `sender_country`                  | String | Country                                           | a / Optional | Optional |
| `sender_zip_code`                 | String | Zip code                                          | Optional     | Optional |
| `sender_phone_number`             | String | Phone number                                      | Optional     | Optional |
| `sender_nationality`              | String | Nationality                                       | Optional     | Optional |
| `sender_national_identity_number` | String | National ID / government ID                       | b / Optional | Optional |
| `sender_dob`                      | String | Date of birth, `mm-dd-yyyy`                       | c / Optional | Optional |
| `sender_place_of_birth`           | String | Place of birth                                    | c / Optional | Optional |
| `source_of_funds`                 | String | Source of funds                                   | Required     | Required |
| `sender_email`                    | String | Email                                             | Optional     | Optional |

#### Beneficiary

| Parameter                          | Type   | Description                                       | >= 50k   | < 50k    |
| ---------------------------------- | ------ | ------------------------------------------------- | -------- | -------- |
| `fee_type`                         | String | `SENDER` or `BENEFICIARY` — who shoulders the fee | Required | Required |
| `beneficiary_first_name`           | String | Beneficiary first name                            | Required | Required |
| `beneficiary_middle_name`          | String | Use `n.a.` if not applicable                      | Required | Required |
| `beneficiary_last_name`            | String | Beneficiary last name                             | Required | Required |
| `beneficiary_sex`                  | String | Sex                                               | Optional | Optional |
| `beneficiary_nationality`          | String | Nationality                                       | Optional | Optional |
| `beneficiary_dob`                  | String | Date of birth                                     | Optional | Optional |
| `beneficiary_bank_code`            | String | PDAX bank code                                    | Required | Required |
| `beneficiary_account_name`         | String | Bank account name                                 | Required | Required |
| `beneficiary_account_number`       | String | Bank account number                               | Required | Required |
| `beneficiary_address_line_one`     | String | Address line 1                                    | Optional | Optional |
| `beneficiary_address_line_two`     | String | Address line 2                                    | Optional | Optional |
| `beneficiary_barangay`             | String | Barangay                                          | Optional | Optional |
| `beneficiary_city`                 | String | City                                              | Optional | Optional |
| `beneficiary_province`             | String | Province                                          | Optional | Optional |
| `beneficiary_country`              | String | Country                                           | Optional | Optional |
| `beneficiary_zip_code`             | String | Zip code                                          | Optional | Optional |
| `beneficiary_government_issued_id` | String | Government ID number                              | Optional | Optional |
| `beneficiary_phone_number`         | String | Phone number                                      | Optional | Optional |

#### Transaction

| Parameter                               | Type   | Description                                                  | >= 50k   | < 50k    |
| --------------------------------------- | ------ | ------------------------------------------------------------ | -------- | -------- |
| `purpose`                               | String | Purpose of transaction                                       | Required | Required |
| `relationship_of_sender_to_beneficiary` | String | Relationship                                                 | Required | Required |
| `currency`                              | String | Only `PHP` supported                                         | Required | Required |
| `amount`                                | String | Fiat withdrawal amount                                       | Required | Required |
| `nature_of_business`                    | String | Nature of business of beneficiary                            | Optional | Optional |
| `method`                                | String | `PAY-TO-ACCOUNT-REAL-TIME` or `PAY-TO-ACCOUNT-NON-REAL-TIME` | Required | Required |
| `instructions`                          | String | Other instructions                                           | Optional | Optional |

### Response

| Parameter          | Type    | Description                          |
| ------------------ | ------- | ------------------------------------ |
| `request_id`       | string  | Request ID for the transaction       |
| `identifier`       | string  | Unique identifier supplied by client |
| `reference_number` | string  | Reference number                     |
| `amount`           | decimal | Fiat withdrawal amount               |
| `method`           | string  | Chosen method                        |
| `fee`              | decimal | Fee                                  |
| `status`           | string  | `PENDING`                            |
| `retry_methods`    | string  | Attempted payment channels           |

---

## GET Fiat Transactions

Track fiat deposits and withdrawals by identifier or mode.

```http
GET /pdax-institution/v1/fiat/transactions?mode=CashOut&identifier=<identifier>&page=1&pageSize=10
Authorization: Bearer <access-token>
id_token: <id-token>
```

### Query parameters

| Parameter    | Type   | Required | Description                          |
| ------------ | ------ | -------- | ------------------------------------ |
| `mode`       | string | no       | `CashIn` or `CashOut`                |
| `identifier` | string | no       | Unique identifier supplied by client |
| `page`       | number | no       | Page index                           |
| `pageSize`   | number | no       | Items per page                       |

### Response

| Parameter          | Type           | Description                          |
| ------------------ | -------------- | ------------------------------------ |
| `request_id`       | string         | Request ID                           |
| `transaction_id`   | number         | Transaction ID                       |
| `amount`           | string         | Amount                               |
| `fee`              | string?        | PDAX fee                             |
| `method`           | string         | Method used                          |
| `mode`             | string         | `cashIn` / `cashOut`                 |
| `reference_number` | string         | Reference number                     |
| `fulfilled_at`     | string         | If set, transaction succeeded        |
| `declined_at`      | string         | If set, transaction failed           |
| `rejection_reason` | string         | Reason if failed                     |
| `currency`         | string         | Currency                             |
| `created_at`       | string         | Created timestamp                    |
| `updated_at`       | string         | Updated timestamp                    |
| `status`           | string         | `IN-PROGRESS`, `COMPLETED`, `FAILED` |
| `identifier`       | string         | Client identifier                    |
| `fee_type`         | string \| null | `SENDER` or `BENEFICIARY`            |
| `retried_methods`  | array          | Attempts per transaction             |

---

## Webhook registration

Register your URL to receive webhook events for fiat transactions.

```http
POST /pdax-institution/v1/config/webhook
Authorization: Bearer <access-token>
id_token: <id-token>
Content-Type: application/json
```

### Body

| Parameter          | Type   | Required | Description                    |
| ------------------ | ------ | -------- | ------------------------------ |
| `event_type`       | string | yes      | `fiat`                         |
| `webhook_endpoint` | string | yes      | Your deployed webhook endpoint |

### Webhook payload — Fiat Event Data

| Parameter          | Type    | Description                                         |
| ------------------ | ------- | --------------------------------------------------- |
| `identifier`       | String  | Unique identifier supplied by client                |
| `user_id`          | String  | UUID of the user                                    |
| `request_id`       | String  | Request ID                                          |
| `reference_number` | String  | Reference number from withdraw response             |
| `amount`           | Decimal | Amount being withdrawn or deposited, excluding fees |
| `asset`            | String  | Fiat currency                                       |
| `asset_type`       | String  | `PHP` only                                          |
| `transaction_type` | String  | `WITHDRAWAL` or `DEPOSIT`                           |
| `status`           | String  | `IN-PROGRESS`, `COMPLETED`, `FAILED`                |
| `method`           | String  | Method used                                         |
| `fee`              | Decimal | Fee                                                 |
