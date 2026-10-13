# WalletConnect SDK compatibility

Tracked by [#938](https://github.com/webnxt-2030/pinkraft/issues/938).

Paiflow uses Stellar Wallets Kit 1.9.5 with a shared WalletConnect Sign Client,
not Reown AppKit. The compatible dependency refresh pins Sign Client to 2.26.0
and WalletConnect Modal to 2.7.0. Scoped pnpm overrides make the kit resolve these
same versions: its published dependencies otherwise pin Sign Client 2.11.2 and
Modal 2.6.2. They do not replace unrelated packages or change wallet selection,
Stellar namespaces, session persistence, or signing/submission semantics.

Modal 2.7.0 is the latest legacy Modal release and is deprecated. It is retained
because the existing kit accepts its `openModal`/`closeModal` interface. Replacing
it with AppKit Core, or upgrading to the wallet kit's v2 API, requires a separate
architecture review and wallet compatibility validation. Updating Sign Client
does not guarantee that Reown's dashboard stops recommending AppKit.

Sources checked on 13 October 2026:

- [Official Sign Client releases](https://github.com/WalletConnect/walletconnect-monorepo/releases)
- [Official legacy Modal repository](https://github.com/WalletConnect/modal)
- [Reown Modal migration guide](https://docs.reown.com/appkit/upgrade/wcm)
- Published npm package metadata for the three dependencies.

Sign Client 2.26.0 uses `relay.walletconnect.org`,
`verify.walletconnect.org/v3`, and `pulse.walletconnect.org/batch`. Existing CSP
allows these HTTPS connections, both supported relay WebSocket hosts, and Verify
frames; this refresh requires no broader CSP. A fresh browser pairing probe under
the testing origin's production CSP confirmed relay handshake 101 and a Stellar
pairing URI. An offline fixture against the actual bundled kit module confirmed
account lookup and a single `stellar_signXDR` request to the selected topic and
network. No wallet was approved and no transaction was sent by these probes.

The dependency audit retains only the repository's already recorded advisory
exceptions; no new exception is introduced.

## Acceptance still requiring a device or dashboard

After deployment to testing, verify on Android Chrome with Freighter:

- Fresh connection, approved and rejected signatures, manual return to the app,
  and reuse of the approved connection after a browser reload.
- Deposit/trigger, deployment, and subscription allowance signing; each approved
  action submits once, and rejected actions submit nothing.
- Desktop Freighter extension signing after the dependency refresh.
- Reown dashboard attribution after fresh connections. Record whether the
  outdated SDK notice remains; retaining legacy Modal may still prompt an
  AppKit migration recommendation.

These are outstanding acceptance checks for #938, not completed by automated
consumer tests or pairing probes. This dependency PR does not change Railway
configuration or deploy to staging.
