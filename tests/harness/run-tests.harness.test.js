import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { runTestProcess } from "../helpers/testHarness.js";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const TESTS_DIRECTORY = path.resolve(path.dirname(CURRENT_FILE), "..");
const HARNESS_SCRIPT = path.join(TESTS_DIRECTORY, "run-tests.js");

test("run-tests harness reports colored summary for passing suites", async () => {
    const result = await runTestProcess({
        command: process.execPath,
        args: [HARNESS_SCRIPT],
        timeoutMs: 8000,
        env: {
            ...process.env,
            GRAVITY_TEST_PATTERN: "^helpers/testHarness\\.test\\.js$",
            GRAVITY_TEST_TIMEOUT_MS: "3000",
            FORCE_COLOR: "1",
            NO_COLOR: ""
        }
    });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /\u001B\[36m▶/u);
    assert.match(result.stdout, /Totals/u);
    assert.match(result.stdout, /\u001B\[32mPassed/u);
});

test("run-tests harness surfaces timeouts in summary", async () => {
    const result = await runTestProcess({
        command: process.execPath,
        args: [HARNESS_SCRIPT],
        timeoutMs: 8000,
        env: {
            ...process.env,
            GRAVITY_TEST_PATTERN: "^helpers/testHarness\\.test\\.js$",
            GRAVITY_TEST_TIMEOUT_MS: "50",
            FORCE_COLOR: "1",
            NO_COLOR: ""
        }
    });
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stdout, /timeout/u);
    assert.match(result.stdout, /\u001B\[33m/u);
});
