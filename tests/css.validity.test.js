// @ts-check

import { test } from "node:test";
import { strictEqual, ok } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const cssPath = resolve(process.cwd(), "styles.css");

test("styles.css has no template literal placeholders", async () => {
    const cssContent = await readFile(cssPath, "utf-8");
    const templateLiteralPattern = /\$\{[^}]+\}/g;
    const matches = cssContent.match(templateLiteralPattern);
    strictEqual(matches, null, `CSS should not contain template placeholders: ${matches?.join(", ")}`);
});

test("styles.css omits invalid debug markers", async () => {
    const cssContent = await readFile(cssPath, "utf-8");
    const invalidMarkers = [/\?\?\?/, /TODO:/i, /FIXME:/i, /XXX:/];
    for (const pattern of invalidMarkers) {
        const matches = cssContent.match(pattern);
        strictEqual(matches, null, `CSS should not contain invalid marker: ${matches?.[0]}`);
    }
});

test("styles.css has balanced braces", async () => {
    const cssContent = await readFile(cssPath, "utf-8");
    const openBraces = (cssContent.match(/\{/g) || []).length;
    const closeBraces = (cssContent.match(/\}/g) || []).length;
    strictEqual(openBraces, closeBraces, `Unbalanced braces in CSS. open=${openBraces}, close=${closeBraces}`);
});

test("styles.css selectors avoid unresolved symbols", async () => {
    const cssContent = await readFile(cssPath, "utf-8");
    const lines = cssContent.split("\n");
    const suspicious = [];
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].trim();
        if (!line.includes("{")) {
            continue;
        }
        const beforeBrace = line.slice(0, line.indexOf("{")).trim();
        if (beforeBrace.includes("$") && !beforeBrace.startsWith("/*")) {
            suspicious.push({ line: index + 1, content: beforeBrace });
        }
    }
    strictEqual(suspicious.length, 0, `Suspicious selectors found:\n${suspicious.map(({ line, content }) => `  Line ${line}: ${content}`).join("\n")}`);
});

test("styles.css defines keyboard-shortcuts-open exactly once", async () => {
    const cssContent = await readFile(cssPath, "utf-8");
    const pattern = /body\.keyboard-shortcuts-open\s*\{[^}]*\}/g;
    const matches = cssContent.match(pattern);
    ok(matches !== null && matches.length === 1, `Expected one body.keyboard-shortcuts-open rule, found ${matches?.length ?? 0}`);
});
