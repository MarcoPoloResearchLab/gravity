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
        /** @type {import('puppeteer').Browser|null} */
        let browser = null;
        /** @type {import('puppeteer').Page|null} */
        let page = null;
        /** @type {Error|null} */
        let launchError = null;

        const skipIfUnavailable = () => {
            if (!browser || !page) {
                const reason = launchError ? launchError.message : "Preview harness unavailable";
                test.skip(reason);
                return true;
            }
            return false;
        };

        test.before(async () => {
            try {
                browser = await puppeteerModule.launch(createSandboxedLaunchOptions(SANDBOX));
                page = await browser.newPage();
                await page.evaluateOnNewDocument(() => {
                    window.GRAVITY_CONFIG = {
                        llmProxyClassifyUrl: ""
                    };
                });
                await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
                await page.waitForSelector("#top-editor .markdown-editor");
                await ensurePreviewRecords(page, createBaselineRecords());
            } catch (error) {
                launchError = error instanceof Error ? error : new Error(String(error));
            }
        });

        test.after(async () => {
            try {
                await page?.close();
            } finally {
                page = null;
                if (browser) {
                    await browser.close();
                    browser = null;
                }
                await cleanupPuppeteerSandbox(SANDBOX);
            }
        });

        test("preview clamps content with fade, continuation marker, and code badge", async () => {
            if (skipIfUnavailable()) return;

            await ensurePreviewRecords(page, createBaselineRecords());
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
            const toggleColor = await page.$eval(toggleSelector, (button) => window.getComputedStyle(button).color);
            assert.equal(toggleColor, "rgb(216, 228, 255)", "chevron toggle should remain high-contrast against fade");

            const shortToggleHidden = await page.$eval(
                `[data-note-id="${SHORT_NOTE_ID}"] .note-expand-toggle`,
                (button) => button.hidden
            );
            assert.equal(shortToggleHidden, true, "chevron toggle should stay hidden on short previews");

            const mediumToggleHidden = await page.$eval(
                `[data-note-id="${MEDIUM_NOTE_ID}"] .note-expand-toggle`,
                (button) => button.hidden
            );
            assert.equal(mediumToggleHidden, true, "chevron toggle should stay hidden on medium previews that fit");

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

            const trailingToggleSelector = `[data-note-id="${TRAILING_IMAGE_NOTE_ID}"] .note-expand-toggle`;
            await page.waitForSelector(trailingToggleSelector);
            await page.evaluate((selector) => {
                const toggle = document.querySelector(selector);
                if (toggle instanceof HTMLElement) {
                    toggle.click();
                }
            }, trailingToggleSelector);
            await page.waitForFunction(
                (selector) => {
                    const preview = document.querySelector(selector);
                    return preview ? preview.classList.contains("note-preview--expanded") : false;
                },
                {},
                `[data-note-id="${TRAILING_IMAGE_NOTE_ID}"] .note-preview`
            );

            const trailingExpandedPreview = await page.$eval(
                `[data-note-id="${TRAILING_IMAGE_NOTE_ID}"] .note-preview`,
                (node) => node.classList.contains("note-preview--expanded")
            );
            assert.equal(trailingExpandedPreview, true, "expanding trailing image note should flip expanded modifier");
        });

        test("expanding preview preserves viewport position", async () => {
            if (skipIfUnavailable()) return;

            await ensurePreviewRecords(page, createBaselineRecords());
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
        });

        test("short and medium previews hide the expand toggle", async () => {
            if (skipIfUnavailable()) return;

            await ensurePreviewRecords(page, createShortMediumRecords());
            await collapseAllPreviews(page);

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

    await page.waitForSelector(`[data-note-id="${LONG_NOTE_ID}"] .note-preview`, { timeout: 5000 });
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
