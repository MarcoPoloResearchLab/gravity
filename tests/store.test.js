import assert from "node:assert/strict";
import test from "node:test";

import { appConfig } from "../config.js";
import { GravityStore } from "../store.js";

const SAMPLE_TIMESTAMP = "2024-01-01T00:00:00.000Z";

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

test.describe("GravityStore.loadAllNotes", () => {
    test.beforeEach(() => {
        global.localStorage = new LocalStorageStub();
    });

    test.afterEach(() => {
        delete global.localStorage;
    });

    test("ignores invalid persisted notes", () => {
        const validRecord = {
            noteId: "valid-note-id",
            markdownText: "Persist me",
            createdAtIso: SAMPLE_TIMESTAMP,
            updatedAtIso: SAMPLE_TIMESTAMP,
            lastActivityIso: SAMPLE_TIMESTAMP,
            attachments: { existing: { dataUrl: "data:image/png;base64,abc", altText: "Alt text" } }
        };

        const persistedRecords = [
            validRecord,
            { noteId: "", markdownText: "Has empty identifier" },
            { noteId: "missing-text" },
            { noteId: "   ", markdownText: "Whitespace identifier" },
            { noteId: "valid-but-blank-text", markdownText: "   " },
            "not-an-object"
        ];

        global.localStorage.setItem(appConfig.storageKey, JSON.stringify(persistedRecords));

        const loadedNotes = GravityStore.loadAllNotes();

        const expectedSanitizedRecord = {
            noteId: validRecord.noteId,
            markdownText: validRecord.markdownText,
            createdAtIso: validRecord.createdAtIso,
            updatedAtIso: validRecord.updatedAtIso,
            lastActivityIso: validRecord.lastActivityIso,
            attachments: { existing: { dataUrl: validRecord.attachments.existing.dataUrl, altText: validRecord.attachments.existing.altText } }
        };

        assert.deepStrictEqual(loadedNotes, [expectedSanitizedRecord]);
    });

    test("saveAllNotes persists only validated notes", () => {
        const validInputRecord = {
            noteId: "persistable-note",
            markdownText: "Keep me",
            attachments: { valid: { dataUrl: "data:image/png;base64,xyz", altText: "Valid attachment" } }
        };

        const candidateRecords = [
            validInputRecord,
            { noteId: "", markdownText: "Missing identifier" },
            { noteId: "blank-text", markdownText: "   " },
            { noteId: "missing-text" }
        ];

        GravityStore.saveAllNotes(candidateRecords);

        const persistedPayload = global.localStorage.getItem(appConfig.storageKey);
        assert.ok(typeof persistedPayload === "string");

        const parsedRecords = JSON.parse(persistedPayload);
        const expectedRecord = {
            noteId: validInputRecord.noteId,
            markdownText: validInputRecord.markdownText,
            attachments: { valid: { dataUrl: validInputRecord.attachments.valid.dataUrl, altText: validInputRecord.attachments.valid.altText } }
        };

        assert.deepStrictEqual(parsedRecords, [expectedRecord]);
    });
});
