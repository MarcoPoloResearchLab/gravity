import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
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
const TMP_PREFIX = "gravity-screenshots-";

test("captures local screenshot artifacts for puppeteer-driven areas", async (t) => {
    if (process.env.CI === "true") {
        t.skip("Screenshot artifacts are not produced on CI.");
        return;
    }

    const existingDirectory = process.env.GRAVITY_SCREENSHOT_DIR;
    let temporaryDirectory = null;
    try {
        if (!existingDirectory || existingDirectory.trim().length === 0) {
            const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), TMP_PREFIX));
            temporaryDirectory = tempRoot;
            process.env.GRAVITY_SCREENSHOT_DIR = tempRoot;
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
    } finally {
        if (temporaryDirectory) {
            await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
            delete process.env.GRAVITY_SCREENSHOT_DIR;
        } else if (typeof existingDirectory === "string") {
            process.env.GRAVITY_SCREENSHOT_DIR = existingDirectory;
        }
    }
});
