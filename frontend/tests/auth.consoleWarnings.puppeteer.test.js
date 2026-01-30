import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createSharedPage } from "./helpers/browserHarness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
// Use index.html (landing page) for console warning tests
const PAGE_URL = `file://${path.join(PROJECT_ROOT, "index.html")}`;

test("base page load stays free of Google console warnings", async () => {
    const { page, teardown } = await createSharedPage();

    // Clear the default test profile to prevent landing page from redirecting to app.html
    // The page hasn't navigated yet, so evaluateOnNewDocument will run on the next navigation
    await page.evaluateOnNewDocument(() => {
        window.__tauthStubProfile = null;
    });

    const messages = [];
    page.on("console", (message) => {
        messages.push({ type: message.type(), text: message.text() });
    });
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });

    // Landing page doesn't have Alpine.js, so wait for mpr-ui components instead
    await page.waitForFunction(() => {
        const registry = window.customElements;
        if (!registry || typeof registry.get !== "function") {
            return false;
        }
        return Boolean(registry.get("mpr-login-button"));
    }, { timeout: 10000 });

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
    } finally {
        await teardown();
    }
});
