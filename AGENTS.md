# AGENTS.md

## Gravity Notes

## Front-End Coding Standards (Browser ES Modules with Alpine.js + Bootstrap)

### 1. Naming & Identifiers

* No single-letter or non-descriptive names.
* **camelCase** → variables & functions.
* **PascalCase** → Alpine factories / classes.
* **SCREAMING_SNAKE_CASE** → constants.
* Event handlers named by behavior (`handleSpinButtonClick`, not `onClick`).

### 2. State & Events

* **Local by default**: `x-data` owns its own state.
* **Shared state** only via `Alpine.store` when truly necessary.
* **Events for communication**: use `$dispatch` / `$listen` to link components.
* Prefer **DOM-scoped events** (bubbling inside a panel) over `.window`. Use scope IDs only if DOM hierarchy forces it.
* Notifications, modals, and similar components must be event-driven; they cannot show unless triggered by a defined event.

### 3. Dead Code & Duplication

* No unused variables, imports, or exports.
* No duplicate logic; extract helpers.
* One source of truth for constants or repeated transforms.

### 4. Strings & Enums

* All user-facing strings live in `constants.js`.
* Use `Object.freeze` or symbols for enums.
* Map keys must be constants, not arbitrary strings.

### 5. Code Style & Structure

* ES modules (`type="module"`), strict mode.
* Pure functions for transforms; Alpine factories (`function Foo() { return {…} }`) for stateful components.
* No mutation of imports; no parameter mutation.
* DOM logic in `ui/`; domain logic in `core/`; utilities in `utils/`.

### 6. Dependencies & Organization

* CDN-hosted dependencies only; no bundlers.
* Node tooling is permitted for **tests only**.
* Layout:

  ```
  /assets/{css,img,audio}
  /data/*.json
  /js/
    constants.js
    types.d.js
    utils/
    core/
    ui/
    app.js   # composition root
  index.html
  ```

### 7. Testing

* Puppeteer permitted; Playwright forbidden.
* Node test harness (`npm test`) runs browser automation.
* Use table-driven test cases.
* Black-box tests only: public APIs and DOM.
* `tests/assert.js` provides `assertEqual`, `assertDeepEqual`, `assertThrows`.

### 8. Documentation

* JSDoc required for public functions, Alpine factories.
* `// @ts-check` at file top.
* `types.d.js` holds typedefs (`Dish`, `SpinResult`, etc.).
* Each domain module has a `doc.md` or `README.md`.

### 9. Refactors

* Plan changes; write bullet plan in PR description.
* Split files >300–400 lines.
* `app.js` wires dependencies, registers Alpine components, stores, and event bridges.

### 10. Error Handling & Logging

* Throw `Error`, never raw strings.
* Catch errors at user entry points (button actions, init).
* `utils/logging.js` wraps logging; no stray `console.log`.

### 11. Performance & UX

* Use `.debounce` modifiers for inputs.
* Batch DOM writes with `requestAnimationFrame`.
* Lazy-init heavy components (on intersection or first interaction).
* Cache selectors and avoid forced reflows.
* Animations must be async; no blocking waits.

### 12. Linting & Formatting

* ESLint run manually (Dockerized).
* Prettier only on explicit trigger, never autosave.
* Core enforced rules:

  * `no-unused-vars`
  * `no-implicit-globals`
  * `no-var`
  * `prefer-const`
  * `eqeqeq`
  * `no-magic-numbers` (allow 0,1,-1,100,360).

### 13. Data > Logic

* Validate catalogs (JSON) at boot.
* Logic assumes valid data; fail fast on schema errors.

### 14. Security & Boundaries

* No `eval`, no inline `onclick`.
* CSP-friendly ES modules only.
* Google Analytics snippet is the only sanctioned inline exception.
* All external calls go through `core/gateway.js`, mockable in tests.
