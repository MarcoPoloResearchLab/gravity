import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

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
