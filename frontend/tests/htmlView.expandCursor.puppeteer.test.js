import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { appConfig } from "../js/core/config.js";
import { createSharedPage, flushAlpineQueues, waitForAppHydration } from "./helpers/browserHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

const NOTE_ID = "cursor-hover-primary";
const NOTE_MARKDOWN = [
    "# Cursor hover regression guard",
    "",
    "This note ensures the expand strip exposes a pointer cursor when hovering the bottom control zone.",
    "",
    "> The rendered markdown needs several lines so the htmlView has space above the strip.",
    "",
    "- Item one keeps the content flowing.",
    "- Item two maintains the note height.",
    "- Item three provides more surface area."
].join("\n");

test("htmlView expand strip exposes pointer cursor in the control zone", async () => {
    const timestamp = new Date().toISOString();
    const record = {
        noteId: NOTE_ID,
        markdownText: NOTE_MARKDOWN,
        attachments: {},
        createdAtIso: timestamp,
        updatedAtIso: timestamp,
        lastActivityIso: timestamp,
        pinned: false
    };

    const { page, teardown } = await openPageWithRecord(record);
    const cardSelector = `.markdown-block[data-note-id="${NOTE_ID}"]`;
    const htmlViewSelector = `${cardSelector} .note-html-view`;

    try {
        await page.waitForSelector(cardSelector);

        const initialCursor = await getHtmlViewCursor(page, htmlViewSelector);
        assert.notEqual(initialCursor, "pointer", "initial cursor should not begin in pointer state");

        const bottomCoordinates = await resolveHoverCoordinates(page, cardSelector, "control-zone");
        assert.ok(bottomCoordinates, "control zone coordinates should be resolved");
        await dispatchMouseMove(page, htmlViewSelector, bottomCoordinates);

        await page.waitForFunction((selector) => {
            const element = document.querySelector(selector);
            if (!(element instanceof HTMLElement)) {
                return false;
            }
            return element.classList.contains("note-html-view--toggle-hover") &&
                window.getComputedStyle(element).cursor === "pointer";
        }, {}, htmlViewSelector);

        const midCoordinates = await resolveHoverCoordinates(page, cardSelector, "content-zone");
        assert.ok(midCoordinates, "content zone coordinates should be resolved");
        await dispatchMouseMove(page, htmlViewSelector, midCoordinates);

        await page.waitForFunction((selector) => {
            const element = document.querySelector(selector);
            if (!(element instanceof HTMLElement)) {
                return false;
            }
            const cursor = window.getComputedStyle(element).cursor;
            return !element.classList.contains("note-html-view--toggle-hover") && cursor !== "pointer";
        }, {}, htmlViewSelector);
    } finally {
        await teardown();
    }
});

async function openPageWithRecord(record) {
    const { page, teardown } = await createSharedPage({
        development: {
            llmProxyUrl: ""
        }
    });
    await page.evaluateOnNewDocument((storageKey, payload) => {
        window.sessionStorage.setItem("__gravityTestInitialized", "true");
        window.localStorage.clear();
        if (typeof payload === "string") {
            window.localStorage.setItem(storageKey, payload);
        }
    }, appConfig.storageKey, JSON.stringify([record]));

    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
    await waitForAppHydration(page);
    await flushAlpineQueues(page);
    await page.waitForSelector("#top-editor .markdown-editor");

    return { page, teardown };
}

async function getHtmlViewCursor(page, selector) {
    return page.evaluate((targetSelector) => {
        const element = document.querySelector(targetSelector);
        if (!(element instanceof HTMLElement)) {
            return null;
        }
        return window.getComputedStyle(element).cursor;
    }, selector);
}

async function resolveHoverCoordinates(page, cardSelector, zone) {
    return page.evaluate((selector, targetZone) => {
        const card = document.querySelector(selector);
        if (!(card instanceof HTMLElement)) {
            return null;
        }
        const htmlView = card.querySelector(".note-html-view");
        if (!(htmlView instanceof HTMLElement)) {
            return null;
        }
        const htmlRect = htmlView.getBoundingClientRect();
        const toggle = card.querySelector(".note-expand-toggle");
        const toggleRect = toggle instanceof HTMLElement ? toggle.getBoundingClientRect() : null;
        const x = htmlRect.left + htmlRect.width / 2;
        const hitHeight = toggleRect && Number.isFinite(toggleRect.height) ? toggleRect.height : 0;
        if (targetZone === "control-zone") {
            const offset = Math.max(1, hitHeight > 0 ? hitHeight / 2 : 8);
            const y = Math.max(htmlRect.top, htmlRect.bottom - offset);
            return { x, y };
        }
        if (hitHeight > 0) {
            const safeY = htmlRect.bottom - hitHeight - 12;
            const y = Math.max(htmlRect.top + 8, safeY);
            return { x, y };
        }
        const fallbackY = htmlRect.top + Math.max(8, htmlRect.height * 0.25);
        return { x, fallbackY };
    }, cardSelector, zone);
}

async function dispatchMouseMove(page, selector, coordinates) {
    await page.evaluate((targetSelector, coords) => {
        const element = document.querySelector(targetSelector);
        if (!(element instanceof HTMLElement) || !coords) {
            return;
        }
        const event = new MouseEvent("mousemove", {
            bubbles: true,
            cancelable: true,
            clientX: coords.x,
            clientY: coords.y
        });
        element.dispatchEvent(event);
    }, selector, coordinates);
}
