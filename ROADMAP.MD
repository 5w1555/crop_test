# ROADMAP


## Partial delivery update (March 29, 2026)

### Implemented in this increment
- Expanded the **Crop settings** UI into an **Advanced controls** surface for:
  - pipeline selection (`auto`, `face`, `salience`, `heuristic`),
  - method selection aligned to the chosen pipeline,
  - anchor hint control,
  - optional filters (`sharpen`, `detail`, `grayscale`),
  - explicit toggle for the head-rotation heuristic.
- Wired the new controls end-to-end from Remix route action to FastAPI form payload.
- Added FastAPI support for `use_head_rotation_heuristic` so `head_bust` cropping can opt out of rotation heuristics.

### To be implemented
- Full manual crop coordinate editor in the UI (drag box + numeric `crop_coordinates`).
- Fine-grained face-detection controls currently internal to FastAPI (`conf_threshold`, lighting/sharpen pre-detect knobs, resize limits).
- A visual preview overlay for anchor/aspect/margins before running crop.
- Save/load user presets for crop configurations.
- Per-method contextual help and automatic compatibility guards.

---

## Current Status (March 2026)

The app is currently functioning in **preview mode** and is usable for core upload/crop flows.

### Stability rule (critical)
- **Do not change any app configuration for now** (Shopify app config, Vite config, deployment config, FastAPI service config, env shape, or pipeline defaults) unless a dedicated stabilization/release task explicitly authorizes it.
- Development should prioritize feature-layer changes and test coverage over configuration churn.

---

## Product Goals

1. Make cropping workflows fully controllable by users.
2. Improve preview quality and confidence before processing/download.
3. Validate and harden batch/pipeline execution behavior.
4. Preserve stability while in preview (no config mutations).

---

## Priority Roadmap

## P0 — Preview Hardening (Immediate)

### 1) Multi-file handling end-to-end
Implement robust multi-file support across UI, API routes, and FastAPI integration:
- Accept/select many files in the UI with clear per-file state.
- Queue and process files predictably (ordered + cancelable where feasible).
- Return per-file result payloads (success/failure, crop metadata, output URLs/base64).
- Ensure users can download single results and all results in one action.

### 2) Real-time preview box with heuristic-driven updates
Add a live preview panel that updates before final processing:
- Preview should update in real time when target aspect ratio changes.
- Preview should reflect heuristic choices (salience/subject area assumptions) so users can see likely crop framing.
- Keep this as a "preview estimate" until user confirms final crop.
- Show clear distinction between live preview and final output.

### 3) Expose FastAPI crop capabilities in the user flow
Current UX should evolve so the user has complete access to crop behavior exposed by `fastapi_service/main.py`:
- Surface available crop options in the UI (not hidden behind one auto path).
- Let users choose/manual override crop strategy.
- Re-think the current "auto pipeline" to be transparent and optional, not mandatory.
- Provide safe presets + advanced controls instead of hard-coded behavior.

### 4) Verify processing pipeline execution path
Audit and test that actual pipeline behavior matches intended implementation:
- Confirm whether batch-processing logic present in `main.py` is truly executed in app-triggered flows.
- Add instrumentation/logging to show which pipeline branch runs for each request.
- Add route/service tests to prevent regressions where code exists but is not reachable.

---

## P1 — UX and Reliability Improvements (Next)

### 5) Better status and error visibility
- Replace alert-like messaging with structured inline status in the app UI.
- Add per-file progress indicators: queued, processing, complete, failed.
- Include actionable error messages (file rejected, crop impossible, service timeout, etc.).

### 6) Output consistency and metadata
- Standardize output metadata (input dimensions, target ratio, crop box, confidence/heuristic score, timing).
- Ensure the same metadata schema is returned for single and batch operations.

### 7) Contract and integration tests
- Expand tests across route handlers and FastAPI contracts for:
  - single-file happy path,
  - multi-file mixed success,
  - manual override behavior,
  - batch branch verification.

---

## P2 — Post-Preview Readiness (Later)

### 8) Performance and scaling checks
- Benchmark batch throughput and response time with realistic image sets.
- Add guardrails for large uploads and memory pressure.
- Introduce background-job/offline processing options if synchronous flow becomes a bottleneck.

### 9) Product polish for release
- Improve control-center UX for discoverability of advanced crop controls.
- Add docs for recommended workflow (auto vs manual).
- Prepare release checklist and migration notes.

---

## Definition of Done for Preview Exit

Preview can be considered ready to move toward general availability once:
- Multi-file handling is fully implemented and tested.
- Real-time preview updates reliably with aspect-ratio and heuristic changes.
- Users have full, explicit control over available crop options from FastAPI.
- Pipeline execution paths (including batch logic) are verified by automated tests.
- No unauthorized config changes were introduced during preview hardening.

---

## Working Rules During This Roadmap

- Keep all changes backwards-compatible where possible.
- Favor incremental PRs with focused scope (UI controls, API wiring, pipeline verification, tests).
- Add tests alongside each behavior change.
- Maintain the **no-config-change** constraint until preview stabilization is complete.
