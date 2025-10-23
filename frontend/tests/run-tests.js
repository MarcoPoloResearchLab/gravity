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
const PROJECT_ROOT = path.join(TESTS_ROOT, "..");
const RUNTIME_OPTIONS_PATH = path.join(TESTS_ROOT, "runtime-options.json");
const SCREENSHOT_ARTIFACT_ROOT = path.join(TESTS_ROOT, "artifacts");

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
 * Exclude self-test fixtures from normal discovery.
 * These files are only invoked explicitly by the harness self-tests.
 * @param {string} relativePath
 */
function isExcludedFromDiscovery(relativePath) {
  const prefix = "harness" + path.sep + "fixtures" + path.sep;
  return relativePath.startsWith(prefix);
}

/**
 * @param {string} relativePath
 * @param {RegExp|null} pattern
 */
function matchesPattern(relativePath, pattern) {
  if (!pattern) return true;
  return pattern.test(relativePath);
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function parseTimeout(value, fallback) {
  if (typeof value === "number") {
    if (Number.isFinite(value) && value > 0) return value;
    return fallback;
  }
  if (!value) return fallback;
  const parsed = Number.parseInt(/** @type {any} */ (value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(/[\n,]/u)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return [];
}

/**
 * @param {unknown} rawOptions
 * @returns {{ policy: "enabled" | "disabled" | "allowlist" | null, allowlist: string[] }}
 */
function parseScreenshotOptions(rawOptions) {
  if (!rawOptions || typeof rawOptions !== "object") {
    return { policy: null, allowlist: [] };
  }
  let policy = null;
  if ("policy" in rawOptions && typeof /** @type {any} */ (rawOptions).policy === "string") {
    const normalized = /** @type {any} */ (rawOptions).policy.trim().toLowerCase();
    if (normalized === "enabled" || normalized === "disabled" || normalized === "allowlist") {
      policy = normalized;
    }
  }
  const allowlist = normalizeStringList(/** @type {any} */ (rawOptions).allowlist);
  if (!policy && allowlist.length > 0) {
    policy = "allowlist";
  }
  return { policy, allowlist };
}

async function loadRuntimeOptions() {
  try {
    const raw = await fs.readFile(RUNTIME_OPTIONS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && /** @type {any} */(error).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function main() {
  const runtimeOptions = await loadRuntimeOptions();
  const isCiEnvironment = process.env.CI === "true";
  const screenshotOptions = parseScreenshotOptions(runtimeOptions.screenshots);
  let screenshotRunRoot = null;
  if (!isCiEnvironment) {
    const timestamp = createArtifactTimestamp();
    screenshotRunRoot = path.join(SCREENSHOT_ARTIFACT_ROOT, timestamp);
    await fs.mkdir(screenshotRunRoot, { recursive: true });
  }

  // Minimal mode = no browser/backend/launch guard. Used by harness self-tests.
  const minimal = Boolean(runtimeOptions.minimal);
  // Raw mode = execute files as plain Node scripts (no --test). Implies minimal semantics.
  const raw = Boolean(runtimeOptions.raw);

  const patternInput = typeof runtimeOptions.pattern === "string" ? runtimeOptions.pattern : null;
  const pattern = patternInput ? new RegExp(patternInput) : null;

  const timeoutMs = parseTimeout(runtimeOptions.timeoutMs, harnessDefaults.timeoutMs);
  const killGraceMs = parseTimeout(runtimeOptions.killGraceMs, harnessDefaults.killGraceMs);

  /** @type {Map<string, number>} */
  const timeoutOverrides = new Map();
  /** @type {Map<string, number>} */
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

  // Default per-file overrides for real runs (not in minimal/raw mode).
  if (!minimal && !raw) {
    const defaultTimeoutEntries = [
      ["fullstack.endtoend.puppeteer.test.js", 60000],
      ["persistence.backend.puppeteer.test.js", 45000],
      ["sync.endtoend.puppeteer.test.js", 45000],
      ["editor.inline.puppeteer.test.js", 40000]
    ];
    for (const [file, value] of defaultTimeoutEntries) {
      if (!timeoutOverrides.has(file)) timeoutOverrides.set(file, value);
    }
    const defaultKillEntries = [
      ["fullstack.endtoend.puppeteer.test.js", 10000],
      ["persistence.backend.puppeteer.test.js", 8000],
      ["sync.endtoend.puppeteer.test.js", 8000],
      ["editor.inline.puppeteer.test.js", 6000]
    ];
    for (const [file, value] of defaultKillEntries) {
      if (!killOverrides.has(file)) killOverrides.set(file, value);
    }
  }

  /** @type {string[]} */
  let files;

  // If explicitFiles are provided, use them as-is (used by harness self-tests).
  if (Array.isArray(runtimeOptions.explicitFiles) && runtimeOptions.explicitFiles.length > 0) {
    files = runtimeOptions.explicitFiles.slice();
  } else {
    files = (await discoverTestFiles(TESTS_ROOT)).sort((a, b) => a.localeCompare(b));
    if (files.length === 0) {
      console.warn("No test files discovered under tests/.");
      return 0;
    }
    // Exclude self-test fixtures from normal discovery
    files = files.filter((f) => !isExcludedFromDiscovery(f));
    files = files.filter((file) => matchesPattern(file, pattern));
    if (files.length === 0) {
      console.warn("No test files matched filter criteria.");
      return 0;
    }
  }

  // Guard import only in full mode (prevents Puppeteer launches in normal runs)
  const guardPath = path.join(TESTS_ROOT, "helpers", "browserLaunchGuard.js");
  const guardSpecifier = toImportSpecifier(guardPath);

  let sharedBrowserContext = null;
  let backendHandle = null;
  let runtimeContextPayload = null;

  const sectionHeading = (label) => `\n${cliColors.symbols.section} ${cliColors.bold(label)}`;
  const formatCount = (count, label, format) => {
    const formatted = `${count} ${label}`;
    if (count === 0) return cliColors.dim(formatted);
    return format(formatted);
  };

  let hasFailure = false;
  const summary = [];
  let totalDurationMs = 0;
  let passCount = 0;
  let failCount = 0;
  let timeoutCount = 0;

  const previousRuntimeContextEnv = process.env.GRAVITY_RUNTIME_CONTEXT;

  try {
    if (!minimal && !raw) {
      sharedBrowserContext = await launchSharedBrowser();
      if (!sharedBrowserContext) throw new Error("Shared browser failed to launch.");
      backendHandle = await startTestBackend();
      if (!backendHandle.signingKeyPem || !backendHandle.signingKeyId) {
        throw new Error("Shared backend did not expose signing metadata.");
      }
      runtimeContextPayload = JSON.stringify({
        backend: {
          baseUrl: backendHandle.baseUrl,
          googleClientId: backendHandle.googleClientId,
          signingKeyPem: backendHandle.signingKeyPem,
          signingKeyId: backendHandle.signingKeyId
        },
        browser: {
          wsEndpoint: sharedBrowserContext.wsEndpoint
        }
      });
      process.env.GRAVITY_RUNTIME_CONTEXT = runtimeContextPayload;
    }

    for (const relative of files) {
      const absolute = path.join(TESTS_ROOT, relative);
      const effectiveTimeout = timeoutOverrides.get(relative) ?? timeoutMs;
      const effectiveKillGrace = killOverrides.get(relative) ?? killGraceMs;
      let screenshotDirectoryForTest = null;
      if (screenshotRunRoot) {
        const shortName = deriveShortTestName(relative);
        screenshotDirectoryForTest = path.join(screenshotRunRoot, shortName);
      }

      console.log(sectionHeading(relative));

      /** @type {string[]} */
      const args = [];
      if (!raw) {
        // Run with Node test runner
        args.push("--test", absolute, `--test-timeout=${Math.max(effectiveTimeout, 1000)}`);
        if (!minimal) {
          args.unshift("--import", guardSpecifier);
        }
      } else {
        // Raw script execution (no test runner) — used to validate harness timeouts deterministically
        args.push(absolute);
      }

      const result = await runTestProcess({
        command: process.execPath,
        args,
        timeoutMs: effectiveTimeout,
        killGraceMs: effectiveKillGrace,
        env: createChildEnv(runtimeContextPayload, screenshotDirectoryForTest, relative, screenshotOptions),
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
    if (typeof previousRuntimeContextEnv === "string") {
      process.env.GRAVITY_RUNTIME_CONTEXT = previousRuntimeContextEnv;
    } else {
      delete process.env.GRAVITY_RUNTIME_CONTEXT;
    }
    if (backendHandle) await backendHandle.close().catch(() => {});
    if (sharedBrowserContext) await closeSharedBrowser().catch(() => {});
  }

  console.log(sectionHeading("Summary"));
  for (const entry of summary) {
    const status = entry.timedOut ? "timeout" : entry.exitCode === 0 ? "pass" : "fail";
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

  if (timeoutCount > 0) {
    return harnessDefaults.exitCode.timeout;
  }
  if (hasFailure) {
    return harnessDefaults.exitCode.failure;
  }
  return harnessDefaults.exitCode.success;
}

function createArtifactTimestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const year = now.getFullYear();
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  return `${year}${month}${day}-${hours}${minutes}`;
}

function sanitizeArtifactComponent(value) {
  const normalized = value
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.replace(/[^a-zA-Z0-9_.-]+/g, "_").replace(/^_+$/u, "_"))
    .join("__");
  return normalized.length > 0 ? normalized : `${Date.now()}`;
}

function createChildEnv(runtimeContextPayload, screenshotDirectory, relativePath, screenshotOptions) {
  const overrides = {};
  if (typeof runtimeContextPayload === "string" && runtimeContextPayload.length > 0) {
    overrides.GRAVITY_RUNTIME_CONTEXT = runtimeContextPayload;
  }
  if (typeof screenshotDirectory === "string" && screenshotDirectory.length > 0) {
    overrides.GRAVITY_SCREENSHOT_DIR = screenshotDirectory;
    overrides.GRAVITY_SCREENSHOT_TEST_FILE = relativePath;
  }
  if (screenshotOptions && typeof screenshotOptions === "object") {
    if (screenshotOptions.policy) {
      overrides.GRAVITY_SCREENSHOT_POLICY = screenshotOptions.policy;
    }
    if (Array.isArray(screenshotOptions.allowlist) && screenshotOptions.allowlist.length > 0) {
      overrides.GRAVITY_SCREENSHOT_ALLOWLIST = screenshotOptions.allowlist.join(",");
    }
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function deriveShortTestName(relativePath) {
  const base = path.basename(relativePath).replace(/\.test\.js$/u, "");
  return sanitizeArtifactComponent(base);
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
