import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createSign, generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    EVENT_NOTE_CREATE
} from "../js/constants.js";
import {
    ensurePuppeteerSandbox,
    cleanupPuppeteerSandbox,
    createSandboxedLaunchOptions
} from "./helpers/puppeteerEnvironment.js";
import {
    prepareFrontendPage,
    dispatchSignIn,
    waitForSyncManagerUser,
    extractSyncDebugState
} from "./helpers/syncTestUtils.js";

const SANDBOX = await ensurePuppeteerSandbox();
let puppeteerModule;
try {
    ({ default: puppeteerModule } = await import("puppeteer"));
} catch {
    puppeteerModule = null;
}

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const BACKEND_DIR = path.join(REPO_ROOT, "backend");
const PAGE_URL = `file://${path.join(REPO_ROOT, "index.html")}`;

const TEST_GOOGLE_CLIENT_ID = "gravity-test-client";
const TEST_SIGNING_SECRET = "gravity-test-signing-secret";
const TEST_USER_ID = "integration-sync-user";
const GLOBAL_TIMEOUT_MS = readPositiveInteger(process.env.GRAVITY_TEST_TIMEOUT_MS, 30000);
const BACKEND_SYNC_TEST_TIMEOUT_MS = GLOBAL_TIMEOUT_MS;
const BACKEND_PROCESS_FORCE_KILL_TIMEOUT_MS = Math.max(2000, Math.min(5000, Math.floor(GLOBAL_TIMEOUT_MS / 6)));
const PUPPETEER_WAIT_TIMEOUT_MS = Math.max(4000, Math.min(15000, Math.floor(GLOBAL_TIMEOUT_MS / 2)));

if (!puppeteerModule) {
    test("puppeteer unavailable", () => {
        test.skip("Puppeteer is not installed in this environment.");
    });
} else {
    const executablePath = typeof puppeteerModule.executablePath === "function"
        ? puppeteerModule.executablePath()
        : undefined;
    if (typeof executablePath === "string" && executablePath.length > 0) {
        process.env.PUPPETEER_EXECUTABLE_PATH = executablePath;
    }

    test.describe("Backend sync integration", () => {
        /** @type {import('puppeteer').Browser?} */
        let browser = null;
        /** @type {{ close: () => Promise<void>, url: string, tokenFactory: () => string }|null} */
        let backendContext = null;

        test.before(async () => {
            const rsaKeys = generateRsaKeyPair();
            const jwksServer = await startJwksServer(rsaKeys.jwk);

            const backendPort = await getAvailablePort();
            const backendAddress = `127.0.0.1:${backendPort}`;
            const jwksUrl = `${jwksServer.url}/oauth2/v3/certs`;
            const databasePath = await createTempDatabasePath();
            const backendProcess = await startBackendProcess({
                address: backendAddress,
                jwksUrl,
                databasePath
            });

            let backendClosed = false;
            let backendClosingPromise = null;
            let jwksClosed = false;
            const databaseDirectory = path.dirname(databasePath);

            async function shutdownBackend() {
                if (backendClosed) {
                    return backendClosingPromise;
                }
                backendClosed = true;
                backendClosingPromise = (async () => {
                    try {
                        if (backendProcess.exitCode === null && backendProcess.signalCode === null) {
                            backendProcess.kill("SIGTERM");
                            const forceKillTimer = setTimeout(() => {
                                if (backendProcess.exitCode === null && backendProcess.signalCode === null) {
                                    backendProcess.kill("SIGKILL");
                                }
                            }, BACKEND_PROCESS_FORCE_KILL_TIMEOUT_MS);
                            try {
                                await once(backendProcess, "exit");
                            } finally {
                                clearTimeout(forceKillTimer);
                            }
                        }
                    } finally {
                        if (!jwksClosed) {
                            jwksClosed = true;
                            await jwksServer.close();
                        }
                        await fs.rm(databaseDirectory, { recursive: true, force: true }).catch(() => {});
                    }
                })();
                return backendClosingPromise;
            }

            backendContext = {
                process: backendProcess,
                url: `http://${backendAddress}`,
                tokenFactory: () => createSignedGoogleToken({
                    audience: TEST_GOOGLE_CLIENT_ID,
                    subject: TEST_USER_ID,
                    privateKey: rsaKeys.privateKey,
                    keyId: rsaKeys.keyId,
                    issuer: "https://accounts.google.com"
                }),
                async close() {
                    await shutdownBackend();
                }
            };
            const launchOptions = createSandboxedLaunchOptions(SANDBOX);
            browser = await puppeteerModule.launch(launchOptions);
        });

        test.after(async () => {
            if (browser) {
                await browser.close();
            }
            if (backendContext) {
                await backendContext.close();
            }
            await cleanupPuppeteerSandbox(SANDBOX);
            process.nextTick(() => process.exit(0));
        });

        test("flushes notes to the backend over HTTP", async (t) => {
            assert.ok(browser, "browser must be available");
            assert.ok(backendContext, "backend must be initialised");

            const deadline = createTestDeadline(t, BACKEND_SYNC_TEST_TIMEOUT_MS);
            const deadlineSignal = deadline.signal;
            let page = null;

            const abortHandler = () => {
                if (page) {
                    page.close().catch(() => {});
                }
                backendContext?.close().catch(() => {});
            };
            deadlineSignal.addEventListener("abort", abortHandler, { once: true });

            const backendUrl = backendContext.url;
            page = await raceWithSignal(deadlineSignal, prepareFrontendPage(browser, PAGE_URL, {
                backendBaseUrl: backendUrl,
                llmProxyClassifyUrl: backendUrl
            }));
            page.on("console", (message) => {
                if (message.type() === "error") {
                    console.error(message.text());
                }
            });
            try {
                const credential = backendContext.tokenFactory();
                await raceWithSignal(deadlineSignal, dispatchSignIn(page, credential, TEST_USER_ID));
                await page.evaluate(async ({ userId, token }) => {
                    const root = document.querySelector("[x-data]");
                    if (!root) {
                        throw new Error("root component not found");
                    }
                    const alpineComponent = (() => {
                        const legacy = /** @type {{ $data?: Record<string, any> }} */ (/** @type {any} */ (root).__x ?? null);
                        if (legacy && typeof legacy.$data === "object") {
                            return legacy.$data;
                        }
                        const alpine = typeof window !== "undefined" ? /** @type {{ $data?: (el: Element) => any }} */ (window.Alpine ?? null) : null;
                        if (alpine && typeof alpine.$data === "function") {
                            const scoped = alpine.$data(root);
                            if (scoped && typeof scoped === "object") {
                                return scoped;
                            }
                        }
                        const stack = /** @type {Array<Record<string, any>>|undefined} */ (/** @type {any} */ (root)._x_dataStack);
                        if (Array.isArray(stack) && stack.length > 0) {
                            const candidate = stack[stack.length - 1];
                            if (candidate && typeof candidate === "object") {
                                return candidate;
                            }
                        }
                        return null;
                    })();
                    const syncManager = alpineComponent?.syncManager;
                    if (!syncManager || typeof syncManager.handleSignIn !== "function") {
                        throw new Error("sync manager not ready");
                    }
                    await syncManager.handleSignIn({ userId, credential: token });
                }, { userId: TEST_USER_ID, token: credential });
                const debugStateBeforeWait = await extractSyncDebugState(page);
                try {
                    await raceWithSignal(
                        deadlineSignal,
                        waitForSyncManagerUser(page, TEST_USER_ID)
                    );
                } catch (error) {
                    const diagnostics = await page.evaluate(() => {
                        const root = document.querySelector("[x-data]");
                        const alpine = root ? /** @type {{ $data?: Record<string, unknown> }} */ (root.__x ?? null) : null;
                        const dataKeys = alpine && typeof alpine.$data === "object"
                            ? Object.keys(alpine.$data)
                            : null;
                        return {
                            hasRoot: Boolean(root),
                            hasAlpine: Boolean(alpine),
                            dataKeys,
                            htmlSnippet: root ? root.outerHTML.slice(0, 200) : null
                        };
                    });
                    console.error("sync manager user wait failed", diagnostics);
                    throw error;
                }
                const noteId = "backend-sync-note";
                const timestampIso = new Date().toISOString();
                await raceWithSignal(deadlineSignal, dispatchNoteCreate(page, {
                    noteId,
                    markdownText: "Integration test note",
                    timestampIso
                }));
                const debugState = await raceWithSignal(deadlineSignal, extractSyncDebugState(page));
                assert.ok(debugState, "sync manager debug state available");
                assert.ok(debugState.backendToken && debugState.backendToken.accessToken, "backend token captured");

                const backendNotes = await raceWithSignal(
                    deadlineSignal,
                    waitForBackendNote({
                        backendUrl,
                        token: debugState.backendToken.accessToken,
                        noteId,
                        timeoutMs: PUPPETEER_WAIT_TIMEOUT_MS
                    })
                );
                assert.ok(backendNotes, "backend returned payload with notes");
            } finally {
                deadlineSignal.removeEventListener("abort", abortHandler);
                deadline.cancel();
                if (page) {
                    try {
                        await page.close();
                    } catch {}
                }
            }
        });
    });
}

function generateRsaKeyPair() {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048
    });
    const jwk = publicKey.export({ format: "jwk" });
    const keyId = "gravity-test-key";
    return {
        privateKey,
        jwk: {
            ...jwk,
            kid: keyId,
            use: "sig",
            alg: "RS256"
        },
        keyId
    };
}

async function startJwksServer(jwk) {
    const server = http.createServer((req, res) => {
        if (req.url === "/oauth2/v3/certs") {
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ keys: [jwk] }));
            return;
        }
        res.statusCode = 404;
        res.end("not found");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = /** @type {{ port: number }} */ (server.address());
    return {
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((resolve) => server.close(() => resolve()))
    };
}

async function startBackendProcess({ address, jwksUrl, databasePath }) {
    const args = [
        "run",
        "./cmd/gravity-api",
        "--http-address", address,
        "--google-client-id", TEST_GOOGLE_CLIENT_ID,
        "--google-jwks-url", jwksUrl,
        "--database-path", databasePath,
        "--signing-secret", TEST_SIGNING_SECRET,
        "--log-level", "info"
    ];
    const child = spawn("go", args, {
        cwd: BACKEND_DIR,
        stdio: ["ignore", "pipe", "pipe"]
    });
    const backendLogs = [];
    if (child.stdout) {
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            backendLogs.push({ stream: "stdout", message: chunk });
            process.stderr.write(`[backend stdout] ${chunk}`);
        });
    }
    if (child.stderr) {
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => {
            backendLogs.push({ stream: "stderr", message: chunk });
            process.stderr.write(`[backend stderr] ${chunk}`);
        });
    }

    let resolved = false;
    const startup = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                reject(new Error("backend startup timed out"));
            }
        }, 20000);

        const handleOutput = (chunk) => {
            const text = chunk.toString();
            if (!resolved && text.includes("server starting")) {
                resolved = true;
                clearTimeout(timeout);
                child.stdout.off("data", handleOutput);
                resolve(null);
            }
        };

        child.stdout.on("data", handleOutput);
        child.stderr.on("data", (chunk) => {
            if (!resolved) {
                const text = chunk.toString();
                if (text.includes("server starting")) {
                    resolved = true;
                    clearTimeout(timeout);
                    child.stdout.off("data", handleOutput);
                    resolve(null);
                }
            }
        });

        child.once("exit", (code, signal) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                reject(new Error(`backend exited during startup (code=${code}, signal=${signal})`));
            }
        });
    });

    await startup;
    child.backendLogs = backendLogs;
    return child;
}

async function getAvailablePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(0, "127.0.0.1", () => {
            const address = /** @type {{ port: number }} */ (server.address());
            const port = address.port;
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(port);
            });
        });
        server.on("error", reject);
    });
}

async function createTempDatabasePath() {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gravity-backend-"));
    return path.join(tmpDir, "gravity.db");
}

function createSignedGoogleToken({ audience, subject, issuer, privateKey, keyId, expiresInSeconds = 5 * 60 }) {
    const header = {
        alg: "RS256",
        typ: "JWT",
        kid: keyId
    };
    const nowSeconds = Math.floor(Date.now() / 1000);
    const payload = {
        aud: audience,
        iss: issuer,
        sub: subject,
        exp: nowSeconds + expiresInSeconds,
        iat: nowSeconds
    };
    const encodedHeader = base64UrlEncode(Buffer.from(JSON.stringify(header), "utf8"));
    const encodedPayload = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    const signature = signer.sign(privateKey);
    const encodedSignature = base64UrlEncode(signature);
    return `${signingInput}.${encodedSignature}`;
}

function base64UrlEncode(buffer) {
    return Buffer.from(buffer)
        .toString("base64")
        .replace(/=+$/u, "")
        .replace(/\+/gu, "-")
        .replace(/\//gu, "_");
}

/**
 * @param {string | undefined} candidate
 * @param {number} fallback
 */
function readPositiveInteger(candidate, fallback) {
    if (!candidate) {
        return fallback;
    }
    const parsed = Number.parseInt(candidate, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}

function createTestDeadline(testContext, timeoutMs) {
    const controller = new AbortController();
    const handleAbort = () => {
        if (!controller.signal.aborted) {
            controller.abort(new Error("Test aborted"));
        }
    };
    testContext.signal.addEventListener("abort", handleAbort, { once: true });
    const timer = setTimeout(() => {
        if (!controller.signal.aborted) {
            controller.abort(new Error(`Test exceeded ${timeoutMs}ms deadline`));
        }
    }, timeoutMs);
    return {
        signal: controller.signal,
        cancel() {
            clearTimeout(timer);
            testContext.signal.removeEventListener?.("abort", handleAbort);
        }
    };
}

function raceWithSignal(signal, candidate) {
    if (!signal) {
        return Promise.resolve(candidate);
    }
    if (signal.aborted) {
        const reason = signal.reason instanceof Error
            ? signal.reason
            : new Error(String(signal.reason ?? "Aborted"));
        return Promise.reject(reason);
    }
    const promise = Promise.resolve(candidate);
    return new Promise((resolve, reject) => {
        const handleAbort = () => {
            cleanup();
            const reason = signal.reason instanceof Error
                ? signal.reason
                : new Error(String(signal.reason ?? "Aborted"));
            reject(reason);
        };
        const cleanup = () => {
            signal.removeEventListener?.("abort", handleAbort);
        };
        promise.then(
            (value) => {
                cleanup();
                resolve(value);
            },
            (error) => {
                cleanup();
                reject(error);
            }
        );
        signal.addEventListener("abort", handleAbort, { once: true });
    });
}

async function dispatchNoteCreate(page, { noteId, markdownText, timestampIso }) {
    await page.evaluate((eventName, detail) => {
        const root = document.querySelector("body");
        if (!root) return;
        root.dispatchEvent(new CustomEvent(eventName, {
            detail,
            bubbles: true
        }));
    }, EVENT_NOTE_CREATE, {
        record: {
            noteId,
            markdownText,
            createdAtIso: timestampIso,
            updatedAtIso: timestampIso,
            lastActivityIso: timestampIso
        },
        storeUpdated: false,
        shouldRender: false
    });
}

function fetchBackendNotes({ backendUrl, token, timeoutMs }) {
    return new Promise((resolve, reject) => {
        try {
            const url = new URL("/notes", backendUrl);
            const request = http.request({
                method: "GET",
                hostname: url.hostname,
                port: url.port,
                path: url.pathname,
                protocol: url.protocol,
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }, (response) => {
                const chunks = [];
                response.setEncoding("utf8");
                response.on("data", (chunk) => {
                    chunks.push(chunk);
                });
                response.on("end", () => {
                    resolve({
                        statusCode: response.statusCode ?? 0,
                        body: chunks.join("")
                    });
                });
            });
            request.on("error", reject);
            request.setTimeout(timeoutMs, () => {
                request.destroy(new Error(`Backend request timed out after ${timeoutMs}ms`));
            });
            request.end();
        } catch (error) {
            reject(error);
        }
    });
}

async function waitForBackendNote({ backendUrl, token, noteId, timeoutMs }) {
    const start = Date.now();
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    while (Date.now() - start < timeoutMs) {
        const { statusCode, body } = await fetchBackendNotes({ backendUrl, token, timeoutMs });
        if (statusCode === 200) {
            try {
                const payload = JSON.parse(body);
                const notes = Array.isArray(payload?.notes) ? payload.notes : [];
                const match = notes.find((entry) => entry?.payload?.noteId === noteId);
                if (match) {
                    return payload;
                }
            } catch {
                // ignore JSON parse errors and retry
            }
        } else if (statusCode >= 400 && statusCode < 500) {
            throw new Error(`Backend responded with status ${statusCode}`);
        }
        await delay(200);
    }
    throw new Error(`Note ${noteId} did not appear in backend within ${timeoutMs}ms`);
}
