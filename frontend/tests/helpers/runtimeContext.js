let cachedContext = null;

export function clearRuntimeContextCache() {
    cachedContext = null;
}

export function readRuntimeContext() {
    if (cachedContext) {
        return cachedContext;
    }
    const context = Reflect.get(globalThis, "__gravityRuntimeContext");
    if (!context || typeof context !== "object") {
        throw new Error("Runtime context unavailable: globalThis.__gravityRuntimeContext is not set.");
    }
    cachedContext = context;
    return cachedContext;
}
