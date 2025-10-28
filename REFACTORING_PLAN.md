# GN-402 — Refactoring Roadmap Aligned with POLICY.md

## Overview

POLICY.md requires edge-only validation, domain smart constructors, explicit error contexts, and lean modules. A survey of the current codebase highlights several gaps—especially around backend domain types and oversized frontend controllers. This document captures the refactoring work needed to realign the implementation with the policy while minimising regressions.

## Backend Focus Areas

- **Notes service violates edge-only validation** (`backend/internal/notes/service.go:60-139`): `ApplyChanges` rebuilds timestamps, validates identifiers, and mutates request payloads inside the core service. Move these checks to the HTTP layer, introduce smart constructors for `NoteID`, `UserID`, and `Timestamp`, and pass domain types into `resolveChange`.
- **Change resolution operates on primitives** (`backend/internal/notes/conflict.go:15-120`): `ChangeRequest` fields are raw strings/ints. Create a domain struct (e.g., `ChangeEnvelope`) produced by edge validation and refactor `resolveChange` to rely on invariants instead of defensive branching.
- **Service wiring hides invalid dependencies** (`backend/internal/notes/service.go:33-58`): `NewService` silently accepts `nil` databases/id providers. Replace it with a smart constructor returning an error when dependencies are missing, and update callers/tests.
- **Error context is missing** (`backend/internal/notes/service.go:78-132`): Returns raw sentinel errors. Wrap failures with operation identifiers (e.g., `notes.apply_changes.missing_note_id`) to satisfy POLICY error rules and improve observability.
- **Auth components lack smart constructors**:
  - `backend/internal/auth/token_issuer.go:33-82` builds issuers that defer validation to runtime. Add a constructor returning `(TokenIssuer, error)` that enforces signing secret, issuer, audience, and TTL invariants.
  - `backend/internal/auth/google_verifier.go:49-97` should reject missing audience/JWKS URLs at creation instead of deferring to `Verify`. Introduce typed errors and tighten issuer normalisation.
- **Missing typed domain errors**: Define reusable error types (e.g., `ErrInvalidChange`, `ErrInvalidTokenConfig`) and ensure they wrap stable codes when propagated to handlers.
- **Tests**: After refactors, add table-driven coverage that a) rejects invalid inputs at edges, b) exercises conflict resolution via domain types, c) confirms wrapped errors include operation + subject.

## Frontend Focus Areas

- **Monolithic card controller** (`frontend/js/ui/card.js:1-2454`): The file far exceeds the 300–400 line guideline and mixes responsibilities (pointer tracking, markdown editing, pin logic, clipboard, layout). Split into dedicated Alpine factories/modules (e.g., pointer tracking service, markdown mode controller, clipboard actions). Ensure each module exports pure helpers where possible.
- **Implicit global state** (`frontend/js/ui/card.js:71-147`): WeakMap-based state scattered across the module complicates reasoning. Encapsulate state within factory instances and expose explicit APIs that tests can exercise.
- **Unvalidated store writes** (`frontend/js/core/store.js:40-168`): `GravityStore` re-normalises records but silently drops invalid shapes. Introduce `createNoteRecord` smart constructors with explicit errors, and move validation to import/export edges.
- **Missing targeted unit tests**: There is no direct coverage for `notesState`, pointer tracking, or clipboard pipelines. Add Jasmine/TAP-style tests for pure utilities and targeted Puppeteer flows for editing state transitions.
- **Event documentation drift**: Once modules split, update `ARCHITECTURE.md` to describe new events or state transitions emitted by the refactored card controller.

## Tooling & CI

- Update automation to run `go vet ./... && staticcheck ./... && ineffassign ./...` after backend refactors, and ensure JS type checks (`tsc --noEmit`) cover new modules.
- Introduce fixtures/mocks for new domain constructors so tests remain fast and deterministic.
- Document the new validation boundaries and constructor usage patterns in module-level READMEs (`backend/internal/notes/doc.md`, `frontend/js/ui/card/README.md`).

## Sequencing Recommendations

1. **Backend Foundations**
   - Add domain types and smart constructors (`NoteID`, `UserID`, `Timestamp`, `ChangeEnvelope`).
   - Refactor service/auth constructors to return errors on invalid configuration.
   - Update HTTP handlers/tests to validate at edges before calling the core.
2. **Frontend Decomposition**
   - Extract pointer/editing/clipboard subsystems from `card.js`, ensuring each module has local state and tests.
   - Introduce smart constructors for note records before store writes.
3. **Error & Telemetry pass**
   - Wrap remaining backend errors with stable codes.
   - Centralise frontend logging/error dispatch via `utils/logging.js`.
4. **Documentation & Tests**
   - Align `ARCHITECTURE.md` with the new module layout.
   - Extend integration and unit tests to cover new domain types and UI flows.

Delivering the above in incremental PRs will keep diffs reviewable while moving the implementation toward full POLICY compliance.
