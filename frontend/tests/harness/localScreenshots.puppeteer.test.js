import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createSharedPage } from "../helpers/browserHarness.js";
import {
    captureElementScreenshot,
    getScreenshotArtifactsDirectory,
    shouldCaptureScreenshots,
    withScreenshotCapture
} from "../helpers/screenshotArtifacts.js";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(CURRENT_DIR, "..", "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

test("captures local screenshot artifacts for puppeteer-driven areas", async (t) => {
    if (process.env.CI === "true") {
        t.skip("Screenshot artifacts are not produced on CI.");
        return;
    }

    assert.equal(
        shouldCaptureScreenshots(),
        false,
        "expected screenshot capturing to be disabled by default"
    );

    await withScreenshotCapture(async () => {
        assert.equal(
            shouldCaptureScreenshots(),
            true,
            "expected forced context to enable screenshot capturing"
        );

        const artifactsDirectory = getScreenshotArtifactsDirectory();
        assert.ok(artifactsDirectory, "expected screenshot artifacts directory to be defined");

        const { page, teardown } = await createSharedPage();
        try {
            await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
            await page.waitForSelector(".app-header");

            const savedPath = await captureElementScreenshot(page, {
                label: "header-region",
                selector: ".app-header"
            });

            assert.ok(savedPath, "expected a screenshot path to be returned");
            const stats = await fs.stat(savedPath);
            assert.ok(stats.isFile(), "expected saved screenshot artifact to be a file");
            assert.ok(stats.size > 0, "expected screenshot artifact to contain data");
        } finally {
            await teardown();
        }
    });
});
