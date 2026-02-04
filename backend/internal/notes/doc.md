# Notes Domain Module

Gravity Notes' backend keeps validation logic at the domain edges. All constructors reject invalid input so services can assume data integrity.

## Constructors

- `NewUserID` / `NewNoteID` ensure identifiers are non-empty, trimmed, and within storage bounds.
- `NewCrdtUpdateBase64` / `NewCrdtSnapshotBase64` validate base64 payloads for CRDT updates and snapshots.
- `NewCrdtUpdateID` rejects negative update identifiers used for CRDT cursors and snapshot coverage.
- `NewCrdtUpdateEnvelope` and `NewCrdtCursor` validate CRDT sync inputs for storage and replay.

## CRDT Sync

CRDT sync is the sole persistence path. The server stores CRDT updates and snapshots without interpreting them, ensuring stale payloads cannot overwrite newer state. Snapshot coverage is tracked via `snapshot_update_id` so snapshots never regress; handlers cap snapshot coverage to the cursor history, and sync requests must include a cursor for every note present in updates so coverage cannot advance without a matching history anchor.

### CRDT Service Expectations

`Service.ApplyCrdtUpdates`, `ListCrdtSnapshots`, and `ListCrdtUpdates` expect:

1. `UserID` instances created via `NewUserID`.
2. `CrdtUpdateEnvelope` values from `NewCrdtUpdateEnvelope`.
3. `CrdtCursor` values from `NewCrdtCursor` when requesting replay updates.
4. Base64 validation performed at the handler edge so core storage assumes payload integrity.
