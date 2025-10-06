import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ACTIVE_BASE_DIRS = new Set();

/**
 * @returns {{
 *   id: string,
 *   baseDir: string,
 *   homeDir: string,
 *   userDataDir: string,
 *   cacheDir: string,
 *   configDir: string,
 *   crashDumpsDir: string
 * }}
 */
export async function ensurePuppeteerSandbox() {
    const sandboxId = crypto.randomUUID();
    const baseDir = path.join(os.tmpdir(), `gravity-puppeteer-${sandboxId}`);
    const homeDir = path.join(baseDir, "home");
    const userDataDir = path.join(homeDir, "user-data");
    const crashpadDir = path.join(userDataDir, "Crashpad");
    const cacheDir = path.join(homeDir, ".cache");
    const configDir = path.join(homeDir, ".config");
    const crashDumpsDir = path.join(homeDir, "crash-dumps");

    await fs.mkdir(crashpadDir, { recursive: true });
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.mkdir(configDir, { recursive: true });
    await fs.mkdir(crashDumpsDir, { recursive: true });

    ACTIVE_BASE_DIRS.add(baseDir);

    return {
        id: sandboxId,
        baseDir,
        homeDir,
        userDataDir,
        cacheDir,
        configDir,
        crashDumpsDir
    };
}

/**
 * @param {{ baseDir: string } | string | undefined | null} sandbox
 */
export async function cleanupPuppeteerSandbox(sandbox) {
    const baseDir = typeof sandbox === "string" ? sandbox : sandbox?.baseDir;
    if (!baseDir) {
        return;
    }

    await fs.rm(baseDir, { recursive: true, force: true }).catch(() => {});
    ACTIVE_BASE_DIRS.delete(baseDir);
}
