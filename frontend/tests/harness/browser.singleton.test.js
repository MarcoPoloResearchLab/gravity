import assert from "node:assert/strict";
import test from "node:test";

const GUARD_ERROR = "Multiple Puppeteer browser launches detected. Tests must use the shared browser harness.";

test("shared harness prevents launching additional browsers", async () => {
    const puppeteer = await import("puppeteer").then((module) => module.default);
    await assert.rejects(async () => {
        await puppeteer.launch();
    }, (error) => {
        assert.ok(error instanceof Error, "guard rejection should be an Error instance");
        assert.equal(error.message, GUARD_ERROR);
        return true;
    });
});
