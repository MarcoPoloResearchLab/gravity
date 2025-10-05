import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { appConfig } from "../js/core/config.js";

let puppeteerModule;
try {
    ({ default: puppeteerModule } = await import("puppeteer"));
} catch (error) {
    puppeteerModule = null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

if (!puppeteerModule) {
    test("puppeteer unavailable", () => {
        test.skip("Puppeteer is not installed in this environment.");
    });
} else {
    test.describe("Enhanced Markdown editor", () => {
        /** @type {import('puppeteer').Browser} */
        let browser;

        test.before(async () => {
            const launchArgs = ["--allow-file-access-from-files"];
            if (process.env.CI) {
                launchArgs.push("--no-sandbox", "--disable-setuid-sandbox");
            }
            browser = await puppeteerModule.launch({ headless: "new", args: launchArgs });
        });

        test.after(async () => {
            if (browser) await browser.close();
        });

        test("EasyMDE auto-continues lists, fences, and brackets", async () => {
            const page = await prepareEnhancedPage(browser);
            try {
                const cmSelector = "#top-editor .CodeMirror";
                const cmTextarea = `${cmSelector} textarea`;
                await page.waitForSelector(cmSelector);
                await page.waitForSelector(cmTextarea);

                // Unordered list continuation retains bullet symbol
                await page.focus(cmTextarea);
                await page.keyboard.type("* Alpha");
                await page.keyboard.press("Enter");
                const listState = await getCodeMirrorState(page);
                assert.equal(listState.value, "* Alpha\n* ");
                assert.equal(listState.cursor.line, 1);
                assert.equal(listState.cursor.ch, 2);

                await page.keyboard.type("Beta");
                await page.keyboard.press("Enter");
                const listContinuation = await getCodeMirrorState(page);
                assert.equal(listContinuation.cursor.line, 2);
                assert.equal(listContinuation.cursor.ch, 2);
                assert.match(listContinuation.value, /^\* Alpha\n\* Beta\n\* $/);

                // Reset editor before code fence scenario
                await page.evaluate(() => {
                    const wrapper = document.querySelector("#top-editor .CodeMirror");
                    if (!wrapper) return;
                    const cm = wrapper.CodeMirror;
                    cm.setValue("");
                    cm.setCursor({ line: 0, ch: 0 });
                });

                await page.focus(cmTextarea);
                await page.keyboard.type("```js");
                await page.keyboard.press("Enter");
                const fenceState = await getCodeMirrorState(page);
                assert.equal(fenceState.value, "```js\n\n```");
                assert.equal(fenceState.cursor.line, 1);
                assert.equal(fenceState.cursor.ch, 0);

                // Reset for bracket auto-close
                await page.evaluate(() => {
                    const wrapper = document.querySelector("#top-editor .CodeMirror");
                    if (!wrapper) return;
                    const cm = wrapper.CodeMirror;
                    cm.setValue("");
                    cm.setCursor({ line: 0, ch: 0 });
                });

                await page.focus(cmTextarea);
                await page.keyboard.type("(");
                const bracketState = await getCodeMirrorState(page);
                assert.equal(bracketState.value, "()");
                assert.equal(bracketState.cursor.line, 0);
                assert.equal(bracketState.cursor.ch, 1);
            } finally {
                await page.close();
            }
        });
    });
}

async function getCodeMirrorState(page) {
    return page.evaluate(() => {
        const wrapper = document.querySelector("#top-editor .CodeMirror");
        if (!wrapper) return { value: null, cursor: { line: -1, ch: -1 } };
        const cm = wrapper.CodeMirror;
        const cursor = cm.getCursor();
        return { value: cm.getValue(), cursor };
    });
}

async function prepareEnhancedPage(browser) {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument((storageKey) => {
        window.__gravityForceMarkdownEditor = true;
        window.localStorage.clear();
        window.localStorage.setItem(storageKey, JSON.stringify([]));
    }, appConfig.storageKey);

    await page.goto(PAGE_URL, { waitUntil: "networkidle0" });
    await page.waitForSelector("#top-editor .CodeMirror");
    return page;
}
