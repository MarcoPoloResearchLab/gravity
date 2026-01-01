import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { appConfig } from "../js/core/config.js?build=2026-01-01T21:20:40Z";
import { createSharedPage } from "./helpers/browserHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

const FIRST_NOTE_ID = "gn71-primary";
const SECOND_NOTE_ID = "gn71-secondary";

const LONG_MARKDOWN_BLOCK = [
    "# Overflowing heading",
    "",
    "Paragraph one describes the behaviour of expanding htmlViews within the Gravity Notes grid.",
    "Paragraph two adds more prose to ensure the htmlView requires expansion to show full content.",
    "Paragraph three keeps going with additional markdown lines so the rendered htmlView needs scrolling.",
    "",
    "- List item A stretches the rendered height a little further.",
    "- List item B adds even more content to the htmlView container.",
    "- List item C continues the overflow scenario required by the test.",
    "",
    "```js",
    "function sample() {",
    "  return \"markdown content\";",
    "}",
    "```",
    "",
    "Final paragraph emphasises the need for a tall htmlView."
].join("\n");

const SECONDARY_MARKDOWN = [
    "# Secondary note",
    "",
    "This record also overflows the htmlView surface so that multiple cards can be expanded at once.",
    "",
    "> Quotes and additional text contribute to the htmlView height.",
    "",
    "- Additional bullet one",
    "- Additional bullet two",
    "- Additional bullet three"
].join("\n");

test.describe("GN-71 note expansion persistence", () => {
    test("expansions persist across cards and edit mode preserves expanded height", async () => {
        const seededRecords = [
            buildNoteRecord({ noteId: FIRST_NOTE_ID, markdownText: LONG_MARKDOWN_BLOCK }),
            buildNoteRecord({ noteId: SECOND_NOTE_ID, markdownText: SECONDARY_MARKDOWN })
        ];
        const { page, teardown } = await openPageWithRecords(seededRecords);
        const firstCardSelector = `.markdown-block[data-note-id="${FIRST_NOTE_ID}"]`;
        const secondCardSelector = `.markdown-block[data-note-id="${SECOND_NOTE_ID}"]`;
        const firstHtmlViewSelector = `${firstCardSelector} .note-html-view`;
        const secondHtmlViewSelector = `${secondCardSelector} .note-html-view`;

        try {
            await page.waitForSelector(firstHtmlViewSelector);
            await page.waitForSelector(secondHtmlViewSelector);

            await page.click(`${firstCardSelector} .note-expand-toggle`);
            await page.waitForSelector(`${firstHtmlViewSelector}.note-html-view--expanded`);
            const firstExpandedHeight = await getElementHeight(page, firstHtmlViewSelector);
            assert.ok(firstExpandedHeight > 0, "expanded htmlView should report a positive height");
            const firstExpandedCardHeight = await getElementHeight(page, firstCardSelector);
            const cardPadding = await page.$eval(firstCardSelector, (element) => {
                if (!(element instanceof HTMLElement)) {
                    return { paddingTop: 0, paddingBottom: 0 };
                }
                const computed = window.getComputedStyle(element);
                const paddingTop = Number.parseFloat(computed.paddingTop || "0") || 0;
                const paddingBottom = Number.parseFloat(computed.paddingBottom || "0") || 0;
                return { paddingTop, paddingBottom };
            });
            const interiorCardHeight = firstExpandedCardHeight - cardPadding.paddingTop - cardPadding.paddingBottom;
            const expansionTolerancePx = 32;
            assert.ok(
                Math.abs(interiorCardHeight - firstExpandedHeight) <= expansionTolerancePx,
                `expanded card interior height (${interiorCardHeight}) should align with htmlView height (${firstExpandedHeight}) within ${expansionTolerancePx}px`
            );

            await page.click(`${secondCardSelector} .note-expand-toggle`);
            await page.waitForSelector(`${secondHtmlViewSelector}.note-html-view--expanded`);

            const firstStillExpanded = await isHtmlViewExpanded(page, firstHtmlViewSelector);
            assert.equal(firstStillExpanded, true, "first card must remain expanded after expanding the second card");

            await page.click(firstCardSelector, { clickCount: 2 });
            await page.waitForSelector(`${firstCardSelector}.editing-in-place`);
            await page.waitForSelector(`${firstCardSelector} .CodeMirror-scroll`);
            const editorHeight = await getElementHeight(page, `${firstCardSelector} .CodeMirror-scroll`);
            assert.ok(editorHeight > 0, "editing surface should report a measurable height");
            const editorOverflowSnapshot = await page.$eval(
                `${firstCardSelector} .CodeMirror-scroll`,
                (element) => {
                    if (!(element instanceof HTMLElement)) {
                        return null;
                    }
                    const computed = window.getComputedStyle(element);
                    return {
                        overflowY: computed.overflowY
                    };
                }
            );
            assert.ok(editorOverflowSnapshot, "expected edit surface overflow snapshot");
            assert.notEqual(
                editorOverflowSnapshot.overflowY,
                "auto",
                "expanded edit surface must not rely on auto overflow"
            );
            assert.notEqual(
                editorOverflowSnapshot.overflowY,
                "scroll",
                "expanded edit surface must not introduce scrollbars"
            );
            const editingCardHeight = await getElementHeight(page, firstCardSelector);
            const editingTolerancePx = 64;
            assert.ok(
                Math.abs(editingCardHeight - firstExpandedCardHeight) <= editingTolerancePx,
                `editing card height (${editingCardHeight}) should track expanded view height (${firstExpandedCardHeight}) within ${editingTolerancePx}px`
            );
            const editorShrinkAllowancePx = 64;
            assert.ok(
                editorHeight >= firstExpandedHeight - editorShrinkAllowancePx,
                `editor height (${editorHeight}) should not shrink appreciably from htmlView height (${firstExpandedHeight})`
            );
            const editingInlineSizing = await getInlineCardSizing(page, firstCardSelector);
            assert.ok(
                editingInlineSizing.minHeight.endsWith("px"),
                `card must carry an inline minHeight lock during editing (${editingInlineSizing.minHeight})`
            );
            assert.equal(
                editingInlineSizing.maxHeight,
                "",
                "card must not apply a maxHeight lock when expanded editing should grow"
            );
            assert.ok(
                editingInlineSizing.cssVariable.endsWith("px"),
                `card must expose the CSS variable height lock during editing (${editingInlineSizing.cssVariable})`
            );

            await page.keyboard.down("Shift");
            await page.keyboard.press("Enter");
            await page.keyboard.up("Shift");

            await page.waitForSelector(`${firstHtmlViewSelector}.note-html-view--expanded`);
            const postEditHtmlViewHeight = await getElementHeight(page, firstHtmlViewSelector);
            const postEditCardHeight = await getElementHeight(page, firstCardSelector);
            const postEditTolerancePx = 64;
            assert.ok(
                Math.abs(postEditHtmlViewHeight - firstExpandedHeight) <= postEditTolerancePx,
                `expanded htmlView height should remain within ${postEditTolerancePx}px after editing (${postEditHtmlViewHeight} vs ${firstExpandedHeight})`
            );
            assert.ok(
                Math.abs(postEditCardHeight - firstExpandedCardHeight) <= editingTolerancePx,
                `card height should remain stable after editing (${postEditCardHeight} vs ${firstExpandedCardHeight})`
            );
            await page.waitForFunction((selector) => {
                const element = document.querySelector(selector);
                if (!(element instanceof HTMLElement)) {
                    return false;
                }
                return (
                    element.style.minHeight === "" &&
                    element.style.maxHeight === "" &&
                    element.style.getPropertyValue("--note-expanded-edit-height") === ""
                );
            }, {}, firstCardSelector);
            const releasedInlineSizing = await getInlineCardSizing(page, firstCardSelector);
            assert.equal(
                releasedInlineSizing.minHeight,
                "",
                "card minHeight lock must be cleared after exiting edit mode"
            );
            assert.equal(
                releasedInlineSizing.maxHeight,
                "",
                "card maxHeight lock must be cleared after exiting edit mode"
            );
            assert.equal(
                releasedInlineSizing.cssVariable,
                "",
                "CSS variable height lock must be cleared after exiting edit mode"
            );

            const secondStillExpanded = await isHtmlViewExpanded(page, secondHtmlViewSelector);
            assert.equal(secondStillExpanded, true, "second card should remain expanded after editing the first card");

            await page.click(`${firstCardSelector} .note-expand-toggle`);
            await page.waitForFunction((selector) => {
                const htmlView = document.querySelector(selector);
                return !(htmlView instanceof HTMLElement) || !htmlView.classList.contains("note-html-view--expanded");
            }, {}, firstHtmlViewSelector);
            const collapseResult = await isHtmlViewExpanded(page, firstHtmlViewSelector);
            assert.equal(collapseResult, false, "expanded card should collapse after explicit click");

            const secondAfterCollapse = await isHtmlViewExpanded(page, secondHtmlViewSelector);
            assert.equal(secondAfterCollapse, true, "collapsing one card must not affect other expanded cards");
        } finally {
            await teardown();
        }
    });
});

test("clicking near the bottom of an expanded card enters edit mode", async () => {
    const seededRecords = [
        buildNoteRecord({ noteId: FIRST_NOTE_ID, markdownText: LONG_MARKDOWN_BLOCK })
    ];
    const { page, teardown } = await openPageWithRecords(seededRecords);
    const firstCardSelector = `.markdown-block[data-note-id="${FIRST_NOTE_ID}"]`;
    const firstHtmlViewSelector = `${firstCardSelector} .note-html-view`;

    try {
        await page.waitForSelector(firstHtmlViewSelector);
        await page.click(`${firstCardSelector} .note-expand-toggle`);
        await page.waitForSelector(`${firstHtmlViewSelector}.note-html-view--expanded`);
        const clickTarget = await page.$eval(firstHtmlViewSelector, (element) => {
            if (!(element instanceof HTMLElement)) {
                return null;
            }
            const rect = element.getBoundingClientRect();
            return {
                x: rect.left + rect.width / 2,
                y: rect.bottom - Math.max(36, rect.height / 4)
            };
        });
        assert.ok(clickTarget, "expected to resolve a click target near the bottom of the htmlView");
        if (clickTarget) {
            await page.mouse.move(clickTarget.x, clickTarget.y);
            await page.mouse.click(clickTarget.x, clickTarget.y, { clickCount: 1 });
        }
        await page.waitForSelector(`${firstCardSelector}.editing-in-place`, { timeout: 4000 });
    } finally {
        await teardown();
    }
});

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

async function getElementHeight(page, selector) {
    return page.$eval(selector, (element) => {
        if (!(element instanceof HTMLElement)) {
            return 0;
        }
        return Math.round(element.getBoundingClientRect().height);
    });
}

async function isHtmlViewExpanded(page, selector) {
    return page.$eval(selector, (element) => {
        if (!(element instanceof HTMLElement)) {
            return false;
        }
        return element.classList.contains("note-html-view--expanded");
    }).catch(() => false);
}

async function getInlineCardSizing(page, selector) {
    return page.$eval(selector, (element) => {
        if (!(element instanceof HTMLElement)) {
            return { minHeight: "", maxHeight: "", cssVariable: "" };
        }
        return {
            minHeight: element.style.minHeight,
            maxHeight: element.style.maxHeight,
            cssVariable: element.style.getPropertyValue("--note-expanded-edit-height")
        };
    });
}
