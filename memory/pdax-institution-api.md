---
name: pdax-institution-api
description: PDAX Institution API endpoints and payload shapes for fiat off-ramp integration
metadata:
  type: reference
---

PDAX Institution API docs stored in the repo at [[docs/pdax-institution-api.md]].

Authentication: all endpoints require two headers:

- `Authorization: Bearer <access_token>`
- `id_token: <id_token>`

The app reads `OFFRAMP_ACCESS_TOKEN` and `OFFRAMP_ID_TOKEN` from env and auto-refreshes both on 401 via `PUT /pdax-institution/v1/refresh-token` using `OFFRAMP_REFRESH_TOKEN` and `OFFRAMP_USERNAME`.

Key endpoints:

- `PUT /pdax-institution/v1/refresh-token` — refresh access/id tokens
- `POST /pdax-institution/v2/trade/quote` — firm quote
- `POST /pdax-institution/v1/trade` — execute order/trade
- `POST /pdax-institution/v1/fiat/withdraw` — fiat withdrawal to beneficiary
- `GET /pdax-institution/v1/fiat/transactions` — track fiat transactions
- `POST /pdax-institution/v1/config/webhook` — register webhook URL

Webhook fiat event payload includes `identifier`, `request_id`, `reference_number`, `status` (`IN-PROGRESS`/`COMPLETED`/`FAILED`), `amount`, `asset`, `transaction_type`, `method`, `fee`.

Implementation in `lib/offramp/pdax.ts` and `lib/offramp/pdax-auth.ts` should be kept in sync with this doc.
