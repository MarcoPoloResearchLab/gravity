// @ts-check

export const LABEL_EXPORT_NOTES = "Export Notes";
export const LABEL_IMPORT_NOTES = "Import Notes";
export const LABEL_MERGE_DOWN = "Merge ↓";
export const LABEL_MERGE_UP = "Merge ↑";
export const LABEL_MOVE_UP = "▲";
export const LABEL_MOVE_DOWN = "▼";
export const LABEL_DELETE_NOTE = "🗑️";
export const LABEL_COPY_NOTE = "📋";
export const LABEL_PIN_NOTE = "";
export const LABEL_EDIT_MARKDOWN = "Edit (Markdown)";
export const LABEL_VIEW_RENDERED = "View (Rendered)";
export const LABEL_NEW_NOTE = "New note";
export const LABEL_APP_TITLE = "Gravity Notes";
export const LABEL_APP_SUBTITLE = "Append anywhere · Bubble to top · Auto-organize";
export const LABEL_PRIVACY_TERMS_LINK = "Privacy • Terms";
export const ARIA_LABEL_NEW_NOTE = "New note";
export const ARIA_LABEL_COPY_MARKDOWN = "Copy Markdown";
export const ARIA_LABEL_COPY_RENDERED = "Copy Rendered HTML";
export const BADGE_LABEL_CODE = "code";
export const LABEL_EXPAND_NOTE = "Expand note";
export const LABEL_COLLAPSE_NOTE = "Collapse note";
export const LABEL_KEYBOARD_SHORTCUTS = "Keyboard shortcuts";
export const LABEL_CLOSE_KEYBOARD_SHORTCUTS = "Close shortcuts";
export const LABEL_SHORTCUT_SAVE_NOTE = "Save note and bubble to top";
export const LABEL_SHORTCUT_SOFT_BREAK = "Insert soft line break";
export const LABEL_SHORTCUT_INDENT = "Indent selection";
export const LABEL_SHORTCUT_OUTDENT = "Outdent selection (negative indent)";
export const LABEL_SHORTCUT_NAVIGATE_PREVIOUS = "Focus previous note";
export const LABEL_SHORTCUT_NAVIGATE_NEXT = "Focus next note";
export const LABEL_SHORTCUT_OPEN_HELP = "Show keyboard shortcuts";
export const LABEL_SHORTCUT_DELETE_LINE = "Delete current line";
export const LABEL_SHORTCUT_DUPLICATE_LINE = "Duplicate current line";
export const ARIA_LABEL_PIN_NOTE = "Pin note";
export const ARIA_LABEL_UNPIN_NOTE = "Unpin note";
export const LABEL_ENTER_FULL_SCREEN = "Enter full screen";
export const LABEL_EXIT_FULL_SCREEN = "Exit full screen";
export const APP_BUILD_ID = "2024-10-05T12:00:00Z";
export const GOOGLE_ANALYTICS_MEASUREMENT_ID = "G-WYL7PDVTHN";

export const MESSAGE_NOTE_SAVED = "Saved";
export const MESSAGE_NOTES_IMPORTED = "Notes imported";
export const MESSAGE_NOTES_SKIPPED = "No new notes found";
export const MESSAGE_NOTES_IMPORT_FAILED = "Import failed";
export const MESSAGE_FULLSCREEN_TOGGLE_FAILED = "Unable to toggle full screen mode.";

export const FILENAME_EXPORT_NOTES_JSON = "gravity-notes.json";
export const ACCEPT_IMPORT_NOTES_JSON = "application/json";
export const STORAGE_KEY_AUTH_STATE = "gravityAuthState";

export const ERROR_IMPORT_INVALID_PAYLOAD = "Imported file must contain a JSON array of notes.";
export const ERROR_IMPORT_READ_FAILED = "Unable to read the selected import file.";
export const ERROR_NOTES_CONTAINER_NOT_FOUND = "Notes container not found";
export const ERROR_CLIPBOARD_COPY_FAILED = "Clipboard copy failed";
export const ERROR_IMAGE_READ_FAILED = "Failed to read pasted image";
export const ERROR_TOP_EDITOR_NOT_FOUND = "Top editor host not found";
export const ERROR_AUTHENTICATION_GENERIC = "Authentication error";

export const CLIPBOARD_MIME_NOTE = "application/x-gravity-note+json";
export const CLIPBOARD_DATA_ATTRIBUTE = "data-gravity-note-payload";
export const CLIPBOARD_METADATA_VERSION = 1;
export const CLIPBOARD_METADATA_DATA_URL_PREFIX = `data:${CLIPBOARD_MIME_NOTE};base64,`;
export const MESSAGE_NOTE_COPIED = "Copied to clipboard";
export const PASTED_IMAGE_ALT_TEXT_PREFIX = "Pasted image";

export const CLASSIFIER_ALLOWED_HANDLES = Object.freeze(["@self", "@alice", "@peter", "@nat"]);
export const CLASSIFIER_KNOWN_PROJECTS = Object.freeze(["Moving Maps", "Blanket"]);
export const CLASSIFIER_KNOWN_AREAS = Object.freeze(["Finance", "Infra", "Health", "Family Ops"]);
export const CLASSIFIER_CATEGORIES = Object.freeze(["Projects", "Areas", "Knowledge", "Journal", "Content", "People"]);
export const CLASSIFIER_STATUSES = Object.freeze(["idea", "draft", "final", "published", "blocked"]);
export const CLASSIFIER_PRIVACY = Object.freeze(["private", "shareable", "public"]);

export const DATA_URL_PREFIX = "data:";

export const EVENT_NOTE_CREATE = "gravity:note-create";
export const EVENT_NOTE_UPDATE = "gravity:note-update";
export const EVENT_NOTE_DELETE = "gravity:note-delete";
export const EVENT_NOTE_PIN_TOGGLE = "gravity:note-pin-toggle";
export const EVENT_NOTES_IMPORTED = "gravity:notes-imported";
export const EVENT_NOTIFICATION_REQUEST = "gravity:notify";
export const EVENT_AUTH_SIGN_IN = "gravity:auth-sign-in";
export const EVENT_AUTH_SIGN_OUT = "gravity:auth-sign-out";
export const EVENT_AUTH_ERROR = "gravity:auth-error";
export const EVENT_SYNC_SNAPSHOT_APPLIED = "gravity:sync-snapshot-applied";
export const REALTIME_EVENT_NOTE_CHANGE = "note-change";
export const REALTIME_EVENT_HEARTBEAT = "heartbeat";
export const REALTIME_SOURCE_BACKEND = "gravity-backend";

export const LABEL_SIGN_IN_WITH_GOOGLE = "Sign in with Google";
export const LABEL_SIGN_OUT = "Sign out";
