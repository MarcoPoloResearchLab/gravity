// @ts-check

import {
    LABEL_ENTER_FULL_SCREEN,
    LABEL_EXIT_FULL_SCREEN,
    MESSAGE_FULLSCREEN_TOGGLE_FAILED
} from "../constants.js";
import { logging } from "../utils/logging.js";

const FULLSCREEN_CHANGE_EVENT = "fullscreenchange";
const STATE_ENTER = "enter";
const STATE_EXIT = "exit";

/**
 * @typedef {{
 *   button: HTMLButtonElement | null,
 *   targetElement?: HTMLElement | null,
 *   notify?: (message: string) => void
 * }} FullScreenToggleOptions
 */

/**
 * Initialize the full-screen toggle control.
 * @param {FullScreenToggleOptions} options
 * @returns {{ dispose(): void }}
 */
export function initializeFullScreenToggle(options) {
    const { button, targetElement = document?.documentElement ?? null, notify } = options ?? {};

    if (!(button instanceof HTMLButtonElement)) {
        return createNoopController();
    }
    const fullScreenTarget = targetElement instanceof HTMLElement ? targetElement : document.documentElement;
    if (!(fullScreenTarget instanceof HTMLElement)) {
        return createNoopController();
    }
    if (!isFullScreenSupported(fullScreenTarget)) {
        hideButton(button);
        return createNoopController();
    }

    let disposed = false;
    button.hidden = false;
    button.removeAttribute("aria-hidden");
    button.type = "button";
    button.dataset.fullscreenState = STATE_ENTER;

    const updateAppearance = () => {
        if (disposed) {
            return;
        }
        const isFullScreen = isElementFullScreen(fullScreenTarget);
        const nextLabel = isFullScreen ? LABEL_EXIT_FULL_SCREEN : LABEL_ENTER_FULL_SCREEN;
        button.dataset.fullscreenState = isFullScreen ? STATE_EXIT : STATE_ENTER;
        button.setAttribute("aria-label", nextLabel);
        button.setAttribute("title", nextLabel);
        button.setAttribute("aria-pressed", isFullScreen ? "true" : "false");
    };

    const handleFullScreenChange = () => {
        updateAppearance();
    };

    const handleClick = async (event) => {
        event.preventDefault();
        if (disposed) {
            return;
        }
        try {
            if (isElementFullScreen(fullScreenTarget)) {
                await exitFullScreen();
            } else {
                await requestFullScreen(fullScreenTarget);
            }
        } catch (error) {
            logging.error("Failed to toggle full screen state", error);
            if (typeof notify === "function") {
                notify(MESSAGE_FULLSCREEN_TOGGLE_FAILED);
            }
        }
    };

    button.addEventListener("click", handleClick);
    document.addEventListener(FULLSCREEN_CHANGE_EVENT, handleFullScreenChange);
    updateAppearance();

    return {
        dispose() {
            if (disposed) {
                return;
            }
            disposed = true;
            document.removeEventListener(FULLSCREEN_CHANGE_EVENT, handleFullScreenChange);
            button.removeEventListener("click", handleClick);
        }
    };
}

/**
 * @returns {{ dispose(): void }}
 */
function createNoopController() {
    return Object.freeze({
        dispose() {
            // noop
        }
    });
}

/**
 * @param {HTMLButtonElement} button
 * @returns {void}
 */
function hideButton(button) {
    button.hidden = true;
    button.setAttribute("aria-hidden", "true");
    button.dataset.fullscreenState = STATE_ENTER;
    button.setAttribute("aria-pressed", "false");
}

/**
 * @param {HTMLElement} element
 * @returns {boolean}
 */
function isFullScreenSupported(element) {
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
function isElementFullScreen(element) {
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
