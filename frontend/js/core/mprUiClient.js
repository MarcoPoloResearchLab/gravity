// @ts-check

import { logging } from "../utils/logging.js?build=2026-01-01T22:43:21Z";

const SCRIPT_ELEMENT_ID = "gravity-mpr-ui-script";
const SCRIPT_TAG_NAME = "script";
const SCRIPT_EVENT_LOAD = "load";
const SCRIPT_EVENT_ERROR = "error";

const TYPE_OBJECT = "object";
const TYPE_UNDEFINED = "undefined";
const TYPE_STRING = "string";

const ERROR_MESSAGES = Object.freeze({
    MISSING_WINDOW: "mpr_ui.missing_window",
    MISSING_DOCUMENT: "mpr_ui.missing_document",
    MISSING_SCRIPT_URL: "mpr_ui.missing_script_url",
    LOAD_FAILED: "mpr_ui.load_failed"
});

const LOG_MESSAGES = Object.freeze({
    LOAD_FAILED: "Failed to load mpr-ui script"
});

/**
 * Ensure the mpr-ui script bundle is loaded.
 * @param {{ documentRef?: Document|null, scriptUrl: string }} options
 * @returns {Promise<void>}
 */
export async function ensureMprUiLoaded(options) {
    if (typeof window === TYPE_UNDEFINED) {
        throw new Error(ERROR_MESSAGES.MISSING_WINDOW);
    }
    if (!options || typeof options !== TYPE_OBJECT) {
        throw new Error(ERROR_MESSAGES.MISSING_SCRIPT_URL);
    }
    const doc = options.documentRef ?? window.document;
    if (!doc) {
        throw new Error(ERROR_MESSAGES.MISSING_DOCUMENT);
    }
    if (doc.getElementById(SCRIPT_ELEMENT_ID)) {
        return;
    }
    const scriptUrl = options.scriptUrl;
    if (typeof scriptUrl !== TYPE_STRING || scriptUrl.length === 0) {
        throw new Error(ERROR_MESSAGES.MISSING_SCRIPT_URL);
    }

    const script = doc.createElement(SCRIPT_TAG_NAME);
    script.id = SCRIPT_ELEMENT_ID;
    script.defer = true;
    script.src = scriptUrl;

    await new Promise((resolve, reject) => {
        script.addEventListener(SCRIPT_EVENT_LOAD, () => resolve(undefined), { once: true });
        script.addEventListener(SCRIPT_EVENT_ERROR, (event) => {
            logging.error(LOG_MESSAGES.LOAD_FAILED, event);
            doc.getElementById(SCRIPT_ELEMENT_ID)?.remove();
            reject(new Error(ERROR_MESSAGES.LOAD_FAILED));
        }, { once: true });
        doc.head.appendChild(script);
    });
}
