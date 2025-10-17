// @ts-check

import { test } from "node:test";
import { strictEqual, ok } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

test("CSS file has no template literal placeholders", async () => {
  const cssPath = resolve(process.cwd(), "styles.css");
  const cssContent = await readFile(cssPath, "utf-8");

  const templateLiteralPattern = /\$\{[^}]+\}/g;
  const matches = cssContent.match(templateLiteralPattern);

  strictEqual(
    matches,
    null,
    `CSS should not contain template literal placeholders like \${...}. Found: ${matches?.join(", ")}`
  );
});

test("CSS file has no invalid syntax markers", async () => {
  const cssPath = resolve(process.cwd(), "styles.css");
  const cssContent = await readFile(cssPath, "utf-8");

  const invalidMarkers = [
    /\?\?\?/,
    /TODO:/i,
    /FIXME:/i,
    /XXX:/
  ];

  for (const pattern of invalidMarkers) {
    const matches = cssContent.match(pattern);
    strictEqual(
      matches,
      null,
      `CSS should not contain invalid markers. Found: ${matches?.[0]}`
    );
  }
});

test("CSS file has balanced braces", async () => {
  const cssPath = resolve(process.cwd(), "styles.css");
  const cssContent = await readFile(cssPath, "utf-8");

  const openBraces = (cssContent.match(/\{/g) || []).length;
  const closeBraces = (cssContent.match(/\}/g) || []).length;

  strictEqual(
    openBraces,
    closeBraces,
    `CSS must have balanced braces. Open: ${openBraces}, Close: ${closeBraces}`
  );
});

test("CSS selectors are properly formed", async () => {
  const cssPath = resolve(process.cwd(), "styles.css");
  const cssContent = await readFile(cssPath, "utf-8");

  const lines = cssContent.split("\n");
  const suspiciousLines = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex].trim();

    if (line.includes("{")) {
      const beforeBrace = line.substring(0, line.indexOf("{")).trim();

      if (beforeBrace.includes("$") && !beforeBrace.startsWith("/*")) {
        suspiciousLines.push({
          line: lineIndex + 1,
          content: line
        });
      }
    }
  }

  strictEqual(
    suspiciousLines.length,
    0,
    `Found suspicious selectors with $ symbols:\n${suspiciousLines.map(s => `  Line ${s.line}: ${s.content}`).join("\n")}`
  );
});

test("CSS has no duplicate rule definitions for keyboard-shortcuts-open", async () => {
  const cssPath = resolve(process.cwd(), "styles.css");
  const cssContent = await readFile(cssPath, "utf-8");

  const keyboardShortcutsPattern = /body\.keyboard-shortcuts-open\s*\{[^}]*\}/g;
  const matches = cssContent.match(keyboardShortcutsPattern);

  ok(
    matches !== null && matches.length === 1,
    `Expected exactly one definition of body.keyboard-shortcuts-open, found ${matches?.length || 0}`
  );
});
