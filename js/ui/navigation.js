// @ts-check

const KEY_ARROW_UP = "ArrowUp";
const KEY_ARROW_DOWN = "ArrowDown";
const LINE_BREAK_CHARACTER = "\n";

/**
 * Determine whether a previous editor should gain focus.
 * @param {KeyboardEvent} event
 * @param {HTMLTextAreaElement} editor
 * @returns {boolean}
 */
export function shouldNavigateToPreviousEditor(event, editor) {
    if (event.key !== KEY_ARROW_UP) return false;
    if (hasNavigationModifier(event)) return false;
    if (!isSelectionCollapsed(editor)) return false;
    return isCaretOnFirstLine(editor);
}

/**
 * Determine whether a next editor should gain focus.
 * @param {KeyboardEvent} event
 * @param {HTMLTextAreaElement} editor
 * @returns {boolean}
 */
export function shouldNavigateToNextEditor(event, editor) {
    if (event.key !== KEY_ARROW_DOWN) return false;
    if (hasNavigationModifier(event)) return false;
    if (!isSelectionCollapsed(editor)) return false;
    return isCaretOnLastLine(editor);
}

/**
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
export function hasNavigationModifier(event) {
    return event.shiftKey || event.altKey || event.ctrlKey || event.metaKey;
}

/**
 * @param {HTMLTextAreaElement} editor
 * @returns {boolean}
 */
export function isSelectionCollapsed(editor) {
    return editor.selectionStart === editor.selectionEnd;
}

/**
 * @param {HTMLTextAreaElement} editor
 * @returns {boolean}
 */
export function isCaretOnFirstLine(editor) {
    const caretPosition = editor.selectionStart ?? 0;
    const textBeforeCaret = editor.value.slice(0, caretPosition);
    return !textBeforeCaret.includes(LINE_BREAK_CHARACTER);
}

/**
 * @param {HTMLTextAreaElement} editor
 * @returns {boolean}
 */
export function isCaretOnLastLine(editor) {
    const caretPosition = editor.selectionEnd ?? editor.value.length;
    const textAfterCaret = editor.value.slice(caretPosition);
    return !textAfterCaret.includes(LINE_BREAK_CHARACTER);
}
