// @ts-check

import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const PNG_EXTENSION = ".png";
const SCREENSHOT_POLICIES = Object.freeze({
    disabled: "disabled",
    enabled: "enabled",
    allowlist: "allowlist"
});

const DEFAULT_ENV_NAMES = Object.freeze({
    directoryEnv: "GRAVITY_SCREENSHOT_DIR",
    policyEnv: "GRAVITY_SCREENSHOT_POLICY",
    allowlistEnv: "GRAVITY_SCREENSHOT_ALLOWLIST",
    testFileEnv: "GRAVITY_SCREENSHOT_TEST_FILE",
    forceEnv: "GRAVITY_SCREENSHOT_FORCE"
});

/**
 * @param {{
 *   directoryEnv?: string,
 *   policyEnv?: string,
 *   allowlistEnv?: string,
 *   testFileEnv?: string,
 *   forceEnv?: string
 * }} [options]
 */
export function createScreenshotArtifactsController(options = {}) {
    const config = {
        ...DEFAULT_ENV_NAMES,
        ...options
    };

    const forcedContext = new AsyncLocalStorage();

    /**
     * @param {NodeJS.ProcessEnv} env
     * @param {string} key
     * @returns {string | undefined}
     */
    function getEnvValue(env, key) {
        const raw = env[key];
        return typeof raw === "string" ? raw : undefined;
    }

    /**
     * @param {NodeJS.ProcessEnv} [env]
     */
    function getScreenshotArtifactsDirectory(env = process.env) {
        const directory = getEnvValue(env, config.directoryEnv);
        if (!directory) {
            return null;
        }
        const trimmed = directory.trim();
        return trimmed.length > 0 ? trimmed : null;
    }

    /**
     * @param {NodeJS.ProcessEnv} [env]
     * @returns {"disabled" | "enabled" | "allowlist"}
     */
    function resolvePolicy(env = process.env) {
        const raw = getEnvValue(env, config.policyEnv);
        if (!raw) {
            return SCREENSHOT_POLICIES.disabled;
        }
        const normalized = raw.trim().toLowerCase();
        if (normalized === "enabled" || normalized === "always") {
            return SCREENSHOT_POLICIES.enabled;
        }
        if (
            normalized === "allowlist" ||
            normalized === "allow-listed" ||
            normalized === "allow-list" ||
            normalized === "allow list"
        ) {
            return SCREENSHOT_POLICIES.allowlist;
        }
        if (normalized === "disabled" || normalized === "never" || normalized === "off") {
            return SCREENSHOT_POLICIES.disabled;
        }
        return SCREENSHOT_POLICIES.disabled;
    }

    /**
     * @param {NodeJS.ProcessEnv} [env]
     */
    function parseAllowlist(env = process.env) {
        const raw = getEnvValue(env, config.allowlistEnv);
        if (!raw) {
            return new Set();
        }
        const entries = raw
            .split(/[\n,]/u)
            .map((value) => value.trim())
            .filter((value) => value.length > 0);
        return new Set(entries);
    }

    /**
     * @param {unknown} value
     */
    function normalizePathValue(value) {
        if (typeof value !== "string") {
            return null;
        }
        return value.replace(/\\/g, "/");
    }

    /**
     * @param {string | undefined} testFile
     * @param {Set<string>} allowlist
     */
    function isTestInAllowlist(testFile, allowlist) {
        if (!testFile || allowlist.size === 0) {
            return false;
        }
        const normalized = normalizePathValue(testFile);
        if (!normalized) {
            return false;
        }
        if (allowlist.has(normalized)) {
            return true;
        }
        const base = path.basename(normalized);
        return allowlist.has(base);
    }

    /**
     * @param {NodeJS.ProcessEnv} [env]
     */
    function isForced(env = process.env) {
        const context = forcedContext.getStore();
        if (context && context.forced === true) {
            return true;
        }
        const raw = getEnvValue(env, config.forceEnv);
        if (!raw) {
            return false;
        }
        const normalized = raw.trim().toLowerCase();
        return normalized === "1" ||
            normalized === "true" ||
            normalized === "yes" ||
            normalized === "on" ||
            normalized === "enabled";
    }

    /**
     * Determine whether screenshots should be saved for the current test process.
     * @param {NodeJS.ProcessEnv} [env]
     * @returns {boolean}
     */
    function shouldCaptureScreenshots(env = process.env) {
        if (env.CI === "true") {
            return false;
        }
        const directory = getScreenshotArtifactsDirectory(env);
        if (!directory) {
            return false;
        }
        if (isForced(env)) {
            return true;
        }
        const policy = resolvePolicy(env);
        if (policy === SCREENSHOT_POLICIES.enabled) {
            return true;
        }
        if (policy === SCREENSHOT_POLICIES.allowlist) {
            const allowlist = parseAllowlist(env);
            const testFile = getEnvValue(env, config.testFileEnv);
            return isTestInAllowlist(testFile, allowlist);
        }
        return false;
    }

    /**
     * Run the provided callback with screenshot capture forced on.
     * @template T
     * @param {() => Promise<T> | T} callback
     * @returns {Promise<T>}
     */
    async function withScreenshotCapture(callback) {
        if (typeof callback !== "function") {
            throw new Error("withScreenshotCapture requires a callback function.");
        }
        return forcedContext.run({ forced: true }, async () => {
            return await callback();
        });
    }

    /**
     * Persist a PNG screenshot buffer if capturing is enabled.
     * @param {string} label
     * @param {Buffer | Uint8Array | ArrayBuffer} buffer
     * @returns {Promise<string | null>}
     */
    async function saveScreenshotArtifact(label, buffer) {
        if (!shouldCaptureScreenshots()) {
            return null;
        }
        const directory = getScreenshotArtifactsDirectory();
        if (!directory || !label || typeof label !== "string") {
            return null;
        }
        const normalized = normalizeBuffer(buffer);
        if (!normalized) {
            return null;
        }
        const safeLabel = sanitizeLabel(label);
        const filePath = path.join(directory, `${safeLabel}${PNG_EXTENSION}`);
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(filePath, normalized);
        return filePath;
    }

    /**
     * Capture a puppeteer screenshot and persist it when enabled.
     * @param {import("puppeteer").Page} page
     * @param {{
     *   label: string,
     *   selector?: string,
     *   clip?: import("puppeteer").BoundingBox
     * }} options
     * @returns {Promise<string | null>}
     */
    async function captureElementScreenshot(page, options) {
        if (!shouldCaptureScreenshots()) {
            return null;
        }
        if (!page || typeof page.screenshot !== "function") {
            throw new Error("A valid puppeteer page instance is required to capture screenshots.");
        }
        if (!options || typeof options !== "object") {
            throw new Error("Screenshot options must be provided.");
        }
        const { label, selector, clip } = options;
        if (typeof label !== "string" || label.trim().length === 0) {
            throw new Error("Screenshot label must be a non-empty string.");
        }

        if (selector && typeof selector === "string" && selector.trim().length > 0) {
            const handle = await page.$(selector);
            if (!handle) {
                throw new Error(`Unable to locate element for selector: ${selector}`);
            }
            try {
                const raw = await handle.screenshot({ type: "png", clip });
                const normalized = normalizeBuffer(raw);
                if (!normalized) {
                    return null;
                }
                return saveScreenshotArtifact(label, normalized);
            } finally {
                await handle.dispose();
            }
        }

        const rawPageScreenshot = await page.screenshot({
            type: "png",
            clip
        });
        const normalizedPageScreenshot = normalizeBuffer(rawPageScreenshot);
        if (!normalizedPageScreenshot) {
            return null;
        }
        return saveScreenshotArtifact(label, normalizedPageScreenshot);
    }

    return {
        shouldCaptureScreenshots,
        getScreenshotArtifactsDirectory,
        saveScreenshotArtifact,
        captureElementScreenshot,
        withScreenshotCapture,
        resolvePolicy,
        parseAllowlist
    };
}

/**
 * @param {unknown} value
 * @returns {Buffer | null}
 */
function normalizeBuffer(value) {
    if (Buffer.isBuffer(value)) {
        return value;
    }
    if (value instanceof Uint8Array) {
        return Buffer.from(value);
    }
    if (value instanceof ArrayBuffer) {
        return Buffer.from(new Uint8Array(value));
    }
    return null;
}

/**
 * @param {string} label
 * @returns {string}
 */
function sanitizeLabel(label) {
    return label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/gu, "_")
        .replace(/^_+/u, "")
        .replace(/_+$/u, "") || "screenshot";
}

const defaultController = createScreenshotArtifactsController();

const {
    shouldCaptureScreenshots: defaultShouldCapture,
    getScreenshotArtifactsDirectory: defaultGetDirectory,
    saveScreenshotArtifact: defaultSaveArtifact,
    captureElementScreenshot: defaultCaptureElement,
    withScreenshotCapture: defaultWithCapture
} = defaultController;

export {
    defaultShouldCapture as shouldCaptureScreenshots,
    defaultGetDirectory as getScreenshotArtifactsDirectory,
    defaultSaveArtifact as saveScreenshotArtifact,
    defaultCaptureElement as captureElementScreenshot,
    defaultWithCapture as withScreenshotCapture
};
