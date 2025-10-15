// @ts-check

import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_KILL_GRACE_MS = 5000;
const TERMINATION_REASON_EXIT = "exit";
const TERMINATION_REASON_TIMEOUT = "timeout";
const SUCCESS_EXIT_CODE = 0;
const FAILURE_EXIT_CODE = 1;
const TIMEOUT_EXIT_CODE = 124;
const ANSI_CODES = Object.freeze({
    reset: "\u001B[0m",
    bold: "\u001B[1m",
    dim: "\u001B[2m",
    red: "\u001B[31m",
    green: "\u001B[32m",
    yellow: "\u001B[33m",
    cyan: "\u001B[36m"
});

function shouldUseColor() {
    const noColor = process.env.NO_COLOR;
    if (typeof noColor === "string" && noColor.length > 0 && noColor !== "0") {
        return false;
    }
    const force = process.env.FORCE_COLOR;
    if (typeof force === "string" && force.length > 0) {
        return force !== "0";
    }
    if (typeof process.stdout !== "undefined" && typeof process.stdout.isTTY === "boolean") {
        return process.stdout.isTTY;
    }
    return true;
}

const COLORS_ENABLED = shouldUseColor();

function wrapWith(code, text) {
    if (!COLORS_ENABLED || !code) {
        return text;
    }
    return `${code}${text}${ANSI_CODES.reset}`;
}

function createWrapper(code) {
    return (text) => wrapWith(code, text);
}

export const cliColors = Object.freeze({
    enabled: COLORS_ENABLED,
    bold: createWrapper(ANSI_CODES.bold),
    dim: createWrapper(ANSI_CODES.dim),
    green: createWrapper(ANSI_CODES.green),
    red: createWrapper(ANSI_CODES.red),
    yellow: createWrapper(ANSI_CODES.yellow),
    cyan: createWrapper(ANSI_CODES.cyan),
    plain: (text) => text,
    symbols: Object.freeze({
        pass: wrapWith(ANSI_CODES.green, "✔"),
        fail: wrapWith(ANSI_CODES.red, "✖"),
        timeout: wrapWith(ANSI_CODES.yellow, "⏱"),
        section: wrapWith(ANSI_CODES.cyan, "▶")
    })
});

/**
 * @param {{
 *   command: string,
 *   args?: string[],
 *   cwd?: string,
 *   env?: NodeJS.ProcessEnv,
 *   timeoutMs?: number,
 *   killGraceMs?: number,
 *   onStdout?: (chunk: string) => void,
 *   onStderr?: (chunk: string) => void
 * }} options
 * @returns {Promise<{
 *   exitCode: number | null,
 *   signal: NodeJS.Signals | null,
 *   stdout: string,
 *   stderr: string,
 *   timedOut: boolean,
 *   durationMs: number,
 *   terminationReason: string
 * }>}
 */
export function runTestProcess(options) {
    const {
        command,
        args = [],
        cwd,
        env,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        killGraceMs = DEFAULT_KILL_GRACE_MS,
        onStdout,
        onStderr
    } = options;

    if (typeof command !== "string" || command.length === 0) {
        return Promise.reject(new Error("command must be a non-empty string"));
    }

    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            env: env ? { ...process.env, ...env } : process.env,
            stdio: ["ignore", "pipe", "pipe"]
        });

        let stdout = "";
        let stderr = "";
        let timedOut = false;
        let timeoutTimer = null;
        let killTimer = null;
        let terminationReason = TERMINATION_REASON_EXIT;
        const start = performance.now();

        const safeClearTimer = (timer) => {
            if (timer) {
                clearTimeout(timer);
            }
        };

        const cleanup = () => {
            safeClearTimer(timeoutTimer);
            safeClearTimer(killTimer);
        };

        const finalize = (exitCode, signal) => {
            cleanup();
            const durationMs = performance.now() - start;
            resolve({
                exitCode,
                signal,
                stdout,
                stderr,
                timedOut,
                durationMs,
                terminationReason
            });
        };

        const terminate = () => {
            if (child.exitCode !== null || child.signalCode !== null) {
                return;
            }
            timedOut = true;
            terminationReason = TERMINATION_REASON_TIMEOUT;
            child.kill("SIGTERM");
            killTimer = setTimeout(() => {
                if (child.exitCode === null && child.signalCode === null) {
                    child.kill("SIGKILL");
                }
            }, Number.isFinite(killGraceMs) && killGraceMs > 0 ? killGraceMs : DEFAULT_KILL_GRACE_MS);
        };

        if (child.stdout) {
            child.stdout.setEncoding("utf8");
            child.stdout.on("data", (chunk) => {
                stdout += chunk;
                if (typeof onStdout === "function") {
                    onStdout(chunk);
                }
            });
        }
        if (child.stderr) {
            child.stderr.setEncoding("utf8");
            child.stderr.on("data", (chunk) => {
                stderr += chunk;
                if (typeof onStderr === "function") {
                    onStderr(chunk);
                }
            });
        }

        child.once("error", (error) => {
            cleanup();
            reject(error);
        });

        child.once("exit", (code, signal) => {
            if (!timedOut && code === TIMEOUT_EXIT_CODE) {
                terminationReason = TERMINATION_REASON_TIMEOUT;
            }
            finalize(code, signal);
        });

        if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
            timeoutTimer = setTimeout(terminate, timeoutMs);
        }
    });
}

/**
 * @param {number} durationMs
 */
export function formatDuration(durationMs) {
    return `${durationMs.toFixed(0)}ms`;
}

export const harnessDefaults = Object.freeze({
    timeoutMs: DEFAULT_TIMEOUT_MS,
    killGraceMs: DEFAULT_KILL_GRACE_MS,
    terminationReason: Object.freeze({
        exit: TERMINATION_REASON_EXIT,
        timeout: TERMINATION_REASON_TIMEOUT
    }),
    exitCode: Object.freeze({
        success: SUCCESS_EXIT_CODE,
        failure: FAILURE_EXIT_CODE,
        timeout: TIMEOUT_EXIT_CODE
    })
});
