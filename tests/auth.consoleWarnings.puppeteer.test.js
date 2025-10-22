import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { GOOGLE_IDENTITY_SCRIPT_URL, MESSAGE_AUTH_UNAVAILABLE_ORIGIN } from "../js/constants.js";
import { createSharedPage } from "./helpers/browserHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

test("base page load stays free of Google console warnings", async () => {
    const { page, teardown } = await createSharedPage();
    const messages = [];
    page.on("console", (message) => {
        messages.push({ type: message.type(), text: message.text() });
    });
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));

    const availabilityState = await page.evaluate((scriptUrl) => {
        const buttonHost = document.querySelector(".auth-button-host");
        const statusElement = document.querySelector("[x-ref='authStatus']");
        const scriptCount = Array.from(document.querySelectorAll(`script[src='${scriptUrl}']`)).length;
        return {
            buttonDataset: buttonHost ? { ...buttonHost.dataset } : null,
            statusText: statusElement ? statusElement.textContent : null,
            statusHidden: statusElement ? statusElement.hasAttribute("hidden") : null,
            scriptCount
        };
    }, GOOGLE_IDENTITY_SCRIPT_URL);

    try {
        const problematic = messages.filter(({ type, text }) => {
            if (type !== "error" && type !== "warning") {
                return false;
            }
            const normalized = text.toLowerCase();
            return normalized.includes("gsi_logger")
                || normalized.includes("identity provider")
                || normalized.includes("gsi/button")
                || normalized.includes("google analytics");
        });
        assert.equal(problematic.length, 0, `Unexpected console output: ${problematic.map((entry) => entry.text).join(" | ")}`);
        assert.equal(availabilityState.scriptCount, 0, "Google Identity script should not load on unsupported origin");
        assert.equal(availabilityState.buttonDataset?.googleSignIn, "unavailable");
        assert.equal(availabilityState.statusHidden, false);
        assert.equal(availabilityState.statusText?.trim(), MESSAGE_AUTH_UNAVAILABLE_ORIGIN);
    } finally {
        await teardown();
    }
});
