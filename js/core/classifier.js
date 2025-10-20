/* global fetch */
// @ts-check

import { appConfig } from "./config.js";
import { clampEnum } from "../utils/enum.js";
import { titleCase, toTagToken } from "../utils/string.js";
import {
    CLASSIFIER_ALLOWED_HANDLES,
    CLASSIFIER_CATEGORIES,
    CLASSIFIER_KNOWN_AREAS,
    CLASSIFIER_KNOWN_PROJECTS,
    CLASSIFIER_PRIVACY,
    CLASSIFIER_STATUSES
} from "../constants.js";

/**
 * Create a classifier client with an injectable fetch implementation for testing.
 * @param {{ fetchImplementation?: typeof fetch }} [options]
 */
export function createClassifierClient(options = {}) {
    const { fetchImplementation = typeof fetch === "function" ? fetch : null } = options;

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
                timezone: appConfig.timezone,
                hints: {
                    suggested_category: null,
                    known_projects: Array.from(CLASSIFIER_KNOWN_PROJECTS),
                    known_areas: Array.from(CLASSIFIER_KNOWN_AREAS),
                    allowed_handles: Array.from(CLASSIFIER_ALLOWED_HANDLES),
                    default_privacy: appConfig.defaultPrivacy
                },
                title: titleText ?? "",
                body: bodyText ?? ""
            };

            const classifyEndpointRaw = appConfig.llmProxyUrl;
            const classifyEndpoint = typeof classifyEndpointRaw === "string" ? classifyEndpointRaw.trim() : "";
            if (classifyEndpoint.length === 0) {
                return buildFallbackClassification(requestBody.now);
            }

            const aborter = new AbortController();
            const timeoutId = setTimeout(() => aborter.abort(), appConfig.classificationTimeoutMs);

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
                const privacy  = clampEnum(json.privacy, CLASSIFIER_PRIVACY, appConfig.defaultPrivacy);
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
                return buildFallbackClassification(requestBody.now);
            }
        }
    });
}

export const ClassifierClient = createClassifierClient();

/**
 * Provide a conservative local classification when the proxy is unavailable.
 * @param {string} referenceIso
 * @returns {import("../types.d.js").NoteClassification}
 */
function buildFallbackClassification(referenceIso) {
    const occurredAt = typeof referenceIso === "string" && referenceIso.length > 0
        ? referenceIso
        : new Date().toISOString();
    return {
        category: "Journal",
        project_name: null,
        areas: [],
        people_handles: [],
        status: "idea",
        privacy: appConfig.defaultPrivacy,
        tags: [],
        occurred_at: occurredAt
    };
}
