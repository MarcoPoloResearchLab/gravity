import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { readRuntimeContext } from "./runtimeContext.js";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
const BACKEND_DIR = path.join(REPO_ROOT, "backend");
const DEFAULT_GOOGLE_CLIENT_ID = "gravity-test-client";
const DEFAULT_SIGNING_SECRET = "gravity-test-signing-secret";
const DEFAULT_SESSION_ISSUER = "mprlab-auth";
const DEFAULT_SESSION_COOKIE = "app_session";
const isWindows = process.platform === "win32";
let backendBinaryPromise = null;

/**
 * Start a Gravity backend instance and supporting JWKS server for integration tests.
 * @param {{
 *   googleClientId?: string,
 *   signingSecret?: string,
 *   logLevel?: string
 * }} [options]
 * @returns {Promise<{
 *   baseUrl: string,
 *   googleClientId: string,
 *   tokenFactory: (userId: string, expiresInSeconds?: number) => string,
 *   close: () => Promise<void>
 * }>}
 */
let sharedBackendInstance = null;
let sharedBackendRefs = 0;

export async function startTestBackend(options = {}) {
    const normalizedOptions = {
        googleClientId: options.googleClientId ?? DEFAULT_GOOGLE_CLIENT_ID,
        signingSecret: options.signingSecret ?? DEFAULT_SIGNING_SECRET,
        issuer: options.issuer ?? DEFAULT_SESSION_ISSUER,
        cookieName: options.cookieName ?? DEFAULT_SESSION_COOKIE,
        logLevel: options.logLevel ?? "info"
    };
    const sharedContextBackend = attemptRuntimeContextBackend(normalizedOptions);
    if (sharedContextBackend) {
        return sharedContextBackend;
    }
    const instanceKey = JSON.stringify(normalizedOptions);

    if (sharedBackendInstance && sharedBackendInstance.key === instanceKey) {
        sharedBackendRefs += 1;
        return createSharedHandle(sharedBackendInstance);
    }

    if (sharedBackendInstance) {
        await disposeSharedBackend();
    }

    const binaryPath = await ensureBackendBinary();

    const backendPort = await getAvailablePort();
    const backendAddress = `127.0.0.1:${backendPort}`;
    const databasePath = await createTempDatabasePath();

    const backendProcess = await startBackendProcess({
        binaryPath,
        address: backendAddress,
        databasePath,
        signingSecret: normalizedOptions.signingSecret,
        issuer: normalizedOptions.issuer,
        cookieName: normalizedOptions.cookieName,
        logLevel: normalizedOptions.logLevel
    });
    await waitForServerReady(backendAddress);

    const databaseDirectory = path.dirname(databasePath);

    sharedBackendInstance = {
        key: instanceKey,
        baseUrl: `http://${backendAddress}`,
        googleClientId: normalizedOptions.googleClientId,
        tokenFactory(userId, expiresInSeconds = 5 * 60) {
            const sessionToken = mintSessionToken({
                userId,
                issuer: normalizedOptions.issuer,
                signingSecret: normalizedOptions.signingSecret,
                expiresInSeconds
            });
            return encodeSessionCredential({
                userId,
                expiresIn: expiresInSeconds,
                sessionToken
            });
        },
        async shutdown() {
            if (backendProcess.exitCode === null && backendProcess.signalCode === null) {
                backendProcess.kill("SIGTERM");
                const killTimer = setTimeout(() => {
                    if (backendProcess.exitCode === null && backendProcess.signalCode === null) {
                        backendProcess.kill("SIGKILL");
                    }
                }, 4000);
                try {
                    await once(backendProcess, "exit");
                } finally {
                    clearTimeout(killTimer);
                }
            }
            await fs.rm(databaseDirectory, { recursive: true, force: true }).catch(() => {});
        }
    };
    sharedBackendRefs = 1;

    return createSharedHandle(sharedBackendInstance);
}

function attemptRuntimeContextBackend(normalizedOptions) {
    let context;
    try {
        context = readRuntimeContext();
    } catch (error) {
        if (error instanceof Error && error.message.startsWith("Runtime context unavailable")) {
            return null;
        }
        throw error;
    }

    const backend = context?.backend;
    if (!backend) {
        return null;
    }

    const { baseUrl, googleClientId, signingSecret, issuer, cookieName } = backend;
    if (typeof baseUrl !== "string" || typeof signingSecret !== "string" || typeof issuer !== "string" || typeof cookieName !== "string") {
        return null;
    }
    if (normalizedOptions.googleClientId !== googleClientId) {
        return null;
    }
    if (normalizedOptions.signingSecret !== signingSecret || normalizedOptions.issuer !== issuer || normalizedOptions.cookieName !== cookieName) {
        return null;
    }

    return {
        baseUrl,
        googleClientId,
        signingSecret,
        issuer,
        cookieName,
        tokenFactory(userId, expiresInSeconds = 5 * 60) {
            const sessionToken = mintSessionToken({
                userId,
                issuer,
                signingSecret,
                expiresInSeconds
            });
            return encodeSessionCredential({
                userId,
                expiresIn: expiresInSeconds,
                sessionToken
            });
        },
        async close() {
            // shared backend is managed by the parent process; no-op for callers
        }
    };
}

/**
 * Poll the backend for notes until a matching identifier appears.
 * @param {{ backendUrl: string, token: string, noteId: string, timeoutMs?: number }} options
 * @returns {Promise<any>}
 */
export async function waitForBackendNote({ backendUrl, token, noteId, timeoutMs }) {
    const resolvedTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 20000;
    const deadline = Date.now() + resolvedTimeout;
    while (Date.now() < deadline) {
        const { statusCode, body } = await fetchBackendNotes({ backendUrl, token, timeoutMs: resolvedTimeout });
        if (statusCode === 200) {
            try {
                const payload = JSON.parse(body);
                const notes = Array.isArray(payload?.notes) ? payload.notes : [];
                const match = notes.find((entry) => entry?.payload?.noteId === noteId);
                if (match) {
                    return payload;
                }
            } catch {
                // ignore parse errors and retry
            }
        } else if (statusCode >= 400 && statusCode < 500) {
            throw new Error(`Backend responded with status ${statusCode}`);
        }
        await delay(200);
    }
    throw new Error(`Note ${noteId} not found within ${resolvedTimeout}ms`);
}

function createSharedHandle(instance) {
    let released = false;
    sharedBackendRefs += 0;
    return {
        baseUrl: instance.baseUrl,
        googleClientId: instance.googleClientId,
        signingSecret: instance.signingSecret,
        issuer: instance.issuer,
        cookieName: instance.cookieName,
        tokenFactory: instance.tokenFactory,
        async close() {
            if (released) {
                return;
            }
            released = true;
            sharedBackendRefs -= 1;
            if (sharedBackendRefs <= 0) {
                await disposeSharedBackend();
            }
        }
    };
}

async function disposeSharedBackend() {
    if (!sharedBackendInstance) {
        return;
    }
    const context = sharedBackendInstance;
    sharedBackendInstance = null;
    sharedBackendRefs = 0;
    await context.shutdown();
}

/**
 * Execute an authenticated GET /notes request against the backend.
 * @param {{ backendUrl: string, token: string, timeoutMs: number }} options
 * @returns {Promise<{ statusCode: number, body: string }>}
 */
export function fetchBackendNotes({ backendUrl, token, timeoutMs }) {
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

async function startBackendProcess({ binaryPath, address, databasePath, signingSecret, issuer, cookieName, logLevel }) {
    const args = [
        "--http-address", address,
        "--database-path", databasePath,
        "--tauth-signing-secret", signingSecret,
        "--tauth-issuer", issuer,
        "--tauth-cookie-name", cookieName,
        "--log-level", logLevel
    ];
    const child = spawn(binaryPath, args, {
        cwd: BACKEND_DIR,
        stdio: ["ignore", "ignore", "ignore"]
    });

    await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("spawn", resolve);
    });

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

async function ensureBackendBinary() {
    if (!backendBinaryPromise) {
        backendBinaryPromise = (async () => {
            const buildDir = await fs.mkdtemp(path.join(os.tmpdir(), "gravity-backend-bin-"));
            const binaryName = isWindows ? "gravity-api.exe" : "gravity-api";
            const binaryPath = path.join(buildDir, binaryName);
            await runCommand("go", ["build", "-o", binaryPath, "./cmd/gravity-api"], {
                cwd: BACKEND_DIR
            });
            process.once("exit", () => {
                fs.rm(buildDir, { recursive: true, force: true }).catch(() => {});
            });
            return binaryPath;
        })();
    }
    return backendBinaryPromise;
}

async function waitForServerReady(address, timeoutMs = 20000) {
    const [host, portString] = address.split(":");
    const port = Number.parseInt(portString, 10);
    if (!host || Number.isNaN(port)) {
        throw new Error(`Invalid backend address: ${address}`);
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const ready = await attemptTcpConnection(host, port);
        if (ready) {
            return;
        }
        await delay(100);
    }
    throw new Error(`Backend did not accept connections at ${address} within ${timeoutMs}ms`);
}

function attemptTcpConnection(host, port) {
    return new Promise((resolve) => {
        const socket = net.connect({ host, port }, () => {
            socket.end();
            resolve(true);
        });
        socket.on("error", () => {
            socket.destroy();
            resolve(false);
        });
        socket.setTimeout(500, () => {
            socket.destroy();
            resolve(false);
        });
    });
}

function runCommand(command, args, options) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            ...options,
            stdio: ["ignore", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";
        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr?.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("error", reject);
        child.on("exit", (code, signal) => {
            if (code === 0) {
                resolve();
            } else {
                const message = [`Command failed: ${command} ${args.join(" ")}`];
                if (stdout.trim().length > 0) {
                    message.push(`stdout:\n${stdout}`);
                }
                if (stderr.trim().length > 0) {
                    message.push(`stderr:\n${stderr}`);
                }
                if (signal) {
                    message.push(`signal: ${signal}`);
                }
                const error = new Error(message.join("\n"));
                reject(error);
            }
        });
    });
}

function mintSessionToken({ userId, issuer, signingSecret, expiresInSeconds }) {
    const header = {
        alg: "HS256",
        typ: "JWT"
    };
    const issuedAtSeconds = Math.floor(Date.now() / 1000);
    const payload = {
        user_id: userId,
        user_email: `${userId}@example.com`,
        user_display_name: "Gravity Test User",
        user_avatar_url: "https://example.com/avatar.png",
        user_roles: ["user"],
        iss: issuer,
        sub: userId,
        iat: issuedAtSeconds,
        nbf: issuedAtSeconds - 30,
        exp: issuedAtSeconds + (Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 5 * 60)
    };
    const encodedHeader = Buffer.from(JSON.stringify(header), "utf8").toString("base64url");
    const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = createHmac("sha256", signingSecret).update(signingInput).digest("base64url");
    return `${signingInput}.${signature}`;
}

function encodeSessionCredential(payload) {
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeSessionCredential(value) {
    if (typeof value !== "string" || value.length === 0) {
        return null;
    }
    try {
        const decoded = Buffer.from(value, "base64url").toString("utf8");
        return JSON.parse(decoded);
    } catch {
        return null;
    }
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
