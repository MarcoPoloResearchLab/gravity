// @ts-check

const mappingStore = new WeakMap();

/**
 * Build a mapping between rendered plain-text offsets and markdown indexes.
 * @param {string} source
 * @returns {{ markdownSource: string, plain: string, map: number[], sourceLength: number }}
 */
export function buildPlainTextMapping(source) {
    const safeSource = typeof source === "string" ? source : "";
    const plainChars = [];
    const map = [];
    const closingRuns = new Map();

    const appendChar = (char, index) => {
        plainChars.push(char);
        map.push(index);
    };

    const processSegment = (start, end) => {
        let pointer = start;
        while (pointer < end) {
            if (closingRuns.has(pointer)) {
                pointer += closingRuns.get(pointer);
                continue;
            }
            const char = safeSource[pointer];
            if (char === "\r") {
                pointer += 1;
                continue;
            }
            if (char === "\n") {
                appendChar("\n", pointer);
                pointer += 1;
                continue;
            }
            if (char === "\\" && pointer + 1 < end) {
                appendChar(safeSource[pointer + 1], pointer + 1);
                pointer += 2;
                continue;
            }
            if (char === "`") {
                const fenceLength = countRunOfChar(safeSource, pointer, "`");
                const closing = findClosingBackticks(safeSource, pointer + fenceLength, fenceLength, end);
                if (closing === -1) {
                    appendChar(char, pointer);
                    pointer += 1;
                    continue;
                }
                pointer += fenceLength;
                while (pointer < closing) {
                    appendChar(safeSource[pointer], pointer);
                    pointer += 1;
                }
                pointer = closing + fenceLength;
                continue;
            }
            if (char === "!" && pointer + 1 < end && safeSource[pointer + 1] === "[") {
                const closing = findClosingBracket(safeSource, pointer + 2, end, "[", "]");
                if (closing === -1) {
                    pointer += 1;
                    continue;
                }
                processSegment(pointer + 2, closing);
                pointer = closing + 1;
                if (safeSource[pointer] === "(") {
                    const closingParen = findClosingBracket(safeSource, pointer + 1, end, "(", ")");
                    pointer = closingParen === -1 ? end : closingParen + 1;
                }
                continue;
            }
            if (char === "[" && !isEscaped(safeSource, pointer)) {
                const closing = findClosingBracket(safeSource, pointer + 1, end, "[", "]");
                if (closing === -1) {
                    appendChar(char, pointer);
                    pointer += 1;
                    continue;
                }
                processSegment(pointer + 1, closing);
                pointer = closing + 1;
                if (safeSource[pointer] === "(") {
                    const closingParen = findClosingBracket(safeSource, pointer + 1, end, "(", ")");
                    pointer = closingParen === -1 ? end : closingParen + 1;
                } else if (safeSource[pointer] === "[") {
                    const closingRef = findClosingBracket(safeSource, pointer + 1, end, "[", "]");
                    pointer = closingRef === -1 ? end : closingRef + 1;
                }
                continue;
            }
            if ((char === "*" || char === "_" || char === "~") && !isEscaped(safeSource, pointer)) {
                const runLength = countRunOfChar(safeSource, pointer, char);
                const closing = findMatchingFormatting(safeSource, pointer + runLength, char, runLength, end);
                if (closing !== -1) {
                    closingRuns.set(closing, runLength);
                    pointer += runLength;
                    continue;
                }
            }
            if (isListMarker(safeSource, pointer, start)) {
                pointer = skipListMarker(safeSource, pointer, end);
                continue;
            }
            if (isHeadingMarker(safeSource, pointer, start)) {
                pointer = skipHeadingMarker(safeSource, pointer, end);
                continue;
            }
            if (isBlockquoteMarker(safeSource, pointer, start)) {
                pointer = skipBlockquoteMarker(safeSource, pointer, end);
                continue;
            }
            if (isTableDelimiter(safeSource, pointer, start, end)) {
                pointer += 1;
                continue;
            }
            appendChar(char, pointer);
            pointer += 1;
        }
    };

    processSegment(0, safeSource.length);
    return {
        markdownSource: safeSource,
        plain: plainChars.join(""),
        map,
        sourceLength: safeSource.length
    };
}

/**
 * Store the mapping for reuse when responding to click offsets.
 * @param {HTMLElement} card
 * @param {{ markdownSource: string, plain: string, map: number[], sourceLength: number }} mapping
 * @returns {void}
 */
export function storePlainTextMapping(card, mapping) {
    if (!(card instanceof HTMLElement) || !mapping) {
        return;
    }
    mappingStore.set(card, mapping);
}

/**
 * Retrieve a previously stored mapping for a card.
 * @param {HTMLElement} card
 * @returns {{ markdownSource: string, plain: string, map: number[], sourceLength: number }|null}
 */
export function getPlainTextMapping(card) {
    if (!(card instanceof HTMLElement)) {
        return null;
    }
    return mappingStore.get(card) ?? null;
}

export function clearPlainTextMapping(card) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    mappingStore.delete(card);
}

/**
 * Convert a plain-text offset to its nearest markdown index using a mapping.
 * @param {{ markdownSource: string, map: number[], sourceLength: number }} mapping
 * @param {number} plainOffset
 * @returns {number}
 */
export function mapPlainOffsetToMarkdown(mapping, plainOffset) {
    if (!mapping || mapping.map.length === 0) {
        return 0;
    }
    const initialIndex = resolveMarkdownIndex(mapping, plainOffset);
    const adjustedPlainOffset = adjustPlainOffsetForListMarkers(mapping.markdownSource, initialIndex, plainOffset);
    if (adjustedPlainOffset !== plainOffset) {
        return resolveMarkdownIndex(mapping, adjustedPlainOffset);
    }
    return initialIndex;
}

/**
 * Annotate a rendered HTML view with markdown position metadata.
 * @param {HTMLElement} card
 * @param {HTMLElement} container
 * @param {string} markdownSource
 * @returns {void}
 */
export function annotateHtmlWithMarkdownPositions(card, container, markdownSource) {
    if (!(card instanceof HTMLElement) || !(container instanceof HTMLElement)) {
        return;
    }
    const mapping = buildPlainTextMapping(markdownSource);
    storePlainTextMapping(card, mapping);
    const doc = container.ownerDocument;
    if (!doc) {
        return;
    }
    const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let plainCursor = 0;
    while (walker.nextNode()) {
        const current = walker.currentNode;
        const textValue = typeof current.textContent === "string" ? current.textContent : "";
        if (textValue.length === 0) {
            continue;
        }
        const plainStart = plainCursor;
        const plainEnd = plainStart + textValue.length;
        const markdownStart = resolveMarkdownIndex(mapping, plainStart);
        const markdownEnd = resolveMarkdownIndex(mapping, Math.max(plainEnd - 1, 0)) + 1;
        const parent = current.parentElement;
        if (parent instanceof HTMLElement) {
            const prevStart = Number(parent.dataset.mdStart ?? "");
            if (Number.isNaN(prevStart) || markdownStart < prevStart) {
                parent.dataset.mdStart = String(markdownStart);
            }
            const prevEnd = Number(parent.dataset.mdEnd ?? "");
            if (Number.isNaN(prevEnd) || markdownEnd > prevEnd) {
                parent.dataset.mdEnd = String(markdownEnd);
            }
        }
        plainCursor = plainEnd;
    }
}

function resolveMarkdownIndex(mapping, plainOffset) {
    const clamped = Math.max(0, Math.min(Math.floor(plainOffset), mapping.map.length));
    if (clamped === mapping.map.length) {
        return mapping.sourceLength;
    }
    const resolved = mapping.map[clamped];
    if (typeof resolved === "number" && !Number.isNaN(resolved)) {
        return resolved;
    }
    for (let index = clamped - 1; index >= 0; index -= 1) {
        const candidate = mapping.map[index];
        if (typeof candidate === "number" && !Number.isNaN(candidate)) {
            return candidate;
        }
    }
    return 0;
}

function adjustPlainOffsetForListMarkers(source, approxIndex, plainOffset) {
    if (!Number.isFinite(plainOffset) || plainOffset <= 0 || approxIndex <= 0) {
        return plainOffset;
    }
    const lineBreakIndex = source.lastIndexOf("\n", approxIndex - 1);
    const lineStart = lineBreakIndex === -1 ? 0 : lineBreakIndex + 1;
    const lineSlice = source.slice(lineStart);
    const match = lineSlice.match(/^(\s*)([*+-]|\d+[.)])(\s+)/);
    if (!match) {
        return plainOffset;
    }
    const markerSpan = match[0].length;
    if (approxIndex < lineStart + markerSpan) {
        return plainOffset;
    }
    const trailingSpaces = match[3].length;
    if (!trailingSpaces) {
        return plainOffset;
    }
    const adjustment = lineStart === 0
        ? Math.max(0, trailingSpaces - 1)
        : trailingSpaces;
    if (adjustment === 0) {
        return plainOffset;
    }
    const adjusted = plainOffset + adjustment;
    return adjusted > Number.MAX_SAFE_INTEGER ? plainOffset : adjusted;
}

function countRunOfChar(value, start, char) {
    let index = start;
    while (index < value.length && value[index] === char) {
        index += 1;
    }
    return index - start;
}

function findClosingBackticks(value, start, runLength, limit) {
    let index = start;
    while (index < limit) {
        if (value[index] === "`" && !isEscaped(value, index)) {
            const span = countRunOfChar(value, index, "`");
            if (span === runLength) {
                return index;
            }
            index += span;
            continue;
        }
        index += 1;
    }
    return -1;
}

function findClosingBracket(value, start, limit, openChar, closeChar) {
    let depth = 0;
    for (let index = start; index < limit; index += 1) {
        const current = value[index];
        if (current === "\\") {
            index += 1;
            continue;
        }
        if (current === openChar) {
            depth += 1;
            continue;
        }
        if (current === closeChar) {
            if (depth === 0) {
                return index;
            }
            depth -= 1;
        }
    }
    return -1;
}

function findMatchingFormatting(value, start, char, runLength, limit) {
    let index = start;
    while (index < limit) {
        if (value[index] === char && !isEscaped(value, index)) {
            const span = countRunOfChar(value, index, char);
            if (span === runLength) {
                return index;
            }
            index += span;
            continue;
        }
        index += 1;
    }
    return -1;
}

function isEscaped(value, index) {
    let preceding = index - 1;
    let count = 0;
    while (preceding >= 0 && value[preceding] === "\\") {
        count += 1;
        preceding -= 1;
    }
    return count % 2 === 1;
}

function isListMarker(value, index, segmentStart) {
    const atLineStart = index === segmentStart || value[index - 1] === "\n";
    if (!atLineStart) {
        return false;
    }
    const char = value[index];
    if (char === "-" || char === "+" || char === "*") {
        const next = value[index + 1];
        return next === " " || next === "\t";
    }
    if (char >= "0" && char <= "9") {
        let pointer = index;
        while (pointer < value.length && value[pointer] >= "0" && value[pointer] <= "9") {
            pointer += 1;
        }
        return value[pointer] === "." && (value[pointer + 1] === " " || value[pointer + 1] === "\t");
    }
    return false;
}

function skipListMarker(value, index, limit) {
    if (value[index] === "-" || value[index] === "+" || value[index] === "*") {
        index += 1;
        while (index < limit && (value[index] === " " || value[index] === "\t")) {
            index += 1;
        }
        return index;
    }
    if (value[index] >= "0" && value[index] <= "9") {
        while (index < limit && value[index] >= "0" && value[index] <= "9") {
            index += 1;
        }
        if (value[index] === ".") {
            index += 1;
        }
        while (index < limit && (value[index] === " " || value[index] === "\t")) {
            index += 1;
        }
        return index;
    }
    return index;
}

function isHeadingMarker(value, index, segmentStart) {
    const atLineStart = index === segmentStart || value[index - 1] === "\n";
    if (!atLineStart || value[index] !== "#") {
        return false;
    }
    return true;
}

function skipHeadingMarker(value, index, limit) {
    while (index < limit && value[index] === "#") {
        index += 1;
    }
    while (index < limit && value[index] === " ") {
        index += 1;
    }
    return index;
}

function isBlockquoteMarker(value, index, segmentStart) {
    const atLineStart = index === segmentStart || value[index - 1] === "\n";
    return atLineStart && value[index] === ">";
}

function skipBlockquoteMarker(value, index, limit) {
    index += 1;
    if (value[index] === " ") {
        index += 1;
    }
    return index;
}

function isTableDelimiter(value, index, segmentStart, segmentEnd) {
    if (value[index] !== "|") {
        return false;
    }
    let start = segmentStart;
    let end = segmentEnd;
    while (start > 0 && value[start - 1] !== "\n") start -= 1;
    while (end < value.length && value[end] !== "\n") end += 1;
    const row = value.slice(start, end);
    return row.includes("|");
}
