# New-flow control hydration

A separate ephemeral Chrome 151 mobile-layout context held the dashboard's
JavaScript chunks to inspect its server-rendered new-flow control. It was enabled
before its click handler existed. A single click opened no dialog and was not
replayed after the chunks loaded. A subsequent hydrated click opened the dialog;
Escape closed it. No creation confirmation was clicked, no API mutation attempt
was observed, and the persistent wallet/browser controller was untouched.

The [sanitized observation](new-flow-hydration-observation.json) contains only
booleans. This controlled experiment establishes an ignored pre-hydration tap
window. It does **not** prove that hydration caused the earlier isolated mobile
builder-test failure. The diagnostic blocked application API mutations; it did not
independently measure optional analytics traffic outside that route prefix.

The fix uses the native button's disabled state during server rendering and first
hydration, enabling it after mount. This supplies ordinary browser actionability
without a production test hook or a React-internal readiness condition in E2E.
All dashboard new-flow entry points share the same component. No draft is created
until the user explicitly confirms its dialog.

The SSR/hydration regression checks native disabled behavior before React mounts,
matching hydration without recoverable errors, enabled dialog interaction after
mount, and no automatic request. A separate component case preserves one named
creation request after explicit confirmation. Run:

```sh
pnpm test tests/unit/flows/new-flow-button.test.tsx
```

Browser execution of the separate builder-only E2E correction remains a distinct
check. This change does not establish wallet signing, deployment, financial, or
real handset acceptance and does not change the frozen testing runtime.
