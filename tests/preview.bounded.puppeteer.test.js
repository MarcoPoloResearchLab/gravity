import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { appConfig } from "../js/core/config.js";
import { createSharedPage } from "./helpers/browserHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

const SHORT_NOTE_ID = "preview-short-note";
const MEDIUM_NOTE_ID = "preview-medium-note";
const LONG_NOTE_ID = "preview-long-note";
const TRAILING_IMAGE_NOTE_ID = "preview-trailing-img";

const SAMPLE_IMAGE_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAHUlEQVQoU2NkYGD4z0AEYBxVSFcwCiA5GgYAAP//AwBh0CY6AAAAAElFTkSuQmCC";
const LARGE_IMAGE_DATA_URL = SAMPLE_IMAGE_DATA_URL;

test.describe("Bounded previews", () => {
    test("preview clamps content with fade, continuation marker, and code badge", async () => {
        const { page, teardown } = await openPreviewHarness(createBaselineRecords());
        try {
            await collapseAllPreviews(page);

            const previewSelector = `[data-note-id="${LONG_NOTE_ID}"] .note-preview`;
            await page.waitForSelector(previewSelector);

            const { overflowY, offsetHeight, scrollHeight } = await page.$eval(previewSelector, (element) => {
                const computed = window.getComputedStyle(element);
                return {
                    overflowY: computed.overflowY,
                    offsetHeight: element.offsetHeight,
                    scrollHeight: element.scrollHeight
                };
            });
            assert.equal(overflowY, "hidden");
            const viewportHeight = await page.evaluate(() => window.innerHeight);
            const maxHeightPx = viewportHeight * 0.18;
            assert.ok(offsetHeight <= maxHeightPx + 4, "preview should remain within 18vh");
            assert.ok(scrollHeight > offsetHeight, "long note should overflow and rely on fade");

            const continuationHtml = await page.$eval(previewSelector, (element) => element.innerHTML || "");
            assert.ok(!/…continues/.test(continuationHtml), "preview should not inject continuation marker text");

            const fadeBackground = await page.$eval(
                previewSelector,
                (element) => window.getComputedStyle(element, "::after").backgroundImage || ""
            );
            assert.ok(fadeBackground.includes("linear-gradient"));

            const badgeTexts = await page.$$eval(
                `[data-note-id="${LONG_NOTE_ID}"] .note-badge`,
                (nodes) => nodes.map((node) => node.textContent?.trim() || "")
            );
            assert.deepEqual(badgeTexts, ["code"], "only the code badge should remain for long notes");

            const toggleSelector = `[data-note-id="${LONG_NOTE_ID}"] .note-expand-toggle`;
            await page.waitForSelector(toggleSelector);
            const toggleVisible = await page.$eval(toggleSelector, (button) => button instanceof HTMLElement && button.hidden === false);
            assert.equal(toggleVisible, true, "expand toggle should appear for overflowing previews");

            const shortToggleHidden = await page.$eval(
                `[data-note-id="${SHORT_NOTE_ID}"] .note-expand-toggle`,
                (button) => button.hidden
            );
            assert.equal(shortToggleHidden, true, "chevron toggle should stay hidden on short previews");

            const { mediumOverflow, mediumToggleHidden } = await page.$eval(
                `[data-note-id="${MEDIUM_NOTE_ID}"]`,
                (card) => {
                    const preview = card.querySelector(".note-preview");
                    const toggle = card.querySelector(".note-expand-toggle");
                    if (!(preview instanceof HTMLElement) || !(toggle instanceof HTMLElement)) {
                        return { mediumOverflow: false, mediumToggleHidden: true };
                    }
                    const overflow = preview.scrollHeight - preview.clientHeight > 0.5;
                    return {
                        mediumOverflow: overflow,
                        mediumToggleHidden: toggle.hidden
                    };
                }
            );
            if (mediumOverflow) {
                assert.equal(mediumToggleHidden, false, "chevron toggle should appear when medium previews overflow");
            } else {
                assert.equal(mediumToggleHidden, true, "chevron toggle should stay hidden when medium previews fit within bounds");
            }

            const toggleAlignment = await page.$eval(
                `[data-note-id="${LONG_NOTE_ID}"]`,
                (card) => {
                    const preview = card.querySelector(".note-preview");
                    const toggle = card.querySelector(".note-expand-toggle");
                    if (!(preview instanceof HTMLElement) || !(toggle instanceof HTMLElement)) {
                        return null;
                    }
                    const previewRect = preview.getBoundingClientRect();
                    const toggleRect = toggle.getBoundingClientRect();
                    return {
                        bottomDelta: Math.abs(previewRect.bottom - toggleRect.bottom),
                        rightDelta: Math.abs(previewRect.right - toggleRect.right)
                    };
                }
            );
            assert.ok(toggleAlignment, "expand toggle should render alongside the preview");
            assert.ok(
                toggleAlignment.bottomDelta <= 4,
                `expand toggle should align with the bottom edge of the text column (delta=${toggleAlignment?.bottomDelta ?? "n/a"})`
            );

            await page.focus(toggleSelector);
            await page.keyboard.press("Enter");
            await page.waitForFunction((selector) => {
                const node = document.querySelector(selector);
                return node?.classList.contains("note-preview--expanded") ?? false;
            }, {}, previewSelector);

            const imagePreviewHtml = await page.$eval(
                `[data-note-id="image-only"] .note-preview`,
                (element) => element.innerHTML
            );
            assert.ok(/<img/i.test(imagePreviewHtml), "image-only note should render inline <img>");

            const imageMetrics = await page.$eval(
                `[data-note-id="image-only"] .note-preview img`,
                (img) => {
                    const style = window.getComputedStyle(img);
                    return {
                        objectFit: style.objectFit,
                        objectPosition: style.objectPosition,
                        clientHeight: Math.round(img.clientHeight),
                        naturalHeight: img.naturalHeight
                    };
                }
            );
            assert.equal(imageMetrics.objectFit, "contain", "preview images should preserve aspect ratio inside container");
            assert.ok(/^(0%|left)/i.test(imageMetrics.objectPosition), "preview image should anchor to the top");
            assert.notEqual(imageMetrics.clientHeight, 120, "preview image height must not be hard-coded to 120px");

            const trailingImageMetrics = await page.$eval(
                `[data-note-id="${TRAILING_IMAGE_NOTE_ID}"] .note-preview`,
                (preview) => {
                    const img = preview.querySelector("img");
                    if (!img) {
                        return null;
                    }
                    const previewRect = preview.getBoundingClientRect();
                    const imgRect = img.getBoundingClientRect();
                    return {
                        imgRelativeTop: imgRect.top - previewRect.top,
                        previewHeight: previewRect.height
                    };
                }
            );
            assert.ok(trailingImageMetrics, "trailing image should exist in rendered markup");
            if (trailingImageMetrics) {
                assert.ok(
                    trailingImageMetrics.imgRelativeTop >= trailingImageMetrics.previewHeight,
                    "trailing image should fall below the visible preview window"
                );
            }

        } finally {
            await teardown();
        }
    });

    test("expanding preview preserves viewport position", async () => {
        const { page, teardown } = await openPreviewHarness(createBaselineRecords());
        try {
            await collapseAllPreviews(page);

            const previewSelector = `[data-note-id="${LONG_NOTE_ID}"] .note-preview`;
            const toggleSelector = `[data-note-id="${LONG_NOTE_ID}"] .note-expand-toggle`;

            await page.waitForSelector(previewSelector);

            const beforeMetrics = await page.evaluate(({ previewSelector }) => {
                const preview = document.querySelector(previewSelector);
                return {
                    scrollY: window.scrollY,
                    previewScrollTop: preview?.scrollTop ?? null
                };
            }, { previewSelector });

            await page.focus(toggleSelector);
            await page.keyboard.press("Enter");
            await page.waitForFunction((selector) => {
                const node = document.querySelector(selector);
                return node?.classList.contains("note-preview--expanded") ?? false;
            }, {}, previewSelector);
            await page.evaluate(() => new Promise((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(resolve));
            }));

            const afterMetrics = await page.evaluate(({ previewSelector }) => {
                const preview = document.querySelector(previewSelector);
                return {
                    scrollY: window.scrollY,
                    previewScrollTop: preview?.scrollTop ?? null
                };
            }, { previewSelector });

            if (typeof beforeMetrics?.previewScrollTop === "number" && typeof afterMetrics?.previewScrollTop === "number") {
                assert.ok(afterMetrics.previewScrollTop <= 1, "expanded preview should maintain top scroll position");
            }

            const previewViewport = await page.$eval(previewSelector, (node) => {
                const rect = node.getBoundingClientRect();
                return {
                    top: rect.top,
                    bottom: rect.bottom,
                    viewportHeight: window.innerHeight
                };
            });
            assert.ok(
                previewViewport.top >= -4 && previewViewport.top <= previewViewport.viewportHeight * 0.5,
                `expanded preview top ${previewViewport.top} should remain within the upper half of the viewport`
            );
            assert.ok(previewViewport.bottom > previewViewport.top, "expanded preview should have non-zero height");
        } finally {
            await teardown();
        }
    });

    test("short previews hide the expand toggle and medium previews follow overflow state", async () => {
        const { page, teardown } = await openPreviewHarness(createShortMediumRecords());
        try {
            await collapseAllPreviews(page);
            await page.waitForSelector(`[data-note-id="${SHORT_NOTE_ID}"]`);

            const shortToggleDisplay = await page.$eval(
                `[data-note-id="${SHORT_NOTE_ID}"] .note-expand-toggle`,
                (button) => window.getComputedStyle(button).display
            );
            assert.equal(shortToggleDisplay, "none", "short previews must not render the expand toggle");

            const mediumToggleState = await page.$eval(
                `[data-note-id="${MEDIUM_NOTE_ID}"]`,
                (card) => {
                    const preview = card.querySelector(".note-preview");
                    const toggle = card.querySelector(".note-expand-toggle");
                    if (!(preview instanceof HTMLElement) || !(toggle instanceof HTMLElement)) {
                        return { display: "none", overflow: false };
                    }
                    const style = window.getComputedStyle(toggle);
                    const overflow = preview.scrollHeight - preview.clientHeight > 0.5;
                    return {
                        display: style.display,
                        overflow
                    };
                }
            );
            if (mediumToggleState.overflow) {
                assert.notEqual(mediumToggleState.display, "none", "medium previews that overflow must render the expand toggle");
            } else {
                assert.equal(mediumToggleState.display, "none", "medium previews that fit must not render the expand toggle");
            }
        } finally {
            await teardown();
        }
    });
});

async function openPreviewHarness(records) {
    const { page, teardown } = await createSharedPage({
        development: {
            llmProxyUrl: ""
        }
    });
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#top-editor .markdown-editor");
    await ensurePreviewRecords(page, records);
    return { page, teardown };
}

function buildNoteRecord({ noteId, markdownText, attachments }) {
    const timestamp = new Date().toISOString();
    return {
        noteId,
        markdownText,
        attachments,
        createdAtIso: timestamp,
        updatedAtIso: timestamp,
        lastActivityIso: timestamp
    };
}

function createBaselineRecords() {
    return [
        buildNoteRecord({ noteId: SHORT_NOTE_ID, markdownText: buildShortMarkdown(), attachments: {} }),
        buildNoteRecord({ noteId: MEDIUM_NOTE_ID, markdownText: buildMediumMarkdown(), attachments: {} }),
        buildNoteRecord({ noteId: LONG_NOTE_ID, markdownText: buildLongMarkdown(), attachments: {} }),
        buildNoteRecord({ noteId: TRAILING_IMAGE_NOTE_ID, markdownText: buildTrailingImageMarkdown(), attachments: {} }),
        buildNoteRecord({ noteId: "image-only", markdownText: buildImageOnlyMarkdown(), attachments: {} })
    ];
}

function createShortMediumRecords() {
    return [
        buildNoteRecord({ noteId: SHORT_NOTE_ID, markdownText: buildShortMarkdown(), attachments: {} }),
        buildNoteRecord({ noteId: MEDIUM_NOTE_ID, markdownText: buildMediumMarkdown(), attachments: {} }),
        buildNoteRecord({ noteId: LONG_NOTE_ID, markdownText: buildLongMarkdown(), attachments: {} })
    ];
}

function buildLongMarkdown() {
    const paragraph = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed posuere viverra urna, vitae convallis turpis.";
    const repeated = Array.from({ length: 6 }, () => paragraph).join(" \n\n");
    return `# Long Preview Fixture\n\n${repeated}\n\n![first-image](${SAMPLE_IMAGE_DATA_URL})\n\n![second-image](${SAMPLE_IMAGE_DATA_URL})\n\n\n\`\`\`js\nconsole.log('line1');\nconsole.log('line2');\nconsole.log('line3');\nconsole.log('line4');\nconsole.log('line5');\nconsole.log('line6');\n\`\`\``;
}

function buildImageOnlyMarkdown() {
    return `![solo-image](${LARGE_IMAGE_DATA_URL})`;
}

function buildTrailingImageMarkdown() {
    const sentence = "Aliquam vitae enim ac arcu tristique sagittis.";
    const block = Array.from({ length: 12 }, () => sentence).join(" ");
    return `${block}\n\n![late-image](${SAMPLE_IMAGE_DATA_URL})`;
}

function buildShortMarkdown() {
    return "Short note that fits easily.";
}

function buildMediumMarkdown() {
    const sentence = "Praesent commodo cursus magna, vel scelerisque nisl consectetur et.";
    return Array.from({ length: 3 }, () => sentence).join(" \n");
}

async function ensurePreviewRecords(page, records) {
    const shouldReload = await page.evaluate(
        ({ storageKey, records }) => {
            const serialized = JSON.stringify(records);
            window.localStorage.setItem(storageKey, serialized);

            const root = document.querySelector("[x-data]");
            const alpineData = (() => {
                if (!root) {
                    return null;
                }
                const alpine = window.Alpine;
                if (alpine && typeof alpine.$data === "function") {
                    return alpine.$data(root);
                }
                return root.__x?.$data ?? null;
            })();

            if (alpineData && typeof alpineData.initializeNotes === "function") {
                alpineData.initializeNotes();
                return false;
            }
            window.location.reload();
            return true;
        },
        { storageKey: appConfig.storageKey, records }
    );

    if (shouldReload) {
        await page.waitForNavigation({ waitUntil: "domcontentloaded" });
    }

    await page.waitForSelector(`[data-note-id="${LONG_NOTE_ID}"] .note-preview`);
    await page.evaluate(() => {
        window.scrollTo({ top: 0, behavior: "instant" });
    });
}

async function collapseAllPreviews(page) {
    await page.evaluate(() => {
        document.querySelectorAll(".note-preview--expanded").forEach((node) => {
            node.classList.remove("note-preview--expanded");
        });
        document.querySelectorAll(".note-expand-toggle").forEach((button) => {
            if (button instanceof HTMLElement) {
                button.blur();
            }
        });
        window.scrollTo({ top: 0, behavior: "instant" });
    });
}
