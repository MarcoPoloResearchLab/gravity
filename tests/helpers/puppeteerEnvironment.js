import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const BASE_DIR = path.join(os.tmpdir(), `gravity-puppeteer-${process.pid}`);
const HOME_DIR = path.join(BASE_DIR, "home");
const USER_DATA_DIR = path.join(HOME_DIR, "user-data");
const CRASHPAD_DIR = path.join(USER_DATA_DIR, "Crashpad");
const CACHE_DIR = path.join(HOME_DIR, ".cache");
const CONFIG_DIR = path.join(HOME_DIR, ".config");
const CRASH_DUMPS_DIR = path.join(HOME_DIR, "crash-dumps");

let prepared = false;

export async function ensurePuppeteerSandbox() {
    if (!prepared) {
        await fs.rm(BASE_DIR, { recursive: true, force: true }).catch(() => {});
        await fs.mkdir(HOME_DIR, { recursive: true });
        await fs.mkdir(USER_DATA_DIR, { recursive: true });
        await fs.mkdir(CRASHPAD_DIR, { recursive: true });
        await fs.mkdir(CACHE_DIR, { recursive: true });
        await fs.mkdir(CONFIG_DIR, { recursive: true });
        await fs.mkdir(CRASH_DUMPS_DIR, { recursive: true });
        prepared = true;
    }

    return {
        homeDir: HOME_DIR,
        userDataDir: USER_DATA_DIR,
        cacheDir: CACHE_DIR,
        configDir: CONFIG_DIR,
        crashDumpsDir: CRASH_DUMPS_DIR
    };
}

export async function cleanupPuppeteerSandbox() {
    await fs.rm(BASE_DIR, { recursive: true, force: true }).catch(() => {});
    prepared = false;
}
