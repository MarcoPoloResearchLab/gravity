import assert from "node:assert/strict";
import test from "node:test";

import { GravityStore } from "../js/core/store.js";
import { createSyncManager } from "../js/core/syncManager.js";
import { EVENT_NOTIFICATION_REQUEST } from "../js/constants.js";

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
            async syncOperations({ operations }) {
                operationsHandled.push({ type: "sync", operations });
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
            async fetchSnapshot() {
                operationsHandled.push({ type: "snapshot" });
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

        const signInResult = await syncManager.handleSignIn({
            userId: "user-sync"
        });

        assert.equal(signInResult.authenticated, true, "sign-in should report success");
        assert.equal(signInResult.queueFlushed, true, "queued operations should flush");
        assert.equal(signInResult.snapshotApplied, true, "snapshot should apply after flush");

        assert.equal(operationsHandled.length >= 2, true, "sync and snapshot should occur");
        assert.equal(operationsHandled[0].type, "sync");
        assert.equal(operationsHandled[0].operations.length, 1);
        assert.equal(operationsHandled[0].operations[0].operation, "upsert");
        assert.equal(operationsHandled[1].type, "snapshot");

        const storedRecords = GravityStore.loadAllNotes();
        assert.equal(storedRecords.length, 1);
        assert.equal(storedRecords[0].markdownText, "Server-Authoritative");

        const debugState = syncManager.getDebugState();
        assert.equal(debugState.pendingOperations.length, 0);
        assert.equal(debugState.activeUserId, "user-sync");
    });

    test("handleSignIn reports authentication failure when userId missing", async () => {
        const syncManager = createSyncManager({
            backendClient: {
                async syncOperations() {
                    throw new Error("should not sync");
                },
                async fetchSnapshot() {
                    throw new Error("should not fetch snapshot");
                }
            }
        });

        const result = await syncManager.handleSignIn({ userId: "" });

        assert.equal(result.authenticated, false);
        assert.equal(result.queueFlushed, false);
        assert.equal(result.snapshotApplied, false);

        const debugState = syncManager.getDebugState();
        assert.equal(debugState.activeUserId, null);
        assert.equal(Array.isArray(debugState.pendingOperations) && debugState.pendingOperations.length, 0);
    });

    test("synchronize refreshes snapshot without flushing queue when requested", async () => {
        const calls = [];
        const backendClient = {
            async syncOperations() {
                calls.push("syncOperations");
                return { results: [] };
            },
            async fetchSnapshot() {
                calls.push("fetchSnapshot");
                return { notes: [] };
            }
        };

        const syncManager = createSyncManager({ backendClient });
        const signInResult = await syncManager.handleSignIn({ userId: "user-sync" });
        assert.equal(signInResult.authenticated, true);

        const synchronizeResult = await syncManager.synchronize({ flushQueue: false });
        assert.equal(synchronizeResult.snapshotApplied, true, "snapshot should apply during forced sync");
        assert.equal(calls.includes("fetchSnapshot"), true, "fetchSnapshot should be invoked");
        assert.equal(calls.includes("syncOperations"), false, "syncOperations should be skipped when flushing disabled");
    });

    test("rejected sync operations remain in conflicts and preserve local edits", async () => {
        const notifications = [];
        const eventTarget = new EventTarget();
        eventTarget.addEventListener(EVENT_NOTIFICATION_REQUEST, (event) => {
            notifications.push(event?.detail ?? {});
        });

        const backendClient = {
            async syncOperations({ operations }) {
                return {
                    results: operations.map((operation) => ({
                        note_id: operation.note_id,
                        accepted: false,
                        version: 2,
                        updated_at_s: operation.updated_at_s,
                        last_writer_edit_seq: 2,
                        is_deleted: false,
                        payload: {
                            noteId: operation.note_id,
                            markdownText: "Server version",
                            createdAtIso: "2023-11-14T21:00:00.000Z",
                            updatedAtIso: "2023-11-14T21:00:00.000Z",
                            lastActivityIso: "2023-11-14T21:00:00.000Z"
                        }
                    }))
                };
            },
            async fetchSnapshot() {
                return {
                    notes: [
                        {
                            note_id: "note-conflict",
                            created_at_s: 1700000000,
                            updated_at_s: 1700000000,
                            last_writer_edit_seq: 2,
                            version: 2,
                            is_deleted: false,
                            payload: {
                                noteId: "note-conflict",
                                markdownText: "Server snapshot",
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
            randomUUID: () => "operation-conflict",
            eventTarget
        });

        const localRecord = {
            noteId: "note-conflict",
            markdownText: "Local draft",
            createdAtIso: "2023-11-14T20:59:00.000Z",
            updatedAtIso: "2023-11-14T20:59:00.000Z",
            lastActivityIso: "2023-11-14T20:59:00.000Z"
        };

        GravityStore.upsertNonEmpty(localRecord);
        syncManager.recordLocalUpsert(localRecord);

        const signInResult = await syncManager.handleSignIn({ userId: "user-conflict" });

        assert.equal(signInResult.authenticated, true);
        assert.equal(signInResult.queueFlushed, false);
        assert.equal(signInResult.snapshotApplied, true);

        const storedRecords = GravityStore.loadAllNotes();
        assert.equal(storedRecords.length, 1);
        assert.equal(storedRecords[0].markdownText, "Local draft");

        const debugState = syncManager.getDebugState();
        assert.equal(debugState.pendingOperations.length, 0);
        assert.equal(debugState.conflictOperations.length, 1);
        assert.equal(debugState.conflictOperations[0].status, "conflict");

        assert.equal(notifications.length, 1);
        assert.equal(typeof notifications[0].message, "string");
        assert.equal(notifications[0].message.length > 0, true);
    });

    test("coalesces repeated upserts and syncs the latest payload", async () => {
        const operationsHandled = [];
        let shouldFail = true;
        let uuidIndex = 0;
        const backendClient = {
            async syncOperations({ operations }) {
                if (shouldFail) {
                    throw new Error("offline");
                }
                operationsHandled.push(operations);
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
            async fetchSnapshot() {
                return { notes: [] };
            }
        };

        const syncManager = createSyncManager({
            backendClient,
            clock: () => new Date("2023-11-14T21:00:00.000Z"),
            randomUUID: () => `operation-${uuidIndex += 1}`
        });

        const signInResult = await syncManager.handleSignIn({ userId: "user-coalesce" });
        assert.equal(signInResult.authenticated, true);

        const firstRecord = {
            noteId: "note-coalesce",
            markdownText: "First draft",
            createdAtIso: "2023-11-14T20:59:00.000Z",
            updatedAtIso: "2023-11-14T20:59:00.000Z",
            lastActivityIso: "2023-11-14T20:59:00.000Z"
        };
        GravityStore.upsertNonEmpty(firstRecord);
        syncManager.recordLocalUpsert(firstRecord);

        const updatedRecord = {
            ...firstRecord,
            markdownText: "Second draft",
            updatedAtIso: "2023-11-14T21:01:00.000Z",
            lastActivityIso: "2023-11-14T21:01:00.000Z"
        };
        GravityStore.upsertNonEmpty(updatedRecord);
        syncManager.recordLocalUpsert(updatedRecord);

        const debugState = syncManager.getDebugState();
        assert.equal(debugState.pendingOperations.length, 1);
        assert.equal(debugState.pendingOperations[0].noteId, "note-coalesce");
        assert.equal(debugState.pendingOperations[0].payload, null);

        await new Promise((resolve) => setTimeout(resolve, 0));
        shouldFail = false;
        const syncResult = await syncManager.synchronize();
        assert.equal(syncResult.queueFlushed, true);
        assert.equal(operationsHandled.length, 1);
        assert.equal(operationsHandled[0].length, 1);
        assert.equal(operationsHandled[0][0].payload.markdownText, "Second draft");
    });
});
