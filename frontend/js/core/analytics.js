// @ts-check

import { appConfig } from "./config.js?build=2024-10-05T12:00:00Z";
import { GOOGLE_ANALYTICS_MEASUREMENT_ID } from "../constants.js?build=2024-10-05T12:00:00Z";
import { logging } from "../utils/logging.js?build=2024-10-05T12:00:00Z";

let analyticsBootstrapped = false;

/**
 * Initialize Google Analytics when the runtime environment allows it.
 * @param {{ measurementId?: string|null }} [options]
 * @returns {void}
 */
export function initializeAnalytics(options = {}) {
    if (analyticsBootstrapped) {
        return;
    }
    const measurementId = normalizeMeasurementId(options.measurementId ?? GOOGLE_ANALYTICS_MEASUREMENT_ID);
    if (!measurementId) {
        return;
    }
    if (appConfig.environment !== "production") {
        return;
    }
    if (typeof window === "undefined" || typeof document === "undefined") {
        return;
    }

    analyticsBootstrapped = true;

    const globalWindow = /** @type {typeof globalThis & { dataLayer?: any[], gtag?: (...args: any[]) => void }} */ (window);
    if (!Array.isArray(globalWindow.dataLayer)) {
        globalWindow.dataLayer = [];
    }
    if (typeof globalWindow.gtag !== "function") {
        globalWindow.gtag = function gtag(...args) {
            globalWindow.dataLayer.push(args);
        };
    }

    globalWindow.gtag("js", new Date());
    globalWindow.gtag("config", measurementId);

    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    script.onerror = (error) => {
        logging.warn("Failed to load Google Analytics", error);
    };
    document.head.appendChild(script);
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeMeasurementId(value) {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return null;
    }
    return trimmed;
}
