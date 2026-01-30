#!/usr/bin/env node
// @ts-check

import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import util from "node:util";

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

if (!process.env.TZ) {
  process.env.TZ = "UTC";
}
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "test";
}

const CURRENT_FILE = fileURLToPath(import.meta.url);
const TESTS_ROOT = path.dirname(CURRENT_FILE);
const PROJECT_ROOT = path.join(TESTS_ROOT, "..");
const RUNTIME_OPTIONS_PATH = path.join(TESTS_ROOT, "runtime-options.json");
const SCREENSHOT_ARTIFACT_ROOT = path.join(TESTS_ROOT, "artifacts");
const RUNTIME_MODULE_PREFIX = path.join(os.tmpdir(), "gravity-runtime-");
const CAPTURED_LOG_LIMIT = 4000;

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
 * @param {number} fallback
 */
function parsePositiveInteger(value, fallback) {
  if (typeof value === "number") {
    if (Number.isFinite(value) && value > 0) return Math.floor(value);
    return fallback;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return fallback;
}

/**
 * @param {unknown} value
 * @param {boolean} fallback
 */
function parseBooleanOption(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }
  return fallback;
}

/**
 * @param {string} text
 * @param {number} limit
 */
function trimCapturedOutput(text, limit) {
  if (typeof text !== "string" || text.length === 0) {
    return "";
  }
  const normalized = text.replace(/\s+$/u, "");
  if (normalized.length <= limit) {
    return normalized;
  }
  return normalized.slice(Math.max(0, normalized.length - limit));
}

/**
 * @param {unknown} raw
 * @returns {{ numeric: number | null, label: string | null }}
 */
function normalizeSeedValue(raw) {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) {
      return { numeric: null, label: null };
    }
    const normalized = (Math.floor(raw) >>> 0);
    return { numeric: normalized, label: String(normalized) };
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return { numeric: null, label: null };
    }
    const decimal = Number.parseInt(trimmed, 10);
    if (Number.isFinite(decimal)) {
      const numeric = (Math.floor(decimal) >>> 0);
      return { numeric, label: trimmed };
    }
    const hexMatch = trimmed.match(/^0x([0-9a-f]+)$/iu);
    if (hexMatch) {
      const numeric = Number.parseInt(hexMatch[1], 16) >>> 0;
      return { numeric, label: trimmed };
    }
    const hash = crypto.createHash("sha256").update(trimmed).digest();
    const numeric = hash.readUInt32LE(0) >>> 0;
    return { numeric, label: trimmed };
  }
  return { numeric: null, label: null };
}

/**
 * @param {number} seed
 * @returns {() => number}
 */
function createMulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {number} iterations
 * @param {number | null} baseSeed
 * @returns {number[]}
 */
function generateIterationSeeds(iterations, baseSeed) {
  if (!Number.isFinite(iterations) || iterations <= 0) {
    return [];
  }
  const count = Math.floor(iterations);
  const seeds = [];
  if (typeof baseSeed === "number" && Number.isFinite(baseSeed)) {
    const random = createMulberry32(baseSeed >>> 0);
    for (let index = 0; index < count; index += 1) {
      const value = random();
      const numeric = Math.floor(value * 0x100000000) >>> 0;
      seeds.push(numeric);
    }
    return seeds;
  }
  for (let index = 0; index < count; index += 1) {
    const bytes = crypto.randomBytes(4);
    seeds.push(bytes.readUInt32LE(0) >>> 0);
  }
  return seeds;
}

/**
 * @param {string[]} values
 * @param {number} seed
 * @returns {string[]}
 */
function shuffleWithSeed(values, seed) {
  if (!Number.isFinite(seed)) {
    return values.slice();
  }
  const items = values.slice();
  const random = createMulberry32(seed >>> 0);
  for (let index = items.length - 1; index > 0; index -= 1) {
    const randomValue = random();
    const swapIndex = Math.floor(randomValue * (index + 1));
    const hold = items[index];
    items[index] = items[swapIndex];
    items[swapIndex] = hold;
  }
  return items;
}

/**
 * @param {number | null} seed
 * @returns {string}
 */
function formatSeed(seed) {
  if (!Number.isFinite(seed)) {
    return "n/a";
  }
  return `0x${(seed >>> 0).toString(16).padStart(8, "0")}`;
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

/**
 * @param {any} runtimeContext
 */
async function createRuntimeModule(runtimeContext) {
  const tempDir = await fs.mkdtemp(RUNTIME_MODULE_PREFIX);
  const modulePath = path.join(tempDir, "context.mjs");
  const serialized = JSON.stringify(runtimeContext);
  const moduleContents = `// auto-generated runtime context for Gravity tests
const context = ${serialized};
if (context && typeof context === "object" && context.screenshots && typeof context.screenshots === "object") {
    Object.freeze(context.screenshots);
}
if (context && typeof context === "object" && context.environment && typeof context.environment === "object") {
    Object.freeze(context.environment);
}
globalThis.__gravityRuntimeContext = Object.freeze(context);
`;
  await fs.writeFile(modulePath, moduleContents, "utf8");
  return {
    modulePath,
    async dispose() {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

/**
 * @param {string[]} argv
 * @returns {{
   *   screenshotPolicy?: string,
   *   screenshotAllowlist?: string[],
 *   screenshotDirectory?: string,
 *   screenshotForce?: boolean,
 *   iterations?: number,
 *   seed?: string,
 *   randomize?: boolean,
 *   failFast?: boolean,
 *   stress?: boolean,
 *   passthroughArgs: string[]
 * }}
 */
function parseCommandLineArguments(argv) {
  const parsed = {
    screenshotPolicy: undefined,
    screenshotAllowlist: undefined,
    screenshotDirectory: undefined,
    screenshotForce: undefined,
    iterations: undefined,
    seed: undefined,
    randomize: undefined,
    failFast: undefined,
    stress: undefined,
    passthroughArgs: []
  };

  for (const argument of argv) {
    if (typeof argument !== "string") {
      continue;
    }
    if (argument.startsWith("--screenshots=")) {
      const value = argument.slice("--screenshots=".length).trim().toLowerCase();
      if (value.length > 0) {
        parsed.screenshotPolicy = value;
      }
      continue;
    }
    if (argument === "--screenshots") {
      parsed.screenshotPolicy = "enabled";
      continue;
    }
    if (argument.startsWith("--screenshot-allowlist=")) {
      const raw = argument.slice("--screenshot-allowlist=".length);
      parsed.screenshotAllowlist = normalizeStringList(raw);
      continue;
    }
    if (argument.startsWith("--screenshot-dir=")) {
      const rawDir = argument.slice("--screenshot-dir=".length).trim();
      if (rawDir.length > 0) {
        parsed.screenshotDirectory = rawDir;
      }
      continue;
    }
    if (argument === "--screenshot-force") {
      parsed.screenshotForce = true;
      continue;
    }
    if (argument.startsWith("--iterations=")) {
      const rawIterations = argument.slice("--iterations=".length).trim();
      if (rawIterations.length > 0) {
        const parsedIterations = Number.parseInt(rawIterations, 10);
        if (Number.isFinite(parsedIterations) && parsedIterations > 0) {
          parsed.iterations = Math.floor(parsedIterations);
        }
      }
      continue;
    }
    if (argument === "--randomize") {
      parsed.randomize = true;
      continue;
    }
    if (argument === "--no-randomize") {
      parsed.randomize = false;
      continue;
    }
    if (argument === "--fail-fast") {
      parsed.failFast = true;
      continue;
    }
    if (argument === "--no-fail-fast") {
      parsed.failFast = false;
      continue;
    }
    if (argument === "--stress") {
      parsed.iterations = Math.max(parsed.iterations ?? 0, 10);
      parsed.stress = true;
      continue;
    }
    if (argument.startsWith("--seed=")) {
      const seedValue = argument.slice("--seed=".length).trim();
      if (seedValue.length > 0) {
        parsed.seed = seedValue;
      }
      continue;
    }
    parsed.passthroughArgs.push(argument);
  }

  return parsed;
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
  const cliArguments = parseCommandLineArguments(process.argv.slice(2));
  process.argv.splice(2, process.argv.length - 2, ...cliArguments.passthroughArgs);

  const runtimeOptions = await loadRuntimeOptions();
  const isCiEnvironment = process.env.CI === "true";
  const failFast = typeof cliArguments.failFast === "boolean"
    ? cliArguments.failFast
    : typeof runtimeOptions.failFast === "boolean"
      ? runtimeOptions.failFast
      : false;

  /** @type {{ policy?: string, allowlist?: string[] }} */
  const mergedScreenshotConfig = {};
  if (runtimeOptions.screenshots && typeof runtimeOptions.screenshots === "object") {
    if ("policy" in runtimeOptions.screenshots) {
      mergedScreenshotConfig.policy = runtimeOptions.screenshots.policy;
    }
    if ("allowlist" in runtimeOptions.screenshots) {
      mergedScreenshotConfig.allowlist = normalizeStringList(runtimeOptions.screenshots.allowlist);
    }
  }
  if (typeof cliArguments.screenshotPolicy === "string") {
    mergedScreenshotConfig.policy = cliArguments.screenshotPolicy;
  }
  if (Array.isArray(cliArguments.screenshotAllowlist)) {
    mergedScreenshotConfig.allowlist = cliArguments.screenshotAllowlist;
  }

  let screenshotDirectorySetting = typeof cliArguments.screenshotDirectory === "string" ? cliArguments.screenshotDirectory : null;
  if (!screenshotDirectorySetting && runtimeOptions.screenshots && typeof runtimeOptions.screenshots.directory === "string") {
    screenshotDirectorySetting = runtimeOptions.screenshots.directory;
  }

  const screenshotOptions = parseScreenshotOptions(mergedScreenshotConfig);
  const screenshotForce = Boolean(cliArguments.screenshotForce || (runtimeOptions.screenshots && runtimeOptions.screenshots.force));
  const streamChildLogs = process.env.GRAVITY_TEST_STREAM_LOGS === "1";

  const shouldAutoProvision = !isCiEnvironment && !screenshotDirectorySetting && (
    screenshotForce ||
    screenshotOptions.policy === "enabled" ||
    (screenshotOptions.policy === "allowlist" && screenshotOptions.allowlist.length > 0)
  );

  let screenshotRunRoot = null;
  if (screenshotDirectorySetting) {
    const resolvedDirectory = path.resolve(process.cwd(), screenshotDirectorySetting);
    await fs.mkdir(resolvedDirectory, { recursive: true });
    screenshotRunRoot = resolvedDirectory;
  } else if (shouldAutoProvision) {
    const timestamp = createArtifactTimestamp();
    screenshotRunRoot = path.join(SCREENSHOT_ARTIFACT_ROOT, timestamp);
    await fs.mkdir(screenshotRunRoot, { recursive: true });
  }

  let iterationConfiguredExplicitly = false;
  let iterationCount = parsePositiveInteger(cliArguments.iterations, 0);
  if (iterationCount > 0) {
    iterationConfiguredExplicitly = true;
  } else {
    iterationCount = parsePositiveInteger(process.env.GRAVITY_TEST_ITERATIONS, 0);
    if (iterationCount > 0) {
      iterationConfiguredExplicitly = true;
    } else if (Object.prototype.hasOwnProperty.call(runtimeOptions, "iterations")) {
      iterationCount = parsePositiveInteger(/** @type {any} */ (runtimeOptions).iterations, 0);
      if (iterationCount > 0) {
        iterationConfiguredExplicitly = true;
      }
    }
  }
  if (iterationCount <= 0) {
    iterationCount = 3;
  }
  if (isCiEnvironment && !iterationConfiguredExplicitly) {
    iterationCount = 1;
  }
  if (cliArguments.stress === true && iterationCount < 10) {
    iterationCount = 10;
  }

  let randomizeTests;
  if (typeof cliArguments.randomize === "boolean") {
    randomizeTests = cliArguments.randomize;
  } else if (typeof process.env.GRAVITY_TEST_RANDOMIZE === "string" && process.env.GRAVITY_TEST_RANDOMIZE.length > 0) {
    randomizeTests = parseBooleanOption(process.env.GRAVITY_TEST_RANDOMIZE, true);
  } else if (Object.prototype.hasOwnProperty.call(runtimeOptions, "randomize")) {
    randomizeTests = parseBooleanOption(/** @type {any} */ (runtimeOptions).randomize, true);
  } else {
    randomizeTests = false;
  }

  const seedCandidates = [
    typeof cliArguments.seed === "string" ? cliArguments.seed : null,
    typeof process.env.GRAVITY_TEST_SEED === "string" ? process.env.GRAVITY_TEST_SEED : null,
    Object.prototype.hasOwnProperty.call(runtimeOptions, "seed") ? /** @type {any} */ (runtimeOptions).seed : null
  ];
  let baseSeedNumeric = null;
  let baseSeedLabel = null;
  for (const candidate of seedCandidates) {
    const { numeric, label } = normalizeSeedValue(candidate);
    if (numeric !== null || label !== null) {
      baseSeedNumeric = numeric;
      baseSeedLabel = label;
      break;
    }
  }
  if (baseSeedNumeric === null && typeof baseSeedLabel === "string") {
    const hashed = normalizeSeedValue(baseSeedLabel);
    baseSeedNumeric = hashed.numeric;
  }

  const iterationSeeds = randomizeTests
    ? generateIterationSeeds(iterationCount, baseSeedNumeric)
    : Array.from({ length: iterationCount }, () => baseSeedNumeric);

  // Minimal mode = no browser/backend/launch guard. Used by harness self-tests.
  const minimal = Boolean(runtimeOptions.minimal);
  // Raw mode = execute files as plain Node scripts (no --test). Implies minimal semantics.
  const raw = Boolean(runtimeOptions.raw);

  const patternInput = typeof runtimeOptions.pattern === "string" ? runtimeOptions.pattern : null;
  const pattern = patternInput ? new RegExp(patternInput) : null;
  const testNamePatternInput = typeof runtimeOptions.testNamePattern === "string"
    ? runtimeOptions.testNamePattern
    : null;

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
      ["auth.tauth.puppeteer.test.js", 90000],
      ["fullstack.endtoend.puppeteer.test.js", 60000],
      ["persistence.backend.puppeteer.test.js", 45000],
      ["sync.endtoend.puppeteer.test.js", 90000],
      ["sync.realtime.puppeteer.test.js", 90000],
      ["sync.scenarios.puppeteer.test.js", 90000],
      ["editor.inline.puppeteer.test.js", 60000],
      ["htmlView.checkmark.puppeteer.test.js", 60000]
    ];
    for (const [file, value] of defaultTimeoutEntries) {
      if (!timeoutOverrides.has(file)) timeoutOverrides.set(file, value);
    }
    const defaultKillEntries = [
      ["fullstack.endtoend.puppeteer.test.js", 10000],
      ["persistence.backend.puppeteer.test.js", 8000],
      ["sync.endtoend.puppeteer.test.js", 8000],
      ["editor.inline.puppeteer.test.js", 8000]
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
  const environmentCopy = Object.fromEntries(Object.entries(process.env));
  /** @type {any} */
  const baseEnvironmentContext = { ci: isCiEnvironment, environment: environmentCopy };

  const sectionHeading = (label) => `\n${cliColors.symbols.section} ${cliColors.bold(label)}`;
  const formatCount = (count, label, format) => {
    const formatted = `${count} ${label}`;
    if (count === 0) return cliColors.dim(formatted);
    return format(formatted);
  };
  const baseSeedSummary = (() => {
    if (typeof baseSeedLabel === "string" && baseSeedLabel.length > 0 && Number.isFinite(baseSeedNumeric)) {
      return `${baseSeedLabel} ⇢ ${formatSeed(baseSeedNumeric ?? 0)}`;
    }
    if (typeof baseSeedLabel === "string" && baseSeedLabel.length > 0) {
      return baseSeedLabel;
    }
    if (Number.isFinite(baseSeedNumeric)) {
      return formatSeed(baseSeedNumeric ?? 0);
    }
    return "generated";
  })();

  console.log(sectionHeading("Runner Configuration"));
  console.log(`  iterations: ${cliColors.bold(String(iterationCount))}`);
  console.log(`  ordering: ${randomizeTests ? cliColors.green("random") : cliColors.yellow("stable")}`);
  if (randomizeTests) {
    console.log(`  base seed: ${cliColors.bold(baseSeedSummary)}`);
    iterationSeeds.forEach((seed, index) => {
      const displaySeed = Number.isFinite(seed) ? formatSeed(seed ?? 0) : "n/a";
      console.log(`    iteration ${String(index + 1).padStart(2, "0")}: ${displaySeed}`);
    });
  }

  let hasFailure = false;
  const summary = [];
  const iterationMetadata = [];
  let totalDurationMs = 0;
  let passCount = 0;
  let failCount = 0;
  let timeoutCount = 0;
  let failFastTriggered = false;

  try {
    for (let iterationIndex = 0; iterationIndex < iterationCount; iterationIndex += 1) {
      /** @type {any} */
      let baseRuntimeContext = baseEnvironmentContext;
      try {
        publishRuntimeContext(baseEnvironmentContext);
        if (!minimal && !raw) {
          sharedBrowserContext = await launchSharedBrowser();
          if (!sharedBrowserContext) throw new Error("Shared browser failed to launch.");
          backendHandle = await startTestBackend();
          if (!backendHandle.signingKeyPem || !backendHandle.signingKeyId) {
            throw new Error("Shared backend did not expose signing metadata.");
          }
          baseRuntimeContext = {
            ...baseEnvironmentContext,
            backend: {
              baseUrl: backendHandle.baseUrl,
              googleClientId: backendHandle.googleClientId,
              signingKeyPem: backendHandle.signingKeyPem,
              signingKeyId: backendHandle.signingKeyId
            },
            browser: {
              wsEndpoint: sharedBrowserContext.wsEndpoint
            }
          };
        }
        publishRuntimeContext(baseRuntimeContext);

        const iterationSeed = randomizeTests ? iterationSeeds[iterationIndex] ?? null : iterationSeeds[iterationIndex] ?? null;
        const iterationFiles = randomizeTests ? shuffleWithSeed(files, iterationSeed ?? 0) : files.slice();
        iterationMetadata.push({
          index: iterationIndex + 1,
          seed: iterationSeed,
          files: iterationFiles.slice()
        });

        const iterationLabelParts = [`Iteration ${iterationIndex + 1}/${iterationCount}`];
        if (randomizeTests) {
          iterationLabelParts.push(`seed ${formatSeed(iterationSeed)}`);
        }
        console.log(sectionHeading(iterationLabelParts.join(" ")));

        let screenshotIterationRoot = null;
        if (screenshotRunRoot) {
          const iterationDirectory = `iteration-${String(iterationIndex + 1).padStart(2, "0")}`;
          screenshotIterationRoot = path.join(screenshotRunRoot, iterationDirectory);
          await fs.mkdir(screenshotIterationRoot, { recursive: true });
        }

        for (const relative of iterationFiles) {
          const absolute = path.join(TESTS_ROOT, relative);
          const effectiveTimeout = timeoutOverrides.get(relative) ?? timeoutMs;
          const effectiveKillGrace = killOverrides.get(relative) ?? killGraceMs;

          let screenshotDirectoryForTest = null;
          if (screenshotIterationRoot) {
            const shortName = deriveShortTestName(relative);
            screenshotDirectoryForTest = path.join(screenshotIterationRoot, shortName);
            await fs.mkdir(screenshotDirectoryForTest, { recursive: true });
          }

          console.log(sectionHeading(relative));

          /** @type {string[]} */
          const args = [];
          if (!raw) {
            args.push("--test", `--test-timeout=${Math.max(effectiveTimeout, 1000)}`);
            if (testNamePatternInput) {
              args.push(`--test-name-pattern=${testNamePatternInput}`);
            }
            args.push(absolute);
          } else {
            args.push(absolute);
          }

          const runtimeContextForTest = {
            ...baseRuntimeContext,
            test: {
              file: relative,
              iteration: iterationIndex + 1,
              totalIterations: iterationCount,
              seed: iterationSeed ?? null
            },
            screenshots: {
              directory: screenshotDirectoryForTest,
              policy: screenshotOptions.policy ?? null,
              allowlist: Array.isArray(screenshotOptions.allowlist) ? screenshotOptions.allowlist : [],
              force: screenshotForce
            }
          };

          const { modulePath: runtimeModulePath, dispose: disposeRuntimeModule } = await createRuntimeModule(runtimeContextForTest);

          if (!raw) {
            args.unshift("--import", runtimeModulePath);
            if (!minimal) {
              args.unshift("--import", guardSpecifier);
            }
          } else {
            args.unshift("--import", runtimeModulePath);
          }

          try {
          /** @type {import("./helpers/testHarness.js").RunResult} */
          let result;
          const runOptions = {
            command: process.execPath,
            args,
            timeoutMs: effectiveTimeout,
            killGraceMs: effectiveKillGrace
          };
          if (streamChildLogs) {
            runOptions.onStdout = (chunk) => safeWrite(process.stdout, chunk);
            runOptions.onStderr = (chunk) => safeWrite(process.stderr, chunk);
          }
          result = await runTestProcess(runOptions);

          summary.push({
            iteration: iterationIndex + 1,
            seed: iterationSeed ?? null,
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
            if (failFast && !failFastTriggered) {
              failFastTriggered = true;
              console.error(`  ${cliColors.red("Fail-fast enabled; stopping after first failure.")}`);
              break;
            }
            continue;
          }
          if (result.exitCode !== 0) {
            hasFailure = true;
            failCount += 1;
            const signalDetail = result.signal ? `signal=${result.signal}` : `exitCode=${result.exitCode}`;
            console.error(`  ${cliColors.symbols.fail} ${cliColors.red(`Failed (${signalDetail})`)}`);
            if (!streamChildLogs) {
              const stderrOutput = trimCapturedOutput(result.stderr ?? "", CAPTURED_LOG_LIMIT);
              if (stderrOutput) {
                console.error(`  ${cliColors.dim("stderr:")}`);
                console.error(stderrOutput);
              }
              const stdoutOutput = trimCapturedOutput(result.stdout ?? "", CAPTURED_LOG_LIMIT);
              if (stdoutOutput) {
                console.error(`  ${cliColors.dim("stdout:")}`);
                console.error(stdoutOutput);
              }
            }
            if (failFast && !failFastTriggered) {
              failFastTriggered = true;
              console.error(`  ${cliColors.red("Fail-fast enabled; stopping after first failure.")}`);
              break;
            }
          } else {
            passCount += 1;
            const durationLabel = cliColors.dim(`(${formatDuration(result.durationMs)})`);
            console.log(`  ${cliColors.symbols.pass} ${cliColors.green("Passed")} ${durationLabel}`);
          }
        } finally {
          await disposeRuntimeModule();
        }
        if (failFastTriggered) {
          break;
        }
      }
      if (failFastTriggered) {
        break;
      }
      } finally {
        if (backendHandle) {
          await backendHandle.close().catch(() => {});
          backendHandle = null;
        }
        if (sharedBrowserContext) {
          await closeSharedBrowser().catch(() => {});
          sharedBrowserContext = null;
        }
      }
    }
  } finally {
    if (backendHandle) await backendHandle.close().catch(() => {});
    if (sharedBrowserContext) await closeSharedBrowser().catch(() => {});
  }

  console.log(sectionHeading("Summary"));
  for (const iteration of iterationMetadata) {
    const iterationEntries = summary.filter((entry) => entry.iteration === iteration.index);
    const iterationHeadingParts = [`Iteration ${iteration.index}/${iterationCount}`];
    if (randomizeTests) {
      iterationHeadingParts.push(`seed ${formatSeed(iteration.seed ?? null)}`);
    }
    console.log(`  ${cliColors.bold(iterationHeadingParts.join(" "))}`);
    if (iterationEntries.length === 0) {
      console.log(`    ${cliColors.dim("no tests executed")}`);
      continue;
    }
    for (const entry of iterationEntries) {
      const status = entry.timedOut ? "timeout" : entry.exitCode === 0 ? "pass" : "fail";
      const durationLabel = cliColors.dim(`(${formatDuration(entry.durationMs)})`);
      if (status === "timeout") {
        console.log(`    ${cliColors.symbols.timeout} ${cliColors.bold(entry.file)} ${cliColors.yellow("timeout")} ${durationLabel}`);
        continue;
      }
      if (status === "fail") {
        const failureDetail = entry.signal ? `signal=${entry.signal}` : `exit=${entry.exitCode}`;
        console.log(`    ${cliColors.symbols.fail} ${cliColors.bold(entry.file)} ${cliColors.red(failureDetail)} ${durationLabel}`);
        continue;
      }
      console.log(`    ${cliColors.symbols.pass} ${cliColors.bold(entry.file)} ${durationLabel}`);
    }
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

function deriveShortTestName(relativePath) {
  const base = path.basename(relativePath).replace(/\.test\.js$/u, "");
  return sanitizeArtifactComponent(base);
}

function publishRuntimeContext(context) {
  globalThis.__gravityRuntimeContext = context;
}

function safeWrite(stream, chunk) {
  if (!stream || typeof stream.write !== "function") {
    return;
  }
  ensureEpipeGuard(stream);
  try {
    stream.write(chunk);
  } catch (error) {
    if (!error || error.code !== "EPIPE") {
      throw error;
    }
  }
}

const EPIPE_GUARD_SYMBOL = Symbol("gravityEpipeGuard");

function ensureEpipeGuard(stream) {
  if (!stream || typeof stream.on !== "function") {
    return;
  }
  if (stream[EPIPE_GUARD_SYMBOL]) {
    return;
  }
  stream.on("error", (error) => {
    if (error && error.code === "EPIPE") {
      return;
    }
    throw error;
  });
  stream[EPIPE_GUARD_SYMBOL] = true;
}

function patchConsoleStreams() {
  const mappings = [
    ["log", process.stdout],
    ["info", process.stdout],
    ["warn", process.stderr],
    ["error", process.stderr]
  ];
  for (const [method, targetStream] of mappings) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      if (!targetStream) {
        original(...args);
        return;
      }
      const formatted = util.format(...args);
      safeWrite(targetStream, `${formatted}\n`);
    };
  }
}

patchConsoleStreams();

main()
  .then((exitCode) => {
    const normalized = Number.isFinite(exitCode) ? Number(exitCode) : 0;
    process.exit(normalized);
  })
  .catch((error) => {
    console.error("Test harness encountered an error:", error);
    process.exit(1);
  });
