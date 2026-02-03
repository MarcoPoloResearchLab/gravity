# CRDT Core

The CRDT core modules provide Yjs-backed note synchronization and persistence.

## Responsibilities

- `crdtAdapter.js` loads Yjs from the CDN in the browser and from the local dependency in tests.
- `crdtDocumentStore.js` persists per-user CRDT snapshots in IndexedDB (with a localStorage fallback for tests) and migrates legacy localStorage data into IndexedDB.
- `crdtNoteEngine.js` owns Yjs documents per note, applies updates/snapshots, builds `NoteRecord` views and CRDT snapshots, and persists snapshots through the document store.
- `js/utils/base64.js` encodes and decodes CRDT updates/snapshots for transport.

`syncManager.js` orchestrates CRDT updates and snapshot application using the core modules above.
