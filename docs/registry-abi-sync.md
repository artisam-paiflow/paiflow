# Contract registry ABI synchronization

The registry's `ContractTemplate.abiJson` is artifact evidence. Uploading valid
WASM does not by itself populate that database metadata. Hash-only synchronization
must not erase it or attach an old artifact's ABI to a new hash (#1209).

## Ordinary upload and hash synchronization

`contracts:upload` and `contracts:deploy-factory` extract complete
`contractspecv0` specification entries from the exact WASM bytes whose hash they
register. Extraction validates the WASM and decodes all specification sections;
the stored representation is `{ specEntriesXdr: [...] }`, retaining entry order.
Extraction happens before any upload/deployment transaction. Existing unchanged
upload/deployment skip paths do not repair metadata; use the scoped mode below.

`contracts:update-hashes` preserves existing ABI JSON verbatim when the requested
hash already matches. For a new or changed hash it requires matching local build
output under `contracts/target/wasm32v1-none/release`, using the
`paiflow_<kind>.wasm` name (or historical `pinkraft_<kind>.wasm`), and extracts its
ABI before registration. If both filenames exist, the `paiflow_` filename wins;
its bytes must match the requested hash. Missing or mismatched artifacts fail
closed. This synchronization does not prove that a new hash is uploaded or has
sufficient chain TTL; retain the existing separate deployment/readiness checks.

The low-level setter preserves omitted ABI for the same hash, rejects a changed
existing hash without supplied metadata, and refuses explicitly empty metadata.
Its read and write run in a serializable transaction with bounded conflict
retries, preventing a concurrent hash change from carrying forward stale ABI.
Legacy direct creation without ABI still records `{}` as unknown evidence;
the upload and synchronization tools supply verified evidence for new rows.

## Inspect or repair one existing ABI

Before any live operation, explicitly confirm the target environment, database,
network, current registry hash and metadata. Obtain the exact uploaded WASM
through a trusted read-only source and verify its hash and chain availability.
No new upload is required solely to fill missing metadata for an existing hash.

Review all immutable template versions pinned to this kind before applying any
metadata change, including a representation change. Private template versions
pin the exact ABI JSON digest. Filling `{}` or replacing another representation
changes that digest even if the WASM hash is unchanged. New preparations using
old pins will fail closed. Do not rewrite immutable versions, repin pending
intents, clear reservations, or replay original requests. Coordinate a new
template version and its consumers where needed; preserve original recovery.
This impact review also applies to upload/factory registration that supplies new
ABI metadata, not only the repair mode.

Set `STELLAR_NETWORK` and `DATABASE_URL` explicitly for the selected environment
using the established private operator configuration. Shell values take
precedence over `.env.local` and `.env`. No credentials belong in reports or shell
history. The command has no `--network` override; see the canonical
[network model](../CLAUDE.md#75-networks).

```bash
pnpm contracts:update-hashes --help
pnpm contracts:update-hashes --abi-kind=SUBSCRIPTION --abi-wasm=/path/to/exact.wasm --abi-hash=<64-lowercase-hex>
```

The second command validates the local WASM and reads only the selected registry
row. It does not synchronize other kinds or factory addresses and does not write
by default. Unknown, repeated or incomplete flags fail before artifact reads or
database changes. After reviewing the exact artifact and immutable pin impact,
the same command with `--apply` registers its extracted ABI for that one existing
row. The setter rechecks the expected hash inside its serializable transaction,
so a concurrent hash change or missing row aborts the repair rather than
activating another artifact.

After an approved application, independently reread the selected row and verify
its unchanged WASM hash, complete ABI, expected ABI digest, and intended template
compatibility. Follow the ordinary scoped acceptance procedure separately. A
metadata repair does not resolve expired deployment slots or authorize hosted
form reopening, request replay, signing, submission or fixture cleanup.
