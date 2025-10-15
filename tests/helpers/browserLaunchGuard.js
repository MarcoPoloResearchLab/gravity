// @ts-check

const puppeteerModule = await import("puppeteer");
const puppeteer = puppeteerModule.default ?? puppeteerModule;

const multipleLaunchErrorMessage = "Multiple Puppeteer browser launches detected. Tests must use the shared browser harness.";

puppeteer.launch = async function guardedLaunch() {
    throw new Error(multipleLaunchErrorMessage);
};

globalThis.__gravityBrowserLaunchGuardMessage = multipleLaunchErrorMessage;
