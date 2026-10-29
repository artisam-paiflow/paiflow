# API v1 developer token permissions

Developer credentials (`pfd_`) authorize only explicitly selected existing deployments that are still confirmed, active and owned by the active non-sandbox token owner. New deployments require explicit grants. Legacy deployment credentials (`pfk_`) keep their existing single-deployment behavior. Neither family authorizes owner-session payroll management or flow/deployment creation. Legacy `pkdev_` authentication was removed in #1138.

`READ_ONLY` allows the reads below. `READ_OPERATE` allows every listed operation. An unlisted operation fails closed until explicitly classified. Wallet signatures, webhook secrets, deployment capability restrictions and retirement admission still apply. Reconciliation is an operate permission even though its response contains status; ordinary transaction-status reads are available to read-only credentials.

For deployment operations, append the listed path to `/api/v1/deployments/{id}/`. `GET deployments` is the scoped collection `/api/v1/deployments`. Grants are checked before domain/RPC/relayer work. Invalid or ungranted deployment access returns the same generic 401; an authorized read-only credential attempting an operate request returns 403. Authenticated refusals consume the shared per-token endpoint allowance and can return 429. Removing access affects subsequent requests and retains existing transaction/finality evidence.

| Operation                                | Minimum permission |
| ---------------------------------------- | ------------------ |
| `GET balances`                           | `READ_ONLY`        |
| `GET capabilities`                       | `READ_ONLY`        |
| `GET events`                             | `READ_ONLY`        |
| `GET funding`                            | `READ_ONLY`        |
| `GET schedule/state`                     | `READ_ONLY`        |
| `GET subscription/state`                 | `READ_ONLY`        |
| `GET swap-quote`                         | `READ_ONLY`        |
| `GET transactions/:txHash`               | `READ_ONLY`        |
| `POST execute`                           | `READ_OPERATE`     |
| `POST execute/submit`                    | `READ_OPERATE`     |
| `POST funding`                           | `READ_OPERATE`     |
| `POST funding/reconcile`                 | `READ_OPERATE`     |
| `POST funding/submit`                    | `READ_OPERATE`     |
| `POST release-early`                     | `READ_OPERATE`     |
| `POST schedule/pause`                    | `READ_OPERATE`     |
| `POST schedule/pause/reconcile`          | `READ_OPERATE`     |
| `POST schedule/pause/submit`             | `READ_OPERATE`     |
| `POST schedule/resume`                   | `READ_OPERATE`     |
| `POST schedule/resume/reconcile`         | `READ_OPERATE`     |
| `POST schedule/resume/submit`            | `READ_OPERATE`     |
| `POST schedule/retrieve`                 | `READ_OPERATE`     |
| `POST schedule/retrieve/reconcile`       | `READ_OPERATE`     |
| `POST schedule/retrieve/submit`          | `READ_OPERATE`     |
| `POST subscription/cancel/prepare`       | `READ_OPERATE`     |
| `POST subscription/cancel/reconcile`     | `READ_OPERATE`     |
| `POST subscription/cancel/submit`        | `READ_OPERATE`     |
| `POST subscription/reactivate/prepare`   | `READ_OPERATE`     |
| `POST subscription/reactivate/reconcile` | `READ_OPERATE`     |
| `POST subscription/reactivate/submit`    | `READ_OPERATE`     |
| `GET deployments`                        | `READ_ONLY`        |
