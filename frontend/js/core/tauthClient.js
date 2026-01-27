// @ts-check

import { APP_BUILD_ID } from "../constants.js?build=2026-01-01T22:43:21Z";
import { logging } from "../utils/logging.js?build=2026-01-01T22:43:21Z";

const SCRIPT_ELEMENT_ID = "gravity-tauth-client-script";
const SCRIPT_TAG_NAME = "script";
const SCRIPT_EVENT_LOAD = "load";
const SCRIPT_EVENT_ERROR = "error";
const DATA_TENANT_ATTRIBUTE = "data-tenant-id";

const TYPE_OBJECT = "object";
const TYPE_UNDEFINED = "undefined";
const TYPE_STRING = "string";

const ERROR_MESSAGES = Object.freeze({
    MISSING_WINDOW: "tauth_client.missing_window",
    MISSING_DOCUMENT: "tauth_client.missing_document",
    MISSING_BASE_URL: "tauth_client.missing_base_url",
    MISSING_SCRIPT_URL: "tauth_client.missing_script_url",
    INVALID_TENANT_ID: "tauth_client.invalid_tenant_id",
    LOAD_FAILED: "tauth-client-load-failed"
});

const LOG_MESSAGES = Object.freeze({
    LOAD_FAILED: "Failed to load TAuth tauth.js"
});

/**
 * Ensure the TAuth tauth.js helper is loaded. Returns when the script
 * has been appended (or already present).
 * @param {{ documentRef?: Document|null, baseUrl: string, scriptUrl: string, tenantId?: string|null }} options
 * @returns {Promise<void>}
 */
export async function ensureTAuthClientLoaded(options) {
    if (typeof window === TYPE_UNDEFINED) {
        throw new Error(ERROR_MESSAGES.MISSING_WINDOW);
    }
    if (!options || typeof options !== TYPE_OBJECT) {
        throw new Error(ERROR_MESSAGES.MISSING_BASE_URL);
    }
    const doc = options.documentRef ?? window.document;
    if (!doc) {
        throw new Error(ERROR_MESSAGES.MISSING_DOCUMENT);
    }
    if (doc.getElementById(SCRIPT_ELEMENT_ID)) {
        return;
    }
    const authBaseUrl = options.baseUrl;
    if (typeof authBaseUrl !== TYPE_STRING || authBaseUrl.length === 0) {
        throw new Error(ERROR_MESSAGES.MISSING_BASE_URL);
    }
    const scriptSource = options.scriptUrl;
    if (typeof scriptSource !== TYPE_STRING || scriptSource.length === 0) {
        throw new Error(ERROR_MESSAGES.MISSING_SCRIPT_URL);
    }
    const tenantId = options.tenantId ?? null;
    if (tenantId !== null && tenantId !== undefined && typeof tenantId !== TYPE_STRING) {
        throw new Error(ERROR_MESSAGES.INVALID_TENANT_ID);
    }

    const scriptUrl = new URL(scriptSource, authBaseUrl);
    if (typeof APP_BUILD_ID === TYPE_STRING && APP_BUILD_ID.length > 0) {
        scriptUrl.searchParams.set("build", APP_BUILD_ID);
    }

    const script = doc.createElement(SCRIPT_TAG_NAME);
    script.id = SCRIPT_ELEMENT_ID;
    script.defer = true;
    script.src = scriptUrl.toString();
    if (tenantId !== null && tenantId !== undefined) {
        script.setAttribute(DATA_TENANT_ATTRIBUTE, tenantId);
    }

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
