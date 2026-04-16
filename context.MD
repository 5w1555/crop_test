# SmartCrop — Current Codebase State (April 15, 2026)

This document is the **single source of truth** for the app’s current implementation status and the baseline for future development toward a **usable Shopify embedded app**.

---

## 1) Product Purpose (as implemented today)

SmartCrop is a Shopify embedded app that lets merchants:
- select images (file upload and Shopify product image lookup),
- run server-side cropping via a separate FastAPI service,
- receive cropped outputs (base64/media update payloads),
- and (in intended production flow) write cropped media back to Shopify.

The app combines:
- **Node/React Router Shopify app** (UI, auth, billing shell, Shopify Admin API access), and
- **Python FastAPI image processing service** (crop pipelines, face/salience heuristics, single + batch endpoints).

---

## 2) Architecture Snapshot

### 2.1 Node app (Shopify embedded app)
- Framework: React Router + Shopify App React Router server package.
- Session storage: Prisma session storage on PostgreSQL.
- Main crop UI route: `/app/crop`.
- Internal API routes:
  - `/api/crop` (crop action endpoint)
  - `/api/products` (Shopify product media search)
  - `/app/api-status` (FastAPI health check proxy)

### 2.2 FastAPI service
- Exposes:
  - `GET /health`
  - `POST /crop`
  - `POST /crop/batch`
  - `GET /downloads/{download_token}`
- Processing stack includes face detection (InsightFace), salience functions, ICC/profile handling, optional HEIC/RAW handling, and image filtering options.

### 2.3 Deployment shape (Render)
- `render.yaml` defines two web services:
  - `smart-crop-app` (Node)
  - `smart-crop-api` (Python)
- Shared secret model: `SMARTCROP_API_TOKEN` must match on both services.

---

## 3) What is implemented and working in the code

### 3.1 Shopify app foundation
- Shopify app server is configured with App Store distribution, embedded mode, current API version, OAuth/auth helpers, and Prisma-backed sessions.
- Webhook routes exist (app uninstall/scopes update + compliance routes).

### 3.2 Crop UX and request wiring
- `CropControlCenter` provides an advanced control surface:
  - pipeline selection (`auto`, `face`, `salience`, `heuristic` behavior in UI),
  - method selection by pipeline,
  - aspect ratio, margins,
  - anchor hint,
  - filters,
  - head rotation heuristic toggle.
- Supports source modes:
  - local uploads,
  - Shopify product image search and image URL selection.
- `/app/crop` action forwards these crop options to SmartCrop API client.

### 3.3 Crop API integration
- Node client service chooses endpoint dynamically:
  - single file -> `/crop`
  - multiple files -> `/crop/batch`
- Includes timeout handling, network error normalization, and shared-secret header forwarding (`X-SmartCrop-Token`).
- Health probe endpoint exists via `testSmartCropApi()` against FastAPI `/health`.

### 3.4 Data model readiness
Prisma schema includes:
- `Session` for Shopify sessions.
- `ShopPlanUsage` for usage limits/tracking.
- `CropJob` for async/batch job lifecycle tracking.
- `MediaWritebackIdempotency` for deduped writeback semantics.

**Important:** The schema supports production-grade workflows, but not all tables appear fully exercised by current route handlers yet.

### 3.5 Billing scaffold
- Billing helpers are present (`Pro plan`, test-mode switch, request/cancel/check functions).
- Core billing wiring exists in `shopify.server.js`.

---

## 4) Gaps that prevent “fully usable Shopify app” status

These are the highest-impact gaps inferred from current code and docs.

### 4.1 Inconsistent crop route behavior (`/app/crop` vs `/api/crop`)
- `/app/crop` action forwards richer option set (pipeline/method/filters/anchor/head rotation).
- `/api/crop` currently forces `pipeline: "auto"` and handles fewer options.

**Impact:** Different behavior paths can produce unexpected results and undermine reliability.

### 4.2 UI currently custom-styled rather than Shopify Polaris/App Bridge components
- Functional, but not yet aligned with expected embedded Shopify UX conventions and accessibility patterns.

**Impact:** Merchant trust and app review readiness may be weaker.

### 4.3 “Write back to Shopify media” needs explicit hardening/verification path
- Product search is implemented; crop output plumbing exists.
- But explicit end-to-end server-side mutation + idempotency usage + user-visible success accounting should be validated and made transparent in the UX.

**Impact:** Merchant value depends on reliable in-place media updates, not just preview/download outputs.

### 4.4 Observability + reliability UX gaps
- Status and errors are present but not yet at full per-file lifecycle quality (queued/processing/completed/failed with retry guidance).
- Need stronger pipeline branch observability for debugging and support.

### 4.5 Test coverage is thin for this complexity level
- Existing tests are mostly around crop contract in FastAPI test folder.
- Node route integration and Shopify media writeback behavior need deeper automated coverage.

---

## 5) Definition of “usable app on Shopify” (target state)

The app should be considered usable when all are true:
1. Merchant can install, auth, and stay in-session reliably.
2. Merchant can search/select Shopify media or upload local media.
3. Merchant can preview and run crop for single and multi-file jobs.
4. Merchant gets clear per-file status + actionable failures.
5. Cropped output writes back to Shopify media reliably with idempotency safeguards.
6. Usage/billing behavior is predictable (free/pro usage model enforced).
7. App has operational visibility (health, logs, branch path, failure metrics).
8. Core workflows are covered by automated tests.

---

## 6) Recommended development plan from current state

### Phase A — Stabilize API behavior parity (P0)
1. Consolidate crop request parsing/validation into a shared utility used by both `/app/crop` and `/api/crop`.
2. Ensure both routes pass identical crop option contracts.
3. Standardize response schema (`status`, `mediaUpdates`, `summary`, `errors`) across all crop paths.

**Exit criteria:** Same input yields same behavior from both routes.

### Phase B — Production writeback reliability (P0)
1. Implement/verify explicit Shopify media mutation path for each successful crop.
2. Enforce idempotency via `MediaWritebackIdempotency` table on write operations.
3. Store audit metadata (source media id, destination id, params hash, status/error).

**Exit criteria:** Re-running same crop request is safe and deterministic.

### Phase C — Merchant UX readiness (P1)
1. Migrate main control surfaces to Polaris/App Bridge components.
2. Add per-file progress timeline and clearer error banners.
3. Add explicit “Preview estimate vs final processed output” UI labels.

**Exit criteria:** A non-technical merchant can complete crop->writeback without confusion.

### Phase D — Billing and plan enforcement (P1)
1. Add usage accounting increments on successful processing/writeback.
2. Enforce free-tier limits based on `ShopPlanUsage`.
3. Add in-app billing page state clarity (current plan, quota, upgrade CTA).

**Exit criteria:** Plan behavior is enforceable and transparent.

### Phase E — Test and release hardening (P0/P1)
1. Node route tests:
   - `/api/crop` single + batch,
   - `/api/products` auth + mapping,
   - error normalization paths.
2. FastAPI tests:
   - branch coverage for `/crop` and `/crop/batch`,
   - auth token enforcement,
   - contract consistency for success/error.
3. Add a smoke checklist for deploy (health + Shopify auth + crop + writeback).

**Exit criteria:** Regressions are caught before deploy.

---

## 7) Immediate next tasks (suggested first sprint)

1. **Unify crop contract layer** between `/app/crop` and `/api/crop`.
2. **Add explicit writeback service module** with idempotency checks.
3. **Instrument pipeline branch logging** (route + FastAPI response metadata).
4. **Ship 6–8 integration tests** covering single/batch success + mixed failures.
5. **Polaris migration for core form/status components** (minimal first pass).

---

## 8) Risk register

- **Cold starts / timeouts** on free Render plans can degrade UX for larger jobs.
- **Auth context mismatch** (embedded + preview mode differences) can produce confusing failures.
- **Contract drift** between Node and FastAPI can break edge-case requests.
- **Model load/memory pressure** in FastAPI may impact batch reliability without queue controls.

---

## 9) Non-goals until stability is complete

- No major config churn across Shopify/Render/FastAPI unless required for incident fixes.
- No speculative feature expansion before contract parity + writeback reliability are complete.

---

## 10) Working assumptions

- Node app remains source of truth for merchant auth/session and Shopify API operations.
- FastAPI remains source of truth for crop computation.
- Direct media writeback (not ZIP-only fallback) is the primary merchant workflow.

---

## 11) Document ownership

Update this file whenever any of the following changes:
- API contracts between UI/Node/FastAPI,
- Shopify scopes/auth/billing behavior,
- DB models used in production flow,
- deployment/runtime assumptions.

If conflicts exist between historical docs and this file, **this file should be treated as the current operational baseline** until superseded.
