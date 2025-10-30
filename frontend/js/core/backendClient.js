// @ts-check

import { logging } from "../utils/logging.js?build=2024-10-05T12:00:00Z";

/**
 * @typedef {{ accessToken: string, expiresIn: number }} BackendToken
 * @typedef {{ operation: "upsert"|"delete", note_id: string, client_edit_seq: number, client_device?: string, client_time_s?: number, created_at_s?: number, updated_at_s?: number, payload?: unknown }} SyncOperation
 */

/**
 * Create a client for interacting with the Gravity backend service.
 * @param {{ baseUrl?: string, fetchImplementation?: typeof fetch }} options
 */
export function createBackendClient(options = {}) {
    const {
        baseUrl = "",
        fetchImplementation = typeof fetch === "function" ? fetch : null
    } = options;

    if (!fetchImplementation) {
        throw new Error("Backend client requires a fetch implementation.");
    }

    const normalizedBase = normalizeBaseUrl(baseUrl);

    return Object.freeze({
        /**
         * Exchange a Google credential for a backend token.
         * @param {{ credential: string }} params
         * @returns {Promise<BackendToken>}
         */
        async exchangeGoogleCredential(params) {
            const response = await fetchImplementation(
                `${normalizedBase}/auth/google`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ id_token: params.credential })
                }
            );
            const payload = await parseJson(response);
            if (!response.ok) {
                throw new Error(payload?.error ?? "Failed to exchange credential.");
            }
            const accessToken = typeof payload?.access_token === "string" ? payload.access_token : null;
            const expiresIn = Number.parseInt(payload?.expires_in ?? "0", 10);
            if (!accessToken || Number.isNaN(expiresIn)) {
                throw new Error("Backend returned an invalid token response.");
            }
            return { accessToken, expiresIn };
        },

        /**
         * Submit queued operations to the backend.
         * @param {{ accessToken: string, operations: SyncOperation[] }} params
         * @returns {Promise<{ results: Array<Record<string, unknown>> }>}
         */
        async syncOperations(params) {
            const response = await fetchImplementation(
                `${normalizedBase}/notes/sync`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${params.accessToken}`
                    },
                    body: JSON.stringify({ operations: params.operations })
                }
            );
            const payload = await parseJson(response);
            if (!response.ok) {
                throw new Error(payload?.error ?? "Failed to sync operations.");
            }
            return payload;
        },

        /**
         * Retrieve the canonical note snapshot for the active user.
         * @param {{ accessToken: string }} params
         * @returns {Promise<{ notes: Array<Record<string, unknown>> }>}
         */
        async fetchSnapshot(params) {
            const response = await fetchImplementation(
                `${normalizedBase}/notes`,
                {
                    method: "GET",
                    headers: {
                        "Authorization": `Bearer ${params.accessToken}`
                    }
                }
            );
            const payload = await parseJson(response);
            if (!response.ok) {
                throw new Error(payload?.error ?? "Failed to load snapshot.");
            }
            return payload;
        }
    });
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
    const trimmed = value.trim().replace(/\/+$/u, "");
    return trimmed.length === 0 ? "" : trimmed;
}
