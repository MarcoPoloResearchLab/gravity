import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { appConfig } from "../js/core/config.js";
import { createSharedPage } from "./helpers/browserHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

const GN58_NOTE_ID = "gn58-duplicate-preview";
const GN58_MARKDOWN = [
    "- [ ] No lines separating the first card from the next",
    "- [ ] "
].join("\n");

test.describe("GN-58 duplicate markdown rendering", () => {
    test("inline editor renders a single editing surface per card", async () => {
        const seededRecords = [
            buildNoteRecord({
                noteId: GN58_NOTE_ID,
                markdownText: GN58_MARKDOWN
            })
        ];
        const { page, teardown } = await openPageWithRecords(seededRecords);
        try {
            const cardSelector = `.markdown-block[data-note-id="${GN58_NOTE_ID}"]`;
            await page.waitForSelector(cardSelector);

            const viewSnapshot = await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return null;
                }
                const preview = card.querySelector(".markdown-content");
                return {
                    classes: [...card.classList.values()],
                    previewHtml: preview ? preview.innerHTML : null
                };
            }, cardSelector);
            assert(viewSnapshot);
            assert.ok(
                Array.isArray(viewSnapshot.classes) && viewSnapshot.classes.includes("markdown-editor-host--view"),
                "card remains in view mode before editing"
            );
            assert.ok(
                typeof viewSnapshot.previewHtml === "string" && viewSnapshot.previewHtml.includes("<ul>"),
                "preview renders sanitized checklist HTML"
            );

            await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return;
                }
                const preview = card.querySelector(".markdown-content");
                if (!(preview instanceof HTMLElement)) {
                    return;
                }
                preview.hidden = false;
                preview.style.display = "block";
            }, cardSelector);

            await page.click(cardSelector);
            await page.waitForSelector(`${cardSelector}.editing-in-place`);

            const editingSnapshot = await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return { codeMirrorCount: 0, markdownEditorCount: 0, previewDisplay: null };
                }
                const preview = card.querySelector(".markdown-content");
                return {
                    codeMirrorCount: card.querySelectorAll(".CodeMirror").length,
                    markdownEditorCount: card.querySelectorAll("textarea.markdown-editor").length,
                    previewDisplay: preview ? window.getComputedStyle(preview).display : null
                };
            }, cardSelector);
            assert.equal(editingSnapshot.codeMirrorCount, 1, "only one CodeMirror instance mounts");
            assert.equal(editingSnapshot.markdownEditorCount, 1, "only one markdown textarea remains");
            assert.equal(editingSnapshot.previewDisplay, "none", "preview hides while editing");

            const codeMirrorTextarea = `${cardSelector} .CodeMirror textarea`;
            await page.waitForSelector(codeMirrorTextarea);
            await page.focus(codeMirrorTextarea);
            await page.keyboard.type("Sample");

            const postTypeState = await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return null;
                }
                const host = /** @type {any} */ (card).__markdownHost;
                const codeMirror = card.querySelector(".CodeMirror");
                return {
                    value: host && typeof host.getValue === "function" ? host.getValue() : null,
                    codeMirrorText: codeMirror ? codeMirror.textContent : null,
                    codeMirrorHtml: codeMirror ? codeMirror.innerHTML : null
                };
            }, cardSelector);
            assert(postTypeState);
            assert.ok(
                typeof postTypeState.value === "string" && postTypeState.value.startsWith("Sample"),
                "inline editor reflects typed content"
            );

            await page.keyboard.down("Shift");
            await page.keyboard.press("Enter");
            await page.keyboard.up("Shift");
            await page.waitForSelector(`${cardSelector}:not(.editing-in-place)`);

            const postFinalizeSnapshot = await page.evaluate((selector) => {
                const card = document.querySelector(selector);
                if (!(card instanceof HTMLElement)) {
                    return null;
                }
                const preview = card.querySelector(".markdown-content");
                return {
                    classes: [...card.classList.values()],
                    previewHtml: preview ? preview.innerHTML : null,
                    previewDisplay: preview ? window.getComputedStyle(preview).display : null
                };
            }, cardSelector);
            assert(postFinalizeSnapshot);
            assert.ok(
                Array.isArray(postFinalizeSnapshot.classes) && postFinalizeSnapshot.classes.includes("markdown-editor-host--view"),
                "card returns to view mode after finalize"
            );
            assert.ok(
                typeof postFinalizeSnapshot.previewHtml === "string" && postFinalizeSnapshot.previewHtml.includes("Sample"),
                "preview reflects saved markdown after finalize"
            );
            assert.equal(
                postFinalizeSnapshot.previewDisplay,
                "block",
                "preview becomes visible again after editing"
            );
        } finally {
            await teardown();
        }
    });
});

function buildNoteRecord({ noteId, markdownText, attachments = {}, pinned = false }) {
    const timestamp = new Date().toISOString();
    return {
        noteId,
        markdownText,
        attachments,
        createdAtIso: timestamp,
        updatedAtIso: timestamp,
        lastActivityIso: timestamp,
        pinned
    };
}

async function openPageWithRecords(records) {
    const { page, teardown } = await createSharedPage();
    const serialized = JSON.stringify(Array.isArray(records) ? records : []);
    await page.evaluateOnNewDocument((storageKey, payload) => {
        window.__gravityForceMarkdownEditor = true;
        window.localStorage.clear();
        window.localStorage.setItem(storageKey, payload);
    }, appConfig.storageKey, serialized);
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
    return { page, teardown };
}
