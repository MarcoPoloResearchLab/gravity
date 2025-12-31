// @ts-check

import { appConfig } from "./config.js?build=2024-10-05T12:00:00Z";
import { logging } from "../utils/logging.js?build=2024-10-05T12:00:00Z";
import { encodeUrlBlanks } from "../utils/url.js?build=2024-10-05T12:00:00Z";

const SCRIPT_ELEMENT_ID = "gravity-tauth-client-script";

/**
 * Ensure the TAuth tauth.js helper is loaded. Returns when the script
 * has been appended (or already present).
 * @param {{ documentRef?: Document|null, baseUrl?: string|null, tenantId?: string|null }} [options]
 * @returns {Promise<void>}
 */
export async function ensureTAuthClientLoaded(options = {}) {
    if (typeof window === "undefined") {
        return;
    }
    const doc = options.documentRef ?? window.document ?? null;
    if (!doc) {
        return;
    }
    if (doc.getElementById(SCRIPT_ELEMENT_ID)) {
        return;
    }
    const authBaseUrl = normalizeUrl(options.baseUrl ?? appConfig.authBaseUrl);
    const tenantId = normalizeTenantId(options.tenantId ?? appConfig.authTenantId);
    if (!authBaseUrl) {
        logging.warn("TAuth authBaseUrl missing; skipping auth-client injection.");
        return;
    }

    const script = doc.createElement("script");
    script.id = SCRIPT_ELEMENT_ID;
    script.defer = true;
    script.src = `${authBaseUrl.replace(/\/+$/u, "")}/tauth.js`;
    if (tenantId) {
        script.setAttribute("data-tenant-id", tenantId);
    }

    await new Promise((resolve, reject) => {
        script.addEventListener("load", () => resolve(undefined), { once: true });
        script.addEventListener("error", (event) => {
            logging.error("Failed to load TAuth tauth.js", event);
            doc.getElementById(SCRIPT_ELEMENT_ID)?.remove();
            reject(new Error("tauth-client-load-failed"));
        }, { once: true });
        doc.head?.appendChild(script) ?? doc.body?.appendChild(script);
    }).catch(() => {
        // Already logged the failure above.
    });
}

/**
 * Normalize a URL string (trim, percent-encode blanks, and drop trailing slashes).
 * @param {unknown} value
 * @returns {string}
 */
function normalizeUrl(value) {
    if (typeof value !== "string") {
        return "";
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return "";
    }
    const encoded = encodeUrlBlanks(trimmed);
    return encoded.replace(/\/+$/u, "");
}

/**
 * Normalize a tenant identifier while preserving intentional blanks.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeTenantId(value) {
    if (value === undefined || value === null) {
        return "";
    }
    if (typeof value !== "string") {
        return "";
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return "";
    }
    return trimmed;
}
