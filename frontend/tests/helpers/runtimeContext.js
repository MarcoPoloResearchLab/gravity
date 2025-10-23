import process from "node:process";

let cachedContext = null;
let cachedSerialized = null;

export function clearRuntimeContextCache() {
    cachedContext = null;
    cachedSerialized = null;
}

export function readRuntimeContext() {
    const raw = process.env.GRAVITY_RUNTIME_CONTEXT;
    if (typeof raw !== "string" || raw.trim().length === 0) {
        throw new Error("Runtime context unavailable: GRAVITY_RUNTIME_CONTEXT is not set.");
    }
    if (cachedContext && cachedSerialized === raw) {
        return cachedContext;
    }
    try {
        cachedContext = JSON.parse(raw);
        cachedSerialized = raw;
        return cachedContext;
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Runtime context parse failure: ${reason}`);
    }
}
