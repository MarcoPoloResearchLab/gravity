// @ts-check

export const appConfig = Object.freeze({
    timezone: "America/Los_Angeles",
    llmProxyBaseUrl: "https://llm-proxy.mprlab.com",
    classifyPath: "/v1/gravity/classify",
    classificationTimeoutMs: 5000,
    defaultPrivacy: "private",
    storageKey: "gravityNotesData", // single, current key
    useMarkdownEditor: false // feature flag for EasyMDE-based editor
});
