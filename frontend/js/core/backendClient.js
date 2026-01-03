// @ts-check

import { EVENT_AUTH_SIGN_OUT_REQUEST } from "../constants.js?build=2026-01-01T22:43:21Z";
import { logging } from "../utils/logging.js?build=2026-01-01T22:43:21Z";
import { encodeUrlBlanks } from "../utils/url.js?build=2026-01-01T22:43:21Z";

const HTTP_STATUS_UNAUTHORIZED = 401;
const AUTH_SIGN_OUT_REASON = "backend-unauthorized";

/**
 * @typedef {{ operation: "upsert"|"delete", note_id: string, client_edit_seq: number, client_device?: string, client_time_s?: number, created_at_s?: number, updated_at_s?: number, payload?: unknown }} SyncOperation
 */

/**
 * Create a client for interacting with the Gravity backend service.
 * @param {{ baseUrl?: string, fetchImplementation?: typeof fetch, eventTarget?: EventTarget|null }} options
 */
export function createBackendClient(options = {}) {
    const normalizedBase = normalizeBaseUrl(options.baseUrl ?? "");
    const resolveFetch = createFetchResolver(options.fetchImplementation);
    const defaultEventTarget = resolveEventTarget(typeof document !== "undefined" ? document.body : null);
    const authEventTarget = resolveEventTarget(options.eventTarget) ?? defaultEventTarget;
    let unauthorizedDispatched = false;

    return Object.freeze({
        /**
         * Submit queued operations to the backend.
         * @param {{ operations: SyncOperation[] }} params
         * @returns {Promise<{ results: Array<Record<string, unknown>> }>}
         */
        async syncOperations(params) {
            const response = await resolveFetch()(
                `${normalizedBase}/notes/sync`,
                buildFetchOptions({
                    method: "POST",
                    body: JSON.stringify({ operations: params.operations })
                })
            );
            handleUnauthorizedResponse(response);
            const payload = await parseJson(response);
            if (!response.ok) {
                throw new Error(payload?.error ?? "Failed to sync operations.");
            }
            return payload;
        },

        /**
         * Retrieve the canonical note snapshot for the active user.
         * @returns {Promise<{ notes: Array<Record<string, unknown>> }>}
         */
        async fetchSnapshot() {
            const response = await resolveFetch()(
                `${normalizedBase}/notes`,
                buildFetchOptions({
                    method: "GET"
                })
            );
            handleUnauthorizedResponse(response);
            const payload = await parseJson(response);
            if (!response.ok) {
                throw new Error(payload?.error ?? "Failed to load snapshot.");
            }
            return payload;
        }
    });

    function handleUnauthorizedResponse(response) {
        if (!response || typeof response.status !== "number") {
            return;
        }
        if (response.ok === true) {
            unauthorizedDispatched = false;
            return;
        }
        if (response.status !== HTTP_STATUS_UNAUTHORIZED) {
            return;
        }
        if (unauthorizedDispatched) {
            return;
        }
        unauthorizedDispatched = true;
        dispatchAuthSignOutRequest({
            reason: AUTH_SIGN_OUT_REASON,
            status: response.status,
            url: typeof response.url === "string" ? response.url : ""
        });
    }

    function dispatchAuthSignOutRequest(detail) {
        if (!authEventTarget || typeof authEventTarget.dispatchEvent !== "function") {
            return;
        }
        try {
            if (typeof CustomEvent === "function") {
                authEventTarget.dispatchEvent(new CustomEvent(EVENT_AUTH_SIGN_OUT_REQUEST, {
                    bubbles: true,
                    detail
                }));
                return;
            }
        } catch (error) {
            logging.error(error);
        }
        try {
            const fallbackEvent = new Event(EVENT_AUTH_SIGN_OUT_REQUEST);
            /** @type {any} */ (fallbackEvent).detail = detail;
            authEventTarget.dispatchEvent(fallbackEvent);
        } catch (error) {
            logging.error(error);
        }
    }
}

function createFetchResolver(customFetch) {
    return () => {
        if (typeof customFetch === "function") {
            return customFetch;
        }
        if (typeof globalThis !== "undefined" && typeof globalThis.apiFetch === "function") {
            return globalThis.apiFetch.bind(globalThis);
        }
        if (typeof fetch === "function") {
            return fetch.bind(globalThis);
        }
        throw new Error("Backend client requires a fetch implementation.");
    };
}

/**
 * @param {{ method?: string, headers?: Record<string, string>, body?: BodyInit | null }} init
 * @returns {RequestInit}
 */
function buildFetchOptions(init = {}) {
    const headers = { ...(init.headers ?? {}) };
    const method = typeof init.method === "string" ? init.method.toUpperCase() : "GET";
    if (method === "POST" || method === "PUT" || method === "PATCH") {
        headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    }
    return {
        ...init,
        method,
        headers,
        credentials: "include"
    };
}

/**
 * @param {Response} response
 * @returns {Promise<any>}
 */
async function parseJson(response) {
    const contentType = response.headers.get("Content-Type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
        const text = await response.text();
        if (text.length === 0) {
            return {};
        }
        try {
            return JSON.parse(text);
        } catch (error) {
            logging.error(error);
            return {};
        }
    }
    try {
        return await response.json();
    } catch (error) {
        logging.error(error);
        return {};
    }
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeBaseUrl(value) {
    if (!value) {
        return "";
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return "";
    }
    const encoded = encodeUrlBlanks(trimmed);
    return encoded.replace(/\/+$/u, "");
}

/**
 * @param {EventTarget|null|undefined} value
 * @returns {EventTarget|null}
 */
function resolveEventTarget(value) {
    if (value && typeof value.dispatchEvent === "function") {
        return value;
    }
    return null;
}
