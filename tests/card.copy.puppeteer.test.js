import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { appConfig } from "../js/core/config.js";
import { CLIPBOARD_MIME_NOTE } from "../js/constants.js";
import { createSharedPage } from "./helpers/browserHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

const VIEW_MODE_NOTE_ID = "copy-preview-fixture";
const VIEW_MODE_MARKDOWN = "Preview **bold** payload.";
const EDIT_MODE_NOTE_ID = "copy-edit-fixture";
const EDIT_MODE_MARKDOWN = "Edit mode copy baseline.";

test.describe("Card clipboard actions", () => {
    test("copy action uses rendered preview when available", async () => {
        const seededRecords = [
            buildNoteRecord({ noteId: VIEW_MODE_NOTE_ID, markdownText: VIEW_MODE_MARKDOWN })
        ];
        const { page, teardown } = await prepareClipboardPage({ records: seededRecords });
        const cardSelector = `.markdown-block[data-note-id="${VIEW_MODE_NOTE_ID}"]`;
        try {
            await page.waitForSelector(`${cardSelector} .note-preview .markdown-content`);
            await page.click(`${cardSelector} [data-action="copy-note"]`);
            await waitForClipboardWrites(page);
            const payload = await readLatestClipboardPayload(page);
            assert(payload, "Clipboard payload should be captured");
            assert.equal(payload["text/plain"], VIEW_MODE_MARKDOWN);
            const htmlPayload = payload["text/html"];
            assert.ok(typeof htmlPayload === "string" && htmlPayload.includes("<strong>bold</strong>"));
            const metadataJson = payload[CLIPBOARD_MIME_NOTE];
            assert.ok(typeof metadataJson === "string" && metadataJson.length > 0);
            const metadata = JSON.parse(metadataJson);
            assert.equal(metadata.markdown, VIEW_MODE_MARKDOWN);
        } finally {
            await teardown();
        }
    });

    test("copy action resolves preview dynamically in edit mode", async () => {
        const seededRecords = [
            buildNoteRecord({ noteId: EDIT_MODE_NOTE_ID, markdownText: EDIT_MODE_MARKDOWN })
        ];
        const { page, teardown } = await prepareClipboardPage({ records: seededRecords });
        const cardSelector = `.markdown-block[data-note-id="${EDIT_MODE_NOTE_ID}"]`;
        try {
            await page.waitForSelector(cardSelector);
            await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return;
                }
                const host = Reflect.get(card, "__markdownHost");
                if (!host || typeof host.setMode !== "function") {
                    return;
                }
                host.setMode("edit");
            }, cardSelector);
            await page.waitForFunction((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return false;
                }
                return !card.querySelector(".note-preview");
            }, {}, cardSelector);
            await page.click(`${cardSelector} [data-action="copy-note"]`);
            await waitForClipboardWrites(page);
            const payload = await readLatestClipboardPayload(page);
            assert(payload, "Clipboard payload should be captured");
            assert.equal(payload["text/plain"], EDIT_MODE_MARKDOWN);
            assert.equal(payload["text/html"], undefined);
            const metadataJson = payload[CLIPBOARD_MIME_NOTE];
            assert.ok(typeof metadataJson === "string" && metadataJson.length > 0);
            const metadata = JSON.parse(metadataJson);
            assert.equal(metadata.markdown, EDIT_MODE_MARKDOWN);
        } finally {
            await teardown();
        }
    });
});

function buildNoteRecord({ noteId, markdownText }) {
    const timestampIso = new Date().toISOString();
    return {
        noteId,
        markdownText,
        attachments: {},
        createdAtIso: timestampIso,
        updatedAtIso: timestampIso,
        lastActivityIso: timestampIso,
        pinned: false
    };
}

async function prepareClipboardPage({ records }) {
    const { page, teardown } = await createSharedPage();
    const serializedRecords = JSON.stringify(Array.isArray(records) ? records : []);
    await page.evaluateOnNewDocument((storageKey, payload) => {
        window.sessionStorage.setItem("__gravityTestInitialized", "true");
        window.localStorage.clear();
        window.localStorage.setItem(storageKey, payload);
        window.__gravityForceMarkdownEditor = true;
        window.__copiedPayloads = [];
        class ClipboardItemStub {
            constructor(items) {
                this.items = items;
                this.types = Object.keys(items);
            }
            async getType(type) {
                const blob = this.items?.[type];
                if (!blob) {
                    throw new Error(`Unsupported clipboard type: ${type}`);
                }
                return blob;
            }
        }
        window.ClipboardItem = ClipboardItemStub;
        const clipboardStub = {
            async write(items) {
                const aggregated = {};
                for (const item of Array.isArray(items) ? items : []) {
                    if (!item || typeof item.getType !== "function") {
                        continue;
                    }
                    const itemTypes = Array.isArray(item.types) ? item.types : Object.keys(item.items || {});
                    for (const type of itemTypes) {
                        try {
                            const blob = await item.getType(type);
                            if (blob && typeof blob.text === "function") {
                                aggregated[type] = await blob.text();
                            }
                        } catch {
                            aggregated[type] = "";
                        }
                    }
                }
                window.__copiedPayloads.push(aggregated);
                return true;
            },
            async writeText(text) {
                window.__copiedPayloads.push({
                    "text/plain": typeof text === "string" ? text : ""
                });
                return true;
            }
        };
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            get() {
                return clipboardStub;
            }
        });
    }, appConfig.storageKey, serializedRecords);
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
    if (Array.isArray(records) && records.length > 0) {
        await page.waitForSelector(".markdown-block[data-note-id]");
    }
    return { page, teardown };
}

async function waitForClipboardWrites(page) {
    await page.waitForFunction(() => {
        return Array.isArray(window.__copiedPayloads) && window.__copiedPayloads.length > 0;
    });
}

async function readLatestClipboardPayload(page) {
    return page.evaluate(() => {
        if (!Array.isArray(window.__copiedPayloads) || window.__copiedPayloads.length === 0) {
            return null;
        }
        return window.__copiedPayloads[window.__copiedPayloads.length - 1];
    });
}
