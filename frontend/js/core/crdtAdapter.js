// @ts-check

const YJS_CDN_URL = "https://cdn.jsdelivr.net/npm/yjs@13.6.29/+esm";

/** @type {Promise<any>|null} */
let yjsModulePromise = null;

/**
 * @returns {Promise<import("yjs")>}
 */
export async function loadYjs() {
    if (yjsModulePromise) {
        return yjsModulePromise;
    }
    if (typeof window !== "undefined" && typeof window.document !== "undefined") {
        yjsModulePromise = import(YJS_CDN_URL);
        return yjsModulePromise;
    }
    yjsModulePromise = import("yjs");
    return yjsModulePromise;
}
