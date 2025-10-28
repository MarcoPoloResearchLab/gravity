# Notes Domain Module

Gravity Notes' backend keeps validation logic at the domain edges. All constructors reject invalid input so services can assume data integrity.

## Constructors

- `NewUserID` / `NewNoteID` ensure identifiers are non-empty, trimmed, and within storage bounds.
- `NewUnixTimestamp` rejects non-positive values so persisted times are well-formed.
- `createNoteRecord` sanitises attachments, normalises booleans, and throws when required fields are missing. Callers must catch the error and avoid persisting malformed payloads.

## ChangeEnvelope

`ChangeEnvelope` is produced in the HTTP handler after payload validation. The service only accepts envelopes, so mutation of user input happens outside the core logic. Use `NewChangeEnvelope` (and the test helper `mustEnvelope`) everywhere a change is created for the domain layer.

## Service Expectations

`Service.ApplyChanges` and `ListNotes` expect:

1. `UserID` instances created via `NewUserID`.
2. `ChangeEnvelope` values from `NewChangeEnvelope`.
3. Storage writes run through `createNoteRecord` so invalid notes are rejected before persistence.

The helper functions in `test_helpers_test.go` provide deterministic fixtures for tests without reimplementing validation.
