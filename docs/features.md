# Features

Running log of user-visible features.

## Stellar.expert explorer links

Contract addresses across the UI now link to the corresponding
[stellar.expert](https://stellar.expert) page for the deployment's network.

- Deployment detail header (`/deployments/[id]`): clicking the truncated
  contract address opens `stellar.expert/explorer/{testnet|public}/contract/{C…}`
  in a new tab.
- Deployment view (`components/deploy/deployment-view.tsx`): the full contract
  address is a link to stellar.expert; a separate copy button preserves the
  copy-to-clipboard affordance.
- Dashboard deployments row: an `open_in_new` icon next to each row opens
  stellar.expert directly without navigating into the deployment.

Network mapping is explicit: `testnet → testnet`, `mainnet → public`. If a
deployment row has an unknown network value or no contract address yet, the
link is omitted (the existing waiting state is unchanged) and a pino warning
is logged.

## Pre-launch landing & login prune

Trimmed marketing surface to a minimal, focused funnel:

- Landing nav: only logo + "Get started" CTA (removed "How it works",
  "Contracts", "Sign in").
- Hero eyebrow now reads `ZAP FOR PAYMENTS · POWERED BY STELLAR`.
- Removed the hero status line (`SYSTEM STATUS / AVG DEPLOY / RPC`) and
  the marquee `TelemetryTicker` section.
- Footer keeps only the copyright (About / Privacy / Terms links removed;
  underlying `app/about`, `app/privacy`, `app/terms` pages remain reachable).
- Contract template tiles: no more fake-address line, no "audited" wording.
- Login page: no "Forgot password?" or "Create one" links (routes still
  reachable directly).
- Login form: removed the "Sign in with passkey" affordance and the OR
  divider; `components/auth/passkey-login.tsx` stays in the tree for
  later re-wiring.
