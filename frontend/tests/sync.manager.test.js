// @ts-check

import assert from "node:assert/strict";
import test from "node:test";

import * as Y from "yjs";

import { APP_BUILD_ID } from "../js/constants.js";
import { decodeBase64, encodeBase64 } from "../js/utils/base64.js";

const { GravityStore } = await import(`../js/core/store.js?build=${APP_BUILD_ID}`);
const { createSyncManager } = await import(`../js/core/syncManager.js?build=${APP_BUILD_ID}`);

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

    test("handleSignIn syncs local records and applies snapshots", async () => {
        const operationsHandled = [];
        let capturedSnapshotB64 = "";
        const backendClient = {
            async syncOperations({ updates, cursors }) {
                operationsHandled.push({ type: "sync", updates, cursors });
                capturedSnapshotB64 = updates[0]?.snapshot_b64 ?? "";
                return {
                    results: updates.map((operation) => ({
                        note_id: operation.note_id,
                        accepted: true,
                        update_id: 5,
                        duplicate: false
                    })),
                    updates: []
                };
            },
            async fetchSnapshot() {
                operationsHandled.push({ type: "snapshot" });
                return {
                    notes: [
                        {
                            note_id: "note-sync",
                            snapshot_b64: capturedSnapshotB64,
                            snapshot_update_id: 5
                        }
                    ]
                };
            }
        };

        const syncManager = createSyncManager({
            backendClient,
            randomUUID: () => "operation-1"
        });

        GravityStore.setUserScope("user-sync");
        const localRecord = {
            noteId: "note-sync",
            markdownText: "Local Draft",
            createdAtIso: "2023-11-14T20:59:00.000Z",
            updatedAtIso: "2023-11-14T20:59:00.000Z",
            lastActivityIso: "2023-11-14T20:59:00.000Z"
        };

        GravityStore.upsertNonEmpty(localRecord);

        const signInResult = await syncManager.handleSignIn({
            userId: "user-sync"
        });

        assert.equal(signInResult.authenticated, true, "sign-in should report success");
        assert.equal(signInResult.queueFlushed, true, "queued operations should flush");
        assert.equal(signInResult.snapshotApplied, true, "snapshot should apply after flush");

        assert.equal(operationsHandled.length >= 2, true, "sync and snapshot should occur");
        assert.equal(operationsHandled[0].type, "sync");
        assert.equal(operationsHandled[0].updates.length, 1);
        assert.equal(operationsHandled[0].updates[0].note_id, "note-sync");
        assert.ok(operationsHandled[0].updates[0].update_b64);
        assert.ok(operationsHandled[0].updates[0].snapshot_b64);
        assert.equal(operationsHandled[1].type, "snapshot");

        const storedRecords = GravityStore.loadAllNotes();
        assert.equal(storedRecords.length, 1);
        assert.equal(storedRecords[0].markdownText, "Local Draft");

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
                return { results: [], updates: [] };
            },
            async fetchSnapshot() {
                calls.push("fetchSnapshot");
                return { notes: [] };
            }
        };

        const syncManager = createSyncManager({ backendClient });
        GravityStore.setUserScope("user-sync");
        const signInResult = await syncManager.handleSignIn({ userId: "user-sync" });
        assert.equal(signInResult.authenticated, true);

        calls.length = 0;
        const synchronizeResult = await syncManager.synchronize({ flushQueue: false });
        assert.equal(synchronizeResult.snapshotApplied, true, "snapshot should apply during forced sync");
        assert.equal(calls.includes("fetchSnapshot"), true, "fetchSnapshot should be invoked");
        assert.equal(calls.includes("syncOperations"), false, "syncOperations should be skipped when flushing disabled");
    });

    test("refreshes queued snapshots after remote updates", async () => {
        const syncCalls = [];
        let syncCallCount = 0;
        let snapshotCallCount = 0;
        const remoteSnapshotB64 = buildSnapshotB64("Remote");

        const backendClient = {
            async syncOperations({ updates, cursors }) {
                syncCallCount += 1;
                syncCalls.push({ updates, cursors });
                if (syncCallCount === 1) {
                    return { results: [], updates: [] };
                }
                return {
                    results: updates.map((operation) => ({
                        note_id: operation.note_id,
                        accepted: true,
                        update_id: 11,
                        duplicate: false
                    })),
                    updates: []
                };
            },
            async fetchSnapshot() {
                snapshotCallCount += 1;
                if (snapshotCallCount === 1) {
                    return { notes: [] };
                }
                return {
                    notes: [
                        {
                            note_id: "note-sync",
                            snapshot_b64: remoteSnapshotB64,
                            snapshot_update_id: 4
                        }
                    ]
                };
            }
        };

        const syncManager = createSyncManager({
            backendClient,
            randomUUID: () => "operation-1"
        });

        GravityStore.setUserScope("user-sync");
        const signInResult = await syncManager.handleSignIn({ userId: "user-sync" });
        assert.equal(signInResult.authenticated, true);

        const localRecord = {
            noteId: "note-sync",
            markdownText: "Local",
            createdAtIso: "2023-11-14T20:59:00.000Z",
            updatedAtIso: "2023-11-14T20:59:00.000Z",
            lastActivityIso: "2023-11-14T20:59:00.000Z"
        };
        GravityStore.upsertNonEmpty(localRecord);
        syncManager.recordLocalUpsert(localRecord);

        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(syncCalls.length, 1);
        const beforeSnapshotState = syncManager.getDebugState();
        assert.equal(beforeSnapshotState.pendingOperations.length, 1);

        const snapshotResult = await syncManager.synchronize({ flushQueue: false });
        assert.equal(snapshotResult.snapshotApplied, true);

        const flushResult = await syncManager.synchronize();
        assert.equal(flushResult.queueFlushed, true);
        assert.equal(syncCalls.length, 2);

        const flushedSnapshotText = decodeUpdateText(syncCalls[1].updates[0].snapshot_b64);
        assert.ok(flushedSnapshotText.includes("Local"));
        assert.ok(flushedSnapshotText.includes("Remote"));
        assert.equal(syncCalls[1].updates[0].snapshot_update_id, 4);
    });

    test("coalesces repeated upserts and syncs the latest payload", async () => {
        const operationsHandled = [];
        let shouldFail = true;
        let uuidIndex = 0;
        const backendClient = {
            async syncOperations({ updates }) {
                if (shouldFail) {
                    throw new Error("offline");
                }
                operationsHandled.push(updates);
                return {
                    results: updates.map((operation) => ({
                        note_id: operation.note_id,
                        accepted: true,
                        update_id: 12,
                        duplicate: false
                    })),
                    updates: []
                };
            },
            async fetchSnapshot() {
                return { notes: [] };
            }
        };

        const syncManager = createSyncManager({
            backendClient,
            randomUUID: () => `operation-${uuidIndex += 1}`
        });

        GravityStore.setUserScope("user-coalesce");
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

        await new Promise((resolve) => setTimeout(resolve, 0));
        shouldFail = false;
        const syncResult = await syncManager.synchronize();
        assert.equal(syncResult.queueFlushed, true);
        assert.equal(operationsHandled.length, 1);
        assert.equal(operationsHandled[0].length, 1);

        const syncedUpdate = operationsHandled[0][0];
        const updateText = decodeUpdateText(syncedUpdate.update_b64);
        assert.equal(updateText, "Second draft");
    });
});

function decodeUpdateText(updateB64) {
    const update = decodeBase64(updateB64);
    const doc = new Y.Doc();
    doc.getText("markdown");
    doc.getMap("meta");
    Y.applyUpdate(doc, update);
    return doc.getText("markdown").toString();
}

function buildSnapshotB64(text) {
    const doc = new Y.Doc();
    const noteText = doc.getText("markdown");
    doc.getMap("meta");
    noteText.insert(0, text);
    const update = Y.encodeStateAsUpdate(doc);
    return encodeBase64(update);
}
