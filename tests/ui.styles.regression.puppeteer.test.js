import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { appConfig } from "../js/core/config.js";
import { createSharedPage } from "./helpers/browserHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

const NOTE_ID = "ui-style-fixture";
const NOTE_MARKDOWN = [
    "# Layout Fixture",
    "",
    "This inline card exists solely to measure CSS positioning across the grid.",
    "",
    "- List markers ensure content height.",
    "- Additional bullets keep the card realistic."
].join("\n");

test("top editor keeps sticky positioning and compact padding", async () => {
    const { page, teardown } = await preparePage();
    try {
        await page.waitForSelector("#top-editor .markdown-block.top-editor");
        const metrics = await getComputedStyles(page, "#top-editor .markdown-block.top-editor", [
            "position",
            "top",
            "grid-template-columns",
            "padding-top",
            "padding-right",
            "padding-bottom",
            "padding-left",
            "border-bottom-width",
            "border-bottom-color",
            "background-color",
            "z-index"
        ]);
        assert.equal(metrics.position, "sticky");
        assert.equal(metrics.top, "64px");
        const columns = metrics["grid-template-columns"].trim().split(/\s+/).filter(Boolean);
        assert.equal(columns.length, 1);
        assert.equal(metrics["padding-top"], "0px");
        assert.equal(metrics["padding-right"], "0px");
        assert.equal(metrics["padding-bottom"], "0px");
        assert.equal(metrics["padding-left"], "0px");
        assert.ok(parseFloat(metrics["border-bottom-width"]) >= 0.9 && parseFloat(metrics["border-bottom-width"]) <= 1.2, "Top editor should render a one-pixel delineator");
        assert.equal(metrics["border-bottom-color"], "rgba(58, 68, 94, 0.7)");
        assert.equal(metrics["background-color"], "rgba(0, 0, 0, 0)");
        assert.equal(metrics["z-index"], "5");
    } finally {
        await teardown();
    }
});

test("note cards preserve grid columns for content and actions", async () => {
    const { page, teardown, cardSelector } = await preparePage();
    try {
        await page.waitForSelector(cardSelector);
        const metrics = await getComputedStyles(page, cardSelector, [
            "display",
            "grid-template-columns",
            "column-gap",
            "row-gap",
            "align-items",
            "padding-left",
            "padding-right",
            "border-bottom-width",
            "border-bottom-color"
        ]);
        assert.equal(metrics.display, "grid");
        const columns = metrics["grid-template-columns"].trim().split(/\s+/).filter(Boolean);
        assert.equal(columns.length, 2);
        const primaryWidth = parseFloat(columns[0]);
        const actionWidth = parseFloat(columns[1]);
        assert.ok(Number.isFinite(primaryWidth) && Number.isFinite(actionWidth), "Grid columns should resolve to numeric widths");
        assert.ok(primaryWidth > actionWidth * 4, "Primary column should be significantly wider than actions column");
        const gapPx = parseFloat(metrics["column-gap"]);
        assert.ok(gapPx >= 10 && gapPx <= 14, "Column gap should remain close to 0.75rem");
        const rowGapPx = parseFloat(metrics["row-gap"]);
        assert.ok(rowGapPx >= 5 && rowGapPx <= 7, "Row gap should remain close to 0.35rem");
        assert.equal(metrics["align-items"], "start");
        assert.ok(parseFloat(metrics["padding-left"]) >= 15 && parseFloat(metrics["padding-left"]) <= 18);
        assert.ok(parseFloat(metrics["padding-right"]) >= 15 && parseFloat(metrics["padding-right"]) <= 18);
        assert.ok(parseFloat(metrics["border-bottom-width"]) >= 1 && parseFloat(metrics["border-bottom-width"]) <= 1.5);
        assert.equal(metrics["border-bottom-color"], "rgba(58, 68, 94, 0.7)");
    } finally {
        await teardown();
    }
});

test("action column stays in second grid column with vertical layout", async () => {
    const { page, teardown, cardSelector } = await preparePage();
    try {
        await page.waitForSelector(`${cardSelector} .actions`);
        const metrics = await getComputedStyles(page, `${cardSelector} .actions`, [
            "display",
            "flex-direction",
            "grid-column-start",
            "grid-column-end",
            "visibility",
            "opacity"
        ]);
        assert.equal(metrics.display, "flex");
        assert.equal(metrics["flex-direction"], "column");
        assert.equal(metrics["grid-column-start"], "2");
        assert.equal(metrics["grid-column-end"], "auto");
        assert.equal(metrics.visibility, "visible");
        assert.ok(parseFloat(metrics.opacity) > 0);
    } finally {
        await teardown();
    }
});

test("action buttons inherit compact styling", async () => {
    const { page, teardown, cardSelector } = await preparePage();
    try {
        const buttonSelector = `${cardSelector} .actions .action-button:not(.action-button--pin)`;
        await page.waitForSelector(buttonSelector);
        const metrics = await getComputedStyles(page, buttonSelector, [
            "border-radius",
            "font-size",
            "padding-top",
            "padding-right",
            "padding-bottom",
            "padding-left"
        ]);
        assert.equal(metrics["border-radius"], "6px");
        assert.ok(parseFloat(metrics["font-size"]) <= 14);
        const horizontalPadding = parseFloat(metrics["padding-left"]) + parseFloat(metrics["padding-right"]);
        const verticalPadding = parseFloat(metrics["padding-top"]) + parseFloat(metrics["padding-bottom"]);
        assert.ok(horizontalPadding > 4 && horizontalPadding < 14, "Buttons should remain compact horizontally");
        assert.ok(verticalPadding > 4 && verticalPadding < 10, "Buttons should remain compact vertically");
    } finally {
        await teardown();
    }
});

test("content elements stay anchored to the first grid column", async () => {
    const { page, teardown, cardSelector } = await preparePage();
    try {
        await page.waitForSelector(`${cardSelector} .markdown-content`);
        const grids = await page.evaluate((selector) => {
            const card = document.querySelector(selector);
            if (!(card instanceof HTMLElement)) {
                return null;
            }
            const collectColumn = (element, label) => {
                if (!(element instanceof HTMLElement)) {
                    return null;
                }
                const style = window.getComputedStyle(element);
                return {
                    selector: label,
                    start: style.gridColumnStart,
                    end: style.gridColumnEnd
                };
            };
            return [
                collectColumn(card.querySelector(".meta-chips"), ".meta-chips"),
                collectColumn(card.querySelector(".note-badges"), ".note-badges"),
                collectColumn(card.querySelector(".note-preview"), ".note-preview"),
                collectColumn(card.querySelector(".markdown-editor"), ".markdown-editor")
            ];
        }, cardSelector);
        assert.ok(Array.isArray(grids), "Expected to collect grid metadata for content elements");
        grids.forEach((entry) => {
            if (!entry) {
                return;
            }
            assert.equal(entry.start, "1", `${entry.selector} should start in column 1`);
            assert.equal(entry.end, "auto", `${entry.selector} should rely on implicit end column`);
        });
    } finally {
        await teardown();
    }
});

async function preparePage() {
    const { page, teardown } = await createSharedPage();
    const records = [buildNoteRecord({ noteId: NOTE_ID, markdownText: NOTE_MARKDOWN })];
    const serialized = JSON.stringify(records);
    await page.evaluateOnNewDocument((storageKey, payload) => {
        window.sessionStorage.setItem("__gravityTestInitialized", "true");
        window.localStorage.setItem(storageKey, payload);
        window.__gravityForceMarkdownEditor = true;
    }, appConfig.storageKey, serialized);
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".markdown-block.top-editor");
    const cardSelector = `.markdown-block[data-note-id="${NOTE_ID}"]`;
    await page.waitForSelector(cardSelector);
    return { page, teardown, cardSelector };
}

async function getComputedStyles(page, selector, properties) {
    return page.$eval(selector, (element, props) => {
        if (!(element instanceof HTMLElement)) {
            throw new Error(`Missing element for selector: ${selector}`);
        }
        const style = window.getComputedStyle(element);
        return props.reduce((acc, property) => {
            let value = style.getPropertyValue(property);
            if (!value) {
                const camelCase = property.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
                value = style[camelCase];
            }
            acc[property] = value;
            return acc;
        }, {});
    }, properties);
}

function buildNoteRecord({ noteId, markdownText, attachments = {} }) {
    const timestamp = new Date().toISOString();
    return {
        noteId,
        markdownText,
        attachments,
        createdAtIso: timestamp,
        updatedAtIso: timestamp,
        lastActivityIso: timestamp,
        pinned: false
    };
}
