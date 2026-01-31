// @ts-check

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createSharedPage } from "../helpers/browserHarness.js";
import { startTestBackend } from "../helpers/backendHarness.js";
import {
    captureElementScreenshot,
    clearScreenshotTestOverrides,
    getScreenshotArtifactsDirectory,
    setScreenshotTestOverrides,
    shouldCaptureScreenshots,
    withScreenshotCapture
} from "../helpers/screenshotArtifacts.js";
import { readRuntimeContext } from "../helpers/runtimeContext.js";
import { attachBackendSessionCookie, resolvePageUrl, signInTestUser } from "../helpers/syncTestUtils.js";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(CURRENT_DIR, "..", "..");
// Use app.html in the new page-separation architecture
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "app.html")}`;
const TMP_PREFIX = "gravity-screenshots-";
const TEST_USER_ID = "local-screenshots-user";

test("captures local screenshot artifacts for puppeteer-driven areas", async (t) => {
    const runtimeContext = readRuntimeContext();
    if (runtimeContext && runtimeContext.ci) {
        t.skip("Screenshot artifacts are not produced on CI.");
        return;
    }

    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), TMP_PREFIX));
    const artifactsDirectory = path.join(tempRoot, "artifacts");

    setScreenshotTestOverrides({
        directory: artifactsDirectory
    });

    try {
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

            const directory = getScreenshotArtifactsDirectory();
            assert.ok(directory, "expected screenshot artifacts directory to be defined");

            const backend = await startTestBackend();
            const { page, teardown } = await createSharedPage();
            try {
                // Set session cookie BEFORE navigation to prevent redirect to landing page
                await attachBackendSessionCookie(page, backend, TEST_USER_ID);
                const resolvedUrl = await resolvePageUrl(PAGE_URL);
                await page.goto(resolvedUrl, { waitUntil: "domcontentloaded" });
                await signInTestUser(page, backend, TEST_USER_ID);
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
                await backend.close();
            }
        });
    } finally {
        clearScreenshotTestOverrides();
        await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
});
