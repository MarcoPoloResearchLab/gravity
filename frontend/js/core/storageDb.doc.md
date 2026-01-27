# Storage DB

`storageDb.js` owns the IndexedDB connection shared by Gravity Notes persistence. It exposes:

- The database name/version and object store names used for notes, sync queue, and sync metadata.
- `resolveStorageMode()` to choose between IndexedDB (browser) and the localStorage fallback used in tests.
- `openStorageDb()` to open or upgrade the database and create required stores.
