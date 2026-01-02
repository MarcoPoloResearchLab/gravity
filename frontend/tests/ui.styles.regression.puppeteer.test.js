import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createAppConfig } from "../js/core/config.js?build=2026-01-01T22:43:21Z";
import { ENVIRONMENT_DEVELOPMENT } from "../js/core/environmentConfig.js?build=2026-01-01T22:43:21Z";
import { createSharedPage, waitForAppHydration, flushAlpineQueues } from "./helpers/browserHarness.js";

const appConfig = createAppConfig({ environment: ENVIRONMENT_DEVELOPMENT });

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

test("desktop layout retains grid proportions and control placement", async () => {
    await withPreparedPage(async ({ page, cardSelector }) => {
        await page.waitForSelector("#top-editor .markdown-block.top-editor");
        const topEditorMetrics = await getComputedStyles(page, "#top-editor .markdown-block.top-editor", [
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
        assert.equal(topEditorMetrics.position, "sticky");
        assert.equal(topEditorMetrics.top, "64px");
        const topColumns = topEditorMetrics["grid-template-columns"].trim().split(/\s+/).filter(Boolean);
        assert.equal(topColumns.length, 1);
        assert.equal(topEditorMetrics["padding-top"], "0px");
        assert.equal(topEditorMetrics["padding-right"], "0px");
        assert.equal(topEditorMetrics["padding-bottom"], "0px");
        assert.equal(topEditorMetrics["padding-left"], "0px");
        assert.ok(
            parseFloat(topEditorMetrics["border-bottom-width"]) >= 0.9
                && parseFloat(topEditorMetrics["border-bottom-width"]) <= 1.2,
            "Top editor should render a one-pixel delineator"
        );
        assert.equal(topEditorMetrics["border-bottom-color"], "rgba(58, 68, 94, 0.7)");
        assert.equal(topEditorMetrics["background-color"], "rgba(0, 0, 0, 0)");
        assert.equal(topEditorMetrics["z-index"], "5");

        await page.waitForSelector(cardSelector);
        await page.waitForSelector(`${cardSelector} .card-controls .actions`);
        const desktopMetrics = await page.evaluate((selector) => {
            const card = document.querySelector(selector);
            if (!(card instanceof HTMLElement)) {
                return null;
            }
            const computed = window.getComputedStyle(card);
            const controls = card.querySelector(".card-controls");
            const content = card.querySelector(".note-html-view") || card.querySelector(".markdown-editor");
            const controlsActions = controls?.querySelector(".actions");
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
            const badge = card.querySelector(".note-badges");
            const markdownContent = card.querySelector(".note-html-view .markdown-content");
            const controlsStyle = window.getComputedStyle(controls);
            const actionsStyle = controlsActions instanceof HTMLElement ? window.getComputedStyle(controlsActions) : null;
            return {
                gridDisplay: computed.display,
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
                controlsTrackWidth,
                controlsLayout: {
                    display: controlsStyle.display,
                    flexDirection: controlsStyle.flexDirection,
                    gridColumnStart: controlsStyle.gridColumnStart,
                    gridColumnEnd: controlsStyle.gridColumnEnd,
                    justifySelf: controlsStyle.justifySelf,
                    alignSelf: controlsStyle.alignSelf,
                    textAlign: controlsStyle.textAlign
                },
                actionsLayout: actionsStyle
                    ? {
                        display: actionsStyle.display,
                        flexDirection: actionsStyle.flexDirection,
                        visibility: actionsStyle.visibility,
                        opacity: actionsStyle.opacity
                    }
                    : null,
                controlsTop: controlsRect.top,
                contentTop: contentRect.top,
                badgeHeight: badge instanceof HTMLElement ? badge.getBoundingClientRect().height : 0,
                markdownTop: markdownContent instanceof HTMLElement ? markdownContent.getBoundingClientRect().top : null,
                markdownMarginTop: (() => {
                    if (!(markdownContent instanceof HTMLElement)) return null;
                    const firstChild = markdownContent.firstElementChild;
                    return firstChild instanceof HTMLElement ? parseFloat(getComputedStyle(firstChild).marginTop || "0") : null;
                })(),
                containerMarginTop: parseFloat(window.getComputedStyle(content).marginTop || "0"),
                columnAssignments: (() => {
                    const contentStyles = window.getComputedStyle(card.querySelector(".card-content") ?? content);
                    const controlStyles = window.getComputedStyle(controls);
                    return {
                        contentStart: contentStyles.gridColumnStart,
                        contentEnd: contentStyles.gridColumnEnd,
                        controlsStart: controlStyles.gridColumnStart,
                        controlsEnd: controlStyles.gridColumnEnd
                    };
                })()
            };
        }, cardSelector);
        assert.ok(desktopMetrics, "Expected to collect desktop card metrics");
        assert.equal(desktopMetrics.gridDisplay, "grid");
        assert.ok(desktopMetrics.contentWidth > 0 && desktopMetrics.controlsWidth > 0, "Track widths must be measurable");
        assert.ok(desktopMetrics.contentTrackWidth > 0 && desktopMetrics.controlsTrackWidth > 0);
        const ratio = desktopMetrics.contentTrackWidth / desktopMetrics.controlsTrackWidth;
        assert.ok(ratio >= 1.9 && ratio <= 2.2, `Content column should remain close to a 2:1 ratio (observed ${ratio.toFixed(2)}).`);
        assert.ok(desktopMetrics.columnGap >= 10 && desktopMetrics.columnGap <= 14, "Column gap should remain close to 0.75rem");
        assert.ok(desktopMetrics.rowGap >= 0 && desktopMetrics.rowGap <= 2, "Grid row gap should remain near zero after restructuring column content.");
        assert.equal(desktopMetrics.alignItems, "start");
        assert.ok(desktopMetrics.paddingLeft >= 15 && desktopMetrics.paddingLeft <= 18);
        assert.ok(desktopMetrics.paddingRight >= 15 && desktopMetrics.paddingRight <= 18);
        assert.ok(desktopMetrics.borderWidth >= 1 && desktopMetrics.borderWidth <= 1.5);
        assert.equal(desktopMetrics.borderColor, "rgba(58, 68, 94, 0.7)");

        assert.equal(desktopMetrics.controlsLayout.display, "flex");
        assert.equal(desktopMetrics.controlsLayout.flexDirection, "column");
        assert.equal(desktopMetrics.controlsLayout.gridColumnStart, "2");
        assert.equal(desktopMetrics.controlsLayout.gridColumnEnd, "auto");
        assert.equal(desktopMetrics.controlsLayout.justifySelf, "stretch");
        assert.equal(desktopMetrics.controlsLayout.alignSelf, "start");
        assert.equal(desktopMetrics.controlsLayout.textAlign, "right");
        assert.ok(desktopMetrics.actionsLayout, "Expected control actions metrics");
        assert.equal(desktopMetrics.actionsLayout.display, "flex");
        assert.equal(desktopMetrics.actionsLayout.flexDirection, "column");
        assert.equal(desktopMetrics.actionsLayout.visibility, "visible");
        assert.ok(parseFloat(desktopMetrics.actionsLayout.opacity) > 0);

        const placementDelta = Math.abs(desktopMetrics.contentTop - desktopMetrics.controlsTop);
        assert.ok(placementDelta <= 2, `Content column should align with controls top (delta ${placementDelta.toFixed(2)}px).`);

        const buttonSelector = `${cardSelector} .actions .action-button:not(.action-button--pin)`;
        await page.waitForSelector(buttonSelector);
        const buttonMetrics = await getComputedStyles(page, buttonSelector, [
            "border-radius",
            "font-size",
            "padding-top",
            "padding-right",
            "padding-bottom",
            "padding-left"
        ]);
        assert.equal(buttonMetrics["border-radius"], "6px");
        assert.ok(parseFloat(buttonMetrics["font-size"]) <= 14);
        const horizontalPadding = parseFloat(buttonMetrics["padding-left"]) + parseFloat(buttonMetrics["padding-right"]);
        const verticalPadding = parseFloat(buttonMetrics["padding-top"]) + parseFloat(buttonMetrics["padding-bottom"]);
        assert.ok(horizontalPadding > 4 && horizontalPadding < 14, "Buttons should remain compact horizontally");
        assert.ok(verticalPadding > 4 && verticalPadding < 10, "Buttons should remain compact vertically");

        assert.equal(desktopMetrics.columnAssignments.contentStart, "1", "Content column should start in column 1");
        assert.equal(desktopMetrics.columnAssignments.contentEnd, "auto", "Content column should rely on implicit end column");
        assert.equal(desktopMetrics.columnAssignments.controlsStart, "2", "Control column should start in column 2");
        assert.equal(desktopMetrics.columnAssignments.controlsEnd, "auto", "Control column should rely on implicit end column");

        const viewportMetrics = await page.evaluate(() => {
            const scrollElement = document.scrollingElement || document.documentElement;
            if (!(scrollElement instanceof Element)) {
                return null;
            }
            const widthDelta = window.innerWidth - scrollElement.clientWidth;
            const heightDelta = window.innerHeight - scrollElement.clientHeight;
            const scrollable = scrollElement.scrollHeight - window.innerHeight > 10;
            return { widthDelta, heightDelta, scrollable };
        });
        assert.ok(viewportMetrics, "Expected viewport metrics for scrollbar check");
        assert.ok(viewportMetrics.scrollable, "Application should remain vertically scrollable for tall feeds");
        assert.ok(
            viewportMetrics.widthDelta <= 1,
            `Vertical scrollbars should be hidden (observed gap ${viewportMetrics.widthDelta.toFixed(2)}px)`
        );
        assert.ok(
            viewportMetrics.heightDelta <= 1,
            `Horizontal scrollbars should be hidden (observed gap ${viewportMetrics.heightDelta.toFixed(2)}px)`
        );
    });
});

test("mobile layout stacks controls above content", async () => {
    await withPreparedPage(async ({ page, cardSelector }) => {
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
    }, {
        viewport: { width: 420, height: 900, deviceScaleFactor: 1 }
    });
});

async function withPreparedPage(callback, options = {}) {
    const context = await preparePage(options);
    try {
        await callback(context);
    } finally {
        await context.teardown();
    }
}

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
    await waitForAppHydration(page);
    await flushAlpineQueues(page);
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
