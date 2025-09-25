const KEY_ARROW_UP = "ArrowUp";
const KEY_ARROW_DOWN = "ArrowDown";
const LINE_BREAK_CHARACTER = "\n";

export function shouldNavigateToPreviousEditor(event, editor) {
    if (event.key !== KEY_ARROW_UP) return false;
    if (hasNavigationModifier(event)) return false;
    if (!isSelectionCollapsed(editor)) return false;
    return isCaretOnFirstLine(editor);
}

export function shouldNavigateToNextEditor(event, editor) {
    if (event.key !== KEY_ARROW_DOWN) return false;
    if (hasNavigationModifier(event)) return false;
    if (!isSelectionCollapsed(editor)) return false;
    return isCaretOnLastLine(editor);
}

export function hasNavigationModifier(event) {
    return event.shiftKey || event.altKey || event.ctrlKey || event.metaKey;
}

export function isSelectionCollapsed(editor) {
    return editor.selectionStart === editor.selectionEnd;
}

export function isCaretOnFirstLine(editor) {
    const caretPosition = editor.selectionStart ?? 0;
    const textBeforeCaret = editor.value.slice(0, caretPosition);
    return !textBeforeCaret.includes(LINE_BREAK_CHARACTER);
}

export function isCaretOnLastLine(editor) {
    const caretPosition = editor.selectionEnd ?? editor.value.length;
    const textAfterCaret = editor.value.slice(caretPosition);
    return !textAfterCaret.includes(LINE_BREAK_CHARACTER);
}
