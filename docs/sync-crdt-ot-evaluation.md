# GN-454 CRDT/OT Sync Evaluation

Date: 2026-02-03
Owner: Gravity Notes

## Context
Gravity previously synced whole-note updates using a last-writer-wins (LWW) strategy with base_version checks.
This prevented stale overwrites but did not merge concurrent multi-device edits within the same note.
GN-454 evaluates CRDT vs OT approaches and proposes a merge strategy, payload schema, and migration plan for CRDT-first sync.

## Goals
- Merge concurrent multi-device edits to the same note without data loss.
- Preserve offline-first behavior and sync queue durability.
- Keep the inline editor UX stable (no jumps, no modal conflicts).
- Maintain backend auditability and deterministic reconciliation.
- Provide a staged migration that avoids breaking existing clients.

## Non-goals
- Real-time cursor presence or collaborative caret sharing in v1.
- Rich-text operational semantics beyond markdown text and note metadata.
- Replacing the existing protocol in a single cutover.

## Current Sync Model (Summary)
- Notes are stored as full markdown payloads.
- Clients enqueue upsert/delete operations and send them to POST /notes/sync.
- Server validates base_version and accepts or rejects operations.
- Conflicts are surfaced but not merged; the server copy wins when ahead.

## Options Considered

### Option A: OT (Operational Transformation)
Description:
- Clients send text operations relative to a base version.
- Server transforms incoming ops against concurrent ops and applies them in order.

Pros:
- Small incremental ops, good for real-time collaboration.
- Mature conceptual model for text editors.

Cons:
- Requires a central transformation authority and strict op ordering.
- Offline reconciliation is harder; clients must replay against server history.
- Complex to implement in Go without a dedicated OT framework.

### Option B: CRDT (Op-based, e.g., Yjs-style updates)
Description:
- Clients maintain a CRDT document per note and exchange deltas (updates).
- Updates are commutative and can be applied in any order.

Pros:
- Offline-first is natural; updates merge without server transforms.
- Server can be relatively dumb: store updates and broadcast.
- Works well with multi-device, multi-session edits.

Cons:
- CRDT state size can grow without compaction.
- Requires binary update encoding (base64) and periodic snapshots.
- Adds a new doc model that must be persisted alongside markdown.

### Option C: CRDT (State-based, e.g., Automerge-style changes)
Description:
- Clients exchange document changes and occasionally full states.

Pros:
- Clear causal history and straightforward persistence of changes.
- Good for structured JSON documents.

Cons:
- Larger payloads compared to op-based CRDTs for text.
- Storage can grow quickly without pruning.

## Recommendation
Adopt Option B: op-based CRDT per note for markdown text, with CRDT map semantics for metadata.
This keeps offline-first semantics, minimizes server logic, and supports multi-device concurrency.

### Merge Strategy
- Text: CRDT sequence for markdown string.
- Metadata: CRDT map fields for title, pinned, created_at, updated_at with last-write semantics.
- Deletions: tombstone flag stored in metadata with delete timestamp; delete wins if later.
- Attachments: treat as a CRDT set keyed by attachment id OR embed in markdown and let text CRDT govern.

### Conflict Policy
- CRDT resolves concurrent text edits without conflicts.
- Metadata conflicts resolve via CRDT map semantics; server records both and emits the winning value.
- If delete conflicts with edits, deletion wins only if its timestamp/HLC is later than the edit.

## Proposed Payload Schema (Draft)

### Sync Request (CRDT v1)
```json
{
  "protocol": "crdt-v1",
  "client": {
    "device_id": "web-uuid",
    "user_id": "user-uuid",
    "seq": 123
  },
  "operations": [
    {
      "note_id": "note-uuid",
      "op": "crdt_update",
      "crdt": {
        "doc_type": "yjs",
        "update_b64": "...",
        "state_vector_b64": "..."
      },
      "metadata": {
        "pinned": false,
        "updated_at_s": 1700000000
      }
    },
    {
      "note_id": "note-uuid",
      "op": "delete",
      "metadata": {
        "deleted_at_s": 1700000001
      }
    }
  ]
}
```

### Sync Response
```json
{
  "results": [
    {
      "note_id": "note-uuid",
      "accepted": true,
      "server_version": 42,
      "crdt": {
        "doc_type": "yjs",
        "update_b64": "...",
        "state_vector_b64": "..."
      },
      "metadata": {
        "pinned": false,
        "updated_at_s": 1700000002,
        "is_deleted": false
      }
    }
  ]
}
```

### Snapshot Response (Dual Mode During Migration)
```json
{
  "protocol": "crdt-v1",
  "notes": [
    {
      "note_id": "note-uuid",
      "markdown_text": "...", 
      "crdt": {
        "doc_type": "yjs",
        "snapshot_b64": "..."
      },
      "metadata": {
        "created_at_s": 1700000000,
        "updated_at_s": 1700000002,
        "pinned": false,
        "is_deleted": false
      }
    }
  ]
}
```

Notes:
- Migration ships CRDT-only sync; markdown_text is a derived/export artifact.
- Markdown payloads are produced for export/import, not for sync reconciliation.

## Migration Plan (Staged)

Phase 0: Design and instrumentation
- Document protocol and schema.
- Add metrics for conflict rates, sync retries, and payload sizes.

Phase 1: Backend storage
- Add tables for CRDT snapshots and updates.
- Treat CRDT as the authoritative source of truth.

Phase 2: Client CRDT write (feature flagged)
- Clients generate CRDT updates for edits.
- Server accepts CRDT updates as the production flow.

Phase 3: Backfill and compatibility
- Convert existing markdown notes into CRDT docs on first load or via background migration.
- Validate equivalence between derived markdown and stored markdown.

Phase 4: CRDT primary
- Server reconciliation uses CRDT state for text and metadata.
- Markdown payload becomes a derived artifact, not the source of truth.

Phase 5: Cleanup
- Retire legacy sync payloads entirely.
- Keep a minimal markdown export path for backups.

## Testing Plan
- Add multi-device concurrent edit suites that verify merged text.
- Add delete-vs-edit race tests with deterministic outcomes.
- Validate offline replay and out-of-order update application.

## Open Questions
- Which CRDT library (Yjs vs Automerge) best fits the current build tooling and bundle size?
- How to compact or snapshot large CRDT histories without blocking UX?
- Do we need server-side merge previews for conflict visualization?
