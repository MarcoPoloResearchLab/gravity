import { appConfig } from "./config.js";
import { clampEnum, titleCase, toTagToken } from "./utils.js";

export const ClassifierClient = (() => {
    async function classifyOrFallback(titleText, bodyText) {
        const requestBody = {
            now: new Date().toISOString(),
            timezone: appConfig.timezone,
            hints: {
                suggested_category: null,
                known_projects: ["Moving Maps", "Blanket"],
                known_areas: ["Finance", "Infra", "Health", "Family Ops"],
                allowed_handles: ["@self", "@alice", "@peter", "@nat"],
                default_privacy: appConfig.defaultPrivacy
            },
            title: titleText ?? "",
            body: bodyText ?? ""
        };

        const aborter = new AbortController();
        const timeoutId = setTimeout(() => aborter.abort(), appConfig.classificationTimeoutMs);

        try {
            const res = await fetch(`${appConfig.llmProxyBaseUrl}${appConfig.classifyPath}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestBody),
                signal: aborter.signal
            });
            clearTimeout(timeoutId);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();

            const category = clampEnum(json.category, ["Projects","Areas","Knowledge","Journal","Content","People"], "Journal");
            const status   = clampEnum(json.status,   ["idea","draft","final","published","blocked"], "idea");
            const privacy  = clampEnum(json.privacy,  ["private","shareable","public"], appConfig.defaultPrivacy);
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
            // Conservative fallback; user can reclassify later if needed.
            return {
                category: "Journal",
                project_name: null,
                areas: [],
                people_handles: [],
                status: "idea",
                privacy: appConfig.defaultPrivacy,
                tags: [],
                occurred_at: new Date().toISOString()
            };
        }
    }

    return { classifyOrFallback };
})();
