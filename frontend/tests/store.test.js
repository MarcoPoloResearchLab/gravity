import assert from "node:assert/strict";
import test from "node:test";

import { createAppConfig } from "../js/core/config.js?build=2026-01-01T22:43:21Z";
import { ENVIRONMENT_DEVELOPMENT } from "../js/core/environmentConfig.js?build=2026-01-01T22:43:21Z";
import { GravityStore, ERROR_INVALID_NOTES_COLLECTION } from "../js/core/store.js";
import { ERROR_IMPORT_INVALID_PAYLOAD } from "../js/constants.js";

const DEFAULT_GOOGLE_CLIENT_ID = "156684561903-4r8t8fvucfdl0o77bf978h2ug168mgur.apps.googleusercontent.com";
const appConfig = createAppConfig({
    environment: ENVIRONMENT_DEVELOPMENT,
    googleClientId: DEFAULT_GOOGLE_CLIENT_ID
});

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
        GravityStore.setUserScope(null);
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
            attachments: { existing: { dataUrl: validRecord.attachments.existing.dataUrl, altText: validRecord.attachments.existing.altText } },
            pinned: false
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
            attachments: { valid: { dataUrl: validInputRecord.attachments.valid.dataUrl, altText: validInputRecord.attachments.valid.altText } },
            pinned: false
        };

        assert.deepStrictEqual(parsedRecords, [expectedRecord]);
    });

    test("getById returns stored record or null", () => {
        const record = {
            noteId: "lookup-note",
            markdownText: "Lookup content",
            createdAtIso: SAMPLE_TIMESTAMP,
            updatedAtIso: SAMPLE_TIMESTAMP,
            lastActivityIso: SAMPLE_TIMESTAMP,
            attachments: {}
        };
        GravityStore.saveAllNotes([record]);

        const fetched = GravityStore.getById("lookup-note");
        assert.ok(fetched);
        assert.equal(fetched.noteId, record.noteId);
        assert.equal(fetched.markdownText, record.markdownText);

        const missing = GravityStore.getById("missing-id");
        assert.equal(missing, null);
    });
});

test.describe("GravityStore.saveAllNotes guard", () => {
    test.beforeEach(() => {
        global.localStorage = new LocalStorageStub();
        GravityStore.setUserScope(null);
    });

    test.afterEach(() => {
        delete global.localStorage;
    });

    test("rejects non-array inputs", () => {
        assert.throws(
            () => GravityStore.saveAllNotes(/** @type {any} */ (null)),
            {
                name: "Error",
                message: ERROR_INVALID_NOTES_COLLECTION
            }
        );
    });
});

test.describe("GravityStore export/import", () => {
    test.beforeEach(() => {
        global.localStorage = new LocalStorageStub();
        GravityStore.setUserScope(null);
    });

    test.afterEach(() => {
        delete global.localStorage;
    });

    test("exportNotes serializes sanitized records", () => {
        const storedRecords = [
            {
                noteId: "note-one",
                markdownText: "Hello world",
                attachments: { first: { dataUrl: "data:image/png;base64,aaa", altText: "First" } },
                classification: { category: "Journal", tags: ["daily"] }
            }
        ];

        GravityStore.saveAllNotes(storedRecords);

        const exportedJson = GravityStore.exportNotes();
        const parsed = JSON.parse(exportedJson);

        assert.deepStrictEqual(parsed, GravityStore.loadAllNotes());
    });

    test("importNotes appends only unique records", async (t) => {
        const scenarios = [
            {
                name: "imports new record with sanitized attachments",
                existing: [],
                incoming: [
                    {
                        noteId: "import-one",
                        markdownText: "Imported note",
                        attachments: {
                            "image-a.png": { dataUrl: "data:image/png;base64,abc", altText: "[Alt]" }
                        },
                        classification: { category: "Journal", tags: ["log"] }
                    }
                ],
                expectedAppended: ["import-one"],
                expectedPersistedCount: 1,
                expectedAttachments: {
                    "image-a.png": { dataUrl: "data:image/png;base64,abc", altText: "Alt" }
                }
            },
            {
                name: "skips records with duplicate identifiers",
                existing: [
                    { noteId: "existing-note", markdownText: "Keep me" }
                ],
                incoming: [
                    { noteId: "existing-note", markdownText: "Different content" }
                ],
                expectedAppended: [],
                expectedPersistedCount: 1
            },
            {
                name: "skips records with identical content attachments and classification",
                existing: [
                    {
                        noteId: "existing-duplicate",
                        markdownText: "Shared body",
                        attachments: {
                            "image-one.png": { dataUrl: "data:image/png;base64,xyz", altText: "One" },
                            "image-two.png": { dataUrl: "data:image/png;base64,uvw", altText: "Two" }
                        },
                        classification: { category: "Projects", tags: ["gravity", "sync"] }
                    }
                ],
                incoming: [
                    {
                        noteId: "different-id",
                        markdownText: "Shared body",
                        attachments: {
                            "image-two.png": { dataUrl: "data:image/png;base64,uvw", altText: "Two" },
                            "image-one.png": { dataUrl: "data:image/png;base64,xyz", altText: "One" }
                        },
                        classification: { tags: ["gravity", "sync"], category: "Projects" }
                    }
                ],
                expectedAppended: [],
                expectedPersistedCount: 1
            },
            {
                name: "imports only unique subset when mixed",
                existing: [
                    { noteId: "keep-existing", markdownText: "Existing" }
                ],
                incoming: [
                    { noteId: "keep-existing", markdownText: "Duplicate id" },
                    { noteId: "brand-new", markdownText: "Fresh content" },
                    {
                        noteId: "content-duplicate",
                        markdownText: "Shared body",
                        attachments: {
                            only: { dataUrl: "data:image/png;base64,ppp", altText: "Only" }
                        },
                        classification: { category: "Journal" }
                    }
                ],
                additionalExisting: [
                    {
                        noteId: "existing-with-same-content",
                        markdownText: "Shared body",
                        attachments: {
                            only: { dataUrl: "data:image/png;base64,ppp", altText: "Only" }
                        },
                        classification: { category: "Journal" }
                    }
                ],
                expectedAppended: ["brand-new"],
                expectedPersistedCount: 3
            }
        ];

        for (const scenario of scenarios) {
            await t.test(scenario.name, () => {
                const existingRecords = Array.isArray(scenario.existing) ? scenario.existing : [];
                GravityStore.saveAllNotes(existingRecords);

                if (Array.isArray(scenario.additionalExisting)) {
                    const current = GravityStore.loadAllNotes();
                    GravityStore.saveAllNotes(current.concat(scenario.additionalExisting));
                }

                const serialized = JSON.stringify(scenario.incoming);
                const appended = GravityStore.importNotes(serialized);

                const appendedIds = appended.map(record => record.noteId);
                assert.deepStrictEqual(appendedIds, scenario.expectedAppended);

                if (scenario.expectedAttachments && appended[0]) {
                    assert.deepStrictEqual(appended[0].attachments, scenario.expectedAttachments);
                }

                const persisted = GravityStore.loadAllNotes();
                assert.strictEqual(persisted.length, scenario.expectedPersistedCount);
            });
        }
    });

    test("importNotes rejects invalid payloads", () => {
        GravityStore.saveAllNotes([]);

        const invalidCases = [
            "",
            "{}",
            "not-json"
        ];

        for (const invalid of invalidCases) {
            assert.throws(() => GravityStore.importNotes(invalid), {
                name: "Error",
                message: ERROR_IMPORT_INVALID_PAYLOAD
            });
        }
    });
});

test.describe("GravityStore user scopes", () => {
    test.beforeEach(() => {
        global.localStorage = new LocalStorageStub();
        GravityStore.setUserScope(null);
    });

    test.afterEach(() => {
        delete global.localStorage;
        GravityStore.setUserScope(null);
    });

    test("isolates persisted notes per user", () => {
        const anonymousRecord = { noteId: "anonymous-note", markdownText: "Anon" };
        GravityStore.saveAllNotes([anonymousRecord]);
        const anonymousKey = GravityStore.getActiveStorageKey();

        GravityStore.setUserScope(" user-a ");
        const userARecord = { noteId: "user-a-note", markdownText: "User A" };
        GravityStore.saveAllNotes([userARecord]);
        const userAKey = GravityStore.getActiveStorageKey();

        GravityStore.setUserScope("user-b");
        const userBKey = GravityStore.getActiveStorageKey();
        const userBRecords = GravityStore.loadAllNotes();
        assert.deepStrictEqual(userBRecords, []);

        GravityStore.saveAllNotes([{ noteId: "user-b-note", markdownText: "User B" }]);

        GravityStore.setUserScope("user-a");
        const loadedUserA = GravityStore.loadAllNotes();
        assert.equal(loadedUserA.length, 1);
        assert.equal(loadedUserA[0].noteId, userARecord.noteId);

        GravityStore.setUserScope(null);
        const loadedAnon = GravityStore.loadAllNotes();
        assert.equal(loadedAnon.length, 1);
        assert.equal(loadedAnon[0].noteId, anonymousRecord.noteId);

        const storedKeys = Array.from(global.localStorage.storage.keys());
        assert.ok(storedKeys.includes(anonymousKey));
        assert.ok(storedKeys.includes(userAKey));
        assert.ok(storedKeys.includes(userBKey));
        assert.notEqual(userAKey, userBKey);
        assert.notEqual(userAKey, anonymousKey);
    });
});
