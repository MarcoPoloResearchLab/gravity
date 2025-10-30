// @ts-check

const DEFAULT_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * @typedef {{
 *   currentVersion: string,
 *   manifestUrl: string,
 *   checkIntervalMs?: number,
 *   fetchImpl?: typeof fetch,
 *   reload?: (nextVersion: string | null) => void,
 *   onVersionMismatch?: (currentVersion: string, remoteVersion: string) => void,
 *   onError?: (error: unknown) => void,
 *   autoStart?: boolean
 * }} VersionRefreshOptions
 */

/**
 * Initialize the periodic version watcher that reloads when the manifest changes.
 * @param {VersionRefreshOptions} options
 * @returns {{ dispose(): void, checkNow(): Promise<{ reloaded: boolean, remoteVersion: string|null }> }}
 */
export function initializeVersionRefresh(options) {
    const currentVersion = typeof options?.currentVersion === "string" ? options.currentVersion : "";
    const manifestUrl = typeof options?.manifestUrl === "string" ? options.manifestUrl : "";
    if (!currentVersion || !manifestUrl) {
        return createNoopController();
    }

    /** @type {typeof fetch | undefined} */
    const fetchImpl = typeof options.fetchImpl === "function"
        ? options.fetchImpl
        : typeof fetch === "function"
            ? fetch.bind(globalThis)
            : undefined;
    if (!fetchImpl) {
        return createNoopController();
    }

    const reload = typeof options.reload === "function"
        ? options.reload
        : () => {
            if (typeof window !== "undefined" && typeof window.location?.reload === "function") {
                window.location.reload();
            }
        };
    const onVersionMismatch = typeof options.onVersionMismatch === "function" ? options.onVersionMismatch : null;
    const onError = typeof options.onError === "function" ? options.onError : null;
    const checkIntervalMs = normalizeInterval(options.checkIntervalMs);
    const autoStart = options.autoStart !== false;

    let disposed = false;
    let timerId = /** @type {ReturnType<typeof setTimeout>|null} */ (null);

    const clearTimer = () => {
        if (timerId !== null) {
            clearTimeout(timerId);
            timerId = null;
        }
    };

    const checkForUpdate = async () => {
        if (disposed) {
            return { reloaded: false, remoteVersion: null };
        }
        let remoteVersion = null;
        try {
            const response = await fetchImpl(manifestUrl, { cache: "no-store" });
            if (!response || typeof response.ok !== "boolean" || !response.ok) {
                return { reloaded: false, remoteVersion: null };
            }
            const payload = await response.json();
            remoteVersion = typeof payload?.version === "string" && payload.version.trim().length > 0
                ? payload.version.trim()
                : null;
            if (remoteVersion && remoteVersion !== currentVersion) {
                if (onVersionMismatch) {
                    onVersionMismatch(currentVersion, remoteVersion);
                }
                disposed = true;
                clearTimer();
                try {
                    reload(remoteVersion);
                } catch (error) {
                    if (onError) {
                        onError(error);
                    }
                }
                return { reloaded: true, remoteVersion };
            }
        } catch (error) {
            if (onError) {
                onError(error);
            }
        }
        return { reloaded: false, remoteVersion };
    };

    const scheduleNext = () => {
        if (disposed) {
            return;
        }
        clearTimer();
        timerId = setTimeout(() => {
            void checkAndSchedule();
        }, checkIntervalMs);
    };

    const checkAndSchedule = async () => {
        const result = await checkForUpdate();
        if (!disposed && !result.reloaded) {
            scheduleNext();
        }
        return result;
    };

    if (autoStart) {
        void checkAndSchedule();
    }

    return {
        dispose() {
            if (disposed) {
                return;
            }
            disposed = true;
            clearTimer();
        },
        checkNow: () => checkAndSchedule()
    };
}

/**
 * @param {number|undefined} interval
 * @returns {number}
 */
function normalizeInterval(interval) {
    if (typeof interval !== "number" || !Number.isFinite(interval) || interval <= 0) {
        return DEFAULT_CHECK_INTERVAL_MS;
    }
    return interval;
}

/**
 * @returns {{ dispose(): void, checkNow(): Promise<{ reloaded: boolean, remoteVersion: string|null }> }}
 */
function createNoopController() {
    return {
        dispose() {
            // noop
        },
        async checkNow() {
            return { reloaded: false, remoteVersion: null };
        }
    };
}
