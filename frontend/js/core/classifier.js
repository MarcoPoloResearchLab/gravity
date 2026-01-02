/* global fetch */
// @ts-check

import { clampEnum } from "../utils/enum.js?build=2026-01-01T22:43:21Z";
import { titleCase, toTagToken } from "../utils/string.js?build=2026-01-01T22:43:21Z";
import {
    CLASSIFIER_ALLOWED_HANDLES,
    CLASSIFIER_CATEGORIES,
    CLASSIFIER_KNOWN_AREAS,
    CLASSIFIER_KNOWN_PROJECTS,
    CLASSIFIER_PRIVACY,
    CLASSIFIER_STATUSES
} from "../constants.js?build=2026-01-01T22:43:21Z";

const TYPE_FUNCTION = "function";

const ERROR_MESSAGES = Object.freeze({
    MISSING_CONFIG: "classifier.missing_config"
});

/**
 * Create a classifier client with an injectable fetch implementation for testing.
 * @param {{ config: import("./config.js").AppConfig, fetchImplementation?: typeof fetch }} options
 */
export function createClassifierClient(options) {
    if (!options || typeof options !== "object") {
        throw new Error(ERROR_MESSAGES.MISSING_CONFIG);
    }
    const { config, fetchImplementation = typeof fetch === TYPE_FUNCTION ? fetch : null } = options;
    if (!config) {
        throw new Error(ERROR_MESSAGES.MISSING_CONFIG);
    }

    return Object.freeze({
        /**
         * Submit content to the remote classifier and fall back to conservative defaults on failure.
         * @param {string} titleText
         * @param {string} bodyText
         * @returns {Promise<import("../types.d.js").NoteClassification>}
         */
        async classifyOrFallback(titleText, bodyText) {
            const requestBody = {
                now: new Date().toISOString(),
                timezone: config.timezone,
                hints: {
                    suggested_category: null,
                    known_projects: Array.from(CLASSIFIER_KNOWN_PROJECTS),
                    known_areas: Array.from(CLASSIFIER_KNOWN_AREAS),
                    allowed_handles: Array.from(CLASSIFIER_ALLOWED_HANDLES),
                    default_privacy: config.defaultPrivacy
                },
                title: titleText ?? "",
                body: bodyText ?? ""
            };

            const classifyEndpointRaw = config.llmProxyUrl;
            const classifyEndpoint = typeof classifyEndpointRaw === "string" ? classifyEndpointRaw.trim() : "";
            if (classifyEndpoint.length === 0) {
                return buildFallbackClassification(requestBody.now, config.defaultPrivacy);
            }

            const aborter = new AbortController();
            const timeoutId = setTimeout(() => aborter.abort(), config.classificationTimeoutMs);

            try {
                if (!fetchImplementation) throw new Error("No fetch implementation available");
                const res = await fetchImplementation(classifyEndpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(requestBody),
                    signal: aborter.signal
                });
                clearTimeout(timeoutId);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();

                const category = clampEnum(json.category, CLASSIFIER_CATEGORIES, "Journal");
                const status   = clampEnum(json.status, CLASSIFIER_STATUSES, "idea");
                const privacy  = clampEnum(json.privacy, CLASSIFIER_PRIVACY, config.defaultPrivacy);
                const occurredAt = (typeof json.occurred_at === "string") ? json.occurred_at : requestBody.now;

                return {
                    category,
                    project_name: json.project_name ?? null,
                    areas: Array.isArray(json.areas) ? json.areas.map(titleCase) : [],
                    people_handles: Array.isArray(json.people_handles)
                        ? json.people_handles.filter(v => typeof v === "string" && v.startsWith("@"))
                        : [],
                    status,
                    privacy,
                    tags: Array.isArray(json.tags) ? json.tags.map(toTagToken).filter(Boolean).slice(0, 8) : [],
                    occurred_at: occurredAt
                };
            } catch {
                clearTimeout(timeoutId);
                return buildFallbackClassification(requestBody.now, config.defaultPrivacy);
            }
        }
    });
}

/**
 * Provide a conservative local classification when the proxy is unavailable.
 * @param {string} referenceIso
 * @param {string} defaultPrivacy
 * @returns {import("../types.d.js").NoteClassification}
 */
function buildFallbackClassification(referenceIso, defaultPrivacy) {
    const occurredAt = typeof referenceIso === "string" && referenceIso.length > 0
        ? referenceIso
        : new Date().toISOString();
    return {
        category: "Journal",
        project_name: null,
        areas: [],
        people_handles: [],
        status: "idea",
        privacy: defaultPrivacy,
        tags: [],
        occurred_at: occurredAt
    };
}
