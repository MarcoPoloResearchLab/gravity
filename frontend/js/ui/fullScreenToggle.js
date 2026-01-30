// @ts-check

import { MESSAGE_FULLSCREEN_TOGGLE_FAILED } from "../constants.js?build=2026-01-01T22:43:21Z";
import { logging } from "../utils/logging.js?build=2026-01-01T22:43:21Z";

/**
 * @typedef {{
 *   targetElement?: HTMLElement | null,
 *   notify?: (message: string) => void
 * }} FullScreenToggleActionOptions
 */

/**
 * Toggle full screen on the provided element (or document root), with standard error handling.
 * @param {FullScreenToggleActionOptions} options
 * @returns {Promise<void>}
 */
export async function performFullScreenToggle(options) {
    const target = options?.targetElement ?? document?.documentElement ?? null;
    if (!(target instanceof HTMLElement)) {
        logging.error("Failed to toggle full screen state", new Error("Full screen target unavailable."));
        if (typeof options?.notify === "function") {
            options.notify(MESSAGE_FULLSCREEN_TOGGLE_FAILED);
        }
        return;
    }
    try {
        if (isElementFullScreen(target)) {
            await exitFullScreen();
        } else {
            await requestFullScreen(target);
        }
    } catch (error) {
        logging.error("Failed to toggle full screen state", error);
        if (typeof options?.notify === "function") {
            options.notify(MESSAGE_FULLSCREEN_TOGGLE_FAILED);
        }
    }
}

/**
 * @param {HTMLElement} element
 * @returns {boolean}
 */
export function isFullScreenSupported(element) {
    if (typeof document === "undefined") {
        return false;
    }
    if (!element) {
        return false;
    }
    const candidate = /** @type {HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void> | void,
        mozRequestFullScreen?: () => Promise<void> | void,
        msRequestFullscreen?: () => Promise<void> | void
    }} */ (element);
    return typeof element.requestFullscreen === "function"
        || typeof candidate.webkitRequestFullscreen === "function"
        || typeof candidate.mozRequestFullScreen === "function"
        || typeof candidate.msRequestFullscreen === "function";
}

/**
 * @param {HTMLElement} element
 * @returns {Promise<void>}
 */
function requestFullScreen(element) {
    const candidate = /** @type {HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void> | void,
        mozRequestFullScreen?: () => Promise<void> | void,
        msRequestFullscreen?: () => Promise<void> | void
    }} */ (element);
    try {
        if (typeof element.requestFullscreen === "function") {
            return element.requestFullscreen();
        }
        if (typeof candidate.webkitRequestFullscreen === "function") {
            candidate.webkitRequestFullscreen();
            return Promise.resolve();
        }
        if (typeof candidate.mozRequestFullScreen === "function") {
            candidate.mozRequestFullScreen();
            return Promise.resolve();
        }
        if (typeof candidate.msRequestFullscreen === "function") {
            candidate.msRequestFullscreen();
            return Promise.resolve();
        }
    } catch (error) {
        return Promise.reject(error);
    }
    return Promise.reject(new Error("Full screen API not supported on the provided element."));
}

/**
 * @returns {Promise<void>}
 */
function exitFullScreen() {
    const candidate = /** @type {Document & {
        webkitExitFullscreen?: () => Promise<void> | void,
        mozCancelFullScreen?: () => Promise<void> | void,
        msExitFullscreen?: () => Promise<void> | void
    }} */ (document);
    try {
        if (typeof document.exitFullscreen === "function") {
            return document.exitFullscreen();
        }
        if (typeof candidate.webkitExitFullscreen === "function") {
            candidate.webkitExitFullscreen();
            return Promise.resolve();
        }
        if (typeof candidate.mozCancelFullScreen === "function") {
            candidate.mozCancelFullScreen();
            return Promise.resolve();
        }
        if (typeof candidate.msExitFullscreen === "function") {
            candidate.msExitFullscreen();
            return Promise.resolve();
        }
    } catch (error) {
        return Promise.reject(error);
    }
    return Promise.reject(new Error("Full screen API not supported on the current document."));
}

/**
 * @param {HTMLElement} element
 * @returns {boolean}
 */
export function isElementFullScreen(element) {
    if (typeof document === "undefined") {
        return false;
    }
    const candidate = /** @type {Document & {
        webkitFullscreenElement?: Element | null,
        mozFullScreenElement?: Element | null,
        msFullscreenElement?: Element | null
    }} */ (document);
    const current = document.fullscreenElement
        ?? candidate.webkitFullscreenElement
        ?? candidate.mozFullScreenElement
        ?? candidate.msFullscreenElement
        ?? null;
    return current === element;
}
