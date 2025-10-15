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
import { RUNTIME_CONTEXT_PATH } from "./helpers/runtimeContext.js";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const TESTS_ROOT = path.dirname(CURRENT_FILE);
const RUNTIME_OPTIONS_PATH = path.join(TESTS_ROOT, "runtime-options.json");

/**
 * Pretty section header.
 * @param {string} label
 */
function sectionHeading(label) {
  return `\n${cliColors.symbols.section} ${cliColors.bold(label)}`;
}

/**
 * Colored counter text.
 * @param {number} count
 * @param {string} label
 * @param {(s:string)=>string} colorize
 */
function formatCountLabeled(count, label, colorize) {
  const formatted = `${count} ${label}`;
  return count === 0 ? cliColors.dim(formatted) : colorize(formatted);
}

/**
 * @param {string} root
 * @returns {Promise<string[]>}
 */
async function discoverTestFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await discoverTestFiles(absolute);
      for (const file of nested) results.push(path.join(entry.name, file));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".test.js")) {
      results.push(entry.name);
    }
  }
  return results;
}

/**
 * Exact filename match (no regex).
 * @param {string} relativePath
 * @param {string | null} pattern
 */
function matchesPattern(relativePath, pattern) {
  if (!pattern) return true;
  return relativePath === pattern;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function parseTimeout(value, fallback) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
  if (!value) return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function loadRuntimeOptions() {
  try {
    const raw = await fs.readFile(RUNTIME_OPTIONS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && /** @type any */(error).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function main() {
  const runtimeOptions = await loadRuntimeOptions();
  const pattern = typeof runtimeOptions.pattern === "string" && runtimeOptions.pattern.length > 0
    ? runtimeOptions.pattern
    : null;

  const timeoutMs = parseTimeout(runtimeOptions.timeoutMs, harnessDefaults.timeoutMs);
  const killGraceMs = parseTimeout(runtimeOptions.killGraceMs, harnessDefaults.killGraceMs);

  const timeoutOverrides = new Map();
  const killOverrides = new Map();

  if (runtimeOptions.timeoutOverrides && typeof runtimeOptions.timeoutOverrides === "object") {
    for (const [key, value] of Object.entries(runtimeOptions.timeoutOverrides)) {
      const parsed = parseTimeout(value, -1);
      if (parsed > 0) timeoutOverrides.set(key, parsed);
    }
  }
  if (runtimeOptions.killOverrides && typeof runtimeOptions.killOverrides === "object") {
    for (const [key, value] of Object.entries(runtimeOptions.killOverrides)) {
      const parsed = parseTimeout(value, -1);
      if (parsed > 0) killOverrides.set(key, parsed);
    }
  }

  // sensible defaults for longer integration tests unless explicitly overridden
  const defaultTimeouts = [
    ["fullstack.endtoend.puppeteer.test.js", 60000],
    ["persistence.backend.puppeteer.test.js", 45000],
    ["sync.endtoend.puppeteer.test.js", 45000]
  ];
  for (const [file, value] of defaultTimeouts) {
    if (!timeoutOverrides.has(file)) timeoutOverrides.set(file, value);
  }

  const defaultKillGraces = [
    ["fullstack.endtoend.puppeteer.test.js", 10000],
    ["persistence.backend.puppeteer.test.js", 8000],
    ["sync.endtoend.puppeteer.test.js", 8000]
  ];
  for (const [file, value] of defaultKillGraces) {
    if (!killOverrides.has(file)) killOverrides.set(file, value);
  }

  const files = (await discoverTestFiles(TESTS_ROOT)).sort((a, b) => a.localeCompare(b));
  if (files.length === 0) {
    console.error("No test files discovered under tests/.");
    return 2; // make absence explicit to CI
  }

  const selected = files.filter((f) => matchesPattern(f, pattern));
  if (selected.length === 0) {
    console.error(`No test files matched pattern: ${pattern}`);
    return 2;
  }

  const guardPath = path.join(TESTS_ROOT, "helpers", "browserLaunchGuard.js");
  const guardSpecifier = toImportSpecifier(guardPath);

  const sharedBrowserContext = await launchSharedBrowser();
  if (!sharedBrowserContext) throw new Error("Shared browser failed to launch.");

  const backendHandle = await startTestBackend();
  if (!backendHandle.signingKeyPem || !backendHandle.signingKeyId) {
    throw new Error("Shared backend did not expose signing metadata.");
  }

  let hasFailure = false;
  const summary = [];
  let totalDurationMs = 0;
  let passCount = 0;
  let failCount = 0;
  let timeoutCount = 0;

  try {
    await fs.writeFile(
      RUNTIME_CONTEXT_PATH,
      JSON.stringify({
        backend: {
          baseUrl: backendHandle.baseUrl,
          googleClientId: backendHandle.googleClientId,
          signingKeyPem: backendHandle.signingKeyPem,
          signingKeyId: backendHandle.signingKeyId
        },
        browser: {
          wsEndpoint: sharedBrowserContext.wsEndpoint
        }
      }),
      "utf8"
    );

    for (const relative of selected) {
      const absolute = path.join(TESTS_ROOT, relative);
      const effectiveTimeout = timeoutOverrides.get(relative) ?? timeoutMs;
      const effectiveKillGrace = killOverrides.get(relative) ?? killGraceMs;

      console.log(sectionHeading(relative));

      const args = [
        "--import", guardSpecifier,
        "--test",
        absolute,
        `--test-timeout=${Math.max(effectiveTimeout - 1000, 1000)}`
      ];

      const result = await runTestProcess({
        command: process.execPath,
        args,
        timeoutMs: effectiveTimeout,
        killGraceMs: effectiveKillGrace,
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
        console.error(`  ${cliColors.symbols.timeout} ${cliColors.yellow(`Timed out after ${formatDuration(effectiveTimeout)}`)}`);
        continue;
      }
      if (result.exitCode !== 0) {
        hasFailure = true;
        failCount += 1;
        const detail = result.signal ? `signal=${result.signal}` : `exitCode=${result.exitCode}`;
        console.error(`  ${cliColors.symbols.fail} ${cliColors.red(`Failed (${detail})`)}`);
      } else {
        passCount += 1;
        const durationLabel = cliColors.dim(`(${formatDuration(result.durationMs)})`);
        console.log(`  ${cliColors.symbols.pass} ${cliColors.green("Passed")} ${durationLabel}`);
      }
    }
  } finally {
    await fs.rm(RUNTIME_CONTEXT_PATH, { force: true }).catch(() => {});
    await backendHandle.close();
    await closeSharedBrowser();
  }

  console.log(sectionHeading("Summary"));
  for (const entry of summary) {
    const status = entry.timedOut ? "timeout" : (entry.exitCode === 0 ? "pass" : "fail");
    const durationLabel = cliColors.dim(`(${formatDuration(entry.durationMs)})`);
    if (status === "timeout") {
      console.log(`  ${cliColors.symbols.timeout} ${cliColors.bold(entry.file)} ${cliColors.yellow("timeout")} ${durationLabel}`);
    } else if (status === "fail") {
      const detail = entry.signal ? `signal=${entry.signal}` : `exit=${entry.exitCode}`;
      console.log(`  ${cliColors.symbols.fail} ${cliColors.bold(entry.file)} ${cliColors.red(detail)} ${durationLabel}`);
    } else {
      console.log(`  ${cliColors.symbols.pass} ${cliColors.bold(entry.file)} ${durationLabel}`);
    }
  }

  const totalsLine = [
    formatCountLabeled(passCount, "passed", cliColors.green),
    formatCountLabeled(failCount, "failed", cliColors.red),
    formatCountLabeled(timeoutCount, "timed out", cliColors.yellow)
  ].join(cliColors.dim(" | "));
  console.log(`  ${cliColors.bold("Totals")}: ${totalsLine}`);
  console.log(`  ${cliColors.cyan("Duration")}: ${cliColors.bold(formatDuration(totalDurationMs))}`);

  return hasFailure ? 1 : 0;
}

main()
  .then((exitCode) => {
    const normalized = Number.isFinite(exitCode) ? Number(exitCode) : 0;
    process.exit(normalized);
  })
  .catch((error) => {
    console.error("Test harness encountered an error:", error);
    process.exit(1);
  });
