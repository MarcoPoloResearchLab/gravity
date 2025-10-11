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

import { appConfig } from "../js/core/config.js";
import {
    EVENT_AUTH_SIGN_IN,
    EVENT_NOTE_CREATE
} from "../js/constants.js";
import { ensurePuppeteerSandbox, cleanupPuppeteerSandbox } from "./helpers/puppeteerEnvironment.js";

const SANDBOX = await ensurePuppeteerSandbox();
const {
    homeDir: SANDBOX_HOME_DIR,
    userDataDir: SANDBOX_USER_DATA_DIR,
    cacheDir: SANDBOX_CACHE_DIR,
    configDir: SANDBOX_CONFIG_DIR,
    crashDumpsDir: SANDBOX_CRASH_DUMPS_DIR
} = SANDBOX;

let puppeteerModule;
try {
    ({ default: puppeteerModule } = await import("puppeteer"));
} catch {
    puppeteerModule = null;
}

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const BACKEND_DIR = path.join(REPO_ROOT, "backend");

const TEST_GOOGLE_CLIENT_ID = "gravity-test-client";
const TEST_SIGNING_SECRET = "gravity-test-signing-secret";
const TEST_USER_ID = "integration-sync-user";

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

            backendContext = {
                async close() {
                    backendProcess.kill("SIGTERM");
                    await once(backendProcess, "exit");
                    await jwksServer.close();
                    await fs.rm(path.dirname(databasePath), { recursive: true, force: true });
                },
                url: `http://${backendAddress}`,
                tokenFactory: () => createSignedGoogleToken({
                    audience: TEST_GOOGLE_CLIENT_ID,
                    subject: TEST_USER_ID,
                    privateKey: rsaKeys.privateKey,
                    keyId: rsaKeys.keyId,
                    issuer: "https://accounts.google.com"
                })
            };

            const launchArgs = [
                "--allow-file-access-from-files",
                "--disable-crashpad",
                "--disable-features=Crashpad",
                "--noerrdialogs",
                "--no-crash-upload",
                "--enable-crash-reporter=0",
                `--crash-dumps-dir=${SANDBOX_CRASH_DUMPS_DIR}`
            ];
            if (process.env.CI) {
                launchArgs.push("--no-sandbox", "--disable-setuid-sandbox");
            }

            browser = await puppeteerModule.launch({
                headless: "new",
                args: launchArgs,
                userDataDir: SANDBOX_USER_DATA_DIR,
                env: {
                    ...process.env,
                    HOME: SANDBOX_HOME_DIR,
                    XDG_CACHE_HOME: SANDBOX_CACHE_DIR,
                    XDG_CONFIG_HOME: SANDBOX_CONFIG_DIR
                }
            });
        });

        test.after(async () => {
            if (browser) {
                await browser.close();
            }
            if (backendContext) {
                await backendContext.close();
            }
            await cleanupPuppeteerSandbox(SANDBOX);
        });

        test("flushes notes to the backend over HTTP", async (t) => {
            t.signal.addEventListener("abort", () => {
                if (backendContext) {
                    backendContext.close().catch(() => {});
                }
            });
            t.timeout(60000);

            assert.ok(browser, "browser must be available");
            assert.ok(backendContext, "backend must be initialised");

            const backendUrl = backendContext.url;
            const page = await preparePage(browser, { backendUrl });
            try {
                const credential = backendContext.tokenFactory();
                await dispatchSignIn(page, credential);
                await waitForSyncManagerUser(page, TEST_USER_ID);

                const noteId = "backend-sync-note";
                const timestampIso = new Date().toISOString();
                await dispatchNoteCreate(page, {
                    noteId,
                    markdownText: "Integration test note",
                    timestampIso
                });

                await waitForPendingOperations(page);

                const debugState = await extractSyncDebugState(page);
                assert.ok(debugState, "sync manager debug state available");
                assert.ok(debugState.backendToken && debugState.backendToken.accessToken, "backend token captured");

                const notesResponse = await fetch(`${backendUrl}/notes`, {
                    headers: {
                        Authorization: `Bearer ${debugState.backendToken.accessToken}`
                    }
                });
                assert.equal(notesResponse.status, 200, "backend responded with OK");
                const payload = await notesResponse.json();
                assert.ok(Array.isArray(payload?.notes), "notes payload should be an array");
                const noteIds = payload.notes.map((entry) => entry?.payload?.noteId);
                assert.ok(noteIds.includes(noteId), "backend notes contains synced note");
            } finally {
                await page.close();
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

async function preparePage(browser, { backendUrl }) {
    const page = await browser.newPage();
    const serializedRecords = JSON.stringify([]);
    await page.evaluateOnNewDocument((storageKey, records) => {
        window.localStorage.clear();
        window.localStorage.setItem(storageKey, records);
    }, appConfig.storageKey, serializedRecords);
    await page.evaluateOnNewDocument((backendBaseUrl) => {
        window.GRAVITY_CONFIG = {
            backendBaseUrl,
            llmProxyBaseUrl: backendBaseUrl
        };
    }, backendUrl);

    const projectRoot = path.resolve(REPO_ROOT);
    const pageUrl = `file://${path.join(projectRoot, "index.html")}`;
    await page.goto(pageUrl, { waitUntil: "networkidle0" });
    await page.waitForSelector("#top-editor .markdown-editor");
    return page;
}

async function dispatchSignIn(page, credential) {
    await page.evaluate((eventName, token, userId) => {
        const root = document.querySelector("body");
        if (!root) return;
        root.dispatchEvent(new CustomEvent(eventName, {
            detail: {
                user: {
                    id: userId,
                    email: `${userId}@example.com`,
                    name: "Sync Integration User",
                    pictureUrl: "https://example.com/avatar.png"
                },
                credential: token
            },
            bubbles: true
        }));
    }, EVENT_AUTH_SIGN_IN, credential, TEST_USER_ID);
}

async function waitForSyncManagerUser(page, expectedUserId) {
    await page.waitForFunction((userId) => {
        const root = document.querySelector("[x-data]");
        const alpine = root?.__x;
        const syncManager = alpine?.$data?.syncManager;
        if (!syncManager) return false;
        const debug = syncManager.getDebugState?.();
        return debug?.activeUserId === userId;
    }, {}, expectedUserId);
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

async function waitForPendingOperations(page) {
    await page.waitForFunction(() => {
        const root = document.querySelector("[x-data]");
        const alpine = root?.__x;
        const syncManager = alpine?.$data?.syncManager;
        if (!syncManager) return false;
        const debug = syncManager.getDebugState?.();
        return Array.isArray(debug?.pendingOperations) && debug.pendingOperations.length === 0;
    }, {}, { timeout: 5000 });
}

async function extractSyncDebugState(page) {
    return page.evaluate(() => {
        const root = document.querySelector("[x-data]");
        const alpine = root?.__x;
        const syncManager = alpine?.$data?.syncManager;
        return syncManager?.getDebugState?.() ?? null;
    });
}
