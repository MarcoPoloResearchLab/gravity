import assert from "node:assert/strict";
import test from "node:test";

import { buildHtmlViewSource } from "../js/ui/htmlView.js";

const SAMPLE_IMAGE = "![diagram](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=)";
const LARGE_IMAGE = `![large](data:image/png;base64,${"A".repeat(800)})`;
const SECOND_IMAGE = "![second](data:image/png;base64,Zm9vYmFy)";

test("buildHtmlViewSource handles image-only markdown", () => {
    const { htmlViewMarkdown, meta } = buildHtmlViewSource(SAMPLE_IMAGE);

    assert.equal(htmlViewMarkdown.trim(), SAMPLE_IMAGE, "image-only markdown should be preserved in html view");
    assert.deepEqual(meta, { hasCode: false });
});

test("buildHtmlViewSource retains full image markdown when base64 exceeds html view cap", () => {
    const { htmlViewMarkdown, meta } = buildHtmlViewSource(LARGE_IMAGE);

    assert.equal(htmlViewMarkdown.trim(), LARGE_IMAGE, "large base64 image markdown should remain intact");
    assert.deepEqual(meta, { hasCode: false });
});

test("buildHtmlViewSource preserves multiple images without statistics", () => {
    const markdown = `${SAMPLE_IMAGE}\n\n${SECOND_IMAGE}`;
    const { htmlViewMarkdown, meta } = buildHtmlViewSource(markdown);

    assert.equal(htmlViewMarkdown, markdown);
    assert.deepEqual(meta, { hasCode: false });
});

test("buildHtmlViewSource leaves long text untouched", () => {
    const filler = "Lorem ipsum dolor sit amet, consectetur adipiscing elit.";
    const longText = Array.from({ length: 30 }, () => filler).join(" ");
    const markdown = `${longText}\n\n${SAMPLE_IMAGE}`;

    const { htmlViewMarkdown } = buildHtmlViewSource(markdown);

    assert.equal(htmlViewMarkdown, markdown);
});

test("buildHtmlViewSource flags code without tracking words or images", () => {
    const markdown = "```js\nconsole.log('hello');\n```\n\n" + SAMPLE_IMAGE + "\n\nSome trailing text.";
    const { htmlViewMarkdown, meta } = buildHtmlViewSource(markdown);

    assert.ok(htmlViewMarkdown.includes("console.log"));
    assert.ok(htmlViewMarkdown.includes(SAMPLE_IMAGE));
    assert.deepEqual(meta, { hasCode: true });
});
