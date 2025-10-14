import { spawn } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rm, mkdtemp, stat, mkdir, readFile, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const BACKEND_ROOT = path.join(PROJECT_ROOT, "backend");
const BACKEND_MAIN_RELATIVE = "./cmd/gravity-api";

const READINESS_TIMEOUT_MS = 15000;
const READINESS_POLL_INTERVAL_MS = 250;
const BACKEND_SHUTDOWN_TIMEOUT_MS = 5000;
const BINARY_CACHE_DIR = path.join(os.tmpdir(), "gravity-backend-binaries");

/**
 * @typedef {Object} BackendHarness
 * @property {string} baseUrl
 * @property {(userId: string) => string} createCredential
 * @property {() => Promise<void>} close
 */

/**
 * Spin up the Go backend with deterministic JWKS for end-to-end testing.
 * @returns {Promise<BackendHarness>}
 */
export async function createBackendHarness() {
    const goExecutable = await resolveGoExecutable();
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "gravity-backend-"));
    const databasePath = path.join(workspaceDir, "gravity-test.db");
    const httpAddress = `127.0.0.1:${await allocatePort()}`;
    const signingSecret = crypto.randomBytes(32).toString("hex");
    const googleClientId = `gravity-test-${crypto.randomUUID()}`;

    const jwksService = await startJwksService();
    const binaryPath = await ensureBackendBinary(goExecutable);

    const backendProcess = spawn(binaryPath, [], {
        cwd: BACKEND_ROOT,
        env: {
            ...process.env,
            GRAVITY_HTTP_ADDRESS: httpAddress,
            GRAVITY_GOOGLE_CLIENT_ID: googleClientId,
            GRAVITY_GOOGLE_JWKS_URL: jwksService.url,
            GRAVITY_AUTH_SIGNING_SECRET: signingSecret,
            GRAVITY_DATABASE_PATH: databasePath,
            GRAVITY_LOG_LEVEL: "error"
        },
        stdio: ["ignore", "pipe", "pipe"]
    });

    const processOutput = captureProcessOutput(backendProcess);

    try {
        await waitForReadiness(`http://${httpAddress}`, backendProcess);
    } catch (error) {
        await shutdownProcess(backendProcess);
        await jwksService.close();
        await rm(workspaceDir, { recursive: true, force: true });
        const readinessError = error instanceof Error ? error : new Error(String(error));
        readinessError.message = `${readinessError.message}\n${processOutput.toString()}`;
        throw readinessError;
    }

    return {
        baseUrl: `http://${httpAddress}`,
        createCredential: (userId) => issueGoogleToken({
            userId,
            audience: googleClientId,
            keyId: jwksService.keyId,
            privateKey: jwksService.privateKey
        }),
        close: async () => {
            await shutdownProcess(backendProcess);
            await jwksService.close();
            await rm(workspaceDir, { recursive: true, force: true });
        }
    };
}

/**
 * @returns {Promise<string>}
 */
async function resolveGoExecutable() {
    try {
        await runCommand("go", ["version"], { cwd: BACKEND_ROOT });
        return "go";
    } catch (error) {
        const original = error instanceof Error ? error : new Error(String(error));
        if (/** @type {{ code?: string }} */ (original).code === "ENOENT") {
            throw original;
        }
        throw new Error(`failed to detect Go toolchain: ${original.message}`);
    }
}

/**
 * @param {string} command
 * @param {readonly string[]} args
 * @param {import("node:child_process").SpawnOptions} options
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function runCommand(command, args, options) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            ...options,
            stdio: ["ignore", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";
        if (child.stdout) {
            child.stdout.on("data", (chunk) => {
                stdout += chunk.toString();
            });
        }
        if (child.stderr) {
            child.stderr.on("data", (chunk) => {
                stderr += chunk.toString();
            });
        }
        child.once("error", reject);
        child.once("close", (code, signal) => {
            if (code === 0) {
                resolve({ stdout, stderr });
                return;
            }
            const failure = new Error(
                `command ${command} failed with code ${code ?? "null"}${signal ? ` (signal ${signal})` : ""}`
            );
            /** @type {any} */ (failure).stdout = stdout;
            /** @type {any} */ (failure).stderr = stderr;
            reject(failure);
        });
    });
}

/**
 * @returns {Promise<number>}
 */
function allocatePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (address && typeof address === "object") {
                const port = address.port;
                server.close(() => resolve(port));
                return;
            }
            server.close(() => reject(new Error("failed to allocate port")));
        });
    });
}

/**
 * @param {string} goExecutable
 * @param {string} targetBinary
 * @returns {Promise<void>}
 */
async function ensureBackendBinary(goExecutable) {
    const binaryName = process.platform === "win32" ? "gravity-api.exe" : "gravity-api";
    const cacheTarget = path.join(BINARY_CACHE_DIR, binaryName);
    await mkdir(BINARY_CACHE_DIR, { recursive: true });

    const sourceFingerprint = await computeSourceFingerprint();
    const cacheFingerprintPath = path.join(BINARY_CACHE_DIR, `${binaryName}.fingerprint`);
    let cacheValid = false;
    try {
        const [binaryStats, fingerprint] = await Promise.all([
            stat(cacheTarget),
            readFile(cacheFingerprintPath)
        ]);
        cacheValid = binaryStats.size > 0 && fingerprint.toString() === sourceFingerprint;
    } catch {
        cacheValid = false;
    }

    if (!cacheValid) {
        await runCommand(goExecutable, ["build", "-o", cacheTarget, BACKEND_MAIN_RELATIVE], {
            cwd: BACKEND_ROOT
        });
        await writeFile(cacheFingerprintPath, sourceFingerprint);
    }

    return cacheTarget;
}

async function computeSourceFingerprint() {
    const files = ["go.mod", "go.sum", path.join("cmd", "gravity-api", "main.go")];
    const chunks = [];
    for (const file of files) {
        try {
            const data = await readFile(path.join(BACKEND_ROOT, file));
            chunks.push(data);
        } catch {}
    }
    return crypto.createHash("sha256").update(Buffer.concat(chunks)).digest("hex");
}

/**
 * @param {{ userId: string, audience: string, keyId: string, privateKey: string }} params
 * @returns {string}
 */
function issueGoogleToken(params) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + 3600;
    const header = {
        alg: "RS256",
        typ: "JWT",
        kid: params.keyId
    };
    const payload = {
        iss: "https://accounts.google.com",
        aud: params.audience,
        sub: params.userId,
        email: `${params.userId}@example.com`,
        email_verified: true,
        iat: issuedAt,
        exp: expiresAt,
        jti: crypto.randomUUID()
    };
    return signJwt(header, payload, params.privateKey);
}

/**
 * @returns {Promise<{ url: string, keyId: string, privateKey: string, close: () => Promise<void> }>}
 */
async function startJwksService() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs1", format: "pem" }
    });

    const publicKeyObject = crypto.createPublicKey(publicKey);
    const jwkExport = /** @type {{ n: string, e: string }} */ (
        publicKeyObject.export({ format: "jwk" })
    );
    const keyId = crypto
        .createHash("sha256")
        .update(publicKey)
        .digest("hex")
        .slice(0, 16);
    const jwksDocument = JSON.stringify({
        keys: [
            {
                kty: "RSA",
                use: "sig",
                alg: "RS256",
                kid: keyId,
                n: jwkExport.n,
                e: jwkExport.e
            }
        ]
    });

    const server = http.createServer((request, response) => {
        if (request.method !== "GET") {
            response.writeHead(405);
            response.end();
            return;
        }
        response.writeHead(200, {
            "content-type": "application/json",
            "cache-control": "no-store"
        });
        response.end(jwksDocument);
    });

    const listenPort = await new Promise((resolve, reject) => {
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (address && typeof address === "object") {
                resolve(address.port);
                return;
            }
            reject(new Error("failed to start JWKS server"));
        });
    });

    const url = `http://127.0.0.1:${listenPort}/jwks.json`;
    return {
        url,
        keyId,
        privateKey,
        close: async () => {
            server.close();
            await once(server, "close");
        }
    };
}

/**
 * @param {import("node:child_process").ChildProcess} child
 * @returns {{ toString: () => string }}
 */
function captureProcessOutput(child) {
    let stdout = "";
    let stderr = "";
    if (child.stdout) {
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });
    }
    if (child.stderr) {
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
    }
    return {
        toString: () => {
            const parts = [];
            if (stdout.trim().length > 0) {
                parts.push(`stdout:\n${stdout}`);
            }
            if (stderr.trim().length > 0) {
                parts.push(`stderr:\n${stderr}`);
            }
            return parts.join("\n");
        }
    };
}

/**
 * @param {import("node:child_process").ChildProcess} processHandle
 * @returns {Promise<void>}
 */
async function shutdownProcess(processHandle) {
    if (processHandle.exitCode !== null) {
        return;
    }
    processHandle.kill("SIGTERM");
    const abortController = new AbortController();
    const timeout = delay(BACKEND_SHUTDOWN_TIMEOUT_MS, undefined, { signal: abortController.signal }).catch(() => {});
    const exitPromise = once(processHandle, "exit").then(() => abortController.abort());
    await Promise.race([timeout, exitPromise]);
    if (processHandle.exitCode === null) {
        processHandle.kill("SIGKILL");
        await once(processHandle, "exit");
    }
}

/**
 * @param {string} baseUrl
 * @param {import("node:child_process").ChildProcess} processHandle
 * @returns {Promise<void>}
 */
async function waitForReadiness(baseUrl, processHandle) {
    const deadline = Date.now() + READINESS_TIMEOUT_MS;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${baseUrl}/notes`, {
                method: "GET",
                headers: { Authorization: "Bearer invalid" }
            });
            if (response.status === 401) {
                return;
            }
        } catch {
            // Retry until timeout
        }
        if (processHandle.exitCode !== null) {
            throw new Error("backend process exited before readiness");
        }
        await delay(READINESS_POLL_INTERVAL_MS);
    }
    throw new Error("backend harness timed out waiting for readiness");
}

/**
 * @param {Record<string, unknown>} header
 * @param {Record<string, unknown>} payload
 * @param {string|Buffer|crypto.KeyObject} privateKey
 * @returns {string}
 */
function signJwt(header, payload, privateKey) {
    const headerSegment = base64UrlEncode(JSON.stringify(header));
    const payloadSegment = base64UrlEncode(JSON.stringify(payload));
    const signingInput = `${headerSegment}.${payloadSegment}`;
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    const signature = signer.sign(privateKey);
    return `${signingInput}.${base64UrlEncode(signature)}`;
}

/**
 * @param {string|Buffer} input
 * @returns {string}
 */
function base64UrlEncode(input) {
    return Buffer.from(input)
        .toString("base64")
        .replace(/\+/gu, "-")
        .replace(/\//gu, "_")
        .replace(/=+$/u, "");
}
