import assert from "node:assert/strict";
import test from "node:test";

import { GravityStore } from "../js/core/store.js";
import { createSyncManager } from "../js/core/syncManager.js";

class LocalStorageStub {
    constructor() {
        this.storage = new Map();
    }

    clear() {
        this.storage.clear();
    }

    getItem(key) {
        return this.storage.has(key) ? this.storage.get(key) : null;
    }

    removeItem(key) {
        this.storage.delete(key);
    }

    setItem(key, value) {
        this.storage.set(key, value);
    }
}

test.describe("SyncManager", () => {
    test.beforeEach(() => {
        global.localStorage = new LocalStorageStub();
        GravityStore.setUserScope(null);
    });

    test.afterEach(() => {
        delete global.localStorage;
    });

    test("handleSignIn exchanges credential, flushes queue, and reconciles snapshot", async () => {
        const operationsHandled = [];
        const backendClient = {
            async exchangeGoogleCredential({ credential }) {
                operationsHandled.push({ type: "exchange", credential });
                return { accessToken: "backend-token", expiresIn: 1800 };
            },
            async syncOperations({ accessToken, operations }) {
                operationsHandled.push({ type: "sync", accessToken, operations });
                return {
                    results: operations.map((operation) => ({
                        note_id: operation.note_id,
                        accepted: true,
                        version: 1,
                        updated_at_s: operation.updated_at_s,
                        last_writer_edit_seq: operation.client_edit_seq,
                        is_deleted: operation.operation === "delete",
                        payload: operation.payload
                    }))
                };
            },
            async fetchSnapshot({ accessToken }) {
                operationsHandled.push({ type: "snapshot", accessToken });
                return {
                    notes: [
                        {
                            note_id: "note-sync",
                            created_at_s: 1700000000,
                            updated_at_s: 1700000000,
                            last_writer_edit_seq: 2,
                            version: 2,
                            is_deleted: false,
                            payload: {
                                noteId: "note-sync",
                                markdownText: "Server-Authoritative",
                                createdAtIso: "2023-11-14T21:00:00.000Z",
                                updatedAtIso: "2023-11-14T21:00:00.000Z",
                                lastActivityIso: "2023-11-14T21:00:00.000Z"
                            }
                        }
                    ]
                };
            }
        };

        const syncManager = createSyncManager({
            backendClient,
            clock: () => new Date("2023-11-14T21:00:00.000Z"),
            randomUUID: () => "operation-1"
        });

       const localRecord = {
           noteId: "note-sync",
           markdownText: "Local Draft",
           createdAtIso: "2023-11-14T20:59:00.000Z",
           updatedAtIso: "2023-11-14T20:59:00.000Z",
           lastActivityIso: "2023-11-14T20:59:00.000Z"
       };

        GravityStore.upsertNonEmpty(localRecord);
        syncManager.recordLocalUpsert(localRecord);

        assert.equal(operationsHandled.length, 0, "operations should queue offline before sign-in");

        await syncManager.handleSignIn({
            userId: "user-sync",
            credential: "stub-google-credential"
        });

        assert.equal(operationsHandled.length >= 3, true, "exchange, sync, and snapshot should occur");
        assert.equal(operationsHandled[0].type, "exchange");
        assert.equal(operationsHandled[0].credential, "stub-google-credential");
        assert.equal(operationsHandled[1].type, "sync");
        assert.equal(operationsHandled[1].accessToken, "backend-token");
        assert.equal(operationsHandled[1].operations.length, 1);
        assert.equal(operationsHandled[1].operations[0].operation, "upsert");
        assert.equal(operationsHandled[2].type, "snapshot");

        const storedRecords = GravityStore.loadAllNotes();
        assert.equal(storedRecords.length, 1);
        assert.equal(storedRecords[0].markdownText, "Server-Authoritative");

        const debugState = syncManager.getDebugState();
        assert.equal(debugState.pendingOperations.length, 0);
        assert.equal(debugState.activeUserId, "user-sync");
        assert.equal(debugState.backendToken?.accessToken, "backend-token");
    });
});
