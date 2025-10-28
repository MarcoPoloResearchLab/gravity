import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createSharedPage } from "./helpers/browserHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;
const CODEMIRROR_SELECTOR = ".markdown-block.top-editor .CodeMirror";

test.describe("GN-205 browser grammar support", () => {
    test("top editor exposes a contenteditable surface with native grammar attributes", async () => {
        const { page, teardown } = await createSharedPage();
        try {
            await page.goto(PAGE_URL);
            await page.waitForSelector(CODEMIRROR_SELECTOR, { timeout: 3000 });

            const diagnostics = await page.evaluate((selector) => {
                const wrapper = document.querySelector(selector);
                if (!(wrapper instanceof HTMLElement)) {
                    return null;
                }
                const editable = wrapper.querySelector('[contenteditable="true"]');
                return {
                    hasContentEditable: editable instanceof HTMLElement,
                    contentEditableSpellcheck: editable instanceof HTMLElement ? editable.spellcheck : null,
                    contentEditableAutoCorrect: editable instanceof HTMLElement ? editable.getAttribute("autocorrect") : null,
                    contentEditableGramm: editable instanceof HTMLElement ? editable.getAttribute("data-gramm") : null,
                    hasFallbackTextarea: Boolean(wrapper.querySelector("textarea"))
                };
            }, CODEMIRROR_SELECTOR);

            assert.ok(diagnostics, "expected editor diagnostics payload");
            assert.equal(diagnostics.hasContentEditable, true, "CodeMirror should expose a contenteditable editing surface");
            assert.equal(
                diagnostics.contentEditableSpellcheck,
                true,
                "contenteditable surface should keep spellcheck enabled for browser grammar tools"
            );
            assert.equal(
                diagnostics.contentEditableAutoCorrect,
                "on",
                "contenteditable surface should keep autocorrect hints enabled"
            );
            assert.equal(
                diagnostics.contentEditableGramm,
                "true",
                "contenteditable surface should advertise Grammarly compatibility"
            );
            assert.equal(
                diagnostics.hasFallbackTextarea,
                false,
                "no inactive fallback textarea should remain when using contenteditable mode"
            );
        } finally {
            await teardown();
        }
    });
});
