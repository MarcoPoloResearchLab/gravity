# Notes Domain Module

Gravity Notes' backend keeps validation logic at the domain edges. All constructors reject invalid input so services can assume data integrity.

## Constructors

- `NewUserID` / `NewNoteID` ensure identifiers are non-empty, trimmed, and within storage bounds.
- `NewUnixTimestamp` rejects non-positive values so persisted times are well-formed.
- `NewNoteVersion` rejects negative versions so base-version checks are meaningful.
- `NewChangeEnvelope` validates payload JSON for upserts (requires `noteId` and `markdownText`, with matching note identifiers) so malformed payloads never reach persistence.
- `NewCrdtUpdateBase64` / `NewCrdtSnapshotBase64` validate base64 payloads for CRDT updates and snapshots.
- `NewCrdtUpdateID` rejects negative update identifiers used for CRDT cursors and snapshot coverage.
- `NewCrdtUpdateEnvelope` and `NewCrdtCursor` validate CRDT sync inputs for storage and replay.

## ChangeEnvelope

`ChangeEnvelope` is produced in the HTTP handler after payload validation. It includes the client base version so the service can reject stale changes when the stored version has advanced. The service only accepts envelopes, so mutation of user input happens outside the core logic. Use `NewChangeEnvelope` (and the test helper `mustEnvelope`) everywhere a change is created for the domain layer.

## CRDT Sync

CRDT sync is the primary persistence path. The server stores CRDT updates and snapshots without interpreting them, ensuring stale payloads cannot overwrite newer state. Snapshot coverage is tracked via `snapshot_update_id` so snapshots never regress.

Snapshot responses may include `legacy_payload` entries only for notes that have not yet been migrated into CRDT snapshots. Clients must convert those payloads into CRDT updates immediately so the server can persist snapshots and stop emitting legacy payloads.

### CRDT Service Expectations

`Service.ApplyCrdtUpdates`, `ListCrdtSnapshots`, and `ListCrdtUpdates` expect:

1. `UserID` instances created via `NewUserID`.
2. `CrdtUpdateEnvelope` values from `NewCrdtUpdateEnvelope`.
3. `CrdtCursor` values from `NewCrdtCursor` when requesting replay updates.
4. Base64 validation performed at the handler edge so core storage assumes payload integrity.

## Legacy LWW Service Expectations

The LWW path remains for legacy data migrations only.

`Service.ApplyChanges` and `ListNotes` expect:

1. `UserID` instances created via `NewUserID`.
2. `ChangeEnvelope` values from `NewChangeEnvelope`.
3. Payload JSON validation (noteId + markdownText) runs before persistence so invalid notes are rejected at the edge.
4. Base versions are compared to the stored note version; stale changes are rejected and no-op retries skip audit logging.

The helper functions in `test_helpers_test.go` provide deterministic fixtures for tests without reimplementing validation.
