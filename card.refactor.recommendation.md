## card.js Refactor Recommendations

### Current Friction Points
- The module blends note persistence, viewport anchoring, EasyMDE wiring, and UI event orchestration, inflating the file beyond 1.9k lines and creating implicit coupling between concerns.
- Scroll anchoring relies on ad-hoc helpers (`captureViewportAnchor`, `maintainCardViewport`) that live alongside markdown transforms, making it hard to reason about editing flows or reuse anchoring in other surfaces.
- Lifecycle bookkeeping (card state management, markdown editor setup, bubbling logic) repeats selector queries and mixes DOM mutations with data updates, increasing the risk of reintroducing inline-editor flakes.

### Recommended Decomposition
1. **Viewport Module (`ui/card/viewport.js`)**
   - Expose pure helpers for capturing anchor snapshots, computing target positions, and applying scroll compensation.
   - Provide deterministic unit coverage focused on scroll math to decouple anchoring from card orchestration tests.
2. **Editing Lifecycle Module (`ui/card/editLifecycle.js`)**
   - Encapsulate entering/editing/finalizing flows (including `enableInPlaceEditing`, `finalizeCard`, height locking, suppression handling).
   - Accept dependencies (viewport utilities, store sync, telemetry) via parameters to simplify testing and guard against cross-module mutations.
3. **Rendering/Persistence Coordinator (`ui/card/renderPipeline.js`)**
   - Own markdown → HTML transformations, attachment reconciliation, and bubbling decisions; this isolates side effects currently spread across `persistCardState`, `bubbleCardToTop`, and HTML view builders.
4. **Event Wiring Wrapper (`ui/card/index.js`)**
   - Re-export the composed API that `card.js` currently provides so existing imports continue to work during migration; gradually move consumers to narrower entry points.

### Incremental Migration Plan
1. **Introduce Viewport Helper Module**
   - Move `captureViewportAnchor`, `maintainCardViewport`, `computeCenteredCardTop`, and related constants into `viewport.js`.
   - Add focused unit tests (using JSDOM or mocked dimensions) to confirm anchoring math across edge cases (top aligned, bottom aligned, oversized cards).
2. **Extract Editing Lifecycle**
   - Relocate `enableInPlaceEditing`, `finalizeCard`, and suppression helpers into `editLifecycle.js`, injecting dependencies for viewport adjustments and store syncing.
   - Replace direct DOM queries with a lightweight card context object (pre-resolved references) to reduce repeated lookups and shrink per-call complexity.
3. **Modularize Persistence & Rendering**
   - Rehome `persistCardState`, HTML view rebuilds, and attachment transforms into a dedicated coordinator to separate data mutations from UI classes.
   - Introduce an explicit return contract (e.g., `{ recordUpdated, htmlViewRefreshed }`) so call sites can respond without relying on side effects.
4. **Staged Consumer Updates**
   - Update `card.js` to delegate to the new modules while preserving the existing public signature; once stable, split `card.js` into a thin façade or remove it outright.
   - Adjust related tests to import the narrower modules so future changes remain localized.

### Testing & Safety Net
- Expand unit coverage around viewport math and editing lifecycle transitions; lean on Puppeteer specs for end-to-end verification of bubbling, blur retention, and anchoring.
- Maintain the seeded flake regression commands (`npm test -- --iterations=1 --seed=0x2ab68857`, `--seed=0x1aef4350`) as a pre-merge gate until the refactor lands.

### Risk Mitigations
- Ship in feature-flagged increments: first swap in the viewport module, verify stability, then proceed with lifecycle and persistence extractions.
- Keep telemetry hooks (where needed) behind debug toggles so CI noise stays low while diagnosing future regressions.
