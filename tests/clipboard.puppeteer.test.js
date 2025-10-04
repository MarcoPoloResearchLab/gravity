import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
let puppeteerModule;
try {
    ({ default: puppeteerModule } = await import("puppeteer"));
} catch (error) {
    puppeteerModule = null;
}

import { CLIPBOARD_MIME_NOTE, CLIPBOARD_METADATA_VERSION, MESSAGE_NOTE_COPIED } from "../constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}?test=true`;

const SAMPLE_IMAGE_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";

if (!puppeteerModule) {
    test("puppeteer unavailable", () => {
        test.skip("Puppeteer is not installed in this environment.");
    });
} else {
test.describe("Clipboard integration", () => {
    /** @type {import('puppeteer').Browser} */
    let browser;

    test.before(async () => {
        browser = await puppeteerModule.launch({
            headless: "new",
            args: ["--allow-file-access-from-files"]
        });
    });

    test.after(async () => {
        if (browser) await browser.close();
    });

    test("click enters edit mode without reordering", async () => {
        const page = await preparePage(browser);
        try {
            await createCard(page, {
                noteId: "bubble-alpha",
                markdownText: "Alpha note",
                attachments: {},
                mode: "view"
            });

            await createCard(page, {
                noteId: "bubble-bravo",
                markdownText: "Bravo note",
                attachments: {},
                mode: "view"
            });

            let states = await getCardStates(page);
            assert.deepStrictEqual(states.map((state) => state.noteId), ["bubble-alpha", "bubble-bravo"]);
            assert.equal(states[0].mode, "view");
            assert.equal(states[1].mode, "view");

            await page.click('[data-note-id="bubble-bravo"] .markdown-content');
            await waitForCardMode(page, "bubble-bravo", "edit");

            states = await getCardStates(page);
            assert.deepStrictEqual(states.map((state) => state.noteId), ["bubble-alpha", "bubble-bravo"]);
            assert.equal(states[0].mode, "view");
            assert.equal(states[1].mode, "edit");
        } finally {
            await page.close();
        }
    });

    test("blur restores rendered view without reordering", async () => {
        const page = await preparePage(browser);
        try {
            await createCard(page, {
                noteId: "blur-alpha",
                markdownText: "Alpha note",
                attachments: {},
                mode: "view"
            });

            await page.click('[data-note-id="blur-alpha"] .markdown-content');
            await waitForCardMode(page, "blur-alpha", "edit");

            await page.click('#top-editor .markdown-editor');
            await waitForCardMode(page, "blur-alpha", "view");

            const states = await getCardStates(page);
            assert.deepStrictEqual(states.map((state) => state.noteId), ["blur-alpha"]);
            assert.equal(states[0].mode, "view");
        } finally {
            await page.close();
        }
    });

    test("edit-mode copy returns raw markdown", async () => {
        const page = await preparePage(browser);
        try {
            const markdown = "# Sample Heading\n\nParagraph with *emphasis*.";

            await createCard(page, {
                noteId: "note-copy-markdown-plain",
                markdownText: markdown,
                attachments: {},
                mode: "edit"
            });

            await page.click('[data-note-id="note-copy-markdown-plain"] [data-action="copy-note"]');
            await waitForClipboardWrite(page);
            await waitForCopyFeedback(page, "note-copy-markdown-plain");

            const clipboardPayload = await page.evaluate(() => window.__clipboardWrites.at(-1));
            const [item] = clipboardPayload;
            assert.equal(item["text/plain"], markdown);
        } finally {
            await page.close();
        }
    });

    test("copy captures markdown, html, and attachment metadata", async () => {
        const page = await preparePage(browser);
        try {
            const markdown = "Intro text\n\n![[sample-image.png]]";
            const attachments = {
                "sample-image.png": { dataUrl: SAMPLE_IMAGE_DATA_URL, altText: "Sample attachment" }
            };

            await createCard(page, {
                noteId: "note-copy-metadata",
                markdownText: markdown,
                attachments,
                mode: "edit"
            });

            await page.click('[data-note-id="note-copy-metadata"] [data-action="copy-note"]');
            await waitForClipboardWrite(page);
            await waitForCopyFeedback(page, "note-copy-metadata");

            const clipboardPayload = await page.evaluate(() => window.__clipboardWrites.at(-1));
            assert.ok(Array.isArray(clipboardPayload) && clipboardPayload.length === 1, "expected single clipboard item");

            const [item] = clipboardPayload;
            assert.equal(item["text/plain"], markdown);
            assert.ok(item["text/html"].includes(SAMPLE_IMAGE_DATA_URL));

            const metadata = JSON.parse(item[CLIPBOARD_MIME_NOTE]);
            assert.equal(metadata.version, CLIPBOARD_METADATA_VERSION);
            assert.equal(metadata.markdown, markdown);
            assert.deepStrictEqual(metadata.attachments, attachments);
        } finally {
            await page.close();
        }
    });

    test("rendered-mode copy returns sanitized HTML", async () => {
        const page = await preparePage(browser);
        try {
            const markdown = "This is **bold** and _italic_.";

            await createCard(page, {
                noteId: "note-copy-rendered-html",
                markdownText: markdown,
                attachments: {},
                mode: "view"
            });

            await page.click('[data-note-id="note-copy-rendered-html"] [data-action="copy-note"]');
            await waitForClipboardWrite(page);
            await waitForCopyFeedback(page, "note-copy-rendered-html");

            const clipboardPayload = await page.evaluate(() => window.__clipboardWrites.at(-1));
            const [item] = clipboardPayload;
            assert.ok(typeof item["text/plain"] === "string");
            assert.ok(!item["text/plain"].includes("<"));
            assert.ok(item["text/html"].includes("<strong>"));
        } finally {
            await page.close();
        }
    });

    test("rendered-mode copy returns HTML with image", async () => {
        const page = await preparePage(browser);
        try {
            const markdown = `Paragraph before image.\n\n![Alt text](${SAMPLE_IMAGE_DATA_URL})`;

            await createCard(page, {
                noteId: "note-copy-rendered-image",
                markdownText: markdown,
                attachments: {},
                mode: "view"
            });

            await page.click('[data-note-id="note-copy-rendered-image"] [data-action="copy-note"]');
            await waitForClipboardWrite(page);
            await waitForCopyFeedback(page, "note-copy-rendered-image");

            const clipboardPayload = await page.evaluate(() => window.__clipboardWrites.at(-1));
            const [item] = clipboardPayload;
            assert.ok(item["text/html"].includes("<img"));
            assert.ok(item["text/html"].includes(SAMPLE_IMAGE_DATA_URL));
        } finally {
            await page.close();
        }
    });

    test("initial view renders attachments", async () => {
        const page = await preparePage(browser);
        try {
            await createCard(page, {
                noteId: "initial-attachment",
                markdownText: "Here is an image placeholder![[sample-image.png]]",
                attachments: {
                    "sample-image.png": { dataUrl: SAMPLE_IMAGE_DATA_URL, altText: "Sample attachment" }
                },
                mode: "view"
            });

            const hasImg = await page.evaluate(() => {
                const card = document.querySelector('[data-note-id="initial-attachment"]');
                const preview = card?.querySelector('.markdown-content');
                return preview?.innerHTML.includes('<img') && preview?.innerHTML.includes('data:image');
            });
            assert.equal(hasImg, true);
        } finally {
            await page.close();
        }
    });

    test("clicking a note enters edit mode without reordering", async () => {
        const page = await preparePage(browser);
        try {
            await createCard(page, {
                noteId: "bubble-alpha",
                markdownText: "Alpha note",
                attachments: {},
                mode: "view"
            });

            await createCard(page, {
                noteId: "bubble-bravo",
                markdownText: "Bravo note",
                attachments: {},
                mode: "view"
            });

            let states = await getCardStates(page);
            assert.deepStrictEqual(states.map((state) => state.noteId), ["bubble-alpha", "bubble-bravo"]);

            await page.click('[data-note-id="bubble-bravo"] .markdown-content');
            await waitForCardMode(page, "bubble-bravo", "edit");

            states = await getCardStates(page);
            assert.deepStrictEqual(states.map((state) => state.noteId), ["bubble-alpha", "bubble-bravo"]);
            assert.equal(states[1].mode, "edit");
        } finally {
            await page.close();
        }
    });

    test("finalizing edits bubbles note to top", async () => {
        const page = await preparePage(browser);
        try {
            await createCard(page, {
                noteId: "bubble-edit-alpha",
                markdownText: "Alpha note",
                attachments: {},
                mode: "view"
            });

            await createCard(page, {
                noteId: "bubble-edit-bravo",
                markdownText: "Bravo note",
                attachments: {},
                mode: "view"
            });

            await page.click('[data-note-id="bubble-edit-bravo"] .markdown-content');
            await waitForCardMode(page, "bubble-edit-bravo", "edit");

            await page.evaluate((id) => {
                const card = document.querySelector(`[data-note-id="${id}"]`);
                const host = card?.__markdownHost;
                if (!host) return;
                const current = host.getValue();
                host.setValue(`${current}\nEdited at ${Date.now()}`);
            }, "bubble-edit-bravo");

            await page.click('#top-editor .markdown-editor');

            await page.waitForFunction(() => {
                const first = document.querySelector('#notes-container .markdown-block:not(.top-editor)');
                return first?.getAttribute('data-note-id') === 'bubble-edit-bravo';
            }, { timeout: 2000 });

            const statesAfter = await getCardStates(page);
            assert.equal(statesAfter[0].noteId, 'bubble-edit-bravo');
            assert.equal(statesAfter[0].mode, 'view');
        } finally {
            await page.close();
        }
    });

    test("pasting metadata recreates attachments in top editor", async () => {
        const page = await preparePage(browser);
        try {
            const markdown = "Attachment holder\n\n![[pasted-image.png]]";
            const attachments = {
                "pasted-image.png": { dataUrl: SAMPLE_IMAGE_DATA_URL, altText: "Recovered attachment" }
            };

            await createCard(page, {
                noteId: "note-copy-paste",
                markdownText: markdown,
                attachments,
                mode: "edit"
            });

            await page.click('[data-note-id="note-copy-paste"] [data-action="copy-note"]');
            await waitForClipboardWrite(page);
            await waitForCopyFeedback(page, "note-copy-paste");

            const payload = await page.evaluate(() => window.__clipboardWrites.at(-1)[0]);

            const result = await page.evaluate(async ({ payload }) => {
                const textarea = document.querySelector('#top-editor .markdown-editor');
                const preview = document.querySelector('#top-editor .markdown-content');

                textarea.focus();
                const transfer = new DataTransfer();
                Object.entries(payload).forEach(([type, value]) => transfer.setData(type, value));
                const pasteEvent = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true });
                textarea.dispatchEvent(pasteEvent);

                const { collectReferencedAttachments } = await import('./ui/imagePaste.js');

                return {
                    value: textarea.value,
                    attachments: collectReferencedAttachments(textarea),
                    previewHtml: preview.innerHTML
                };
            }, { payload });

            assert.equal(result.value, markdown);
            assert.deepStrictEqual(result.attachments, attachments);
            assert.ok(result.previewHtml.includes(SAMPLE_IMAGE_DATA_URL));
        } finally {
            await page.close();
        }
    });

    test("secondary card interactions leave primary card mode untouched", async () => {
        const page = await preparePage(browser);
        const primaryId = "note-primary-mode";
        const secondaryId = "note-secondary-mode";
        try {
            await createCard(page, {
                noteId: primaryId,
                markdownText: "Primary note",
                attachments: {},
                mode: "edit"
            });

            await createCard(page, {
                noteId: secondaryId,
                markdownText: "Secondary note",
                attachments: {},
                mode: "edit"
            });

            await focusCardEditorField(page, primaryId);
            await assertCardIsEditing(page, primaryId, "primary focused state");

            await focusCardEditorField(page, secondaryId);
            await assertCardIsView(page, primaryId, "primary after secondary focus");
            await assertCardIsEditing(page, secondaryId, "secondary focused state");

            await focusCardEditorField(page, primaryId);
            await assertCardIsEditing(page, primaryId, "primary refocused");
            await assertCardIsView(page, secondaryId, "secondary after primary refocus");

            await focusCardEditorField(page, secondaryId);
            let clipboardCount = await getClipboardWriteCount(page);
            await page.click(`[data-note-id="${secondaryId}"] [data-action="copy-note"]`);
            await waitForClipboardWrite(page, clipboardCount);
            clipboardCount = await getClipboardWriteCount(page);
            await assertCardIsView(page, primaryId, "after copying secondary");
            await assertCardIsEditing(page, secondaryId, "after copying secondary");
            await waitForCopyFeedback(page, secondaryId);

            await focusCardEditorField(page, secondaryId);
            await page.evaluate(async ({ noteId, dataUrl }) => {
                const card = document.querySelector(`[data-note-id="${noteId}"]`);
                const textarea = card?.querySelector?.('.markdown-editor');
                if (!textarea) return;
                const { insertAttachmentPlaceholders } = await import('./ui/imagePaste.js');
                const response = await fetch(dataUrl);
                const blob = await response.blob();
                const file = new File([blob], 'pasted-image.png', { type: 'image/png' });
                await insertAttachmentPlaceholders(textarea, [file]);
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
            }, { noteId: secondaryId, dataUrl: SAMPLE_IMAGE_DATA_URL });
            await assertCardIsView(page, primaryId, "after secondary receives pasted image");
            await assertCardIsEditing(page, secondaryId, "after secondary receives pasted image");

            await focusCardEditorField(page, secondaryId);
            clipboardCount = await getClipboardWriteCount(page);
            await page.click(`[data-note-id="${secondaryId}"] [data-action="copy-note"]`);
            await waitForClipboardWrite(page, clipboardCount);
            await assertCardIsView(page, primaryId, "after copying secondary with image");
            await assertCardIsEditing(page, secondaryId, "after copying secondary with image");
            await waitForCopyFeedback(page, secondaryId);
        } finally {
            await page.close();
        }
    });
});
}

async function preparePage(browser) {
    const page = await browser.newPage();

    await page.evaluateOnNewDocument(() => {
        window.__clipboardWrites = [];
        class ClipboardItemStub {
            constructor(items) {
                this.__items = items;
            }
        }
        window.ClipboardItem = ClipboardItemStub;
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                write: async (items) => {
                    const normalized = [];
                    for (const item of items) {
                        const entry = {};
                        const sources = item.__items || {};
                        const types = Object.keys(sources);
                        for (const type of types) {
                            const blob = sources[type];
                            if (blob && typeof blob.text === 'function') {
                                entry[type] = await blob.text();
                            } else if (blob != null) {
                                entry[type] = String(blob);
                            }
                        }
                        normalized.push(entry);
                    }
                    window.__clipboardWrites.push(normalized);
                },
                writeText: async (text) => {
                    window.__clipboardWrites.push([{ 'text/plain': text }]);
                }
            }
        });

        window.localStorage.clear();
    });

    await page.goto(PAGE_URL, { waitUntil: "networkidle0" });
    await page.waitForSelector("#top-editor .markdown-editor");

    return page;
}

async function createCard(page, { noteId, markdownText, attachments, mode }) {
    const timestamp = new Date().toISOString();
    await page.evaluate(async ({ record }) => {
        const { renderCard, updateActionButtons } = await import('./ui/card.js');
        const container = document.getElementById('notes-container');
        const card = renderCard(record, { notesContainer: container });
        container.appendChild(card);
        updateActionButtons(container);
    }, {
        record: {
            noteId,
            markdownText,
            attachments,
            createdAtIso: timestamp,
            updatedAtIso: timestamp,
            lastActivityIso: timestamp
        }
    });
    if (mode === 'view') {
        await page.evaluate((id) => {
            const card = document.querySelector(`[data-note-id="${id}"]`);
            const host = card?.__markdownHost;
            host?.setMode('view');
            card?.classList.remove('editing-in-place');
        }, noteId);
        await waitForCardMode(page, noteId, 'view');
    } else {
        await focusCardEditorField(page, noteId);
    }
}

async function getCardStates(page) {
    return page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.markdown-block:not(.top-editor)'));
        return cards.map((card) => ({
            noteId: card.getAttribute('data-note-id'),
            mode: card.__markdownHost?.getMode(),
            editing: card.__markdownHost?.getMode() === 'edit'
        }));
    });
}

async function waitForClipboardWrite(page, previousCount = 0) {
    await page.waitForFunction(
        (count) => (window.__clipboardWrites?.length || 0) > count,
        { timeout: 2000 },
        previousCount
    );
}

async function getClipboardWriteCount(page) {
    return page.evaluate(() => window.__clipboardWrites?.length || 0);
}

async function waitForCardMode(page, noteId, mode) {
    await page.waitForFunction(({ id, mode }) => {
        const card = document.querySelector(`[data-note-id="${id}"]`);
        return card?.__markdownHost?.getMode() === mode;
    }, { timeout: 1000 }, { id: noteId, mode });
}

async function assertCardIsEditing(page, noteId, context) {
    const states = await getCardStates(page);
    const cardState = states.find((state) => state.noteId === noteId);
    assert.ok(cardState, `Expected card ${noteId} to exist (${context})`);
    assert.equal(cardState.mode, 'edit', `Expected ${noteId} to remain in edit mode (${context})`);
}

async function focusCardEditorField(page, noteId) {
    await page.waitForSelector(`[data-note-id="${noteId}"] .markdown-content`);
    const currentMode = await page.evaluate((id) => {
        const card = document.querySelector(`[data-note-id="${id}"]`);
        return card?.__markdownHost?.getMode();
    }, noteId);
    if (currentMode !== 'edit') {
        await page.click(`[data-note-id="${noteId}"] .markdown-content`);
        await waitForCardMode(page, noteId, 'edit');
    }
    await page.waitForSelector(`[data-note-id="${noteId}"] .markdown-editor`, { visible: true });
    await page.click(`[data-note-id="${noteId}"] .markdown-editor`);
    await waitForCardMode(page, noteId, 'edit');
}

async function waitForCopyFeedback(page, noteId) {
    await page.waitForFunction(({ id, message }) => {
        const card = document.querySelector(`[data-note-id="${id}"]`);
        const feedback = card?.querySelector('.clipboard-feedback');
        return Boolean(
            feedback &&
            feedback.classList.contains('clipboard-feedback--visible') &&
            feedback.textContent === message
        );
    }, { timeout: 1000 }, { id: noteId, message: MESSAGE_NOTE_COPIED });

    await page.waitForFunction(({ id }) => {
        const card = document.querySelector(`[data-note-id="${id}"]`);
        const feedback = card?.querySelector('.clipboard-feedback');
        return !feedback || !feedback.classList.contains('clipboard-feedback--visible');
    }, { timeout: 3000 }, { id: noteId });
}

async function assertCardIsView(page, noteId, context) {
    const states = await getCardStates(page);
    const cardState = states.find((state) => state.noteId === noteId);
    assert.ok(cardState, `Expected card ${noteId} to exist (${context})`);
    assert.equal(cardState.mode, 'view', `Expected ${noteId} to be in view mode (${context})`);
}
