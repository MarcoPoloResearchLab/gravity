// @ts-check

import assert from "node:assert/strict";
import test from "node:test";

import { initializePuppeteerTest } from "./helpers/syncTestUtils.js";

const CUSTOM_AUTH_BASE_URL = "http://localhost:58081";

let puppeteerAvailable = true;
try {
    await import("puppeteer");
} catch {
    puppeteerAvailable = false;
}

if (!puppeteerAvailable) {
    test("puppeteer unavailable", () => {
        test.skip("Puppeteer is not installed in this environment.");
    });
} else {
    test.describe("Landing login button", () => {
        test("uses runtime auth base url and nonce/login/logout paths", async () => {
            const harness = await initializePuppeteerTest(undefined, {
                runtimeConfig: {
                    development: {
                        authBaseUrl: CUSTOM_AUTH_BASE_URL
                    }
                }
            });
            try {
                await harness.page.waitForSelector("[data-test=\"landing-login\"]");
                const attributes = await harness.page.$eval("[data-test=\"landing-login\"]", (element) => {
                    return {
                        tauthUrl: element.getAttribute("tauth-url"),
                        loginPath: element.getAttribute("tauth-login-path"),
                        logoutPath: element.getAttribute("tauth-logout-path"),
                        noncePath: element.getAttribute("tauth-nonce-path")
                    };
                });

                assert.equal(attributes.tauthUrl, CUSTOM_AUTH_BASE_URL);
                assert.equal(attributes.loginPath, "/auth/google");
                assert.equal(attributes.logoutPath, "/auth/logout");
                assert.equal(attributes.noncePath, "/auth/nonce");
            } finally {
                await harness.teardown();
            }
        });
    });
}
