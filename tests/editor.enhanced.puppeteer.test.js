import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { appConfig } from "../js/core/config.js";
import { ensurePuppeteerSandbox, cleanupPuppeteerSandbox } from "./helpers/puppeteerEnvironment.js";

const SANDBOX = await ensurePuppeteerSandbox();
const {
    homeDir: SANDBOX_HOME_DIR,
    userDataDir: SANDBOX_USER_DATA_DIR,
    cacheDir: SANDBOX_CACHE_DIR,
    configDir: SANDBOX_CONFIG_DIR,
    crashDumpsDir: SANDBOX_CRASH_DUMPS_DIR
} = SANDBOX;

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
    const executablePath = typeof puppeteerModule.executablePath === "function"
        ? puppeteerModule.executablePath()
        : undefined;
    if (typeof executablePath === "string" && executablePath.length > 0) {
        process.env.PUPPETEER_EXECUTABLE_PATH = executablePath;
    }

    test.describe("Enhanced Markdown editor", () => {
        /** @type {import('puppeteer').Browser} */
        let browser;
        /** @type {Error|null} */
        let launchError = null;

        const shouldSkip = () => {
            if (!browser) {
                test.skip(launchError ? launchError.message : "Puppeteer launch unavailable in sandbox.");
                return true;
            }
            return false;
        };

        test.before(async () => {
            const launchArgs = [
                "--allow-file-access-from-files",
                "--disable-crashpad",
                "--disable-features=Crashpad",
                "--noerrdialogs",
                "--no-crash-upload",
                "--enable-crash-reporter=0",
                `--crash-dumps-dir=${SANDBOX_CRASH_DUMPS_DIR}`
            ];
            if (process.env.CI) {
                launchArgs.push("--no-sandbox", "--disable-setuid-sandbox");
            }
            try {
                browser = await puppeteerModule.launch({
                    headless: "new",
                    args: launchArgs,
                    userDataDir: SANDBOX_USER_DATA_DIR,
                    env: {
                        ...process.env,
                        HOME: SANDBOX_HOME_DIR,
                        XDG_CACHE_HOME: SANDBOX_CACHE_DIR,
                        XDG_CONFIG_HOME: SANDBOX_CONFIG_DIR
                    }
                });
            } catch (error) {
                launchError = error instanceof Error ? error : new Error(String(error));
            }
        });

        test.after(async () => {
            if (browser) await browser.close();
            await cleanupPuppeteerSandbox(SANDBOX);
        });

        test("EasyMDE auto-continues lists, fences, and brackets", async () => {
            if (shouldSkip()) return;
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

        test("EasyMDE undo and redo shortcuts restore history", async () => {
            if (shouldSkip()) return;
            const page = await prepareEnhancedPage(browser);
            try {
                const cmSelector = "#top-editor .CodeMirror";
                const cmTextarea = `${cmSelector} textarea`;
                await page.waitForSelector(cmSelector);
                await page.waitForSelector(cmTextarea);

                await page.focus(cmTextarea);
                await page.keyboard.type("Alpha");

                let state = await getCodeMirrorState(page);
                assert.equal(state.value, "Alpha");

                await page.keyboard.down("Control");
                await page.keyboard.press("KeyZ");
                await page.keyboard.up("Control");

                state = await getCodeMirrorState(page);
                assert.equal(state.value, "");

                await page.keyboard.down("Control");
                await page.keyboard.down("Shift");
                await page.keyboard.press("KeyZ");
                await page.keyboard.up("Shift");
                await page.keyboard.up("Control");

                state = await getCodeMirrorState(page);
                assert.equal(state.value, "Alpha");
            } finally {
                await page.close();
            }
        });

        test("EasyMDE renumbers ordered lists after pasted insertion", async () => {
            if (shouldSkip()) return;
            const page = await prepareEnhancedPage(browser);
            try {
                await page.evaluate(() => {
                    const wrapper = document.querySelector("#top-editor .CodeMirror");
                    if (!wrapper) {
                        throw new Error("CodeMirror wrapper not found");
                    }
                    const cm = wrapper.CodeMirror;
                    cm.setValue("1. First\n2. Third");
                    cm.setCursor({ line: 1, ch: 0 });
                    cm.replaceSelection("2. Second\n", "start");
                });

                await page.waitForFunction(() => {
                    const wrapper = document.querySelector("#top-editor .CodeMirror");
                    if (!wrapper) return false;
                    const cm = wrapper.CodeMirror;
                    return cm.getValue() === "1. First\n2. Second\n3. Third";
                });

                const state = await getCodeMirrorState(page);
                assert.equal(state.value, "1. First\n2. Second\n3. Third");
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
