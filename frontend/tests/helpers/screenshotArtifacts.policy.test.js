import assert from "node:assert/strict";
import test from "node:test";

import {
    createScreenshotArtifactsController,
    setScreenshotTestOverrides,
    shouldCaptureScreenshots,
    clearScreenshotTestOverrides,
    withScreenshotCapture
} from "./screenshotArtifacts.js";

function buildBaseConfig() {
    return {
        ci: false,
        directory: "/tmp/gravity-screenshots",
        policy: "disabled",
        allowlist: [],
        testFile: "helpers/screenshotArtifacts.policy.test.js",
        force: false
    };
}

test("defaults to disabled policy when unset", () => {
    const config = buildBaseConfig();
    const controller = createScreenshotArtifactsController(() => config);
    assert.equal(controller.shouldCaptureScreenshots(), false);
});


test("policy=enabled captures for every test", () => {
    const config = buildBaseConfig();
    config.policy = "enabled";
    const controller = createScreenshotArtifactsController(() => config);
    assert.equal(controller.shouldCaptureScreenshots(), true);
});


test("allowlist policy enables capture only for listed tests", () => {
    const config = buildBaseConfig();
    config.policy = "allowlist";
    config.allowlist = ["helpers/screenshotArtifacts.policy.test.js"];
    const controller = createScreenshotArtifactsController(() => config);
    assert.equal(controller.shouldCaptureScreenshots(), true);
    config.testFile = "helpers/another.test.js";
    assert.equal(controller.shouldCaptureScreenshots(), false);
});


test("withScreenshotCapture overrides disabled policy for the active async context", async () => {
    const config = buildBaseConfig();
    config.policy = "disabled";
    const controller = createScreenshotArtifactsController(() => config);
    assert.equal(controller.shouldCaptureScreenshots(), false);

    await controller.withScreenshotCapture(async () => {
        assert.equal(controller.shouldCaptureScreenshots(), true);
    });

    assert.equal(controller.shouldCaptureScreenshots(), false);
});


test("default controller responds to explicit overrides", async () => {
    clearScreenshotTestOverrides();
    setScreenshotTestOverrides({
        directory: "/tmp/gravity-screenshots",
        policy: "disabled",
        allowlist: [],
        testFile: "helpers/screenshotArtifacts.policy.test.js",
        ci: false
    });
    assert.equal(shouldCaptureScreenshots(), false);
    await withScreenshotCapture(async () => {
        assert.equal(shouldCaptureScreenshots(), true);
    });
    clearScreenshotTestOverrides();
});

