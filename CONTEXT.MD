# CONTEXT.md — crop_test (AI-Optimized Project Context)

## 1) What this repository is

`crop_test` is a **Shopify embedded app** (React Router + Shopify App Bridge web components) that lets merchants upload product images and run a **Smart Crop pipeline** backed by a separate **FastAPI** service.

At runtime, the system is two services:

1. **Node/React Router Shopify app** (this repo root)
2. **Python FastAPI image service** (`fastapi_service/`)

The app includes:
- Shopify auth/session handling via `@shopify/shopify-app-react-router`
- Prisma/PostgreSQL session + plan usage persistence
- Plan gating (Free vs Pro) for image quota and available crop methods
- Billing workflow for a Pro subscription
- Batch crop + downloadable ZIP output

---

## 2) High-level architecture

### Node app responsibilities
- Authenticate Shopify admin requests.
- Show UI for upload/crop actions.
- Validate plan limits and allowed methods.
- Send images to FastAPI `/crop/batch`.
- Persist monthly usage counters.
- Expose a temporary download URL for the ZIP.

### FastAPI service responsibilities
- Accept secure uploads (`X-SmartCrop-Token`).
- Decode/normalize image formats (JPEG/PNG/HEIC/RAW support stack).
- Run face-aware crop logic (InsightFace + fallbacks).
- Return either single image (`/crop`) or ZIP (`/crop/batch`).
- Enforce size/batch/concurrency safeguards.

---

## 3) Key user flow (upload → crop → download)

1. Merchant opens `/app/additional`.
2. Loader checks FastAPI health and billing/plan state and fetches recent Shopify products for context.
3. User uploads one or more images and chooses a crop method.
4. Action validates files and plan capacity.
5. Node app posts files to FastAPI `/crop/batch`.
6. On success, Node stores the ZIP temporarily and returns a short-lived download URL.
7. User clicks download; loader streams stored ZIP to browser.

---

## 4) Important routes and modules

### Core app routes
- `app/routes/app._index.jsx`: app home/checklist entry point.
- `app/routes/app.additional.jsx`: main crop UI + loader/action logic.
- `app/routes/app.billing.jsx`: start/cancel Pro subscription UI/flow.

### Shopify app wiring
- `app/shopify.server.js`: Shopify app config (API version, billing plan, session storage).
- `app/routes.js`: filesystem route registration via `flatRoutes()`.

### Smart crop integration
- `app/utils/smartCropClient.js`: calls FastAPI `/health`, `/crop`, `/crop/batch`; enforces shared token.
- `app/utils/preparedDownloads.server.js`: temporary server-side ZIP storage + tokenized download links.

### Plan/billing domain
- `app/utils/plan.js`: plan definitions and plan view shaping.
- `app/utils/plan.server.js`: usage persistence and quota/method checks.
- `app/utils/billing.js` + `app/utils/billing.server.js`: plan identifier + Shopify billing check/request helpers.

### Persistence
- `prisma/schema.prisma`:
  - `Session` model for Shopify sessions.
  - `ShopPlanUsage` model for monthly usage + current plan.

---

## 5) Data model and plan semantics

### `ShopPlanUsage`
- One record per shop (`shop` is unique).
- Tracks `plan`, `periodStart` (month start UTC), and `imagesProcessed`.
- Automatically resets usage at month boundaries.

### Plan behavior (as implemented)
- Free plan has lower monthly limit and restricted methods.
- Pro plan unlocks full face-detection method set and higher quota.
- Effective plan resolution can derive from:
  - active Shopify billing status,
  - persisted plan,
  - optional env override list (`PAID_PLAN_SHOPS`).

---

## 6) Environment configuration

### Node app required env
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL`
- `SCOPES`
- `DATABASE_URL`
- `DIRECT_DATABASE_URL`
- `SMARTCROP_API_URL`

### Node app recommended env
- `SHOPIFY_BILLING_TEST_MODE`
- `PAID_PLAN_SHOPS`
- `SMARTCROP_API_TOKEN`

### FastAPI env highlights
- `SMARTCROP_API_TOKEN` (required for protected endpoints)
- `SMARTCROP_FRONTEND_ORIGINS`
- `SMARTCROP_MAX_UPLOAD_MB`
- `SMARTCROP_MAX_BATCH_FILES`
- `SMARTCROP_MAX_CONCURRENCY`
- `SMARTCROP_ACQUIRE_TIMEOUT_SECONDS`
- `SMARTCROP_PRELOAD_MODEL`
- `SMARTCROP_MAX_MP`

---

## 7) Build, run, and test commands

### Node app
- Install: `npm ci`
- Local dev (Shopify CLI): `npm run dev`
- Build: `npm run build`
- Start server: `npm run start`
- DB setup/migrations: `npm run setup`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Unit tests: `npm test`

### FastAPI service
- Install deps: `pip install -r fastapi_service/requirements.txt`
- Run: `uvicorn main:app --host 0.0.0.0 --port 8000` (from `fastapi_service/`)

---

## 8) Deployment shape

`render.yaml` defines two Render services:
- `smart-crop-app` (Node web service)
- `smart-crop-api` (Python web service)

Production assumptions:
- PostgreSQL + Prisma migrations at startup (`npm run setup`).
- App and API communicate over `SMARTCROP_API_URL` + shared token.
- API uses conservative limits (`MAX_CONCURRENCY=1`, upload/batch caps) on free-tier infra.

---

## 9) Testing and quality signals

Existing tests are focused on core integration logic:
- `app/utils/smartCropClient.test.js`: endpoint construction, auth header, error handling.
- `app/utils/plan.server.test.js`: free-plan method restrictions and capacity checks.

There are no broad e2e tests in this repo; most risk is concentrated in route action/loader behavior and API contract consistency.

---

## 10) Operational gotchas (important for AI agents)

1. **Token mismatch is a hard failure**
   - Node sends `X-SmartCrop-Token`; FastAPI enforces exact match.
2. **`SMARTCROP_API_TOKEN` is effectively required in Node**
   - client helper throws if missing before outbound crop/health requests.
3. **Plan gating can silently force method changes**
   - Free plan requests may be coerced to fallback method.
4. **Download links are ephemeral**
   - ZIP downloads are tokenized and stored temporarily server-side.
5. **Billing cancellation path uses test mode flag in code path**
   - verify behavior before production billing changes.

---

## 11) Suggested starting points for future contributors/agents

If implementing feature work, inspect in this order:
1. `app/routes/app.additional.jsx` (primary user workflow)
2. `app/utils/smartCropClient.js` (service contract)
3. `app/utils/plan.server.js` + `app/utils/plan.js` (gating/usage semantics)
4. `fastapi_service/main.py` (actual crop behavior and limits)
5. `prisma/schema.prisma` + migrations (persisted state impact)

If debugging production issues, first verify:
- env var completeness/validity,
- Node ↔ API token alignment,
- API health endpoint reachability,
- monthly usage counters for the shop,
- Render service logs for timeout/memory saturation on batch requests.
