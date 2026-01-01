// @ts-check

import { appConfig } from "./config.js?build=2024-10-05T12:00:00Z";
import { logging } from "../utils/logging.js?build=2024-10-05T12:00:00Z";

const SCRIPT_ELEMENT_ID = "gravity-tauth-client-script";
const SCRIPT_TAG_NAME = "script";
const SCRIPT_EVENT_LOAD = "load";
const SCRIPT_EVENT_ERROR = "error";
const SCRIPT_TAUTH_PATH = "/tauth.js";
const DATA_TENANT_ATTRIBUTE = "data-tenant-id";

const TYPE_UNDEFINED = "undefined";
const TYPE_STRING = "string";

const ERROR_MESSAGES = Object.freeze({
    MISSING_WINDOW: "tauth_client.missing_window",
    MISSING_DOCUMENT: "tauth_client.missing_document",
    MISSING_BASE_URL: "tauth_client.missing_base_url",
    INVALID_TENANT_ID: "tauth_client.invalid_tenant_id",
    LOAD_FAILED: "tauth-client-load-failed"
});

const LOG_MESSAGES = Object.freeze({
    LOAD_FAILED: "Failed to load TAuth tauth.js"
});

/**
 * Ensure the TAuth tauth.js helper is loaded. Returns when the script
 * has been appended (or already present).
 * @param {{ documentRef?: Document|null, baseUrl?: string|null, tenantId?: string|null }} [options]
 * @returns {Promise<void>}
 */
export async function ensureTAuthClientLoaded(options = {}) {
    if (typeof window === TYPE_UNDEFINED) {
        throw new Error(ERROR_MESSAGES.MISSING_WINDOW);
    }
    const doc = options.documentRef ?? window.document;
    if (!doc) {
        throw new Error(ERROR_MESSAGES.MISSING_DOCUMENT);
    }
    if (doc.getElementById(SCRIPT_ELEMENT_ID)) {
        return;
    }
    const authBaseUrl = options.baseUrl ?? appConfig.authBaseUrl;
    if (typeof authBaseUrl !== TYPE_STRING || authBaseUrl.length === 0) {
        throw new Error(ERROR_MESSAGES.MISSING_BASE_URL);
    }
    const tenantId = options.tenantId ?? appConfig.authTenantId;
    if (tenantId !== null && tenantId !== undefined && typeof tenantId !== TYPE_STRING) {
        throw new Error(ERROR_MESSAGES.INVALID_TENANT_ID);
    }

    const script = doc.createElement(SCRIPT_TAG_NAME);
    script.id = SCRIPT_ELEMENT_ID;
    script.defer = true;
    script.src = authBaseUrl + SCRIPT_TAUTH_PATH;
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
