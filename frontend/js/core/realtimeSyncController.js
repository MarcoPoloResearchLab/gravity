// @ts-check

import {
    REALTIME_EVENT_HEARTBEAT,
    REALTIME_EVENT_NOTE_CHANGE,
    REALTIME_SOURCE_BACKEND
} from "../constants.js?build=2026-01-01T22:43:21Z";
import { logging } from "../utils/logging.js?build=2026-01-01T22:43:21Z";
import { encodeUrlBlanks } from "../utils/url.js?build=2026-01-01T22:43:21Z";

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const FALLBACK_POLL_INTERVAL_MS = 3000;
/**
 * Create a realtime synchronization controller.
 * @param {{ syncManager: ReturnType<typeof import("./syncManager.js").createSyncManager>, now?: () => number }} options
 * @returns {{ connect(params: { baseUrl: string }): void, disconnect(): void, dispose(): void }}
 */
export function createRealtimeSyncController(options) {
    const syncManager = options?.syncManager ?? null;
    if (!syncManager || typeof syncManager.synchronize !== "function") {
        throw new Error("syncManager with synchronize capability required");
    }
    const now = typeof options?.now === "function" ? options.now : () => Date.now();

    /** @type {EventSource|null} */
    let source = null;
    /** @type {{ baseUrl: string }|null} */
    let activeConfig = null;
    /** @type {number|null} */
    let reconnectTimer = null;
    /** @type {number|null} */
    let pollTimer = null;
    let reconnectDelayMs = RECONNECT_BASE_DELAY_MS;

    function connect(params) {
        const baseUrl = normalizeBaseUrl(params?.baseUrl);
        if (!baseUrl) {
            return;
        }
        activeConfig = { baseUrl };
        reconnectDelayMs = RECONNECT_BASE_DELAY_MS;
        schedulePolling();
        establishConnection();
    }

    function establishConnection() {
        if (!activeConfig) {
            return;
        }
        clearReconnectTimer();
        if (source) {
            source.close();
            source = null;
        }

        try {
            const streamUrl = composeStreamUrl(activeConfig.baseUrl);
            source = new EventSource(streamUrl, { withCredentials: true });
        } catch (error) {
            logging.error("Failed to open realtime stream", error);
            scheduleReconnect();
            return;
        }

        if (!source) {
            scheduleReconnect();
            return;
        }

        source.addEventListener(REALTIME_EVENT_NOTE_CHANGE, handleNoteChangeEvent);
        source.addEventListener(REALTIME_EVENT_HEARTBEAT, handleHeartbeatEvent);
        source.onerror = () => {
            logging.error("Realtime stream encountered an error");
            scheduleReconnect();
        };
    }

    /**
     * @param {MessageEvent<string>} event
     */
    function handleNoteChangeEvent(event) {
        const payload = parseEventData(event.data);
        if (!payload || payload.source !== REALTIME_SOURCE_BACKEND) {
            return;
        }
        logging.info("Realtime note change received", payload);
        void syncManager.synchronize({ flushQueue: false });
        reconnectDelayMs = RECONNECT_BASE_DELAY_MS;
    }

    /**
     * @param {MessageEvent<string>} event
     */
    function handleHeartbeatEvent(event) {
        const payload = parseEventData(event.data);
        logging.info("Realtime heartbeat", payload);
        reconnectDelayMs = RECONNECT_BASE_DELAY_MS;
    }

    function disconnect() {
        clearReconnectTimer();
        clearPollingTimer();
        if (source) {
            source.close();
            source = null;
        }
        activeConfig = null;
    }

    function scheduleReconnect() {
        if (!activeConfig) {
            return;
        }
        if (source) {
            source.close();
            source = null;
        }
        if (reconnectTimer !== null) {
            return;
        }
        const delay = reconnectDelayMs;
        reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_DELAY_MS);
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            establishConnection();
        }, delay);
    }

    function clearReconnectTimer() {
        if (reconnectTimer !== null) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
    }

    function schedulePolling() {
        clearPollingTimer();
        pollTimer = setInterval(() => {
            if (!activeConfig) {
                return;
            }
            void syncManager.synchronize({ flushQueue: false });
        }, FALLBACK_POLL_INTERVAL_MS);
    }

    function clearPollingTimer() {
        if (pollTimer !== null) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    return Object.freeze({
        connect,
        disconnect,
        dispose: disconnect
    });
}

/**
 * @param {string} baseUrl
 * @returns {string}
 */
function composeStreamUrl(baseUrl) {
    const normalized = baseUrl.replace(/\/+$/u, "");
    return `${normalized}/notes/stream`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeBaseUrl(value) {
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
 * @param {string} raw
 * @returns {{ noteIds?: string[], timestamp?: string, source?: string }|null}
 */
function parseEventData(raw) {
    if (typeof raw !== "string" || raw.trim().length === 0) {
        return null;
    }
    try {
        return JSON.parse(raw);
    } catch (error) {
        logging.error("Failed to parse realtime payload", error);
        return null;
    }
}
