// @ts-check

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { harnessDefaults, runTestProcess } from "./testHarness.js";

if (process.env.GRAVITY_TEST_FORCE_HANG === "1") {
    test("simulated harness hang", async () => {
        await new Promise(() => {});
    });
}

test("runTestProcess resolves for short-lived scripts", { timeout: 5000 }, async (t) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gravity-harness-test-"));
    const scriptPath = path.join(tempDir, "short.js");
    await fs.writeFile(
        scriptPath,
        [
            "setTimeout(() => {",
            "  process.stdout.write('done');",
            "  process.exit(0);",
            "}, 50);"
        ].join("\n"),
        "utf8"
    );

    try {
        const result = await runTestProcess({
            command: process.execPath,
            args: [scriptPath],
            timeoutMs: 500
        });
        assert.equal(result.exitCode, 0);
        assert.equal(result.signal, null);
        assert.equal(result.timedOut, false);
        assert.equal(result.stdout, "done");
        assert.equal(result.stderr, "");
        assert.equal(result.terminationReason, harnessDefaults.terminationReason.exit);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test("runTestProcess terminates hung scripts", { timeout: 5000 }, async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gravity-harness-test-"));
    const scriptPath = path.join(tempDir, "hanging.js");
    await fs.writeFile(
        scriptPath,
        [
            "setInterval(() => {",
            "  process.stdout.write('tick');",
            "}, 200);"
        ].join("\n"),
        "utf8"
    );

    try {
        const result = await runTestProcess({
            command: process.execPath,
            args: [scriptPath],
            timeoutMs: 200
        });
        assert.equal(result.timedOut, true);
        assert.equal(result.exitCode, null);
        assert.equal(typeof result.signal, "string");
        assert.equal(typeof result.stdout, "string");
        assert.equal(result.terminationReason, harnessDefaults.terminationReason.timeout);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});

test("runTestProcess escalates to SIGKILL when process ignores termination", { timeout: 5000 }, async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gravity-harness-test-"));
    const scriptPath = path.join(tempDir, "ignores-term.js");
    await fs.writeFile(
        scriptPath,
        [
            "let active = true;",
            "process.on('SIGTERM', () => {",
            "  process.stdout.write('term-ignored');",
            "  active = true;",
            "});",
            "setInterval(() => {",
            "  if (active) {",
            "    process.stdout.write('pulse');",
            "  }",
            "}, 100);"
        ].join("\n"),
        "utf8"
    );

    try {
        const result = await runTestProcess({
            command: process.execPath,
            args: [scriptPath],
            timeoutMs: 200,
            killGraceMs: 100
        });
        assert.equal(result.timedOut, true);
        assert.equal(result.terminationReason, harnessDefaults.terminationReason.timeout);
        assert.equal(result.signal, "SIGKILL");
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
});
