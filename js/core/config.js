// @ts-check

export const appConfig = Object.freeze({
    timezone: "America/Los_Angeles",
    llmProxyBaseUrl: "https://llm-proxy.mprlab.com",
    classifyPath: "/v1/gravity/classify",
    classificationTimeoutMs: 5000,
    defaultPrivacy: "private",
    storageKey: "gravityNotesData", // single, current key
    storageKeyUserPrefix: "gravityNotesData:user",
    useMarkdownEditor: false, // feature flag for EasyMDE-based editor
    googleClientId: "156684561903-4r8t8fvucfdl0o77bf978h2ug168mgur.apps.googleusercontent.com",
    backendBaseUrl: ""
});
