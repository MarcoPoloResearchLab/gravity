// @ts-check

import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs/promises";
import path from "node:path";

import { readRuntimeContext } from "./runtimeContext.js";

const SCREENSHOT_POLICIES = Object.freeze({
    disabled: "disabled",
    enabled: "enabled",
    allowlist: "allowlist"
});

/**
 * @typedef {Object} ScreenshotConfiguration
 * @property {boolean} ci
 * @property {string | null} directory
 * @property {"disabled" | "enabled" | "allowlist"} policy
 * @property {string[]} allowlist
 * @property {string | null} testFile
 * @property {boolean} force
 */

/**
 * @typedef {Object} ScreenshotOverrides
 * @property {string | null | undefined} [directory]
 * @property {"disabled" | "enabled" | "allowlist" | undefined} [policy]
 * @property {string[] | undefined} [allowlist]
 * @property {string | null | undefined} [testFile]
 * @property {boolean | undefined} [force]
 * @property {boolean | undefined} [ci]
 */

/**
 * @param {*} value
 * @returns {"disabled" | "enabled" | "allowlist"}
 */
function normalizePolicy(value) {
    const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (raw === SCREENSHOT_POLICIES.enabled) return SCREENSHOT_POLICIES.enabled;
    if (raw === SCREENSHOT_POLICIES.allowlist) return SCREENSHOT_POLICIES.allowlist;
    return SCREENSHOT_POLICIES.disabled;
}

/**
 * @param {*} value
 * @returns {string | null}
 */
function normalizeDirectory(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * @param {*} value
 * @returns {string | null}
 */
function normalizeTestFile(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * @param {*} value
 * @returns {string[]}
 */
function normalizeAllowlist(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0);
}

/**
 * @param {*} value
 * @returns {boolean}
 */
function normalizeBoolean(value) {
    return value === true;
}

/**
 * @param {*} rawConfig
 * @returns {ScreenshotConfiguration}
 */
function normalizeConfiguration(rawConfig) {
    const config = typeof rawConfig === "object" && rawConfig !== null ? rawConfig : {};
    return {
        ci: Boolean(config.ci),
        directory: normalizeDirectory(config.directory),
        policy: normalizePolicy(config.policy),
        allowlist: normalizeAllowlist(config.allowlist),
        testFile: normalizeTestFile(config.testFile),
        force: Boolean(config.force)
    };
}

/**
 * @param {ScreenshotOverrides | undefined} overrides
 * @returns {ScreenshotOverrides | null}
 */
function normalizeOverrides(overrides) {
    if (!overrides || typeof overrides !== "object") {
        return null;
    }
    /** @type {ScreenshotOverrides} */
    const normalized = {};
    if ("directory" in overrides) {
        normalized.directory = normalizeDirectory(overrides.directory);
    }
    if ("policy" in overrides) {
        normalized.policy = normalizePolicy(overrides.policy);
    }
    if ("allowlist" in overrides) {
        normalized.allowlist = normalizeAllowlist(overrides.allowlist);
    }
    if ("testFile" in overrides) {
        normalized.testFile = normalizeTestFile(overrides.testFile);
    }
    if ("force" in overrides) {
        normalized.force = Boolean(overrides.force);
    }
    if ("ci" in overrides) {
        normalized.ci = Boolean(overrides.ci);
    }
    return normalized;
}

/**
 * @param {string} candidate
 * @param {string} target
 */
function doesAllowlistEntryMatch(candidate, target) {
    const normalizedCandidate = candidate.replace(/\\/g, "/");
    const normalizedTarget = target.replace(/\\/g, "/");
    if (normalizedCandidate === normalizedTarget) {
        return true;
    }
    return normalizedCandidate === path.basename(normalizedTarget);
}

/**
 * @param {() => ScreenshotConfiguration} resolver
 */
export function createScreenshotArtifactsController(resolver) {
    if (typeof resolver !== "function") {
        throw new Error("Screenshot configuration resolver must be a function.");
    }

    const forcedContext = new AsyncLocalStorage();
    /** @type {ScreenshotOverrides | null} */
    let overrides = null;

    /**
     * @returns {ScreenshotConfiguration}
     */
    function resolveEffectiveConfiguration() {
        const baseConfig = normalizeConfiguration(resolver());
        if (overrides) {
            if ("ci" in overrides) {
                baseConfig.ci = Boolean(overrides.ci);
            }
            if ("directory" in overrides) {
                baseConfig.directory = overrides.directory ?? baseConfig.directory;
            }
            if ("policy" in overrides && overrides.policy) {
                baseConfig.policy = overrides.policy;
            }
            if ("allowlist" in overrides && overrides.allowlist) {
                baseConfig.allowlist = overrides.allowlist.slice();
            }
            if ("testFile" in overrides) {
                baseConfig.testFile = overrides.testFile ?? baseConfig.testFile;
            }
            if ("force" in overrides) {
                baseConfig.force = Boolean(overrides.force);
            }
        }
        const store = forcedContext.getStore();
        if (store && store.forced === true) {
            baseConfig.force = true;
        }
        return baseConfig;
    }

    function shouldCaptureScreenshots() {
        const config = resolveEffectiveConfiguration();
        if (config.ci) {
            return false;
        }
        if (!config.directory) {
            return false;
        }
        if (config.force) {
            return true;
        }
        if (config.policy === SCREENSHOT_POLICIES.enabled) {
            return true;
        }
        if (config.policy === SCREENSHOT_POLICIES.allowlist) {
            if (!config.testFile) {
                return false;
            }
            return config.allowlist.some((entry) => doesAllowlistEntryMatch(entry, config.testFile || ""));
        }
        return false;
    }

    function getScreenshotArtifactsDirectory() {
        const config = resolveEffectiveConfiguration();
        return config.directory;
    }

    /**
     * @param {string} label
     * @param {Buffer | Uint8Array | ArrayBuffer} buffer
     */
    async function saveScreenshotArtifact(label, buffer) {
        if (!shouldCaptureScreenshots()) {
            return null;
        }
        const directory = getScreenshotArtifactsDirectory();
        if (!directory) {
            return null;
        }
        const normalizedBuffer = normalizeBuffer(buffer);
        if (!normalizedBuffer) {
            return null;
        }
        const safeLabel = sanitizeLabel(label);
        const filePath = path.join(directory, `${safeLabel}.png`);
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(filePath, normalizedBuffer);
        return filePath;
    }

    /**
     * @param {import("puppeteer").Page} page
     * @param {{
     *   label: string,
     *   selector?: string,
     *   clip?: import("puppeteer").BoundingBox
     * }} options
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

        if (typeof selector === "string" && selector.trim().length > 0) {
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

    /**
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
     * @param {ScreenshotOverrides | undefined} nextOverrides
     */
    function setOverrides(nextOverrides) {
        overrides = normalizeOverrides(nextOverrides) ?? null;
    }

    function clearOverrides() {
        overrides = null;
    }

    return Object.freeze({
        shouldCaptureScreenshots,
        getScreenshotArtifactsDirectory,
        saveScreenshotArtifact,
        captureElementScreenshot,
        withScreenshotCapture,
        setOverrides,
        clearOverrides
    });
}

const defaultController = createScreenshotArtifactsController(() => {
    const runtime = readRuntimeContext();
    const screenshots = typeof runtime === "object" && runtime !== null ? runtime.screenshots : null;
    const testInfo = typeof runtime === "object" && runtime !== null ? runtime.test : null;
    return {
        ci: Boolean(runtime && typeof runtime === "object" && runtime.ci),
        directory: normalizeDirectory(screenshots && screenshots.directory),
        policy: normalizePolicy(screenshots && screenshots.policy),
        allowlist: normalizeAllowlist(screenshots && screenshots.allowlist),
        testFile: normalizeTestFile(testInfo && testInfo.file),
        force: Boolean(screenshots && screenshots.force)
    };
});

const {
    shouldCaptureScreenshots: defaultShouldCapture,
    getScreenshotArtifactsDirectory: defaultGetDirectory,
    saveScreenshotArtifact: defaultSaveArtifact,
    captureElementScreenshot: defaultCaptureElement,
    withScreenshotCapture: defaultWithScreenshotCapture,
    setOverrides: setDefaultOverrides,
    clearOverrides: clearDefaultOverrides
} = defaultController;

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
 */
function sanitizeLabel(label) {
    return label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/gu, "_")
        .replace(/^_+/u, "")
        .replace(/_+$/u, "") || "screenshot";
}

export {
    defaultShouldCapture as shouldCaptureScreenshots,
    defaultGetDirectory as getScreenshotArtifactsDirectory,
    defaultSaveArtifact as saveScreenshotArtifact,
    defaultCaptureElement as captureElementScreenshot,
    defaultWithScreenshotCapture as withScreenshotCapture,
    setDefaultOverrides as setScreenshotTestOverrides,
    clearDefaultOverrides as clearScreenshotTestOverrides
};
