import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
let puppeteerModule;
try {
    ({ default: puppeteerModule } = await import("puppeteer"));
} catch (error) {
    puppeteerModule = null;
}

import { CLIPBOARD_MIME_NOTE, CLIPBOARD_METADATA_VERSION, CLIPBOARD_METADATA_DATA_URL_PREFIX, MESSAGE_NOTE_COPIED } from "../constants.js";

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
        const launchArgs = ["--allow-file-access-from-files"];
        if (process.env.CI) {
            launchArgs.push("--no-sandbox", "--disable-setuid-sandbox");
        }
        browser = await puppeteerModule.launch({
            headless: "new",
            args: launchArgs
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
            const plain = item["text/plain"];
            assert.ok(typeof plain === "string" && plain.includes(CLIPBOARD_METADATA_DATA_URL_PREFIX));
            assert.equal(stripMetadataSentinel(plain), markdown);
            const plainMetadata = readMetadataFromPlainText(plain);
            assert.ok(plainMetadata);
            assert.equal(plainMetadata.markdown, markdown);
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
            const typeMap = collectClipboardTypeMap(clipboardPayload);
            const plain = typeMap["text/plain"]?.[0] ?? "";
            const stripped = stripMetadataSentinel(plain);
            assert.ok(stripped.includes(SAMPLE_IMAGE_DATA_URL));
            assert.ok(plain.includes(CLIPBOARD_METADATA_DATA_URL_PREFIX));

            const imageValues = typeMap["image/png"] ?? [];
            assert.ok(imageValues.includes(SAMPLE_IMAGE_DATA_URL));

            const htmlSample = typeMap["text/html"]?.[0] ?? "";
            assert.ok(htmlSample.includes(SAMPLE_IMAGE_DATA_URL));

            const metadataRaw = typeMap[CLIPBOARD_MIME_NOTE]?.[0] ?? "";
            const metadata = metadataRaw ? JSON.parse(metadataRaw) : null;
            assert.ok(metadata);
            assert.equal(metadata.version, CLIPBOARD_METADATA_VERSION);
            assert.ok(typeof metadata.markdown === 'string');
            assert.ok(metadata.markdown.includes('![[') || metadata.markdown.includes('data:image'));
            assert.ok(typeof metadata.markdownExpanded === 'string');
            assert.ok(metadata.markdownExpanded.includes('![Sample attachment]'));
            assert.deepStrictEqual(metadata.attachments, attachments);
        } finally {
            await page.close();
        }
    });

    test("edit-mode copy plain text matches expanded markdown", async () => {
        const page = await preparePage(browser);
        try {
            const markdown = "Header\n\n![[sample-image.png]]";
            const attachments = {
                "sample-image.png": { dataUrl: SAMPLE_IMAGE_DATA_URL, altText: "Sample attachment" }
            };

            await createCard(page, {
                noteId: "note-copy-expanded-check",
                markdownText: markdown,
                attachments,
                mode: "edit"
            });

            await page.click('[data-note-id="note-copy-expanded-check"] [data-action="copy-note"]');
            await waitForClipboardWrite(page);
            await waitForCopyFeedback(page, "note-copy-expanded-check");

            const clipboardPayload = await page.evaluate(() => window.__clipboardWrites.at(-1));
            const typeMap = collectClipboardTypeMap(clipboardPayload);
            const stripped = stripMetadataSentinel(typeMap["text/plain"]?.[0] ?? "");
            assert.ok(stripped.includes(SAMPLE_IMAGE_DATA_URL));
            assert.ok((typeMap["text/plain"]?.[0] ?? "").includes(CLIPBOARD_METADATA_DATA_URL_PREFIX));
            assert.equal(typeMap["image/png"]?.[0], SAMPLE_IMAGE_DATA_URL);
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
            assert.ok(item["text/plain"].includes(CLIPBOARD_METADATA_DATA_URL_PREFIX));
            assert.ok(!stripMetadataSentinel(item["text/plain"]).includes("<"));
            assert.ok(item["text/html"].includes("<strong>"));
            assert.ok(!item["image/png"]);
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
            assert.ok(item["text/plain"].includes(SAMPLE_IMAGE_DATA_URL));
            assert.ok(item["text/plain"].includes(CLIPBOARD_METADATA_DATA_URL_PREFIX));
            assert.ok(item["text/html"].includes("<img"));
            assert.ok(item["text/html"].includes(SAMPLE_IMAGE_DATA_URL));
        } finally {
            await page.close();
        }
    });

    test("fallback markdown copy restores attachments on paste", async () => {
        const page = await preparePage(browser);
        try {
            await setClipboardAsyncSupport(page, false);
            const markdown = "Intro text\n\n![[sample-image.png]]";
            const attachments = {
                "sample-image.png": { dataUrl: SAMPLE_IMAGE_DATA_URL, altText: "Sample attachment" }
            };

            await createCard(page, {
                noteId: "fallback-markdown-copy",
                markdownText: markdown,
                attachments,
                mode: "edit"
            });

            let clipboardCount = await getClipboardWriteCount(page);
            await page.click('[data-note-id="fallback-markdown-copy"] [data-action="copy-note"]');
            await waitForClipboardWrite(page, clipboardCount);
            await waitForCopyFeedback(page, "fallback-markdown-copy");

            const entry = await page.evaluate(() => window.__clipboardWrites.at(-1)[0]);
            assert.ok(entry["text/plain"].includes(CLIPBOARD_METADATA_DATA_URL_PREFIX));
            assert.ok(stripMetadataSentinel(entry["text/plain"]).includes(SAMPLE_IMAGE_DATA_URL));
            const metadata = readMetadataFromPlainText(entry["text/plain"]);
            assert.ok(metadata);
            assert.deepStrictEqual(metadata.attachments, attachments);

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
            }, { payload: entry });

            assert.equal(result.value, markdown);
            assert.deepStrictEqual(result.attachments, attachments);
            assert.ok(result.previewHtml.includes(SAMPLE_IMAGE_DATA_URL));
        } finally {
            await setClipboardAsyncSupport(page, true);
            await page.close();
        }
    });

    test("fallback rendered copy restores attachments on paste", async () => {
        const page = await preparePage(browser);
        try {
            await setClipboardAsyncSupport(page, false);
            const markdown = "Here is an image placeholder ![[sample-image.png]]";
            const attachments = {
                "sample-image.png": { dataUrl: SAMPLE_IMAGE_DATA_URL, altText: "Sample attachment" }
            };

            await createCard(page, {
                noteId: "fallback-rendered-copy",
                markdownText: markdown,
                attachments,
                mode: "view"
            });

            let clipboardCount = await getClipboardWriteCount(page);
            await page.click('[data-note-id="fallback-rendered-copy"] [data-action="copy-note"]');
            await waitForClipboardWrite(page, clipboardCount);
            await waitForCopyFeedback(page, "fallback-rendered-copy");

            const entry = await page.evaluate(() => window.__clipboardWrites.at(-1)[0]);
            assert.ok(entry["text/plain"].includes(SAMPLE_IMAGE_DATA_URL));
            assert.ok(entry["text/plain"].includes(CLIPBOARD_METADATA_DATA_URL_PREFIX));

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
            }, { payload: entry });

            assert.equal(result.value.includes('![[sample-image.png]]'), true);
            assert.deepStrictEqual(result.attachments, attachments);
            assert.ok(result.previewHtml.includes(SAMPLE_IMAGE_DATA_URL));
        } finally {
            await setClipboardAsyncSupport(page, true);
            await page.close();
        }
    });

    test("fallback copy handles multiple attachments", async () => {
        const page = await preparePage(browser);
        try {
            await setClipboardAsyncSupport(page, false);
            const markdown = "Gallery\n\n![[image-one.png]]\n\n![[image-two.png]]";
            const attachments = {
                "image-one.png": { dataUrl: SAMPLE_IMAGE_DATA_URL, altText: "First attachment" },
                "image-two.png": { dataUrl: SAMPLE_IMAGE_DATA_URL, altText: "Second attachment" }
            };

            await createCard(page, {
                noteId: "fallback-multi-copy",
                markdownText: markdown,
                attachments,
                mode: "edit"
            });

            let clipboardCount = await getClipboardWriteCount(page);
            await page.click('[data-note-id="fallback-multi-copy"] [data-action="copy-note"]');
            await waitForClipboardWrite(page, clipboardCount);
            await waitForCopyFeedback(page, "fallback-multi-copy");

            const entry = await page.evaluate(() => window.__clipboardWrites.at(-1)[0]);
            assert.ok(entry["text/plain"].includes(CLIPBOARD_METADATA_DATA_URL_PREFIX));
            const stripped = stripMetadataSentinel(entry["text/plain"]);
            const occurrences = stripped.match(new RegExp(SAMPLE_IMAGE_DATA_URL, 'g')) || [];
            assert.equal(occurrences.length >= 2, true);
            const metadata = readMetadataFromPlainText(entry["text/plain"]);
            assert.ok(metadata);
            assert.deepStrictEqual(metadata.attachments, attachments);

            const result = await page.evaluate(async ({ payload }) => {
                const textarea = document.querySelector('#top-editor .markdown-editor');
                textarea.focus();
                const transfer = new DataTransfer();
                Object.entries(payload).forEach(([type, value]) => transfer.setData(type, value));
                const pasteEvent = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true });
                textarea.dispatchEvent(pasteEvent);
                const { collectReferencedAttachments } = await import('./ui/imagePaste.js');
                return {
                    value: textarea.value,
                    attachments: collectReferencedAttachments(textarea)
                };
            }, { payload: entry });

            assert.equal(result.value, markdown);
            assert.deepStrictEqual(result.attachments, attachments);
        } finally {
            await setClipboardAsyncSupport(page, true);
            await page.close();
        }
    });

    test("rendered-mode copy + paste recreates attachments", async () => {
        const page = await preparePage(browser);
        try {
            const markdown = "Here is an image placeholder ![[sample-image.png]]";
            const attachments = {
                "sample-image.png": { dataUrl: SAMPLE_IMAGE_DATA_URL, altText: "Sample attachment" }
            };

            await createCard(page, {
                noteId: "copy-view-attachments",
                markdownText: markdown,
                attachments,
                mode: "view"
            });

            await page.click('[data-note-id="copy-view-attachments"] [data-action="copy-note"]');
            await waitForClipboardWrite(page);
            await waitForCopyFeedback(page, "copy-view-attachments");

            const clipboardPayload = await page.evaluate(() => window.__clipboardWrites.at(-1));
            const typeMap = collectClipboardTypeMap(clipboardPayload);
            assert.equal(typeMap["image/png"]?.[0], SAMPLE_IMAGE_DATA_URL);
            const payload = firstValueClipboardPayload(clipboardPayload);

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

            assert.equal(result.value.includes('![[sample-image.png]]'), true);
            assert.deepStrictEqual(result.attachments, attachments);
            assert.equal(result.previewHtml.includes(SAMPLE_IMAGE_DATA_URL), true);
        } finally {
            await page.close();
        }
    });

    test("EasyMDE paste restores Gravity attachments", async () => {
        const page = await preparePage(browser, { enableMarkdownEditor: true });
        let pageClosed = false;
        try {
            const easyMdeAvailable = await page.evaluate(() => typeof window.EasyMDE === "function");
            if (!easyMdeAvailable) {
                await page.close();
                pageClosed = true;
                test.skip("EasyMDE unavailable in this environment.");
            }

            await page.waitForSelector("#top-editor .CodeMirror textarea");
            const markdown = "Attachment holder\n\n![[sample-image.png]]";
            const attachments = {
                "sample-image.png": { dataUrl: SAMPLE_IMAGE_DATA_URL, altText: "Sample attachment" }
            };

            await createCard(page, {
                noteId: "easymde-source-note",
                markdownText: markdown,
                attachments,
                mode: "view"
            });

            await page.click('[data-note-id="easymde-source-note"] [data-action="copy-note"]');
            await waitForClipboardWrite(page);
            await waitForCopyFeedback(page, "easymde-source-note");

            const clipboardPayload = await page.evaluate(() => window.__clipboardWrites.at(-1));
            const payload = firstValueClipboardPayload(clipboardPayload);

            const result = await page.evaluate(async ({ payload }) => {
                const wrapper = document.querySelector('#top-editor .markdown-block');
                const host = wrapper?.__markdownHost;
                const preview = wrapper?.querySelector('.markdown-content');
                const editorElement = wrapper?.querySelector('.CodeMirror textarea');
                if (!wrapper || !host || !editorElement) {
                    return { value: "", attachments: {}, previewHtml: "", enhanced: false };
                }

                host.focus();

                const transfer = new DataTransfer();
                Object.entries(payload).forEach(([type, value]) => transfer.setData(type, value));
                const pasteEvent = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true });
                editorElement.dispatchEvent(pasteEvent);

                await new Promise((resolve) => setTimeout(resolve, 0));

                const { collectReferencedAttachments } = await import('./ui/imagePaste.js');
                return {
                    value: host.getValue(),
                    attachments: collectReferencedAttachments(host.getTextarea()),
                    previewHtml: preview?.innerHTML ?? "",
                    enhanced: host.isEnhanced()
                };
            }, { payload });

            assert.equal(result.enhanced, true);
            assert.equal(result.value.includes('![[sample-image.png]]'), true);
            assert.deepStrictEqual(result.attachments, attachments);
            assert.equal(result.previewHtml.includes(SAMPLE_IMAGE_DATA_URL), true);
        } finally {
            if (!pageClosed) {
                await page.close();
            }
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

            const clipboardPayload = await page.evaluate(() => window.__clipboardWrites.at(-1));
            const payload = firstValueClipboardPayload(clipboardPayload);

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

async function preparePage(browser, options = {}) {
    const page = await browser.newPage();

    if (options.enableMarkdownEditor) {
        await page.evaluateOnNewDocument(() => {
            window.__gravityForceMarkdownEditor = true;
        });
    }

    await page.evaluateOnNewDocument(() => {
        window.__clipboardWrites = [];

        const clipboardWrites = window.__clipboardWrites;

        class ClipboardItemStub {
            constructor(items) {
                this.__items = items;
            }
        }

        async function normalizeClipboardItems(items) {
            const normalized = [];
            for (const item of items) {
                const entry = {};
                const sources = item.__items || {};
                const types = Object.keys(sources);
                for (const type of types) {
                    const blob = sources[type];
                    if (blob && type.startsWith('image/') && typeof blob.arrayBuffer === 'function') {
                        const buffer = await blob.arrayBuffer();
                        const base64 = arrayBufferToBase64(buffer);
                        entry[type] = `data:${blob.type};base64,${base64}`;
                    } else if (blob && typeof blob.text === 'function') {
                        entry[type] = await blob.text();
                    } else if (blob != null) {
                        entry[type] = String(blob);
                    }
                }
                normalized.push(entry);
            }
            return normalized;
        }

        const clipboardStub = {
            write: async (items) => {
                const normalized = await normalizeClipboardItems(items);
                clipboardWrites.push(normalized);
            },
            writeText: async (text) => {
                clipboardWrites.push([{ 'text/plain': text }]);
            }
        };

        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: clipboardStub
        });

        window.__setClipboardAsyncSupport = (enabled) => {
            if (enabled) {
                clipboardStub.write = async (items) => {
                    const normalized = await normalizeClipboardItems(items);
                    clipboardWrites.push(normalized);
                };
                window.ClipboardItem = ClipboardItemStub;
            } else {
                clipboardStub.write = undefined;
                window.ClipboardItem = undefined;
            }
        };

        window.__setClipboardAsyncSupport(true);

        document.addEventListener('copy', (event) => {
            if (!event?.clipboardData) return;
            const entry = {};
            for (const type of event.clipboardData.types) {
                try {
                    entry[type] = event.clipboardData.getData(type);
                } catch (error) {
                    // Ignore read errors for unsupported types
                }
            }
            if (Object.keys(entry).length > 0) {
                clipboardWrites.push([entry]);
            }
        });

        window.localStorage.clear();
        function arrayBufferToBase64(buffer) {
            let binary = '';
            const bytes = new Uint8Array(buffer);
            for (let i = 0; i < bytes.byteLength; i += 1) {
                binary += String.fromCharCode(bytes[i]);
            }
            return btoa(binary);
        }
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

async function setClipboardAsyncSupport(page, enabled) {
    await page.evaluate((flag) => {
        window.__setClipboardAsyncSupport(Boolean(flag));
    }, enabled);
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

function stripMetadataSentinel(plainText) {
    if (typeof plainText !== 'string') return '';
    const index = plainText.lastIndexOf(CLIPBOARD_METADATA_DATA_URL_PREFIX);
    if (index === -1) return plainText;
    let before = plainText.slice(0, index);
    if (before.endsWith('\n\n')) {
        before = before.slice(0, -2);
    } else if (before.endsWith('\n') || before.endsWith('\r')) {
        before = before.slice(0, -1);
    }
    return before;
}

function readMetadataFromPlainText(plainText) {
    if (typeof plainText !== 'string') return null;
    const index = plainText.lastIndexOf(CLIPBOARD_METADATA_DATA_URL_PREFIX);
    if (index === -1) return null;
    const encodedSection = plainText.slice(index + CLIPBOARD_METADATA_DATA_URL_PREFIX.length);
    const match = encodedSection.match(/^([A-Za-z0-9+/=]+)/);
    if (!match) return null;
    try {
        const json = Buffer.from(match[1], 'base64').toString('utf8');
        return JSON.parse(json);
    } catch (error) {
        return null;
    }
}

function collectClipboardTypeMap(payload) {
    const map = {};
    if (!Array.isArray(payload)) return map;
    for (const item of payload) {
        if (!item || typeof item !== 'object') continue;
        for (const [type, value] of Object.entries(item)) {
            if (!map[type]) map[type] = [];
            map[type].push(value);
        }
    }
    return map;
}

function firstValueClipboardPayload(payload) {
    const typeMap = collectClipboardTypeMap(payload);
    const result = {};
    for (const [type, values] of Object.entries(typeMap)) {
        if (values.length > 0) {
            result[type] = values[0];
        }
    }
    return result;
}
