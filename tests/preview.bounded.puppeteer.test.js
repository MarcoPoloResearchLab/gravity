import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { appConfig } from "../js/core/config.js";
import {
    ensurePuppeteerSandbox,
    cleanupPuppeteerSandbox,
    createSandboxedLaunchOptions
} from "./helpers/puppeteerEnvironment.js";

const SANDBOX = await ensurePuppeteerSandbox();
let puppeteerModule;
try {
    ({ default: puppeteerModule } = await import("puppeteer"));
} catch {
    puppeteerModule = null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

const SHORT_NOTE_ID = "preview-short-note";
const MEDIUM_NOTE_ID = "preview-medium-note";
const LONG_NOTE_ID = "preview-long-note";
const TRAILING_IMAGE_NOTE_ID = "preview-trailing-img";

const SAMPLE_IMAGE_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAHUlEQVQoU2NkYGD4z0AEYBxVSFcwCiA5GgYAAP//AwBh0CY6AAAAAElFTkSuQmCC";
const LARGE_IMAGE_DATA_URL = SAMPLE_IMAGE_DATA_URL;

if (!puppeteerModule) {
    test("puppeteer unavailable", () => {
        test.skip("Puppeteer is not installed in this environment.");
    });
} else {
    const executablePath = typeof puppeteerModule.executablePath === "function"
        ? puppeteerModule.executablePath()
        : undefined;
    if (typeof executablePath === "string" && executablePath.length > 0) {
        process.env.PUPPETEER_EXECUTABLE_PATH = executablePath;
    }
    test.describe("Bounded previews", () => {
        /** @type {import('puppeteer').Browser} */
        let browser;
        /** @type {Error|null} */
        let launchError = null;

        const skipIfNoBrowser = () => {
            if (!browser) {
                test.skip(launchError ? launchError.message : "Puppeteer launch unavailable in sandbox.");
                return true;
            }
            return false;
        };

        test.before(async () => {
            try {
                const launchOptions = createSandboxedLaunchOptions(SANDBOX);
                browser = await puppeteerModule.launch(launchOptions);
            } catch (error) {
                launchError = error instanceof Error ? error : new Error(String(error));
            }
        });

        test.after(async () => {
            if (browser) await browser.close();
            await cleanupPuppeteerSandbox(SANDBOX);
        });

        test("preview clamps content with fade, continuation marker, and code badge", async () => {
            if (skipIfNoBrowser()) return;
            const longMarkdown = buildLongMarkdown();
            const records = [
                buildNoteRecord({
                    noteId: SHORT_NOTE_ID,
                    markdownText: buildShortMarkdown(),
                    attachments: {}
                }),
                buildNoteRecord({
                    noteId: MEDIUM_NOTE_ID,
                    markdownText: buildMediumMarkdown(),
                    attachments: {}
                }),
                buildNoteRecord({
                    noteId: LONG_NOTE_ID,
                    markdownText: longMarkdown,
                    attachments: {}
                }),
                buildNoteRecord({
                    noteId: TRAILING_IMAGE_NOTE_ID,
                    markdownText: buildTrailingImageMarkdown(),
                    attachments: {}
                }),
                buildNoteRecord({
                    noteId: "image-only",
                    markdownText: buildImageOnlyMarkdown(),
                    attachments: {}
                })
            ];
            const page = await preparePage(browser, { records });
            try {
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

                const fadeBackground = await page.$eval(previewSelector, (element) => window.getComputedStyle(element, "::after").backgroundImage || "");
                assert.ok(fadeBackground.includes("linear-gradient"));

                const badgeTexts = await page.$$eval(`[data-note-id="${LONG_NOTE_ID}"] .note-badge`, (nodes) => nodes.map((node) => node.textContent?.trim() || ""));
                assert.deepEqual(badgeTexts, ["code"], "only the code badge should remain for long notes");

                const toggleSelector = `[data-note-id="${LONG_NOTE_ID}"] .note-expand-toggle`;
                await page.waitForSelector(toggleSelector);
                const toggleVisible = await page.$eval(toggleSelector, (button) => button instanceof HTMLElement && button.hidden === false);
                assert.equal(toggleVisible, true, "expand toggle should appear for overflowing previews");
                const toggleColor = await page.$eval(toggleSelector, (button) => window.getComputedStyle(button).color);
                assert.equal(toggleColor, "rgb(216, 228, 255)", "chevron toggle should remain high-contrast against fade");

                const shortToggleHidden = await page.$eval(`[data-note-id="${SHORT_NOTE_ID}"] .note-expand-toggle`, (button) => button.hidden);
                assert.equal(shortToggleHidden, true, "chevron toggle should stay hidden on short previews");
                const mediumToggleHidden = await page.$eval(`[data-note-id="${MEDIUM_NOTE_ID}"] .note-expand-toggle`, (button) => button.hidden);
                assert.equal(mediumToggleHidden, true, "chevron toggle should stay hidden on medium previews that fit");

                await page.focus(toggleSelector);
                await page.keyboard.press("Enter");
                await page.waitForFunction((selector) => {
                    const node = document.querySelector(selector);
                    return node?.classList.contains("note-preview--expanded") ?? false;
                }, {}, previewSelector);

                const imagePreviewHtml = await page.$eval(`[data-note-id="image-only"] .note-preview`, (element) => element.innerHTML);
                assert.ok(/<img/i.test(imagePreviewHtml), "image-only note should render inline <img>");

                const imageMetrics = await page.$eval(`[data-note-id="image-only"] .note-preview img`, (img) => {
                    const style = window.getComputedStyle(img);
                    return {
                        objectFit: style.objectFit,
                        objectPosition: style.objectPosition,
                        clientHeight: Math.round(img.clientHeight),
                        naturalHeight: img.naturalHeight
                    };
                });
                assert.equal(imageMetrics.objectFit, "contain", "preview images should preserve aspect ratio inside container");
                assert.ok(/^(0%|left)/i.test(imageMetrics.objectPosition), "preview image should anchor to the top");
                assert.notEqual(imageMetrics.clientHeight, 120, "preview image height must not be hard-coded to 120px");

                const trailingImageMetrics = await page.$eval(`[data-note-id="${TRAILING_IMAGE_NOTE_ID}"] .note-preview`, (preview) => {
                    const img = preview.querySelector("img");
                    if (!img) return null;
                    const previewRect = preview.getBoundingClientRect();
                    const imgRect = img.getBoundingClientRect();
                    return {
                        imgRelativeTop: imgRect.top - previewRect.top,
                        previewHeight: previewRect.height
                    };
                });
                assert.ok(trailingImageMetrics, "trailing image should exist in rendered markup");
                if (trailingImageMetrics) {
                    assert.ok(
                        trailingImageMetrics.imgRelativeTop >= trailingImageMetrics.previewHeight,
                        "trailing image should fall below the visible preview window"
                    );
                }

                const trailingToggleSelector = `[data-note-id="${TRAILING_IMAGE_NOTE_ID}"] .note-expand-toggle`;
                await page.waitForSelector(trailingToggleSelector);
                await page.click(trailingToggleSelector);
                await new Promise((resolve) => setTimeout(resolve, 150));
                const trailingExpandedPreview = await page.$eval(
                    `[data-note-id="${TRAILING_IMAGE_NOTE_ID}"] .note-preview`,
                    (node) => node.classList.contains("note-preview--expanded")
                );
                assert.equal(trailingExpandedPreview, true, "trailing preview expands after toggle");

                const longExpanded = await page.$eval(previewSelector, (node) => node.classList.contains("note-preview--expanded"));
                assert.equal(longExpanded, false, "expanding a different note collapses the first preview");

                await page.click(`[data-note-id="${TRAILING_IMAGE_NOTE_ID}"] .note-preview`);
                await page.waitForSelector(`[data-note-id="${TRAILING_IMAGE_NOTE_ID}"].editing-in-place`);

                const trailingPreviewExpanded = await page.$eval(`[data-note-id="${TRAILING_IMAGE_NOTE_ID}"] .note-preview`, (node) => node.classList.contains("note-preview--expanded"));
                assert.equal(trailingPreviewExpanded, false, "editing collapses expanded previews");

                await page.keyboard.down("Control");
                await page.keyboard.press("Enter");
                await page.keyboard.up("Control");
                await page.waitForFunction((selector) => {
                    const card = document.querySelector(selector);
                    return card && !card.classList.contains("editing-in-place");
                }, {}, `[data-note-id="${TRAILING_IMAGE_NOTE_ID}"]`);

                const trailingToggleHidden = await page.$eval(trailingToggleSelector, (node) => node.hidden);
                assert.equal(trailingToggleHidden, false, "expand toggle should remain visible after editing finishes");

                const blankHeight = await page.$eval("#top-editor .markdown-editor", (element) => element.getBoundingClientRect().height);
                assert.ok(blankHeight < maxHeightPx * 0.25, "blank top editor should remain a single-line height");

                const shortMetrics = await measurePreview(page, SHORT_NOTE_ID);
                assert.ok(Math.abs(shortMetrics.scrollHeight - shortMetrics.clientHeight) <= 2, "short note should not overflow");
                assert.ok(shortMetrics.clientHeight < maxHeightPx * 0.6, "short note height should track its content");
                const shortFade = await getPreviewFadeOpacity(page, SHORT_NOTE_ID);
                assert.equal(shortFade, 0, "short note should not display fading overlay");

                const mediumMetrics = await measurePreview(page, MEDIUM_NOTE_ID);
                assert.ok(Math.abs(mediumMetrics.scrollHeight - mediumMetrics.clientHeight) <= 2, "medium note should render fully without overflow");
                assert.ok(mediumMetrics.clientHeight <= maxHeightPx + 4, "medium note should respect max height");
                assert.ok(mediumMetrics.clientHeight > shortMetrics.clientHeight, "medium note should be taller than short note");
                const mediumFade = await getPreviewFadeOpacity(page, MEDIUM_NOTE_ID);
                assert.equal(mediumFade, 0, "medium note that fits should not display fading overlay");

                const longFade = await getPreviewFadeOpacity(page, LONG_NOTE_ID);
                assert.ok(longFade > 0, "long note should display fading overlay");
            } finally {
                await page.close();
            }
        });

        test("expanding preview preserves viewport position", async () => {
            if (skipIfNoBrowser()) return;
            const fillerRecords = Array.from({ length: 6 }, (_, index) =>
                buildNoteRecord({ noteId: `filler-${index}`, markdownText: buildMediumMarkdown(), attachments: {} })
            );
            const records = [
                ...fillerRecords,
                buildNoteRecord({ noteId: LONG_NOTE_ID, markdownText: buildLongMarkdown(), attachments: {} })
            ];
            const page = await preparePage(browser, { records });
            try {
                const cardSelector = `[data-note-id="${LONG_NOTE_ID}"]`;
                const toggleSelector = `${cardSelector} .note-expand-toggle`;
                await page.waitForSelector(toggleSelector);

                await page.$eval(cardSelector, (element) => {
                    const rect = element.getBoundingClientRect();
                    window.scrollBy({ top: rect.top - 140, behavior: "instant" });
                });

                const beforeMetrics = await page.evaluate((selector) => {
                    const card = document.querySelector(selector);
                    const preview = card?.querySelector(".note-preview");
                    const cardRect = card?.getBoundingClientRect();
                    return {
                        cardTop: cardRect ? cardRect.top : null,
                        scrollY: window.scrollY,
                        previewScrollTop: preview instanceof HTMLElement ? preview.scrollTop : null
                    };
                }, cardSelector);

                await page.$eval(`${cardSelector} .note-preview`, (element) => {
                    element.scrollTop = element.scrollHeight;
                });

                await page.$eval(cardSelector, (card) => {
                    const toggle = card.querySelector(".note-expand-toggle");
                    if (!(toggle instanceof HTMLElement)) {
                        return;
                    }
                    // Simulate the regression where expanding forces the window to jump
                    // toward the note's end so the fix can be validated deterministically.
                    const simulateScrollJump = () => {
                        requestAnimationFrame(() => {
                            window.scrollTo(0, document.body.scrollHeight);
                        });
                    };
                    const handleClick = () => simulateScrollJump();
                    const handleKeyDown = (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                            simulateScrollJump();
                        }
                    };
                    toggle.addEventListener("click", handleClick, { once: true });
                    toggle.addEventListener("keydown", handleKeyDown, { once: true });
                });

                await page.click(toggleSelector);

                await page.waitForFunction((selector) => {
                    const preview = document.querySelector(`${selector} .note-preview`);
                    return preview?.classList.contains("note-preview--expanded") ?? false;
                }, {}, cardSelector);

                await new Promise((resolve) => setTimeout(resolve, 250));

                const afterMetrics = await page.evaluate((selector) => {
                    const card = document.querySelector(selector);
                    const preview = card?.querySelector(".note-preview");
                    const cardRect = card?.getBoundingClientRect();
                    return {
                        cardTop: cardRect ? cardRect.top : null,
                        scrollY: window.scrollY,
                        previewScrollTop: preview instanceof HTMLElement ? preview.scrollTop : null
                    };
                }, cardSelector);

                assert.ok(beforeMetrics.cardTop !== null && afterMetrics.cardTop !== null, "card metrics should be measurable");
                if (beforeMetrics.cardTop !== null && afterMetrics.cardTop !== null) {
                    const deltaTop = Math.abs(afterMetrics.cardTop - beforeMetrics.cardTop);
                    assert.ok(deltaTop <= 2, `card should remain anchored in place (delta ${deltaTop})`);
                }

                const deltaScroll = Math.abs(afterMetrics.scrollY - beforeMetrics.scrollY);
                assert.ok(deltaScroll <= 6, `window scroll should not jump to note end (delta ${deltaScroll})`);

                if (typeof beforeMetrics.previewScrollTop === "number" && typeof afterMetrics.previewScrollTop === "number") {
                    assert.ok(afterMetrics.previewScrollTop <= 1, "expanded preview should maintain top scroll position");
                }
            } finally {
                await page.close();
            }
        });

        test("short and medium previews hide the expand toggle", async () => {
            if (skipIfNoBrowser()) return;
            const records = [
                buildNoteRecord({ noteId: SHORT_NOTE_ID, markdownText: buildShortMarkdown(), attachments: {} }),
                buildNoteRecord({ noteId: MEDIUM_NOTE_ID, markdownText: buildMediumMarkdown(), attachments: {} }),
                buildNoteRecord({ noteId: LONG_NOTE_ID, markdownText: buildLongMarkdown(), attachments: {} })
            ];

            const page = await preparePage(browser, { records });
            try {
                await page.waitForSelector(`[data-note-id="${SHORT_NOTE_ID}"]`);

                const shortToggleDisplay = await page.$eval(
                    `[data-note-id="${SHORT_NOTE_ID}"] .note-expand-toggle`,
                    (button) => window.getComputedStyle(button).display
                );
                assert.equal(shortToggleDisplay, "none", "short previews must not render the expand toggle");

                const mediumToggleDisplay = await page.$eval(
                    `[data-note-id="${MEDIUM_NOTE_ID}"] .note-expand-toggle`,
                    (button) => window.getComputedStyle(button).display
                );
                assert.equal(mediumToggleDisplay, "none", "medium previews must not render the expand toggle");
            } finally {
                await page.close();
            }
        });
    });
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

function buildLongMarkdown() {
    const paragraph = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed posuere viverra urna, vitae convallis turpis.";
    const repeated = Array.from({ length: 12 }, () => paragraph).join(" \n\n");
    return `# Long Preview Fixture\n\n${repeated}\n\n![first-image](${SAMPLE_IMAGE_DATA_URL})\n\n![second-image](${SAMPLE_IMAGE_DATA_URL})\n\n\n\`\`\`js\nconsole.log('line1');\nconsole.log('line2');\nconsole.log('line3');\nconsole.log('line4');\nconsole.log('line5');\nconsole.log('line6');\nconsole.log('line7');\n\`\`\``;
}

function buildImageOnlyMarkdown() {
    return `![solo-image](${LARGE_IMAGE_DATA_URL})`;
}

function buildTrailingImageMarkdown() {
    const sentence = "Aliquam vitae enim ac arcu tristique sagittis.";
    const block = Array.from({ length: 25 }, () => sentence).join(" ");
    return `${block}\n\n![late-image](${SAMPLE_IMAGE_DATA_URL})`;
}

function buildShortMarkdown() {
    return "Short note that fits easily.";
}

function buildMediumMarkdown() {
    const sentence = "Praesent commodo cursus magna, vel scelerisque nisl consectetur et.";
    return Array.from({ length: 3 }, () => sentence).join(" \n");
}

async function preparePage(browser, { records }) {
    const page = await browser.newPage();
    const serialized = JSON.stringify(Array.isArray(records) ? records : []);
    await page.evaluateOnNewDocument((storageKey, payload) => {
        window.localStorage.clear();
        window.localStorage.setItem(storageKey, payload);
    }, appConfig.storageKey, serialized);

    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#top-editor .markdown-editor");
    await page.waitForSelector(`[data-note-id="${LONG_NOTE_ID}"]`);
    return page;
}

async function measurePreview(page, noteId) {
    return page.$eval(`[data-note-id="${noteId}"] .note-preview`, (element) => ({
        clientHeight: element.getBoundingClientRect().height,
        scrollHeight: element.scrollHeight
    }));
}

async function getPreviewFadeOpacity(page, noteId) {
    return page.$eval(`[data-note-id="${noteId}"] .note-preview`, (element) => {
        const style = window.getComputedStyle(element, "::after");
        const opacity = parseFloat(style.opacity || "0");
        return Number.isFinite(opacity) ? opacity : 0;
    });
}
