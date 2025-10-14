import { spawn } from "node:child_process";
import { createSign, generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const BACKEND_DIR = path.join(REPO_ROOT, "backend");
const DEFAULT_GOOGLE_CLIENT_ID = "gravity-test-client";
const DEFAULT_SIGNING_SECRET = "gravity-test-signing-secret";
const DEFAULT_JWT_ISSUER = "https://accounts.google.com";

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
export async function startTestBackend(options = {}) {
    const googleClientId = options.googleClientId ?? DEFAULT_GOOGLE_CLIENT_ID;
    const signingSecret = options.signingSecret ?? DEFAULT_SIGNING_SECRET;
    const logLevel = options.logLevel ?? "info";

    const rsaKeys = generateRsaKeyPair();
    const jwksServer = await startJwksServer(rsaKeys.jwk);
    const jwksUrl = `${jwksServer.url}/oauth2/v3/certs`;

    const backendPort = await getAvailablePort();
    const backendAddress = `127.0.0.1:${backendPort}`;
    const databasePath = await createTempDatabasePath();

    const backendProcess = await startBackendProcess({
        address: backendAddress,
        jwksUrl,
        databasePath,
        googleClientId,
        signingSecret,
        logLevel
    });
    await waitForServerReady(backendAddress);

    let backendClosed = false;
    let closingPromise = Promise.resolve();
    const databaseDirectory = path.dirname(databasePath);

    async function close() {
        if (backendClosed) {
            await closingPromise;
            return;
        }
        backendClosed = true;
        closingPromise = (async () => {
            try {
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
            } finally {
                await jwksServer.close().catch(() => {});
                await fs.rm(databaseDirectory, { recursive: true, force: true }).catch(() => {});
            }
        })();
        await closingPromise;
    }

    return {
        baseUrl: `http://${backendAddress}`,
        googleClientId,
        tokenFactory(userId, expiresInSeconds = 5 * 60) {
            return createSignedGoogleToken({
                audience: googleClientId,
                subject: userId,
                issuer: DEFAULT_JWT_ISSUER,
                privateKey: rsaKeys.privateKey,
                keyId: rsaKeys.keyId,
                expiresInSeconds
            });
        },
        close
    };
}

/**
 * Poll the backend for notes until a matching identifier appears.
 * @param {{ backendUrl: string, token: string, noteId: string, timeoutMs: number }} options
 * @returns {Promise<any>}
 */
export async function waitForBackendNote({ backendUrl, token, noteId, timeoutMs }) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
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
                // ignore parse errors and retry
            }
        } else if (statusCode >= 400 && statusCode < 500) {
            throw new Error(`Backend responded with status ${statusCode}`);
        }
        await delay(200);
    }
    throw new Error(`Note ${noteId} not found within ${timeoutMs}ms`);
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

async function startBackendProcess({ address, jwksUrl, databasePath, googleClientId, signingSecret, logLevel }) {
    const args = [
        "run",
        "./cmd/gravity-api",
        "--http-address", address,
        "--google-client-id", googleClientId,
        "--google-jwks-url", jwksUrl,
        "--database-path", databasePath,
        "--signing-secret", signingSecret,
        "--log-level", logLevel
    ];
    const child = spawn("go", args, {
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

function createSignedGoogleToken({ audience, subject, issuer, privateKey, keyId, expiresInSeconds }) {
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

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
