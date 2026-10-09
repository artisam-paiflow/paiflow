# Public embed payment links and live events — #577

The public embed uses the explicit server projection introduced in #789. All
viewers, including owners, other teams and sandbox users, receive the same safe
display data. Owner APIs and controls remain authenticated; the balance panel is
omitted. No public read calls a relayer execution endpoint.

## Public read paths

Only confirmed deployments with a contract address and valid graph are served.
Malformed ids, missing deployments and unconfirmed deployments return 404.

| Path under `/api/deployments/:id/embed` | Response                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `/events`                               | SSE `connected` and `snapshot` events, plus heartbeat comments                 |
| `/activity`                             | JSON `{ data: { events: [...] } }` catch-up/fallback                           |
| `/qr`                                   | Fixed-size SVG QR encoding the customer payment-page URL on the request origin |

Initial history, snapshots and catch-up expose only event identity, kind, ledger,
transaction hash, timestamp and a validated integer amount string. Graph configs,
pipeline metadata, webhook secrets, API tokens, notification/contact addresses,
KYC/bank fields and raw event payloads never cross the public-data boundary.

The QR points to `/trigger/:id`, where the customer reviews and signs with their
wallet. It never encodes an owner-source invocation or allowance transaction.
The public QR endpoint rejects query parameters, including `action`. Eligibility
uses the deployed pipeline root: Receive supports payments; Webhook supports
funding; Streamer supports funding. Legacy standalone Splitter and Streamer are
also supported. Unknown networks and other pipeline roots omit payment controls;
the QR route returns 404. A webhook top-up does not execute a reward. Subscription
approval remains separate under #790.

## Bounded ingestion and connection lifecycle

- Public reads use a 600-request/minute IP bucket before database lookup; SSE
  connection attempts also use a 120-attempt/minute IP bucket. Varying the
  deployment id cannot create fresh IP allowances. Rejections include Retry-After.
- SSE admission atomically checks shared Redis caps: 200 total streams,
  40 per IP and 60 per deployment. Limits accommodate multiple teams behind
  a shared IP. Admission fails closed if Redis is unavailable. The client's
  periodic JSON reads still work under the ordinary rate limiter, whose existing
  outage fallback is per process/replica.
- Each stream owns its Redis subscriber. Cancellation, request abort, connection
  failure/drop, slow-reader backpressure and a 55-second lifetime all close the
  subscriber and release its slots. Dead-process slots expire after 70 seconds.
- Redis messages only prompt a database refresh; their unrestricted contents are
  never forwarded. Subscribe happens before catch-up. A stream coalesces overlapping
  refresh requests and checks stored events every 15 seconds while open.
- Refreshes reuse `refreshEventsIfStale`, including v1's per-deployment in-process
  coalescing, Redis lease, 10-second freshness throttle and five-second read wait.
  Public viewers cannot each start an independent unbounded RPC poll. Existing
  ingestion and event-cursor rules remain unchanged; cron polling continues.
- The client merges recent snapshots by `eventId`, sorts newest-first and retains
  at most 50 events. It preserves distinct same-kind payouts in one transaction.
  Reconnects read recent stored history; this is a recent-activity display, not
  a paginated audit log. Owner/v1 history remains separate.
- On disconnect, the client retries SSE after 30 seconds and reads JSON every
  15 seconds, backing off on 429. Hidden tabs release their connections and resume
  with catch-up when visible. LIVE means the stream is connected; it does not
  guarantee that the event indexer has reached the chain tip. UPDATING indicates
  periodic fallback reads.

## Local checks and remaining live verification

Use the [running manual verification queue](hackathon/manual-verifications.md)
after promotion. Source changes and synthetic local fixtures do not establish a
successful live wallet payment or deployed-environment readiness.

The dedicated local browser test uses an isolated database whose name starts with
`public_embed_`, local Redis, synthetic accounts and a synthetic event notification.
It never signs/submits an on-chain transaction. Start a built local app with the
same disposable database, Redis URL and synthetic auth secret, then run:

```sh
PUBLIC_EMBED_LOCAL_TEST=1 pnpm exec playwright test --config playwright.public-embed.config.ts
```

Set `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`, and optionally
`PLAYWRIGHT_BASE_URL`/`CHROMIUM_PATH` in that local validation environment. The
test checks real HTML/RSC, QR rendering and the customer page in a separate browser,
anonymous/other-team/sandbox/owner public views, stored-event updates without reload,
reload catch-up, private-route refusal, and shared-slot cleanup.

External starter/sample AI-context copies and the participant PDF still need
synchronization with the verified promoted build. Event Plan reconciliation
remains on hold. The actual donation/dues payout rehearsal is pending.

Local validation on October 7, 2026 passed typecheck, production build, dependency
audit and all 3,469 tests in 237 files with four workers. An existing swap-panel
test timed out under the default parallel load; the complete four-worker run passed.
The browser check used a production build, disposable PostgreSQL
and Redis, and Chromium. The browser test passed in five contexts (anonymous,
authenticated other-team/sandbox/owner, and a separate mobile-sized customer).
Real HTML/RSC, rendered QR, customer-page access, simulated event ingestion,
reload catch-up, private-route refusal and slot cleanup passed. Actual Redis
admission checks reached each of the 40/IP, 60/deployment and 200/total caps,
rejected the next admission, and released all slots. These results do not record
an actual wallet signature or on-chain payout.
