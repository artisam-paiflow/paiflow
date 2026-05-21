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
