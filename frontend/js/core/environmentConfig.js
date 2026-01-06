// @ts-check

export const ENVIRONMENT_PRODUCTION = "production";
export const ENVIRONMENT_DEVELOPMENT = "development";

export const DEVELOPMENT_BACKEND_BASE_URL = "http://localhost:8080";
export const DEVELOPMENT_LLM_PROXY_URL = "http://computercat:8081/v1/gravity/classify";
export const DEVELOPMENT_AUTH_BASE_URL = "http://localhost:8082";
export const DEVELOPMENT_AUTH_TENANT_ID = "";

// Production URLs are loaded from runtime.config.production.json - no hardcoded fallbacks
export const PRODUCTION_ENVIRONMENT_CONFIG = Object.freeze({
    backendBaseUrl: "",
    llmProxyUrl: "",
    authBaseUrl: "",
    authTenantId: ""
});

export const DEVELOPMENT_ENVIRONMENT_CONFIG = Object.freeze({
    backendBaseUrl: DEVELOPMENT_BACKEND_BASE_URL,
    llmProxyUrl: DEVELOPMENT_LLM_PROXY_URL,
    authBaseUrl: DEVELOPMENT_AUTH_BASE_URL,
    authTenantId: DEVELOPMENT_AUTH_TENANT_ID
});

export const ENVIRONMENT_CONFIG = Object.freeze({
    [ENVIRONMENT_PRODUCTION]: PRODUCTION_ENVIRONMENT_CONFIG,
    [ENVIRONMENT_DEVELOPMENT]: DEVELOPMENT_ENVIRONMENT_CONFIG
});
