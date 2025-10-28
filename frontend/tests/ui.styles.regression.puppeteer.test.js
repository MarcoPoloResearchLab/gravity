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
const FILLER_NOTE_PREFIX = "ui-style-filler";
const FILLER_NOTE_MARKDOWN = [
    "Filler note content keeps the viewport scrollable for scrollbar regression coverage.",
    "",
    "Additional text ensures each filler card consumes visible height."
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

test("note cards preserve 2:1 grid proportion between content and controls", async () => {
    const { page, teardown, cardSelector } = await preparePage();
    try {
        await page.waitForSelector(cardSelector);
        const metrics = await page.evaluate((selector) => {
            const card = document.querySelector(selector);
            if (!(card instanceof HTMLElement)) {
                return null;
            }
            const computed = window.getComputedStyle(card);
            const controls = card.querySelector(".card-controls");
            const content = card.querySelector(".note-html-view") || card.querySelector(".markdown-editor");
            if (!(controls instanceof HTMLElement) || !(content instanceof HTMLElement)) {
                return null;
            }
            const cardRect = card.getBoundingClientRect();
            const controlsRect = controls.getBoundingClientRect();
            const contentRect = content.getBoundingClientRect();
            const paddingLeft = parseFloat(computed.paddingLeft);
            const paddingRight = parseFloat(computed.paddingRight);
            const columnGap = parseFloat(computed.columnGap);
            const contentTrackWidth = controlsRect.left - (cardRect.left + paddingLeft) - columnGap;
            const controlsTrackWidth = cardRect.right - paddingRight - controlsRect.left;
            return {
                display: computed.display,
                columnGap,
                rowGap: parseFloat(computed.rowGap),
                alignItems: computed.alignItems,
                paddingLeft,
                paddingRight,
                borderWidth: parseFloat(computed.borderBottomWidth),
                borderColor: computed.borderBottomColor,
                contentWidth: contentRect.width,
                controlsWidth: controlsRect.width,
                contentTrackWidth,
                controlsTrackWidth
            };
        }, cardSelector);
        assert.ok(metrics, "Expected to collect card layout metrics");
        assert.equal(metrics.display, "grid");
        assert.ok(metrics.contentWidth > 0 && metrics.controlsWidth > 0, "Track widths must be measurable");
        assert.ok(metrics.contentTrackWidth > 0 && metrics.controlsTrackWidth > 0, "Track widths derived from card geometry must be positive");
        const ratio = metrics.contentTrackWidth / metrics.controlsTrackWidth;
        assert.ok(ratio >= 1.9 && ratio <= 2.2, `Content column should remain close to a 2:1 ratio (observed ${ratio.toFixed(2)}).`);
        assert.ok(metrics.columnGap >= 10 && metrics.columnGap <= 14, "Column gap should remain close to 0.75rem");
        assert.ok(metrics.rowGap >= 0 && metrics.rowGap <= 2, "Grid row gap should remain near zero after restructuring column content.");
        assert.equal(metrics.alignItems, "start");
        assert.ok(metrics.paddingLeft >= 15 && metrics.paddingLeft <= 18);
        assert.ok(metrics.paddingRight >= 15 && metrics.paddingRight <= 18);
        assert.ok(metrics.borderWidth >= 1 && metrics.borderWidth <= 1.5);
        assert.equal(metrics.borderColor, "rgba(58, 68, 94, 0.7)");
    } finally {
        await teardown();
    }
});

test("control column anchors to second grid track and keeps vertical controls", async () => {
    const { page, teardown, cardSelector } = await preparePage();
    try {
        await page.waitForSelector(`${cardSelector} .card-controls`);
        const controlMetrics = await getComputedStyles(page, `${cardSelector} .card-controls`, [
            "display",
            "flex-direction",
            "grid-column-start",
            "grid-column-end",
            "justify-self",
            "align-self",
            "text-align"
        ]);
        assert.equal(controlMetrics.display, "flex");
        assert.equal(controlMetrics["flex-direction"], "column");
        assert.equal(controlMetrics["grid-column-start"], "2");
        assert.equal(controlMetrics["grid-column-end"], "auto");
        assert.equal(controlMetrics["justify-self"], "stretch");
        assert.equal(controlMetrics["align-self"], "start");
        assert.equal(controlMetrics["text-align"], "right");

        const actionsMetrics = await getComputedStyles(page, `${cardSelector} .card-controls .actions`, [
            "display",
            "flex-direction",
            "visibility",
            "opacity"
        ]);
        assert.equal(actionsMetrics.display, "flex");
        assert.equal(actionsMetrics["flex-direction"], "column");
        assert.equal(actionsMetrics.visibility, "visible");
        assert.ok(parseFloat(actionsMetrics.opacity) > 0);
    } finally {
        await teardown();
    }
});

test("card controls anchor to the card's top-right corner", async () => {
    const { page, teardown, cardSelector } = await preparePage();
    try {
        await page.waitForSelector(`${cardSelector} .card-controls`);
        const placement = await page.evaluate((selector) => {
            const card = document.querySelector(selector);
            if (!(card instanceof HTMLElement)) {
                return null;
            }
            const controls = card.querySelector(".card-controls");
            if (!(controls instanceof HTMLElement)) {
                return null;
            }
            const cardStyle = window.getComputedStyle(card);
            const cardRect = card.getBoundingClientRect();
            const controlsRect = controls.getBoundingClientRect();
            const paddingTop = parseFloat(cardStyle.paddingTop) || 0;
            const paddingRight = parseFloat(cardStyle.paddingRight) || 0;
            return {
                topOffset: controlsRect.top - (cardRect.top + paddingTop),
                rightOffset: (cardRect.right - paddingRight) - controlsRect.right
            };
        }, cardSelector);
        assert.ok(placement, "Expected to capture control placement");
        assert.ok(Math.abs(placement.topOffset) <= 2, `Controls should align with the card's top padding (observed ${placement.topOffset?.toFixed(2)}px).`);
        assert.ok(Math.abs(placement.rightOffset) <= 2, `Controls should align with the card's right padding (observed ${placement.rightOffset?.toFixed(2)}px).`);
    } finally {
        await teardown();
    }
});

test("card content stays top-aligned with controls column", async () => {
    const { page, teardown, cardSelector } = await preparePage();
    try {
        await page.waitForSelector(`${cardSelector} .note-html-view, ${cardSelector} .markdown-editor`);
        const metrics = await page.evaluate((selector) => {
            const card = document.querySelector(selector);
            if (!(card instanceof HTMLElement)) {
                return null;
            }
            const controls = card.querySelector(".card-controls");
            const htmlView = card.querySelector(".note-html-view");
            const editor = card.querySelector(".markdown-editor");
            const badges = card.querySelector(".note-badges");
            const markdownContent = card.querySelector(".note-html-view .markdown-content");
            const primaryContent = htmlView instanceof HTMLElement
                ? htmlView
                : editor instanceof HTMLElement
                    ? editor
                    : null;
            if (!(controls instanceof HTMLElement) || !(primaryContent instanceof HTMLElement)) {
                return null;
            }
            const controlsTop = controls.getBoundingClientRect().top;
            const contentTop = primaryContent.getBoundingClientRect().top;
            return {
                cardTop: card.getBoundingClientRect().top,
                controlsTop,
                contentTop,
                delta: contentTop - controlsTop,
                badgeHeight: badges instanceof HTMLElement ? badges.getBoundingClientRect().height : 0,
                markdownTop: markdownContent instanceof HTMLElement ? markdownContent.getBoundingClientRect().top : null,
                markdownMarginTop: (() => {
                    if (!(markdownContent instanceof HTMLElement)) return null;
                    const firstChild = markdownContent.firstElementChild;
                    return firstChild instanceof HTMLElement ? parseFloat(getComputedStyle(firstChild).marginTop || "0") : null;
                })(),
                containerMarginTop: (() => {
                    if (!(primaryContent instanceof HTMLElement)) return null;
                    return parseFloat(getComputedStyle(primaryContent).marginTop || "0");
                })(),
                children: Array.from(card.children, (child) => {
                    if (!(child instanceof HTMLElement)) {
                        return null;
                    }
                    const rect = child.getBoundingClientRect();
                    return {
                        className: child.className,
                        display: getComputedStyle(child).display,
                        top: rect.top,
                        height: rect.height
                    };
                }).filter(Boolean)
            };
        }, cardSelector);
        assert.ok(metrics, "Expected to measure card alignment");
        assert.ok(Math.abs(metrics.delta) <= 2, [
            `Content column should align with controls top`,
            `delta ${metrics.delta.toFixed(2)}px`,
            `badge height ${metrics.badgeHeight.toFixed(2)}px`,
            `card top ${metrics.cardTop.toFixed(2)}px`,
            `controls top ${metrics.controlsTop.toFixed(2)}px`,
            `content top ${metrics.contentTop.toFixed(2)}px`,
            `markdown top ${metrics.markdownTop ? metrics.markdownTop.toFixed(2) : "n/a"}px`,
            `container margin ${metrics.containerMarginTop ?? "n/a"}`,
            `first child margin ${metrics.markdownMarginTop ?? "n/a"}`,
            `children ${JSON.stringify(metrics.children)}`
        ].join("; ") + ".");
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

test("content and control columns stay anchored to their grid tracks", async () => {
    const { page, teardown, cardSelector } = await preparePage();
    try {
        await page.waitForSelector(`${cardSelector} .markdown-content`);
        const layout = await page.evaluate((selector) => {
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
            return {
                content: collectColumn(card.querySelector(".card-content"), ".card-content"),
                controls: collectColumn(card.querySelector(".card-controls"), ".card-controls")
            };
        }, cardSelector);
        assert.ok(layout && layout.content, "Expected layout metadata for note card columns");
        assert.equal(layout.content.start, "1", "Content column should start in column 1");
        assert.equal(layout.content.end, "auto", "Content column should rely on implicit end column");
        assert.ok(layout.controls, "Expected control column metadata");
        assert.equal(layout.controls.start, "2", "Control column should start in column 2");
        assert.equal(layout.controls.end, "auto", "Control column should rely on implicit end column");
    } finally {
        await teardown();
    }
});

test("application viewport hides native scrollbars while remaining scrollable", async () => {
    const { page, teardown } = await preparePage();
    try {
        await page.waitForFunction(
            (expectedCount) => {
                const nodes = document.querySelectorAll(".markdown-block");
                return nodes.length >= expectedCount;
            },
            {},
            10
        );
        const metrics = await page.evaluate(() => {
            const scrollElement = document.scrollingElement || document.documentElement;
            if (!(scrollElement instanceof Element)) {
                return null;
            }
            const widthDelta = window.innerWidth - scrollElement.clientWidth;
            const heightDelta = window.innerHeight - scrollElement.clientHeight;
            const scrollable = scrollElement.scrollHeight - window.innerHeight > 10;
            return { widthDelta, heightDelta, scrollable };
        });
        assert.ok(metrics, "Expected viewport metrics for scrollbar check");
        assert.ok(metrics.scrollable, "Application should remain vertically scrollable for tall feeds");
        assert.ok(
            metrics.widthDelta <= 1,
            `Vertical scrollbars should be hidden (observed gap ${metrics.widthDelta.toFixed(2)}px)`
        );
        assert.ok(
            metrics.heightDelta <= 1,
            `Horizontal scrollbars should be hidden (observed gap ${metrics.heightDelta.toFixed(2)}px)`
        );
    } finally {
        await teardown();
    }
});

test("mobile layout stacks controls above content", async () => {
    const { page, teardown, cardSelector } = await preparePage({
        viewport: { width: 420, height: 900, deviceScaleFactor: 1 }
    });
    try {
        await page.waitForSelector(cardSelector);
        const metrics = await page.evaluate((selector) => {
            const card = document.querySelector(selector);
            if (!(card instanceof HTMLElement)) {
                return null;
            }
            const controls = card.querySelector(".card-controls");
            const content = card.querySelector(".card-content");
            if (!(controls instanceof HTMLElement) || !(content instanceof HTMLElement)) {
                return null;
            }
            const actions = controls.querySelector(".actions");
            const cardStyle = window.getComputedStyle(card);
            const controlsStyle = window.getComputedStyle(controls);
            const actionsStyle = actions instanceof HTMLElement ? window.getComputedStyle(actions) : null;
            const controlsRect = controls.getBoundingClientRect();
            const contentRect = content.getBoundingClientRect();
            return {
                gridTemplateColumns: cardStyle.gridTemplateColumns.trim(),
                controlsBottom: controlsRect.bottom,
                contentTop: contentRect.top,
                controlsFlexDirection: controlsStyle.flexDirection,
                actionsFlexDirection: actionsStyle ? actionsStyle.flexDirection : null,
                controlsTextAlign: controlsStyle.textAlign
            };
        }, cardSelector);
        assert.ok(metrics, "Expected mobile layout metrics");
        const columns = metrics.gridTemplateColumns.split(/\s+/u).filter(Boolean);
        assert.equal(columns.length, 1, `Mobile layout should collapse to a single column (observed ${metrics.gridTemplateColumns}).`);
        assert.ok(metrics.controlsBottom <= metrics.contentTop, "Controls should render above the note content on narrow viewports");
        assert.equal(metrics.controlsFlexDirection, "row", "Controls should lay out horizontally on mobile viewports");
        assert.equal(metrics.actionsFlexDirection, "row", "Action buttons should align horizontally on mobile viewports");
        assert.equal(metrics.controlsTextAlign, "left", "Controls text should align left when stacked above content");
    } finally {
        await teardown();
    }
});

async function preparePage(options = {}) {
    const { viewport } = options;
    const { page, teardown } = await createSharedPage();
    if (viewport && typeof page.setViewport === "function") {
        await page.setViewport(viewport);
    }
    const records = [
        buildNoteRecord({ noteId: NOTE_ID, markdownText: NOTE_MARKDOWN }),
        ...Array.from({ length: 12 }, (_, index) => buildNoteRecord({
            noteId: `${FILLER_NOTE_PREFIX}-${index + 1}`,
            markdownText: FILLER_NOTE_MARKDOWN
        }))
    ];
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
