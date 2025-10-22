// @ts-check

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const SCREENSHOT_DIRECTORY_ENV = "GRAVITY_SCREENSHOT_DIR";
const PNG_EXTENSION = ".png";

/**
 * Determine whether screenshots should be saved for the current test process.
 * @returns {boolean}
 */
export function shouldCaptureScreenshots() {
    if (process.env.CI === "true") {
        return false;
    }
    const directory = process.env[SCREENSHOT_DIRECTORY_ENV];
    return typeof directory === "string" && directory.trim().length > 0;
}

/**
 * Resolve the directory that should receive screenshot artifacts.
 * @returns {string | null}
 */
export function getScreenshotArtifactsDirectory() {
    const directory = process.env[SCREENSHOT_DIRECTORY_ENV];
    if (typeof directory !== "string") {
        return null;
    }
    const trimmed = directory.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * Persist a PNG screenshot buffer if capturing is enabled.
 * @param {string} label
 * @param {Buffer | Uint8Array | ArrayBuffer} buffer
 * @returns {Promise<string | null>}
 */
export async function saveScreenshotArtifact(label, buffer) {
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
export async function captureElementScreenshot(page, options) {
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
