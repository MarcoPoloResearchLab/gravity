// @ts-check

import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SANDBOX_ROOT = path.join(os.tmpdir(), "gravity-puppeteer-cache");
const ACTIVE_BASE_DIRS = new Set();
const AVAILABLE_BASE_DIRS = new Set();

async function prepareBaseDir() {
    await fs.mkdir(SANDBOX_ROOT, { recursive: true });
    for (const candidate of AVAILABLE_BASE_DIRS) {
        if (!ACTIVE_BASE_DIRS.has(candidate)) {
            AVAILABLE_BASE_DIRS.delete(candidate);
            await fs.mkdir(candidate, { recursive: true });
            return candidate;
        }
    }
    const sandboxId = crypto.randomUUID();
    const baseDir = path.join(SANDBOX_ROOT, sandboxId);
    await fs.mkdir(baseDir, { recursive: true });
    return baseDir;
}

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
    const baseDir = await prepareBaseDir();
    const sandboxId = path.basename(baseDir);
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
 * @returns {Promise<void>}
 */
export async function cleanupPuppeteerSandbox(sandbox) {
    const baseDir = typeof sandbox === "string" ? sandbox : sandbox?.baseDir;
    if (!baseDir) {
        return;
    }
    await fs.rm(baseDir, { recursive: true, force: true }).catch(() => {});
    ACTIVE_BASE_DIRS.delete(baseDir);
    AVAILABLE_BASE_DIRS.add(baseDir);
}

/**
 * @param {{
 *   homeDir: string,
 *   userDataDir: string,
 *   cacheDir: string,
 *   configDir: string,
 *   crashDumpsDir: string
 * }} sandbox
 * @param {{
 *   additionalArgs?: string[],
 *   environment?: NodeJS.ProcessEnv,
 *   headless?: import("puppeteer").PuppeteerLaunchOptions["headless"],
 *   userDataDir?: string,
 *   defaultViewport?: import("puppeteer").Viewport | null
 * }} [overrides]
 * @returns {import("puppeteer").LaunchOptions & import("puppeteer").BrowserLaunchArgumentOptions & import("puppeteer").BrowserConnectOptions}
 */
export function createSandboxedLaunchOptions(sandbox, overrides) {
    const baseArgs = [
        "--allow-file-access-from-files",
        "--disable-crashpad",
        "--disable-features=Crashpad",
        "--noerrdialogs",
        "--no-crash-upload",
        "--enable-crash-reporter=0",
        `--crash-dumps-dir=${sandbox.crashDumpsDir}`
    ];
    const args = overrides?.additionalArgs
        ? baseArgs.concat(overrides.additionalArgs)
        : baseArgs.slice();
    if (process.env.CI) {
        args.push("--no-sandbox", "--disable-setuid-sandbox");
    }
    const env = {
        ...process.env,
        HOME: sandbox.homeDir,
        XDG_CACHE_HOME: sandbox.cacheDir,
        XDG_CONFIG_HOME: sandbox.configDir,
        ...(overrides?.environment ?? {})
    };
    const launchOptions = {
        headless: overrides?.headless ?? "new",
        args,
        userDataDir: overrides?.userDataDir ?? sandbox.userDataDir,
        env
    };
    if (overrides?.defaultViewport !== undefined) {
        launchOptions.defaultViewport = overrides.defaultViewport;
    }
    return launchOptions;
}
