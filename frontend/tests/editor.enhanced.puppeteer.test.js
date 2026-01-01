import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { appConfig } from "../js/core/config.js?build=2026-01-01T21:20:40Z";
import { createSharedPage } from "./helpers/browserHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

const getCodeMirrorInputSelector = (scope) => `${scope} .CodeMirror [contenteditable="true"], ${scope} .CodeMirror textarea`;

test.describe("Enhanced Markdown editor", () => {
    test("EasyMDE auto-continues lists, fences, and brackets", async () => {
        const { page, teardown } = await openEnhancedPage();
        try {
            const cmSelector = "#top-editor .CodeMirror";
            const cmInputSelector = getCodeMirrorInputSelector("#top-editor");
            await page.waitForSelector(cmSelector);
            await page.waitForSelector(cmInputSelector);

                // Unordered list continuation retains bullet symbol
                await page.focus(cmInputSelector);
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

                // First list item Enter inserts a plain newline before the list
                await page.evaluate(() => {
                    const wrapper = document.querySelector("#top-editor .CodeMirror");
                    if (!wrapper) return;
                    const cm = wrapper.CodeMirror;
                    cm.setValue("* Alpha\n* Beta");
                    cm.setCursor({ line: 0, ch: 0 });
                });
                await page.focus(cmInputSelector);
                await page.keyboard.press("Enter");
                const firstLineState = await getCodeMirrorState(page);
                assert.equal(firstLineState.value, "\n* Alpha\n* Beta");
                assert.equal(firstLineState.cursor.line, 1);
                assert.equal(firstLineState.cursor.ch, 0);

                // Checklist continuation inserts unchecked task prefix
                await page.evaluate(() => {
                    const wrapper = document.querySelector("#top-editor .CodeMirror");
                    if (!wrapper) return;
                    const cm = wrapper.CodeMirror;
                    cm.setValue("- [ ] First task");
                    const line = cm.getLine(0);
                    cm.setCursor({ line: 0, ch: line.length });
                });
                await page.focus(cmInputSelector);
                await page.keyboard.press("Enter");
                const checklistState = await getCodeMirrorState(page);
                assert.equal(checklistState.value, "- [ ] First task\n- [ ] ");
                assert.equal(checklistState.cursor.line, 1);
                assert.equal(checklistState.cursor.ch, "- [ ] ".length);

                // Reset editor before code fence scenario
                await page.evaluate(() => {
                    const wrapper = document.querySelector("#top-editor .CodeMirror");
                    if (!wrapper) return;
                    const cm = wrapper.CodeMirror;
                    cm.setValue("");
                    cm.setCursor({ line: 0, ch: 0 });
                });

                await page.focus(cmInputSelector);
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

                await page.focus(cmInputSelector);
                await page.keyboard.type("(");
                const bracketState = await getCodeMirrorState(page);
                assert.equal(bracketState.value, "()");
                assert.equal(bracketState.cursor.line, 0);
                assert.equal(bracketState.cursor.ch, 1);
            } finally {
                await teardown();
            }
        });

        test("EasyMDE undo and redo shortcuts restore history", async () => {
            const { page, teardown } = await openEnhancedPage();
            try {
                const cmSelector = "#top-editor .CodeMirror";
                const cmInputSelector = getCodeMirrorInputSelector("#top-editor");
                await page.waitForSelector(cmSelector);
                await page.waitForSelector(cmInputSelector);

                await page.focus(cmInputSelector);
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
                await teardown();
            }
        });

        test("EasyMDE skips duplicate closing brackets", async () => {
            const { page, teardown } = await openEnhancedPage();
            try {
                const cmSelector = "#top-editor .CodeMirror";
                const cmInputSelector = getCodeMirrorInputSelector("#top-editor");
                await page.waitForSelector(cmSelector);
                await page.waitForSelector(cmInputSelector);

                await page.focus(cmInputSelector);
                await page.keyboard.type("(");

                let state = await getCodeMirrorState(page);
                assert.equal(state.value, "()");
                assert.equal(state.cursor.ch, 1);

                await page.keyboard.type(")");

                state = await getCodeMirrorState(page);
                assert.equal(state.value, "()");
                assert.equal(state.cursor.ch, 2);

                await page.evaluate(() => {
                    const wrapper = document.querySelector("#top-editor .CodeMirror");
                    if (!wrapper) return;
                    const cm = wrapper.CodeMirror;
                    cm.setValue("");
                    cm.setCursor({ line: 0, ch: 0 });
                });

                await page.focus(cmInputSelector);
                await page.keyboard.type("{");
                await page.keyboard.type("}");

                state = await getCodeMirrorState(page);
                assert.equal(state.value, "{}");
                assert.equal(state.cursor.ch, 2);

                await page.evaluate(() => {
                    const wrapper = document.querySelector("#top-editor .CodeMirror");
                    if (!wrapper) return;
                    const cm = wrapper.CodeMirror;
                    cm.setValue("");
                    cm.setCursor({ line: 0, ch: 0 });
                });

                await page.focus(cmInputSelector);
                await page.keyboard.type("[");
                await page.keyboard.type("]");

                state = await getCodeMirrorState(page);
                assert.equal(state.value, "[ ] ");
                assert.equal(state.cursor.ch, 4);
        } finally {
            await teardown();
        }
    });

    test("EasyMDE delete line shortcut removes the active row", async () => {
        const { page, teardown } = await openEnhancedPage();
        try {
            const cmSelector = "#top-editor .CodeMirror";
            const cmInputSelector = getCodeMirrorInputSelector("#top-editor");
            await page.waitForSelector(cmSelector);
            await page.waitForSelector(cmInputSelector);

                await page.evaluate(() => {
                    const wrapper = document.querySelector("#top-editor .CodeMirror");
                    if (!wrapper) return;
                    const cm = wrapper.CodeMirror;
                    cm.setValue("Alpha\nBeta");
                    cm.setCursor({ line: 0, ch: 1 });
                });

                await page.focus(cmInputSelector);
                await page.keyboard.down("Control");
                await page.keyboard.down("Shift");
                await page.keyboard.press("KeyK");
                await page.keyboard.up("Shift");
                await page.keyboard.up("Control");

                const state = await getCodeMirrorState(page);
                assert.equal(state.value, "Beta");
                assert.equal(state.cursor.line, 0);
                assert.equal(state.cursor.ch, 0);
        } finally {
            await teardown();
        }
    });

    test("EasyMDE duplicate line shortcut copies the active row", async () => {
        const { page, teardown } = await openEnhancedPage();
        try {
            const cmSelector = "#top-editor .CodeMirror";
            const cmInputSelector = getCodeMirrorInputSelector("#top-editor");
            await page.waitForSelector(cmSelector);
            await page.waitForSelector(cmInputSelector);

                await page.evaluate(() => {
                    const wrapper = document.querySelector("#top-editor .CodeMirror");
                    if (!wrapper) return;
                    const cm = wrapper.CodeMirror;
                    cm.setValue("Alpha\nBeta");
                    cm.setCursor({ line: 0, ch: 2 });
                });

                await page.focus(cmInputSelector);
                await page.keyboard.down("Control");
                await page.keyboard.down("Shift");
                await page.keyboard.press("KeyD");
                await page.keyboard.up("Shift");
                await page.keyboard.up("Control");

                const state = await getCodeMirrorState(page);
                assert.equal(state.value, "Alpha\nAlpha\nBeta");
                assert.equal(state.cursor.line, 1);
                assert.equal(state.cursor.ch, 2);
        } finally {
            await teardown();
        }
    });

    test("EasyMDE renumbers ordered lists before submit", async () => {
        const { page, teardown } = await openEnhancedPage();
        try {
            const cmSelector = "#top-editor .CodeMirror";
            const cmInputSelector = getCodeMirrorInputSelector("#top-editor");
            await page.waitForSelector(cmSelector);
            await page.waitForSelector(cmInputSelector);

                await page.evaluate(() => {
                    const wrapper = document.querySelector("#top-editor .CodeMirror");
                    if (!wrapper) return;
                    const cm = wrapper.CodeMirror;
                    cm.setValue("1. Alpha\n2. Bravo\n3. Charlie");
                });

                await page.evaluate(() => {
                    const wrapper = document.querySelector("#top-editor .CodeMirror");
                    if (!wrapper) return;
                    const cm = wrapper.CodeMirror;
                    cm.replaceRange("", { line: 0, ch: 0 }, { line: 1, ch: 0 });
                });

                let state = await getCodeMirrorState(page);
                assert.equal(state.value, "2. Bravo\n3. Charlie");

                await page.keyboard.down("Control");
                await page.keyboard.press("Enter");
                await page.keyboard.up("Control");

                await page.waitForFunction((storageKey) => {
                    const raw = window.localStorage.getItem(storageKey);
                    if (!raw) return false;
                    try {
                        const records = JSON.parse(raw);
                        return Array.isArray(records) && records.length === 1;
                    } catch {
                        return false;
                    }
                }, {}, appConfig.storageKey);

                const savedRecords = await page.evaluate((storageKey) => {
                    const raw = window.localStorage.getItem(storageKey);
                    return raw ? JSON.parse(raw) : [];
                }, appConfig.storageKey);

                assert.equal(savedRecords[0]?.markdownText, "1. Bravo\n2. Charlie");
        } finally {
            await teardown();
        }
    });

    test("EasyMDE renumbers ordered lists after pasted insertion", async () => {
        const { page, teardown } = await openEnhancedPage();
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
            await teardown();
        }
    });
});

async function getCodeMirrorState(page) {
    return page.evaluate(() => {
        const wrapper = document.querySelector("#top-editor .CodeMirror");
        if (!wrapper) return { value: null, cursor: { line: -1, ch: -1 } };
        const cm = wrapper.CodeMirror;
        const cursor = cm.getCursor();
        return { value: cm.getValue(), cursor };
    });
}

async function openEnhancedPage() {
    const { page, teardown } = await createSharedPage();
    await page.evaluateOnNewDocument((storageKey) => {
        window.__gravityForceMarkdownEditor = true;
        window.localStorage.clear();
        window.localStorage.setItem(storageKey, JSON.stringify([]));
    }, appConfig.storageKey);
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#top-editor .CodeMirror");
    return { page, teardown };
}
