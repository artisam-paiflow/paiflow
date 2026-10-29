# Stored-file retirement

[#989](https://github.com/webnxt-2030/pinkraft/issues/989) removes the unused
stored-file feature. The maintainer confirmed that no existing-user support or
export transition is needed. The implementation retires uploads, downloads and
deletion together; there is no legacy download window.

## Endpoint behavior

After authentication, `POST /api/files` and `GET` / `DELETE /api/files/[id]`
return HTTP **410**:

```json
{
  "error": {
    "code": "FILE_STORAGE_RETIRED",
    "message": "Stored-file uploads, downloads and deletion have been retired."
  }
}
```

The routes share a per-account limit of 60 requests per minute using
`file:retired:<userId>`. Unauthenticated requests remain 401, rate-limited
requests remain 429, and middleware continues to block sandbox access. No route
parses upload bodies, looks up a file ID, initializes storage or reads/writes
stored-file metadata or bytes. Downloads no longer return file contents; this
also removes the missing-file GET failure surface tracked in
[#881](https://github.com/webnxt-2030/pinkraft/issues/881).

`POST /api/transcribe` remains independent: microphone audio is forwarded to the
transcription provider. Its authentication, AI feature gate, rate limit, allowed
audio types and 25 MiB limit are unchanged. Stored-file retirement does not change
flow building, deployment or payment behavior.

## Migration and deployment

The new retirement migration drops the `FileAsset` table and its ownership
relation. **Applying it removes any stored-file metadata in that database.**
Historical migrations and evidence remain intact. No export, compatibility layer
or file-access transition is included under the confirmed retirement decision.

Deploy through the existing migration-first startup procedure. Coordinate the
rollout so older app replicas are no longer serving file requests when the table
is removed: older code expects the table and storage drivers to exist. The new
routes need neither the table nor storage configuration. Record actual rollout
and migration verification separately; merging code is not evidence of a hosted
retirement.

## Environment and object cleanup

The storage implementation, MinIO dependency/patch, file-storage environment
examples, Docker storage directories and MinIO Compose service are removed.
Postgres, Redis, unrelated dependencies, wallet dependency tests and microphone
transcription remain in place. The image no longer needs a writable file-storage
path. The historical staging IaC snapshot must not be applied as a cleanup shortcut.

No migration, route or startup script deletes underlying storage objects, buckets,
volumes or old directories. Metadata removal and object cleanup are separate:

- Remove obsolete `FILE_STORAGE_DRIVER`, `FILE_STORAGE_PATH` and `MINIO_*` service
  settings when rolling out the retired feature. Keep credentials out of logs and
  public issue reports.
- Existing local MinIO containers and the `paiflow_minio` Docker volume are not
  deleted by removing their Compose declarations. Review them separately.
- Identify any old volume paths, buckets or prefixes before operational deletion.
  Confirm exclusive ownership by this feature; do not delete shared buckets,
  database/archive volumes or unrelated data. Remove only the explicitly identified
  obsolete resources through the normal operational process.

This change performs no hosted storage deletion or infrastructure apply.

## Verification and issue tracking

Verify authenticated 410 responses, authentication/rate-limit/sandbox restrictions
and absence of file persistence calls. Run transcription route/helper regression
coverage, wallet dependency compatibility tests, typecheck, dependency audit and
app image checks appropriate to the changed Docker/runtime setup.

Update [#568](https://github.com/webnxt-2030/pinkraft/issues/568) to record that
stored-file quotas are superseded when retirement ships; its other resource quotas
remain in scope. Close #989/#881 based on verified implementation and rollout
status, not merely the issue-scope decision.
