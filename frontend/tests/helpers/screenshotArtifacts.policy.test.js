import assert from "node:assert/strict";
import test from "node:test";

import {
    createScreenshotArtifactsController,
    shouldCaptureScreenshots,
    withScreenshotCapture
} from "./screenshotArtifacts.js";

const ORIGINAL_ENV = {
    CI: process.env.CI,
    GRAVITY_SCREENSHOT_POLICY: process.env.GRAVITY_SCREENSHOT_POLICY,
    GRAVITY_SCREENSHOT_ALLOWLIST: process.env.GRAVITY_SCREENSHOT_ALLOWLIST,
    GRAVITY_SCREENSHOT_TEST_FILE: process.env.GRAVITY_SCREENSHOT_TEST_FILE,
    GRAVITY_SCREENSHOT_DIR: process.env.GRAVITY_SCREENSHOT_DIR,
    GRAVITY_SCREENSHOT_FORCE: process.env.GRAVITY_SCREENSHOT_FORCE
};

function resetEnv() {
    for (const key of Object.keys(ORIGINAL_ENV)) {
        const baseline = ORIGINAL_ENV[key];
        if (typeof baseline === "string") {
            process.env[key] = baseline;
        } else {
            delete process.env[key];
        }
    }
}

function applyTestEnv(overrides) {
    resetEnv();
    for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined || value === null) {
            delete process.env[key];
            continue;
        }
        process.env[key] = String(value);
    }
}

test.after(resetEnv);

test("defaults to disabled policy when no overrides provided", () => {
    applyTestEnv({
        CI: undefined,
        GRAVITY_SCREENSHOT_DIR: "/tmp/gravity-screenshots",
        GRAVITY_SCREENSHOT_TEST_FILE: "helpers/screenshotArtifacts.policy.test.js",
        GRAVITY_SCREENSHOT_POLICY: undefined
    });
    assert.equal(shouldCaptureScreenshots(), false);
});

test("policy=enabled captures for every test", () => {
    applyTestEnv({
        CI: undefined,
        GRAVITY_SCREENSHOT_POLICY: "enabled",
        GRAVITY_SCREENSHOT_DIR: "/tmp/gravity-screenshots",
        GRAVITY_SCREENSHOT_TEST_FILE: "helpers/screenshotArtifacts.policy.test.js"
    });
    assert.equal(shouldCaptureScreenshots(), true);
});

test("allowlist policy enables capture only for listed tests", () => {
    applyTestEnv({
        CI: undefined,
        GRAVITY_SCREENSHOT_POLICY: "allowlist",
        GRAVITY_SCREENSHOT_ALLOWLIST: "helpers/screenshotArtifacts.policy.test.js",
        GRAVITY_SCREENSHOT_DIR: "/tmp/gravity-screenshots",
        GRAVITY_SCREENSHOT_TEST_FILE: "helpers/screenshotArtifacts.policy.test.js"
    });
    assert.equal(shouldCaptureScreenshots(), true);
    process.env.GRAVITY_SCREENSHOT_TEST_FILE = "helpers/another.test.js";
    assert.equal(shouldCaptureScreenshots(), false);
});

test("withScreenshotCapture overrides disabled policy for the active async context", async () => {
    applyTestEnv({
        CI: undefined,
        GRAVITY_SCREENSHOT_DIR: "/tmp/gravity-screenshots",
        GRAVITY_SCREENSHOT_TEST_FILE: "helpers/screenshotArtifacts.policy.test.js",
        GRAVITY_SCREENSHOT_POLICY: "disabled"
    });
    assert.equal(shouldCaptureScreenshots(), false);

    await withScreenshotCapture(async () => {
        assert.equal(shouldCaptureScreenshots(), true);
    });

    assert.equal(shouldCaptureScreenshots(), false);
});

test("factory supports custom env bindings for reuse", () => {
    applyTestEnv({
        CUSTOM_SCREENSHOT_POLICY: "enable",
        CUSTOM_SCREENSHOT_DIR: "/tmp/custom-screenshots",
        CUSTOM_SCREENSHOT_TEST_FILE: "custom/test.js"
    });

    const controller = createScreenshotArtifactsController({
        directoryEnv: "CUSTOM_SCREENSHOT_DIR",
        policyEnv: "CUSTOM_SCREENSHOT_POLICY",
        allowlistEnv: "CUSTOM_SCREENSHOT_ALLOWLIST",
        testFileEnv: "CUSTOM_SCREENSHOT_TEST_FILE",
        forceEnv: "CUSTOM_SCREENSHOT_FORCE"
    });

    assert.equal(controller.shouldCaptureScreenshots(), false, "unknown policies disable capturing");

    process.env.CUSTOM_SCREENSHOT_POLICY = "enabled";
    assert.equal(controller.shouldCaptureScreenshots(), true, "enabled policy activates capture");
});
