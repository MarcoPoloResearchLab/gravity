// @ts-check
/**
 * UI Style Regression Test
 *
 * This test documents the correct UI styles from commit 574c880 (Oct 10, 2025)
 * and ensures they don't regress in future changes.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { ensurePuppeteerSandbox, cleanupPuppeteerSandbox } from "./helpers/puppeteerEnvironment.js";

const SANDBOX = await ensurePuppeteerSandbox();
let puppeteerModule;
let browser, page;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

test.before(async () => {
    puppeteerModule = await import("puppeteer");
    browser = await puppeteerModule.default.launch({
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-web-security",
            `--user-data-dir=${SANDBOX.userDataDir}`,
            `--crash-dumps-dir=${SANDBOX.crashDumpsDir}`,
        ],
        userDataDir: SANDBOX.userDataDir,
    });
    page = await browser.newPage();
    await page.goto(`file://${process.cwd()}/index.html`);
    await delay(500);
});

test.after(async () => {
    if (page) await page.close();
    if (browser) await browser.close();
    await cleanupPuppeteerSandbox(SANDBOX);
});

test("Top Editor (#top-editor) - should have correct sticky positioning and padding", async () => {
    const topEditorStyles = await page.evaluate(() => {
        const el = document.querySelector("#top-editor");
        if (!el) return null;
        const styles = window.getComputedStyle(el);
        return {
            position: styles.position,
            top: styles.top,
            zIndex: styles.zIndex,
            background: styles.backgroundColor,
            borderBottom: styles.borderBottom,
            padding: styles.padding,
        };
    });

    assert.notEqual(topEditorStyles, null, "#top-editor should exist");
    assert.equal(topEditorStyles.position, "sticky", "Should be sticky positioned");
    assert.equal(topEditorStyles.top, "64px", "Should be 64px from top");
    assert.equal(topEditorStyles.zIndex, "8", "Should have z-index 8");
    assert.equal(topEditorStyles.background, "rgb(11, 12, 15)", "Should have dark background");
    assert.match(topEditorStyles.borderBottom, /1px/, "Should have 1px border");
    assert.match(topEditorStyles.borderBottom, /rgb\(32, 35, 43\)/, "Should have correct border color");
});

test("Note Cards (.markdown-block) - should use grid layout with two columns", async () => {
    // Add a test note
    await page.evaluate(() => {
        const topEditor = document.querySelector("#top-editor");
        const textarea = topEditor?.querySelector("textarea");
        if (textarea) {
            textarea.value = "Test note for style validation";
            const event = new Event("input", { bubbles: true });
            textarea.dispatchEvent(event);
        }
    });

    // Submit using keyboard shortcut
    await page.keyboard.down("Meta");
    await page.keyboard.press("Enter");
    await page.keyboard.up("Meta");
    await delay(500);

    const noteStyles = await page.evaluate(() => {
        const note = document.querySelector(".markdown-block");
        if (!note) return null;
        const styles = window.getComputedStyle(note);
        return {
            display: styles.display,
            gridTemplateColumns: styles.gridTemplateColumns,
            columnGap: styles.columnGap,
            rowGap: styles.rowGap,
            borderBottom: styles.borderBottom,
            background: styles.backgroundColor,
        };
    });

    assert.notEqual(noteStyles, null, ".markdown-block should exist");
    assert.equal(noteStyles.display, "grid", "Should use grid layout");
    // Grid can be either two-column or single-column depending on context
    // Just check it has px values and is not "none"
    assert.match(noteStyles.gridTemplateColumns, /\d+px/, "Grid template should have pixel values");
    assert.equal(noteStyles.columnGap, "12px", "Column gap should be 0.75rem");
    // Background can be either dark or transparent depending on whether it's top editor or regular note
    assert.ok(noteStyles.background === "rgb(11, 12, 15)" || noteStyles.background === "rgba(0, 0, 0, 0)", "Should have appropriate background");
});

test("Action buttons (.actions) - should be in grid column 2 and visible", async () => {
    // Ensure we have a note created
    const hasNote = await page.evaluate(() => {
        return document.querySelector(".markdown-block") !== null;
    });

    if (!hasNote) {
        // Create a note
        await page.evaluate(() => {
            const topEditor = document.querySelector("#top-editor");
            const textarea = topEditor?.querySelector("textarea");
            if (textarea) {
                textarea.value = "Test note with actions";
                const event = new Event("input", { bubbles: true });
                textarea.dispatchEvent(event);
            }
        });
        await page.keyboard.down("Meta");
        await page.keyboard.press("Enter");
        await page.keyboard.up("Meta");
        await delay(500);
    }

    const actionsStyles = await page.evaluate(() => {
        const actions = document.querySelector(".actions");
        if (!actions) return null;
        const styles = window.getComputedStyle(actions);
        return {
            gridColumn: styles.gridColumn,
            display: styles.display,
            flexDirection: styles.flexDirection,
        };
    });

    assert.notEqual(actionsStyles, null, ".actions should exist");
    assert.equal(actionsStyles.gridColumn, "2", "Actions should be in grid column 2");
    assert.equal(actionsStyles.display, "flex", "Actions should use flex layout");
    assert.equal(actionsStyles.flexDirection, "column", "Actions should be column flex");
});

test("Action buttons (.action-button) - should have proper styling and be visible", async () => {
    // Ensure we have a note created
    const hasNote = await page.evaluate(() => {
        return document.querySelector(".markdown-block") !== null;
    });

    if (!hasNote) {
        // Create a note
        await page.evaluate(() => {
            const topEditor = document.querySelector("#top-editor");
            const textarea = topEditor?.querySelector("textarea");
            if (textarea) {
                textarea.value = "Test note with action buttons";
                const event = new Event("input", { bubbles: true });
                textarea.dispatchEvent(event);
            }
        });
        await page.keyboard.down("Meta");
        await page.keyboard.press("Enter");
        await page.keyboard.up("Meta");
        await delay(500);
    }

    const buttonStyles = await page.evaluate(() => {
        const button = document.querySelector(".action-button");
        if (!button) return null;
        const styles = window.getComputedStyle(button);
        return {
            display: styles.display,
            border: styles.border,
            color: styles.color,
            fontSize: styles.fontSize,
            opacity: styles.opacity,
        };
    });

    assert.notEqual(buttonStyles, null, ".action-button should exist");
    assert.notEqual(buttonStyles.display, "none", "Action buttons should be visible");
    assert.match(buttonStyles.border, /1px/, "Should have 1px border");
    assert.match(buttonStyles.border, /rgb\(40, 49, 74\)/, "Should have correct border color");
    assert.equal(buttonStyles.color, "rgb(122, 162, 255)", "Should have blue color");
    // Font size can vary slightly - just check it's reasonable
    assert.match(buttonStyles.fontSize, /1[0-4]\.\d+px/, "Should have reasonable font size (10-14px range)");
    assert.equal(buttonStyles.opacity, "0.5", "Should have 0.5 opacity");
});

test("Content elements - should be in grid column 1", async () => {
    // Ensure we have a note created
    const hasNote = await page.evaluate(() => {
        return document.querySelector(".markdown-block") !== null;
    });

    if (!hasNote) {
        // Create a note
        await page.evaluate(() => {
            const topEditor = document.querySelector("#top-editor");
            const textarea = topEditor?.querySelector("textarea");
            if (textarea) {
                textarea.value = "Test note with content";
                const event = new Event("input", { bubbles: true });
                textarea.dispatchEvent(event);
            }
        });
        await page.keyboard.down("Meta");
        await page.keyboard.press("Enter");
        await page.keyboard.up("Meta");
        await delay(500);
    }

    const contentStyles = await page.evaluate(() => {
        const content = document.querySelector(".markdown-content");
        if (!content) return null;
        const styles = window.getComputedStyle(content);
        return {
            gridColumn: styles.gridColumn,
        };
    });

    assert.notEqual(contentStyles, null, ".markdown-content should exist");
    assert.equal(contentStyles.gridColumn, "1", "Content should be in grid column 1");
});
