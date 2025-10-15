// @ts-check

const puppeteerModule = await import("puppeteer");
const puppeteer = puppeteerModule.default ?? puppeteerModule;
const originalLaunch = puppeteer.launch.bind(puppeteer);

const multipleLaunchErrorMessage = "Multiple Puppeteer browser launches detected. Tests must use the shared browser harness.";

puppeteer.launch = async function guardedLaunch(...args) {
    if (process.env.GRAVITY_TEST_ALLOW_BROWSER_LAUNCH !== "1") {
        throw new Error(multipleLaunchErrorMessage);
    }
    process.env.GRAVITY_TEST_ALLOW_BROWSER_LAUNCH = "0";
    return originalLaunch(...args);
};

globalThis.__gravityBrowserLaunchGuardMessage = multipleLaunchErrorMessage;
