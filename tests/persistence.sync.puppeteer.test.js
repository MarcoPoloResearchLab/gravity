import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { EVENT_NOTE_CREATE } from "../js/constants.js";
import { ensurePuppeteerSandbox, cleanupPuppeteerSandbox } from "./helpers/puppeteerEnvironment.js";
import { dispatchSignIn, waitForPendingOperations, waitForSyncManagerUser } from "./helpers/syncTestUtils.js";

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
} catch (error) {
    puppeteerModule = null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;
const SERVER_SYNC_TIMEOUT_MS = 4000;

const BACKEND_STATE = {
    credentialMap: new Map([["stub-google-credential", "sync-user"]]),
    tokens: new Map(),
    notesByUser: new Map(),
    tokenCounter: 0
};

async function handleBackendFetch({ url, method, headers, body }) {
    if (url.endsWith("/auth/google") && method === "POST") {
        const parsed = body ? JSON.parse(body) : {};
        const credential = parsed?.id_token;
        const userId = BACKEND_STATE.credentialMap.get(credential);
        if (!userId) {
            return {
                status: 401,
                headers: { "Content-Type": "application/json" },
                bodyText: JSON.stringify({ error: "unauthorized" })
            };
        }
        const token = `backend-token-${++BACKEND_STATE.tokenCounter}`;
        BACKEND_STATE.tokens.set(token, userId);
        return {
            status: 200,
            headers: { "Content-Type": "application/json" },
            bodyText: JSON.stringify({ access_token: token, expires_in: 1800 })
        };
    }

    if (url.endsWith("/notes/sync") && method === "POST") {
        const authHeader = headers?.Authorization ?? headers?.authorization ?? "";
        const token = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
            ? authHeader.slice("Bearer ".length)
            : null;
        const userId = token ? BACKEND_STATE.tokens.get(token) : null;
        if (!userId) {
            return {
                status: 401,
                headers: { "Content-Type": "application/json" },
                bodyText: JSON.stringify({ error: "unauthorized" })
            };
        }
        const parsed = body ? JSON.parse(body) : {};
        const operations = Array.isArray(parsed?.operations) ? parsed.operations : [];

        const userNotes = BACKEND_STATE.notesByUser.get(userId) ?? new Map();
        const results = [];
        for (const operation of operations) {
            const noteId = operation?.note_id;
            if (typeof noteId !== "string" || noteId.length === 0) {
                continue;
            }
            const existing = userNotes.get(noteId) ?? {
                version: 0,
                last_writer_edit_seq: 0,
                payload: null,
                is_deleted: false,
                created_at_s: operation?.created_at_s ?? operation?.updated_at_s ?? Date.now() / 1000
            };
            const nextVersion = existing.version + 1;
            const lastWriterEditSeq = operation?.client_edit_seq ?? existing.last_writer_edit_seq;
            const isDelete = operation?.operation === "delete";
            const payload = operation?.payload ?? existing.payload;
            const updatedAtSeconds = operation?.updated_at_s ?? Math.floor(Date.now() / 1000);

            const record = {
                note_id: noteId,
                version: nextVersion,
                last_writer_edit_seq: lastWriterEditSeq,
                is_deleted: isDelete,
                payload,
                updated_at_s: updatedAtSeconds,
                created_at_s: existing.created_at_s
            };

            if (isDelete) {
                record.payload = existing.payload;
            }

            userNotes.set(noteId, record);
            results.push({ ...record, accepted: true });
        }
        BACKEND_STATE.notesByUser.set(userId, userNotes);
        return {
            status: 200,
            headers: { "Content-Type": "application/json" },
            bodyText: JSON.stringify({ results })
        };
    }

    if (url.endsWith("/notes") && method === "GET") {
        const authHeader = headers?.Authorization ?? headers?.authorization ?? "";
        const token = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
            ? authHeader.slice("Bearer ".length)
            : null;
        const userId = token ? BACKEND_STATE.tokens.get(token) : null;
        if (!userId) {
            return {
                status: 401,
                headers: { "Content-Type": "application/json" },
                bodyText: JSON.stringify({ error: "unauthorized" })
            };
        }
        const userNotes = BACKEND_STATE.notesByUser.get(userId) ?? new Map();
        const notes = Array.from(userNotes.values()).map((record) => ({
            note_id: record.note_id,
            version: record.version,
            last_writer_edit_seq: record.last_writer_edit_seq,
            is_deleted: record.is_deleted,
            updated_at_s: record.updated_at_s,
            created_at_s: record.created_at_s,
            payload: record.payload
        }));
        return {
            status: 200,
            headers: { "Content-Type": "application/json" },
            bodyText: JSON.stringify({ notes })
        };
    }

    return {
        status: 404,
        headers: { "Content-Type": "application/json" },
        bodyText: JSON.stringify({ error: "not_found" })
    };
}

async function exposeBackend(page) {
    await page.exposeFunction("gravityBackendFetch", handleBackendFetch);
    await page.evaluateOnNewDocument(() => {
        window.fetch = async (input, init = {}) => {
            const requestUrl = typeof input === "string" ? input : input?.url ?? String(input);
            const method = typeof init.method === "string" ? init.method.toUpperCase() : "GET";
            const headers = {};
            if (init.headers) {
                const entries = Array.isArray(init.headers)
                    ? init.headers
                    : init.headers instanceof Headers
                        ? Array.from(init.headers.entries())
                        : Object.entries(init.headers);
                for (const [key, value] of entries) {
                    if (typeof key === "string") {
                        headers[key] = typeof value === "string" ? value : String(value);
                    }
                }
            }
            const bodyText = typeof init.body === "string" ? init.body : init.body ? String(init.body) : null;
            const response = await window.gravityBackendFetch({ url: requestUrl, method, headers, body: bodyText });
            const finalHeaders = new Headers(response.headers ?? {});
            if (!finalHeaders.has("Content-Type")) {
                finalHeaders.set("Content-Type", "application/json");
            }
            return new Response(response.bodyText ?? "", {
                status: response.status ?? 200,
                headers: finalHeaders
            });
        };
    });
}

function resetBackendState() {
    BACKEND_STATE.tokens.clear();
    BACKEND_STATE.notesByUser.clear();
    BACKEND_STATE.tokenCounter = 0;
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

async function expectServerNote(userId, noteId) {
    const deadline = Date.now() + SERVER_SYNC_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const userNotes = BACKEND_STATE.notesByUser.get(userId);
        if (userNotes && userNotes.has(noteId)) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail(`Note ${noteId} not persisted on server for user ${userId}`);
}

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

    test.describe("Backend persistence", () => {
        /** @type {import("puppeteer").Browser | null} */
        let browser = null;
        /** @type {Error|null} */
        let launchError = null;

        const skipIfNoBrowser = () => {
            if (!browser) {
                test.skip(launchError ? launchError.message : "Puppeteer launch unavailable in sandbox.");
                return true;
            }
            return false;
        };

        test.before(async () => {
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
            try {
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
            } catch (error) {
                launchError = error instanceof Error ? error : new Error(String(error));
            }
        });

        test.after(async () => {
            if (browser) {
                await browser.close();
            }
            await cleanupPuppeteerSandbox(SANDBOX);
        });

        test("notes persist across clients via backend sync", async () => {
            if (skipIfNoBrowser()) return;
            resetBackendState();

            const pageA = await browser.newPage();
            await exposeBackend(pageA);
            await pageA.goto(PAGE_URL, { waitUntil: "load" });
            await dispatchSignIn(pageA, "stub-google-credential", "sync-user");
            await waitForSyncManagerUser(pageA, "sync-user", 5000);
            await pageA.waitForSelector(".auth-avatar:not([hidden])");

            await dispatchNoteCreate(pageA, {
                noteId: "sync-note",
                markdownText: "Backend persisted note",
                timestampIso: "2023-11-14T21:05:00.000Z"
            });
            await waitForPendingOperations(pageA);

            await expectServerNote("sync-user", "sync-note");

            const contextB = await browser.createBrowserContext();
            const pageB = await contextB.newPage();
            await exposeBackend(pageB);
            await pageB.goto(PAGE_URL, { waitUntil: "load" });
            await dispatchSignIn(pageB, "stub-google-credential", "sync-user");
            await waitForSyncManagerUser(pageB, "sync-user", 5000);
            await waitForPendingOperations(pageB);
            await pageB.waitForSelector(".auth-avatar:not([hidden])");

            await pageB.waitForSelector('.markdown-block[data-note-id="sync-note"]');
            const renderedMarkdown = await pageB.$eval('.markdown-block[data-note-id="sync-note"] .markdown-content', (element) => element.textContent?.trim() ?? "");
            assert.match(renderedMarkdown, /Backend persisted note/);

            await pageA.close();
            await contextB.close();
        });
    });
}
