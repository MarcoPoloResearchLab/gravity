import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PNG } from "pngjs";

import { appConfig } from "../js/core/config.js";
import { createSharedPage } from "./helpers/browserHarness.js";
import { saveScreenshotArtifact } from "./helpers/screenshotArtifacts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

const GN58_NOTE_ID = "gn58-duplicate-preview";
const UNIQUE_TASK_TEXT = "unique1";
const INITIAL_MARKDOWN_LINES = [
    `- [ ] ${UNIQUE_TASK_TEXT}`,
    "- [ ]"
];
const INITIAL_MARKDOWN = INITIAL_MARKDOWN_LINES.join("\n");
const FIRST_TOGGLE_MARKDOWN = [
    `- [x] ${UNIQUE_TASK_TEXT}`,
    "- [ ]"
].join("\n");
const SECOND_TOGGLE_MARKDOWN = [
    `- [x] ${UNIQUE_TASK_TEXT}`,
    "- [x]"
].join("\n");
const EDIT_WORD_HIGHLIGHT_RGB = Object.freeze([32, 176, 32]);
const SCROLLBAR_ALERT_RGB = Object.freeze([24, 148, 220]);
const DUPLICATE_SURFACE_ALERT_RGB = Object.freeze([240, 128, 0]);

test.describe("GN-58 duplicate markdown rendering", () => {
    test("checklist preview and editor remain singular with persistent checkbox state", async () => {
        const seededRecords = [
            buildNoteRecord({
                noteId: GN58_NOTE_ID,
                markdownText: INITIAL_MARKDOWN
            })
        ];
        const { page, teardown } = await openPageWithRecords(seededRecords);
        try {
            const cardSelector = `.markdown-block[data-note-id="${GN58_NOTE_ID}"]`;
            await page.waitForSelector(cardSelector);

            const previewCleanBuffer = await captureCardScreenshot(page, cardSelector);
            await saveScreenshotArtifact("preview-clean", previewCleanBuffer);

            await highlightRenderedCheckboxes(page, cardSelector);
            const previewHtmlSnapshot = await getPreviewHtml(page, cardSelector);
            const previewDebugBuffer = await captureCardScreenshot(page, cardSelector);
            const checkboxClusterCount = countHighlightedCheckboxClusters(previewDebugBuffer);
            await saveScreenshotArtifact("preview-debug", previewDebugBuffer);
            assert.equal(
                checkboxClusterCount,
                2,
                `rendered preview screenshot shows exactly two highlighted checkboxes: ${previewHtmlSnapshot}`
            );

            const previewOccurrences = await countPreviewOccurrences(page, cardSelector, UNIQUE_TASK_TEXT);
            assert.equal(previewOccurrences, 1, `preview renders ${UNIQUE_TASK_TEXT} exactly once`);

            const previewCheckboxCount = await countPreviewCheckboxes(page, cardSelector);
            assert.equal(previewCheckboxCount, 2, "preview exposes two checklist inputs");

            await enterEditMode(page, cardSelector);

            const previewDuringEditCount = await countPreviewWrappers(page, cardSelector);
            assert.equal(previewDuringEditCount, 0, "entering edit mode removes preview wrapper");

            const editCleanBuffer = await captureCardScreenshot(page, cardSelector);
            await saveScreenshotArtifact("edit-clean", editCleanBuffer);

            const editHighlightMetrics = await highlightEditorModeSurface(
                page,
                cardSelector,
                UNIQUE_TASK_TEXT,
                EDIT_WORD_HIGHLIGHT_RGB,
                SCROLLBAR_ALERT_RGB,
                DUPLICATE_SURFACE_ALERT_RGB
            );
            assert.equal(
                editHighlightMetrics.highlightCount,
                1,
                `editing state highlights ${UNIQUE_TASK_TEXT} exactly once`
            );
            const editDebugBuffer = await captureCardScreenshot(page, cardSelector);
            await saveScreenshotArtifact("edit-debug", editDebugBuffer);
            const highlightedWordClusters = countColorClusters(editDebugBuffer, {
                targetColor: EDIT_WORD_HIGHLIGHT_RGB,
                tolerance: 18,
                columnGapThreshold: 6,
                rowGapThreshold: 40,
                columnWeightThreshold: 70,
                rowWeightThreshold: 30
            });
            assert.equal(highlightedWordClusters, 1, "edit screenshot shows the unique checklist text once");
            const duplicateSurfaceClusters = countColorClusters(editDebugBuffer, {
                targetColor: DUPLICATE_SURFACE_ALERT_RGB,
                tolerance: 20,
                columnGapThreshold: 8,
                rowGapThreshold: 60,
                columnWeightThreshold: 40,
                rowWeightThreshold: 24
            });
            assert.equal(duplicateSurfaceClusters, 0, "edit screenshot contains no duplicate markdown surface");
            const scrollbarIndicatorClusters = countColorClusters(editDebugBuffer, {
                targetColor: SCROLLBAR_ALERT_RGB,
                tolerance: 18,
                columnGapThreshold: 6,
                rowGapThreshold: 40,
                columnWeightThreshold: 40,
                rowWeightThreshold: 24
            });
            const overflowMetrics = editHighlightMetrics.overflowMetrics ?? { vertical: 0, horizontal: 0 };
            assert.equal(
                scrollbarIndicatorClusters,
                0,
                `edit screenshot contains no scrollbar indicator color (verticalOverflow=${overflowMetrics.vertical}, horizontalOverflow=${overflowMetrics.horizontal}, overflowY="${overflowMetrics.overflowY}", overflowX="${overflowMetrics.overflowX}", inlineHeight="${overflowMetrics.inlineHeight}", computedHeight="${overflowMetrics.computedHeight}", clusters=${scrollbarIndicatorClusters})`
            );

            const initialMarkdownValue = await getMarkdownValue(page, cardSelector);
            assert.equal(
                initialMarkdownValue,
                INITIAL_MARKDOWN,
                "editing surface loads the original markdown including trailing empty task"
            );

            await finalizeEditing(page, cardSelector);
            const previewAfterFinalize = await countPreviewWrappers(page, cardSelector);
            assert.equal(previewAfterFinalize, 1, "preview wrapper reattaches after finalizing edit");

            await page.click(`${cardSelector} input[data-task-index="0"]`);
            await waitForMarkdownValue(page, cardSelector, FIRST_TOGGLE_MARKDOWN);

            const firstToggleMarkdown = await getMarkdownValue(page, cardSelector);
            assert.equal(firstToggleMarkdown, FIRST_TOGGLE_MARKDOWN, "toggling first checkbox persists markdown state");

            const firstCheckboxChecked = await isCheckboxChecked(page, cardSelector, 0);
            assert.equal(firstCheckboxChecked, true, "first preview checkbox reflects the toggled state");

            await enterEditMode(page, cardSelector);
            const previewDuringFirstToggleEdit = await countPreviewWrappers(page, cardSelector);
            assert.equal(previewDuringFirstToggleEdit, 0, "preview remains destroyed while editing after toggle");

            const markdownInFirstToggleEdit = await getMarkdownValue(page, cardSelector);
            assert.equal(markdownInFirstToggleEdit, FIRST_TOGGLE_MARKDOWN, "editor reflects first toggle markdown");
            await finalizeEditing(page, cardSelector);

            await page.click(`${cardSelector} input[data-task-index="1"]`);
            await waitForMarkdownValue(page, cardSelector, SECOND_TOGGLE_MARKDOWN);

            const secondToggleMarkdown = await getMarkdownValue(page, cardSelector);
            assert.equal(secondToggleMarkdown, SECOND_TOGGLE_MARKDOWN, "toggling second checkbox persists markdown state");

            const secondCheckboxChecked = await isCheckboxChecked(page, cardSelector, 1);
            assert.equal(secondCheckboxChecked, true, "second preview checkbox reflects the toggled state");

            await enterEditMode(page, cardSelector);
            const previewDuringSecondToggleEdit = await countPreviewWrappers(page, cardSelector);
            assert.equal(previewDuringSecondToggleEdit, 0, "preview does not reappear in edit mode after second toggle");

            const markdownInSecondToggleEdit = await getMarkdownValue(page, cardSelector);
            assert.equal(markdownInSecondToggleEdit, SECOND_TOGGLE_MARKDOWN, "editor reflects fully toggled markdown");
            await finalizeEditing(page, cardSelector);

            const finalCheckboxCount = await countPreviewCheckboxes(page, cardSelector);
            assert.equal(finalCheckboxCount, 2, "preview retains two interactive checkboxes after edits");

            const finalPreviewOccurrences = await countPreviewOccurrences(page, cardSelector, UNIQUE_TASK_TEXT);
            assert.equal(finalPreviewOccurrences, 1, `final preview renders ${UNIQUE_TASK_TEXT} once without duplication`);
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

async function highlightRenderedCheckboxes(page, cardSelector) {
    await page.evaluate((selector) => {
        const card = document.querySelector(selector);
        if (!(card instanceof HTMLElement)) {
            return;
        }
        const checkboxes = card.querySelectorAll(".note-task-checkbox");
        checkboxes.forEach((checkbox) => {
            if (!(checkbox instanceof HTMLInputElement)) {
                return;
            }
            checkbox.style.appearance = "none";
            checkbox.style.width = "18px";
            checkbox.style.height = "18px";
            checkbox.style.backgroundColor = "rgb(220, 0, 0)";
            checkbox.style.border = "2px solid rgb(220, 0, 0)";
        });
    }, cardSelector);
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => {
            requestAnimationFrame(resolve);
        });
    }));
}

async function highlightEditorModeSurface(page, cardSelector, searchTerm, highlightRgb, scrollbarRgb, duplicateRgb) {
    return page.evaluate(async (selector, term, highlightColor, scrollbarColor, duplicateColor) => {
        const card = document.querySelector(selector);
        if (!(card instanceof HTMLElement)) {
            return {
                highlightCount: 0,
                scrollbarHighlighted: false,
                duplicateSurfaceVisible: false
            };
        }

        const toCss = (rgbTuple) => (Array.isArray(rgbTuple) && rgbTuple.length === 3)
            ? `rgb(${rgbTuple[0]}, ${rgbTuple[1]}, ${rgbTuple[2]})`
            : "rgb(0, 0, 0)";

        const highlightCss = toCss(highlightColor);
        const scrollbarCss = toCss(scrollbarColor);
        const duplicateCss = toCss(duplicateColor);

        let highlightCount = 0;
        const codeMirrorLines = card.querySelectorAll(".CodeMirror-code pre");
        codeMirrorLines.forEach((line) => {
            if (!(line instanceof HTMLElement)) {
                return;
            }
            const lineText = line.innerText || line.textContent || "";
            if (typeof lineText === "string" && lineText.includes(term)) {
                highlightCount += 1;
                line.style.backgroundColor = highlightCss;
                line.style.color = "rgb(0, 0, 0)";
            }
        });

        const scrollPane = card.querySelector(".CodeMirror-scroll");
        const overflowMetrics = {
            vertical: 0,
            horizontal: 0,
            inlineHeight: "",
            computedHeight: "",
            overflowX: "",
            overflowY: ""
        };
        let scrollbarHighlighted = false;
        if (scrollPane instanceof HTMLElement) {
            const verticalOverflow = scrollPane.scrollHeight - scrollPane.clientHeight;
            const horizontalOverflow = scrollPane.scrollWidth - scrollPane.clientWidth;
            overflowMetrics.vertical = verticalOverflow;
            overflowMetrics.horizontal = horizontalOverflow;
            overflowMetrics.inlineHeight = scrollPane.style.height || "";
            const computed = window.getComputedStyle(scrollPane);
            overflowMetrics.computedHeight = computed.height;
            overflowMetrics.overflowX = computed.overflowX;
            overflowMetrics.overflowY = computed.overflowY;
            const hasVerticalOverflow = (computed.overflowY === "scroll" || computed.overflowY === "auto")
                && Number.isFinite(verticalOverflow) && verticalOverflow > 4;
            const hasHorizontalOverflow = (computed.overflowX === "scroll" || computed.overflowX === "auto")
                && Number.isFinite(horizontalOverflow) && horizontalOverflow > 4;
            if (hasVerticalOverflow || hasHorizontalOverflow) {
                scrollbarHighlighted = true;
                scrollPane.style.boxShadow = `inset 0 0 0 4px ${scrollbarCss}`;
            } else {
                scrollPane.style.boxShadow = "";
            }
        }

        const textarea = card.querySelector("textarea.markdown-editor");
        let duplicateSurfaceVisible = false;
        if (textarea instanceof HTMLElement) {
            const computed = window.getComputedStyle(textarea);
            const isRendered = computed.display !== "none"
                && computed.visibility !== "hidden"
                && computed.opacity !== "0";
            if (isRendered) {
                duplicateSurfaceVisible = true;
                textarea.style.backgroundColor = duplicateCss;
            } else {
                textarea.style.backgroundColor = "";
            }
        }

        await new Promise((resolve) => {
            requestAnimationFrame(() => {
                requestAnimationFrame(resolve);
            });
        });

        return {
            highlightCount,
            scrollbarHighlighted,
            duplicateSurfaceVisible,
            overflowMetrics
        };
    }, cardSelector, searchTerm, highlightRgb, scrollbarRgb, duplicateRgb);
}

async function captureCardScreenshot(page, cardSelector) {
    const handle = await page.$(cardSelector);
    if (!handle) {
        throw new Error(`Unable to capture screenshot for selector: ${cardSelector}`);
    }
    try {
        const result = await handle.screenshot({ type: "png" });
        return Buffer.isBuffer(result) ? result : Buffer.from(result);
    } finally {
        await handle.dispose();
    }
}

function countHighlightedCheckboxClusters(buffer) {
    return countColorClusters(buffer, {
        targetColor: [220, 0, 0],
        tolerance: 25,
        alphaThreshold: 200,
        columnGapThreshold: 3,
        rowGapThreshold: 6,
        columnWeightThreshold: 120,
        rowWeightThreshold: 40
    });
}

function resolveSignificantClusters(weightMap, gapThreshold, weightThreshold) {
    if (!(weightMap instanceof Map) || weightMap.size === 0) {
        return 0;
    }
    const sortedIndexes = Array.from(weightMap.keys()).sort((a, b) => a - b);
    const clusters = [];
    let previousIndex = null;
    let activeCluster = null;
    for (const index of sortedIndexes) {
        if (previousIndex === null || index - previousIndex > gapThreshold) {
            if (activeCluster) {
                clusters.push(activeCluster);
            }
            activeCluster = {
                start: index,
                end: index,
                weight: weightMap.get(index) ?? 0
            };
        } else if (activeCluster) {
            activeCluster.end = index;
            activeCluster.weight += weightMap.get(index) ?? 0;
        }
        previousIndex = index;
    }
    if (activeCluster) {
        clusters.push(activeCluster);
    }
    return clusters.filter((cluster) => cluster.weight >= weightThreshold).length;
}

function countColorClusters(buffer, options) {
    const {
        targetColor,
        tolerance = 16,
        alphaThreshold = 180,
        columnGapThreshold = 3,
        rowGapThreshold = 3,
        columnWeightThreshold = 60,
        rowWeightThreshold = 30
    } = options;
    if (!Array.isArray(targetColor) || targetColor.length !== 3) {
        return 0;
    }
    const png = PNG.sync.read(buffer);
    const columnWeights = new Map();
    const rowWeights = new Map();
    const { width, height, data } = png;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const index = (y * width + x) * 4;
            const red = data[index];
            const green = data[index + 1];
            const blue = data[index + 2];
            const alpha = data[index + 3];
            if (alpha < alphaThreshold) {
                continue;
            }
            if (!isApproximateColorMatch(red, green, blue, targetColor, tolerance)) {
                continue;
            }
            columnWeights.set(x, (columnWeights.get(x) ?? 0) + 1);
            rowWeights.set(y, (rowWeights.get(y) ?? 0) + 1);
        }
    }
    const columnClusters = resolveSignificantClusters(columnWeights, columnGapThreshold, columnWeightThreshold);
    const rowClusters = resolveSignificantClusters(rowWeights, rowGapThreshold, rowWeightThreshold);
    return Math.max(columnClusters, rowClusters);
}

function isApproximateColorMatch(red, green, blue, target, tolerance) {
    const [targetRed, targetGreen, targetBlue] = target;
    return (
        Math.abs(red - targetRed) <= tolerance
        && Math.abs(green - targetGreen) <= tolerance
        && Math.abs(blue - targetBlue) <= tolerance
    );
}

async function enterEditMode(page, cardSelector) {
    await page.click(`${cardSelector} .note-preview`, { clickCount: 2 });
    await page.waitForSelector(`${cardSelector}.editing-in-place`);
    await page.waitForSelector(`${cardSelector} .CodeMirror textarea`);
}

async function finalizeEditing(page, cardSelector) {
    const codeMirrorTextarea = `${cardSelector} .CodeMirror textarea`;
    await page.waitForSelector(codeMirrorTextarea);
    await page.focus(codeMirrorTextarea);
    await page.keyboard.down("Shift");
    await page.keyboard.press("Enter");
    await page.keyboard.up("Shift");
    await page.waitForSelector(`${cardSelector}:not(.editing-in-place)`);
}

async function getMarkdownValue(page, cardSelector) {
    return page.evaluate((selector) => {
        const card = document.querySelector(selector);
        const host = card && typeof card === "object" ? card.__markdownHost : null;
        if (!host || typeof host.getValue !== "function") {
            return null;
        }
        return host.getValue();
    }, cardSelector);
}

async function waitForMarkdownValue(page, cardSelector, expected) {
    await page.waitForFunction((selector, targetValue) => {
        const card = document.querySelector(selector);
        const host = card && typeof card === "object" ? card.__markdownHost : null;
        if (!host || typeof host.getValue !== "function") {
            return false;
        }
        return host.getValue() === targetValue;
    }, {}, cardSelector, expected);
}

async function countPreviewOccurrences(page, cardSelector, term) {
    return page.evaluate((selector, searchTerm) => {
        const card = document.querySelector(selector);
        if (!(card instanceof HTMLElement)) {
            return 0;
        }
        const preview = card.querySelector(".markdown-content");
        if (!(preview instanceof HTMLElement)) {
            return 0;
        }
        const content = preview.innerText ?? "";
        const matches = content.match(new RegExp(searchTerm, "g")) ?? [];
        return matches.length;
    }, cardSelector, term);
}

async function countPreviewCheckboxes(page, cardSelector) {
    return page.evaluate((selector) => {
        const card = document.querySelector(selector);
        if (!(card instanceof HTMLElement)) {
            return 0;
        }
        return card.querySelectorAll(".note-preview input.note-task-checkbox").length;
    }, cardSelector);
}

async function countPreviewWrappers(page, cardSelector) {
    return page.evaluate((selector) => {
        const card = document.querySelector(selector);
        if (!(card instanceof HTMLElement)) {
            return 0;
        }
        return card.querySelectorAll(".note-preview").length;
    }, cardSelector);
}

async function isCheckboxChecked(page, cardSelector, index) {
    return page.evaluate((selector, targetIndex) => {
        const card = document.querySelector(selector);
        if (!(card instanceof HTMLElement)) {
            return false;
        }
        const checkbox = card.querySelectorAll("input.note-task-checkbox")[targetIndex];
        return checkbox instanceof HTMLInputElement ? checkbox.checked : false;
    }, cardSelector, index);
}

async function getPreviewHtml(page, cardSelector) {
    return page.evaluate((selector) => {
        const card = document.querySelector(selector);
        if (!(card instanceof HTMLElement)) {
            return "";
        }
        const preview = card.querySelector(".markdown-content");
        return preview instanceof HTMLElement ? preview.innerHTML : "";
    }, cardSelector);
}
