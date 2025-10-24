import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { appConfig } from "../js/core/config.js";
import { createSharedPage } from "./helpers/browserHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

const SHORT_NOTE_ID = "htmlView-short-note";
const MEDIUM_NOTE_ID = "htmlView-medium-note";
const LONG_NOTE_ID = "htmlView-long-note";
const TRAILING_IMAGE_NOTE_ID = "htmlView-trailing-img";

const SAMPLE_IMAGE_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAHUlEQVQoU2NkYGD4z0AEYBxVSFcwCiA5GgYAAP//AwBh0CY6AAAAAElFTkSuQmCC";
const LARGE_IMAGE_DATA_URL = SAMPLE_IMAGE_DATA_URL;

test.describe("Bounded htmlViews", () => {
    test("htmlView clamps content with fade, continuation marker, and code badge", async () => {
        const { page, teardown } = await openHtmlViewHarness(createBaselineRecords());
        try {
            await collapseAllHtmlViews(page);

            const htmlViewSelector = `[data-note-id="${LONG_NOTE_ID}"] .note-html-view`;
            await page.waitForSelector(htmlViewSelector);

            const { overflowY, offsetHeight, scrollHeight } = await page.$eval(htmlViewSelector, (element) => {
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
            assert.ok(offsetHeight <= maxHeightPx + 4, "htmlView should remain within 18vh");
            assert.ok(scrollHeight > offsetHeight, "long note should overflow and rely on fade");

            const continuationHtml = await page.$eval(htmlViewSelector, (element) => element.innerHTML || "");
            assert.ok(!/…continues/.test(continuationHtml), "htmlView should not inject continuation marker text");

            const fadeBackground = await page.$eval(
                htmlViewSelector,
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
            assert.equal(toggleVisible, true, "expand toggle should appear for overflowing htmlViews");

            const shortToggleHidden = await page.$eval(
                `[data-note-id="${SHORT_NOTE_ID}"] .note-expand-toggle`,
                (button) => button.hidden
            );
            assert.equal(shortToggleHidden, true, "chevron toggle should stay hidden on short htmlViews");

            const { mediumOverflow, mediumToggleHidden } = await page.$eval(
                `[data-note-id="${MEDIUM_NOTE_ID}"]`,
                (card) => {
                    const htmlView = card.querySelector(".note-html-view");
                    const toggle = card.querySelector(".note-expand-toggle");
                    if (!(htmlView instanceof HTMLElement) || !(toggle instanceof HTMLElement)) {
                        return { mediumOverflow: false, mediumToggleHidden: true };
                    }
                    const overflow = htmlView.scrollHeight - htmlView.clientHeight > 0.5;
                    return {
                        mediumOverflow: overflow,
                        mediumToggleHidden: toggle.hidden
                    };
                }
            );
            if (mediumOverflow) {
                assert.equal(mediumToggleHidden, false, "chevron toggle should appear when medium htmlViews overflow");
            } else {
                assert.equal(mediumToggleHidden, true, "chevron toggle should stay hidden when medium htmlViews fit within bounds");
            }

            const toggleAlignment = await page.$eval(
                `[data-note-id="${LONG_NOTE_ID}"]`,
                (card) => {
                    const htmlView = card.querySelector(".note-html-view");
                    const toggle = card.querySelector(".note-expand-toggle");
                    if (!(htmlView instanceof HTMLElement) || !(toggle instanceof HTMLElement)) {
                        return null;
                    }
                    const htmlViewRect = htmlView.getBoundingClientRect();
                    const toggleRect = toggle.getBoundingClientRect();
                    const htmlViewCenterX = htmlViewRect.left + htmlViewRect.width / 2;
                    const toggleCenterX = toggleRect.left + toggleRect.width / 2;
                    return {
                        horizontalDelta: Math.abs(htmlViewCenterX - toggleCenterX)
                    };
                }
            );
            assert.ok(toggleAlignment, "expand toggle should render alongside the htmlView");
            assert.ok(
                toggleAlignment.horizontalDelta <= 4,
                `expand toggle should align with the horizontal center of the text column (delta=${toggleAlignment?.horizontalDelta ?? "n/a"})`
            );
            await page.focus(toggleSelector);
            await page.keyboard.press("Enter");
            await page.waitForFunction((selector) => {
                const node = document.querySelector(selector);
                return node?.classList.contains("note-html-view--expanded") ?? false;
            }, {}, htmlViewSelector);

            const imageHtmlViewHtml = await page.$eval(
                `[data-note-id="image-only"] .note-html-view`,
                (element) => element.innerHTML
            );
            assert.ok(/<img/i.test(imageHtmlViewHtml), "image-only note should render inline <img>");

            const imageMetrics = await page.$eval(
                `[data-note-id="image-only"] .note-html-view img`,
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
            assert.equal(imageMetrics.objectFit, "contain", "htmlView images should preserve aspect ratio inside container");
            assert.ok(/^(0%|left)/i.test(imageMetrics.objectPosition), "htmlView image should anchor to the top");
            assert.notEqual(imageMetrics.clientHeight, 120, "htmlView image height must not be hard-coded to 120px");

            const trailingImageMetrics = await page.$eval(
                `[data-note-id="${TRAILING_IMAGE_NOTE_ID}"] .note-html-view`,
                (htmlView) => {
                    const img = htmlView.querySelector("img");
                    if (!img) {
                        return null;
                    }
                    const htmlViewRect = htmlView.getBoundingClientRect();
                    const imgRect = img.getBoundingClientRect();
                    return {
                        imgRelativeTop: imgRect.top - htmlViewRect.top,
                        htmlViewHeight: htmlViewRect.height
                    };
                }
            );
            assert.ok(trailingImageMetrics, "trailing image should exist in rendered markup");
            if (trailingImageMetrics) {
                assert.ok(
                    trailingImageMetrics.imgRelativeTop >= trailingImageMetrics.htmlViewHeight,
                    "trailing image should fall below the visible htmlView window"
                );
            }

        } finally {
            await teardown();
        }
    });

    test("chevron toggle handles expansion while content clicks enter edit mode", async () => {
        const { page, teardown } = await openHtmlViewHarness(createBaselineRecords());
        const cardSelector = `[data-note-id="${LONG_NOTE_ID}"]`;
        const htmlViewSelector = `${cardSelector} .note-html-view`;
        const toggleSelector = `${cardSelector} .note-expand-toggle`;
        try {
            await collapseAllHtmlViews(page);
            await page.waitForSelector(toggleSelector, { timeout: 5000 });
            await page.waitForFunction((selector) => {
                const node = document.querySelector(selector);
                return node instanceof HTMLElement && !node.classList.contains("note-html-view--expanded");
            }, {}, htmlViewSelector);

            await page.click(toggleSelector);
            await page.waitForFunction((selector) => {
                const node = document.querySelector(selector);
                return node instanceof HTMLElement && node.classList.contains("note-html-view--expanded");
            }, {}, htmlViewSelector);

            await page.click(toggleSelector);
            await page.waitForFunction((selector) => {
                const node = document.querySelector(selector);
                return node instanceof HTMLElement && !node.classList.contains("note-html-view--expanded");
            }, {}, htmlViewSelector);

            await page.$eval(`${cardSelector} .markdown-content`, (element) => {
                element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            });
            await page.waitForFunction((selector) => {
                const card = document.querySelector(selector);
                return card instanceof HTMLElement && card.classList.contains("editing-in-place");
            }, { timeout: 4000 }, cardSelector);

            const htmlViewDuringEdit = await page.$(htmlViewSelector);
            assert.equal(htmlViewDuringEdit, null, "htmlView should be removed while editing in place");

            await page.keyboard.down("Control");
            await page.keyboard.press("Enter");
            await page.keyboard.up("Control");
            await page.waitForFunction((selector) => {
                const card = document.querySelector(selector);
                return !(card instanceof HTMLElement) || !card.classList.contains("editing-in-place");
            }, { timeout: 4000 }, cardSelector);
        } finally {
            await teardown();
        }
    });

    test("expanding htmlView preserves viewport position", async () => {
        const { page, teardown } = await openHtmlViewHarness(createBaselineRecords());
        try {
            await collapseAllHtmlViews(page);

            const htmlViewSelector = `[data-note-id="${LONG_NOTE_ID}"] .note-html-view`;
            const toggleSelector = `[data-note-id="${LONG_NOTE_ID}"] .note-expand-toggle`;

            await page.waitForSelector(htmlViewSelector);

            await page.focus(toggleSelector);
            await page.evaluate(() => new Promise((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(resolve));
            }));

            const beforeMetrics = await page.evaluate(({ htmlViewSelector }) => {
                const htmlView = document.querySelector(htmlViewSelector);
                return {
                    scrollY: window.scrollY,
                    htmlViewScrollTop: htmlView?.scrollTop ?? null
                };
            }, { htmlViewSelector });

            await page.keyboard.press("Enter");
            await page.waitForFunction((selector) => {
                const node = document.querySelector(selector);
                return node?.classList.contains("note-html-view--expanded") ?? false;
            }, {}, htmlViewSelector);
            await page.evaluate(() => new Promise((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(resolve));
            }));

            const afterMetrics = await page.evaluate(({ htmlViewSelector }) => {
                const htmlView = document.querySelector(htmlViewSelector);
                return {
                    scrollY: window.scrollY,
                    htmlViewScrollTop: htmlView?.scrollTop ?? null
                };
            }, { htmlViewSelector });

            if (typeof beforeMetrics?.htmlViewScrollTop === "number" && typeof afterMetrics?.htmlViewScrollTop === "number") {
                assert.ok(afterMetrics.htmlViewScrollTop <= 1, "expanded htmlView should maintain top scroll position");
            }
            if (typeof beforeMetrics?.scrollY === "number" && typeof afterMetrics?.scrollY === "number") {
                const scrollDelta = Math.abs(afterMetrics.scrollY - beforeMetrics.scrollY);
                assert.ok(scrollDelta <= 6, `expanding htmlView should not scroll the page (delta=${scrollDelta})`);
            }

            const htmlViewViewport = await page.$eval(htmlViewSelector, (node) => {
                const rect = node.getBoundingClientRect();
                return {
                    top: rect.top,
                    bottom: rect.bottom,
                    viewportHeight: window.innerHeight
                };
            });
            const viewportThreshold = htmlViewViewport.viewportHeight * 0.8;
            assert.ok(
                htmlViewViewport.top >= -4 && htmlViewViewport.top <= viewportThreshold,
                `expanded htmlView top ${htmlViewViewport.top} should remain near the upper portion of the viewport`
            );
            assert.ok(htmlViewViewport.bottom > htmlViewViewport.top, "expanded htmlView should have non-zero height");
        } finally {
            await teardown();
        }
    });

    test("short htmlViews hide the expand toggle and medium htmlViews follow overflow state", async () => {
        const { page, teardown } = await openHtmlViewHarness(createShortMediumRecords());
        try {
            await collapseAllHtmlViews(page);
            await page.waitForSelector(`[data-note-id="${SHORT_NOTE_ID}"]`);

            const shortToggleDisplay = await page.$eval(
                `[data-note-id="${SHORT_NOTE_ID}"] .note-expand-toggle`,
                (button) => window.getComputedStyle(button).display
            );
            assert.equal(shortToggleDisplay, "none", "short htmlViews must not render the expand toggle");

            const mediumToggleState = await page.$eval(
                `[data-note-id="${MEDIUM_NOTE_ID}"]`,
                (card) => {
                    const htmlView = card.querySelector(".note-html-view");
                    const toggle = card.querySelector(".note-expand-toggle");
                    if (!(htmlView instanceof HTMLElement) || !(toggle instanceof HTMLElement)) {
                        return { display: "none", overflow: false };
                    }
                    const style = window.getComputedStyle(toggle);
                    const overflow = htmlView.scrollHeight - htmlView.clientHeight > 0.5;
                    return {
                        display: style.display,
                        overflow
                    };
                }
            );
            if (mediumToggleState.overflow) {
                assert.notEqual(mediumToggleState.display, "none", "medium htmlViews that overflow must render the expand toggle");
            } else {
                assert.equal(mediumToggleState.display, "none", "medium htmlViews that fit must not render the expand toggle");
            }
        } finally {
            await teardown();
        }
    });
});

async function openHtmlViewHarness(records) {
    const { page, teardown } = await createSharedPage({
        development: {
            llmProxyUrl: ""
        }
    });
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#top-editor .markdown-editor");
    await ensureHtmlViewRecords(page, records);
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
    return `# Long HtmlView Fixture\n\n${repeated}\n\n![first-image](${SAMPLE_IMAGE_DATA_URL})\n\n![second-image](${SAMPLE_IMAGE_DATA_URL})\n\n\n\`\`\`js\nconsole.log('line1');\nconsole.log('line2');\nconsole.log('line3');\nconsole.log('line4');\nconsole.log('line5');\nconsole.log('line6');\n\`\`\``;
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

async function ensureHtmlViewRecords(page, records) {
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

    await page.waitForSelector(`[data-note-id="${LONG_NOTE_ID}"] .note-html-view`);
    await page.evaluate(() => {
        window.scrollTo({ top: 0, behavior: "instant" });
    });
}

async function collapseAllHtmlViews(page) {
    await page.evaluate(() => {
        document.querySelectorAll(".note-html-view--expanded").forEach((node) => {
            node.classList.remove("note-html-view--expanded");
        });
        document.querySelectorAll(".note-expand-toggle").forEach((button) => {
            if (button instanceof HTMLElement) {
                button.blur();
            }
        });
        window.scrollTo({ top: 0, behavior: "instant" });
    });
}
