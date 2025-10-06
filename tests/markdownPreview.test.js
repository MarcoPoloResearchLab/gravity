import assert from "node:assert/strict";
import test from "node:test";

import { buildDeterministicPreview } from "../js/ui/markdownPreview.js";

const SAMPLE_IMAGE = "![diagram](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=)";
const LARGE_IMAGE = `![large](data:image/png;base64,${"A".repeat(800)})`;
const SECOND_IMAGE = "![second](data:image/png;base64,Zm9vYmFy)";

test("buildDeterministicPreview handles image-only markdown", () => {
    const { previewMarkdown, meta } = buildDeterministicPreview(SAMPLE_IMAGE);

    assert.equal(previewMarkdown.trim(), SAMPLE_IMAGE, "image-only markdown should be preserved in preview");
    assert.deepEqual(meta, { hasCode: false });
});

test("buildDeterministicPreview retains full image markdown when base64 exceeds preview cap", () => {
    const { previewMarkdown, meta } = buildDeterministicPreview(LARGE_IMAGE);

    assert.equal(previewMarkdown.trim(), LARGE_IMAGE, "large base64 image markdown should remain intact");
    assert.deepEqual(meta, { hasCode: false });
});

test("buildDeterministicPreview preserves multiple images without statistics", () => {
    const markdown = `${SAMPLE_IMAGE}\n\n${SECOND_IMAGE}`;
    const { previewMarkdown, meta } = buildDeterministicPreview(markdown);

    assert.equal(previewMarkdown, markdown);
    assert.deepEqual(meta, { hasCode: false });
});

test("buildDeterministicPreview leaves long text untouched", () => {
    const filler = "Lorem ipsum dolor sit amet, consectetur adipiscing elit.";
    const longText = Array.from({ length: 30 }, () => filler).join(" ");
    const markdown = `${longText}\n\n${SAMPLE_IMAGE}`;

    const { previewMarkdown } = buildDeterministicPreview(markdown);

    assert.equal(previewMarkdown, markdown);
});

test("buildDeterministicPreview flags code without tracking words or images", () => {
    const markdown = "```js\nconsole.log('hello');\n```\n\n" + SAMPLE_IMAGE + "\n\nSome trailing text.";
    const { previewMarkdown, meta } = buildDeterministicPreview(markdown);

    assert.ok(previewMarkdown.includes("console.log"));
    assert.ok(previewMarkdown.includes(SAMPLE_IMAGE));
    assert.deepEqual(meta, { hasCode: true });
});
