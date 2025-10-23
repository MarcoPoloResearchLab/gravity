// @ts-check

/** @type {Console['error']} */
const consoleError = (...args) => console.error(...args);
/** @type {Console['warn']} */
const consoleWarn = (...args) => console.warn(...args);
/** @type {Console['info']} */
const consoleInfo = (...args) => console.info(...args);

export const logging = Object.freeze({
    error: consoleError,
    warn: consoleWarn,
    info: consoleInfo
});
