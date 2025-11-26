import assert from "node:assert/strict";
import test from "node:test";

import { createSyncScenarioHarness } from "./helpers/syncScenarioHarness.js";

test.describe("Synchronization scenarios", () => {
    /** @type {Awaited<ReturnType<typeof createSyncScenarioHarness>> | null} */
    let harness = null;

    test.before(async () => {
        harness = await createSyncScenarioHarness();
    });

    test.after(async () => {
        await harness?.dispose();
        harness = null;
    });

    test("flushes queued operations after transient network failure", { timeout: 60000 }, async (t) => {
        assert.ok(harness, "scenario harness must be initialised");
        const userId = harness.createUserId("transient-sync-user");
        const session = await harness.createSession({ userId });
        const syncInterceptor = await harness.createSyncInterceptor(session.page, { mode: "fail-once" });
        const noteRecord = harness.createNoteDraft({
            noteId: harness.createNoteId("transient-note"),
            markdownText: "Transient failure note"
        });
        try {
            await harness.recordLocalCreate(session.page, noteRecord);
            await harness.waitForQueueLength(session.page, 1);
            assert.equal(syncInterceptor.getAttempts(), 1, "initial sync attempt should fail exactly once");

            await harness.synchronize(session.page, { flushQueue: true });
            await harness.waitForPendingOperations(session.page);
            assert.ok(syncInterceptor.getAttempts() >= 2, "sync queue should retry after connectivity returns");

            const backendNote = await harness.waitForBackendNote(userId, noteRecord.noteId);
            assert.equal(backendNote.payload.markdownText, noteRecord.markdownText);
        } finally {
            await syncInterceptor.dispose();
            await session.close();
        }
    });

    test("replays pending queue on subsequent session sign-in", { timeout: 60000 }, async () => {
        assert.ok(harness, "scenario harness must be initialised");
        const userId = harness.createUserId("queued-session-user");
        const persistentContext = await harness.createBrowserContext();
        try {
            const initialSession = await harness.createSession({ userId, context: persistentContext });
            const offlineInterceptor = await harness.createSyncInterceptor(initialSession.page, { mode: "always-fail" });
            const queuedRecord = harness.createNoteDraft({
                noteId: harness.createNoteId("queued-note"),
                markdownText: "Queued while offline"
            });
            try {
                await harness.recordLocalCreate(initialSession.page, queuedRecord);
                await harness.waitForQueueLength(initialSession.page, 1);
            } finally {
                await offlineInterceptor.dispose();
                await initialSession.close({ keepContext: true });
            }

            const replaySession = await harness.createSession({
                userId,
                context: persistentContext,
                preserveLocalStorage: true,
                autoSignIn: false
            });
            try {
                const persistedOffline = await harness.hasLocalNote(replaySession.page, queuedRecord.noteId, userId);
                assert.ok(persistedOffline, "offline note should persist locally before replay");

                await replaySession.signIn();
                await harness.waitForPendingOperations(replaySession.page);
                await harness.waitForRenderedMarkdown(replaySession.page, queuedRecord.noteId, queuedRecord.markdownText);

                const backendNote = await harness.waitForBackendNote(userId, queuedRecord.noteId);
                assert.equal(backendNote.payload.markdownText, queuedRecord.markdownText);
            } finally {
                await replaySession.close({ keepContext: true });
            }
        } finally {
            await persistentContext.close().catch(() => {});
        }
    });

    test("propagates edits between concurrent sessions", { timeout: 60000 }, async () => {
        assert.ok(harness, "scenario harness must be initialised");
        const userId = harness.createUserId("multi-session-user");
        const sessionA = await harness.createSession({ userId });
        const sessionB = await harness.createSession({ userId });

        try {
            const initialRecord = harness.createNoteDraft({
                noteId: harness.createNoteId("shared-note"),
                markdownText: "Shared session note"
            });
            await harness.recordLocalCreate(sessionA.page, initialRecord);
            await harness.waitForPendingOperations(sessionA.page);

            await harness.waitForBackendNote(userId, initialRecord.noteId);
            await harness.waitForPendingOperations(sessionB.page);
            await harness.waitForRenderedMarkdown(sessionB.page, initialRecord.noteId, initialRecord.markdownText);

            const baseRecord = await harness.getStoreRecord(sessionB.page, initialRecord.noteId, sessionB.userId);
            assert.ok(baseRecord, "base record must exist on second session");

            const updatedMarkdown = "Shared session note (edited in session B)";
            const updatedRecord = harness.createUpdatedRecord(baseRecord, { markdownText: updatedMarkdown });
            await harness.recordLocalUpdate(sessionB.page, initialRecord.noteId, updatedRecord);
            await harness.waitForPendingOperations(sessionB.page);

            await harness.synchronize(sessionA.page, { flushQueue: false });
            await harness.waitForRenderedMarkdown(sessionA.page, initialRecord.noteId, "edited in session B");

            const updatedRecordA = await harness.getStoreRecord(sessionA.page, initialRecord.noteId, sessionA.userId);
            const updatedRecordB = await harness.getStoreRecord(sessionB.page, initialRecord.noteId, sessionB.userId);

            assert.ok(updatedRecordA, "updated record should exist on session A");
            assert.ok(updatedRecordB, "updated record should exist on session B");
            assert.equal(updatedRecordA.markdownText, updatedMarkdown);
            assert.equal(updatedRecordB.markdownText, updatedMarkdown);

            const snapshot = await harness.waitForBackendNote(userId, initialRecord.noteId);
            assert.equal(snapshot.payload.markdownText, updatedMarkdown);
        } finally {
            await sessionA.close();
            await sessionB.close();
        }
    });
});
