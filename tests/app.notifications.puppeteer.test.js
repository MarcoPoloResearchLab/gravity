import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { ERROR_IMPORT_INVALID_PAYLOAD } from "../js/constants.js";
import { createSharedPage } from "./helpers/browserHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

test.describe("App notifications", () => {
    test("import failure surfaces toast notification", async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gravity-import-test-"));
        const invalidFilePath = path.join(tempDir, "invalid.json");
        await fs.writeFile(invalidFilePath, "not-json", "utf8");

        const { page, teardown } = await createSharedPage();
        try {
            await page.evaluateOnNewDocument(() => {
                window.GRAVITY_CONFIG = { backendBaseUrl: "", llmProxyClassifyUrl: "" };
            });
            await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
            await page.waitForSelector("#top-editor .markdown-editor");

            const fileInput = await page.$("#import-notes-input");
            if (!fileInput) {
                throw new Error("Import input not found");
            }
            await fileInput.uploadFile(invalidFilePath);

            await page.waitForSelector("#editor-toast.toast--visible");
            const toastMessage = await page.$eval("#editor-toast", (el) => el.textContent?.trim() ?? "");
            assert.equal(toastMessage, ERROR_IMPORT_INVALID_PAYLOAD);
        } finally {
            await teardown();
            await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
    });
});
