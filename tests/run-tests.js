#!/usr/bin/env node
// @ts-check

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
    cliColors,
    formatDuration,
    harnessDefaults,
    runTestProcess
} from "./helpers/testHarness.js";
import { startTestBackend } from "./helpers/backendHarness.js";
import {
    launchSharedBrowser,
    closeSharedBrowser,
    toImportSpecifier
} from "./helpers/browserHarness.js";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const TESTS_ROOT = path.dirname(CURRENT_FILE);

/**
 * @param {string} root
 * @returns {Promise<string[]>}
 */
async function discoverTestFiles(root) {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const results = [];
    for (const entry of entries) {
        if (entry.name.startsWith(".")) {
            continue;
        }
        const absolute = path.join(root, entry.name);
        if (entry.isDirectory()) {
            const nested = await discoverTestFiles(absolute);
            for (const file of nested) {
                results.push(path.join(entry.name, file));
            }
            continue;
        }
        if (entry.isFile() && entry.name.endsWith(".test.js")) {
            results.push(entry.name);
        }
    }
    return results;
}

/**
 * @param {string} relativePath
 * @param {RegExp|null} pattern
 */
function matchesPattern(relativePath, pattern) {
    if (!pattern) {
        return true;
    }
    return pattern.test(relativePath);
}

/**
 * @param {string | undefined} value
 * @param {number} fallback
 */
function parseTimeout(value, fallback) {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}

function parseOverrides(raw) {
    const map = new Map();
    if (!raw) {
        return map;
    }
    const segments = raw.split(",");
    for (const segment of segments) {
        const trimmed = segment.trim();
        if (trimmed.length === 0) continue;
        const [key, value] = trimmed.split("=");
        const file = key?.trim();
        const parsed = Number.parseInt(value, 10);
        if (!file || !Number.isFinite(parsed) || parsed <= 0) {
            continue;
        }
        map.set(file, parsed);
    }
    return map;
}

async function main() {
    const patternInput = process.env.GRAVITY_TEST_PATTERN ?? null;
    const pattern = patternInput ? new RegExp(patternInput) : null;

    const timeoutMs = parseTimeout(
        process.env.GRAVITY_TEST_TIMEOUT_MS,
        harnessDefaults.timeoutMs
    );
    const killGraceMs = parseTimeout(
        process.env.GRAVITY_TEST_KILL_GRACE_MS,
        harnessDefaults.killGraceMs
    );
    const timeoutOverrides = parseOverrides(process.env.GRAVITY_TEST_TIMEOUT_OVERRIDES ?? "");
    const killOverrides = parseOverrides(process.env.GRAVITY_TEST_KILL_GRACE_OVERRIDES ?? "");

    const defaultTimeoutEntries = [
        ["fullstack.endtoend.puppeteer.test.js", 60000],
        ["persistence.backend.puppeteer.test.js", 45000],
        ["sync.endtoend.puppeteer.test.js", 45000]
    ];
    for (const [file, value] of defaultTimeoutEntries) {
        if (!timeoutOverrides.has(file)) {
            timeoutOverrides.set(file, value);
        }
    }
    const defaultKillEntries = [
        ["fullstack.endtoend.puppeteer.test.js", 10000],
        ["persistence.backend.puppeteer.test.js", 8000],
        ["sync.endtoend.puppeteer.test.js", 8000]
    ];
    for (const [file, value] of defaultKillEntries) {
        if (!killOverrides.has(file)) {
            killOverrides.set(file, value);
        }
    }

    const files = (await discoverTestFiles(TESTS_ROOT)).sort((a, b) => a.localeCompare(b));
    if (files.length === 0) {
        console.warn("No test files discovered under tests/.");
        return;
    }

    const selected = files.filter((file) => matchesPattern(file, pattern));
    if (selected.length === 0) {
        console.warn("No test files matched filter criteria.");
        return;
    }

    const guardPath = path.join(TESTS_ROOT, "helpers", "browserLaunchGuard.js");
    const guardSpecifier = toImportSpecifier(guardPath);
    const guardFlag = `--import=${guardSpecifier}`;
    const existingNodeOptions = process.env.NODE_OPTIONS ?? "";
    if (!existingNodeOptions.includes(guardFlag)) {
        process.env.NODE_OPTIONS = existingNodeOptions.length > 0
            ? `${existingNodeOptions} ${guardFlag}`
            : guardFlag;
    }

    await import("./helpers/browserLaunchGuard.js");

    process.env.GRAVITY_TEST_ALLOW_BROWSER_LAUNCH = "1";
    let sharedBrowserContext = null;
    try {
        sharedBrowserContext = await launchSharedBrowser();
    } finally {
        process.env.GRAVITY_TEST_ALLOW_BROWSER_LAUNCH = "0";
    }
    if (!sharedBrowserContext) {
        throw new Error("Shared browser failed to launch.");
    }

    const backendHandle = await startTestBackend();
    if (!backendHandle.signingKeyPem || !backendHandle.signingKeyId) {
        throw new Error("Shared backend did not expose signing metadata.");
    }
    const sharedEnvironment = {
        GRAVITY_TEST_BACKEND_URL: backendHandle.baseUrl,
        GRAVITY_TEST_GOOGLE_CLIENT_ID: backendHandle.googleClientId,
        GRAVITY_TEST_JWT_PRIVATE_KEY_PEM_BASE64: Buffer.from(backendHandle.signingKeyPem, "utf8").toString("base64"),
        GRAVITY_TEST_JWT_KEY_ID: backendHandle.signingKeyId,
        GRAVITY_TEST_BROWSER_WS_ENDPOINT: sharedBrowserContext.wsEndpoint
    };
    Object.assign(process.env, sharedEnvironment);

    let hasFailure = false;
    const summary = [];
    let totalDurationMs = 0;
    let passCount = 0;
    let failCount = 0;
    let timeoutCount = 0;

    const sectionHeading = (label) => `\n${cliColors.symbols.section} ${cliColors.bold(label)}`;
    const formatCount = (count, label, format) => {
        const formatted = `${count} ${label}`;
        if (count === 0) {
            return cliColors.dim(formatted);
        }
        return format(formatted);
    };

    try {
        for (const relative of selected) {
            const absolute = path.join(TESTS_ROOT, relative);
            const effectiveTimeout = timeoutOverrides.get(relative) ?? timeoutMs;
            const effectiveKillGrace = killOverrides.get(relative) ?? killGraceMs;
            console.log(sectionHeading(relative));
            const args = ["--test", absolute, `--test-timeout=${Math.max(effectiveTimeout - 1000, 1000)}`];
            const result = await runTestProcess({
                command: process.execPath,
                args,
                timeoutMs: effectiveTimeout,
                killGraceMs: effectiveKillGrace,
                env: {
                    ...process.env,
                    ...sharedEnvironment
                },
                onStdout: (chunk) => process.stdout.write(chunk),
                onStderr: (chunk) => process.stderr.write(chunk)
            });

            summary.push({
                file: relative,
                durationMs: result.durationMs,
                timedOut: result.timedOut,
                exitCode: result.exitCode,
                signal: result.signal,
                terminationReason: result.terminationReason
            });
            totalDurationMs += result.durationMs;

            if (result.timedOut) {
                hasFailure = true;
                timeoutCount += 1;
                const timeoutMessage = `${cliColors.symbols.timeout} ${cliColors.yellow(`Timed out after ${formatDuration(effectiveTimeout)}`)}`;
                console.error(`  ${timeoutMessage}`);
                continue;
            }
            if (result.exitCode !== 0) {
                hasFailure = true;
                failCount += 1;
                const signalDetail = result.signal ? `signal=${result.signal}` : `exitCode=${result.exitCode}`;
                console.error(`  ${cliColors.symbols.fail} ${cliColors.red(`Failed (${signalDetail})`)}`);
            } else {
                passCount += 1;
                const durationLabel = cliColors.dim(`(${formatDuration(result.durationMs)})`);
                console.log(`  ${cliColors.symbols.pass} ${cliColors.green("Passed")} ${durationLabel}`);
            }
        }
    } finally {
        await backendHandle.close();
        await closeSharedBrowser();
    }

    console.log(sectionHeading("Summary"));
    for (const entry of summary) {
        const status = entry.timedOut
            ? "timeout"
            : entry.exitCode === 0
                ? "pass"
                : "fail";
        const durationLabel = cliColors.dim(`(${formatDuration(entry.durationMs)})`);
        if (status === "timeout") {
            console.log(`  ${cliColors.symbols.timeout} ${cliColors.bold(entry.file)} ${cliColors.yellow("timeout")} ${durationLabel}`);
            continue;
        }
        if (status === "fail") {
            const failureDetail = entry.signal ? `signal=${entry.signal}` : `exit=${entry.exitCode}`;
            console.log(`  ${cliColors.symbols.fail} ${cliColors.bold(entry.file)} ${cliColors.red(failureDetail)} ${durationLabel}`);
            continue;
        }
        console.log(`  ${cliColors.symbols.pass} ${cliColors.bold(entry.file)} ${durationLabel}`);
    }

    const totalsLine = [
        formatCount(passCount, "passed", cliColors.green),
        formatCount(failCount, "failed", cliColors.red),
        formatCount(timeoutCount, "timed out", cliColors.yellow)
    ].join(cliColors.dim(" | "));
    console.log(`  ${cliColors.bold("Totals")}: ${totalsLine}`);
    console.log(`  ${cliColors.cyan("Duration")}: ${cliColors.bold(formatDuration(totalDurationMs))}`);

    if (hasFailure) {
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error("Test harness encountered an error:", error);
    process.exitCode = 1;
});
