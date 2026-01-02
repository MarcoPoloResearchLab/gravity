// @ts-check

export const ENVIRONMENT_PRODUCTION = "production";
export const ENVIRONMENT_DEVELOPMENT = "development";

export const PRODUCTION_BACKEND_BASE_URL = "https://gravity-api.mprlab.com";
export const DEVELOPMENT_BACKEND_BASE_URL = "http://localhost:8080";
export const PRODUCTION_LLM_PROXY_URL = "https://llm-proxy.mprlab.com/v1/gravity/classify";
export const DEVELOPMENT_LLM_PROXY_URL = "http://computercat:8081/v1/gravity/classify";
export const PRODUCTION_AUTH_BASE_URL = "https://tauth.mprlab.com";
export const DEVELOPMENT_AUTH_BASE_URL = "http://localhost:8082";
export const PRODUCTION_AUTH_TENANT_ID = "gravity";
export const DEVELOPMENT_AUTH_TENANT_ID = "";

export const PRODUCTION_ENVIRONMENT_CONFIG = Object.freeze({
    backendBaseUrl: PRODUCTION_BACKEND_BASE_URL,
    llmProxyUrl: PRODUCTION_LLM_PROXY_URL,
    authBaseUrl: PRODUCTION_AUTH_BASE_URL,
    authTenantId: PRODUCTION_AUTH_TENANT_ID
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
