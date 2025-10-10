import assert from "node:assert/strict";
import test from "node:test";

import { buildPlainTextClipboardPayload } from "../js/utils/clipboard.js";

const SAMPLE_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";

test("clipboard plain text scenarios", () => {
    const cases = [
        {
            name: "plain markdown stays untouched",
            text: "- List\n- of things\n- I need to do",
            attachments: {},
            verify(result) {
                assert.equal(result, this.text);
                assert.equal(result.includes("application/x-gravity-note"), false);
            }
        },
        {
            name: "image-only markdown yields data url",
            text: "",
            attachments: {
                "image-1": { dataUrl: SAMPLE_DATA_URL, altText: "diagram" }
            },
            verify(result) {
                assert.equal(result, SAMPLE_DATA_URL);
            }
        },
        {
            name: "inline placeholder expands",
            text: "Intro text\n\n![[img-123]]\n\nMore text",
            attachments: {
                "img-123": { dataUrl: "data:image/png;base64,AAAABBBB", altText: "chart" }
            },
            verify(result) {
                assert.ok(result.includes("data:image/png;base64,AAAABBBB"));
                assert.equal(result.includes("![[img-123]]"), false);
            }
        }
    ];

    for (const scenario of cases) {
        const payload = buildPlainTextClipboardPayload({ text: scenario.text, attachments: scenario.attachments });
        try {
            scenario.verify(payload);
        } catch (error) {
            error.message = `${scenario.name}: ${error.message}`;
            throw error;
        }
    }
});
