# Context — `fastapi_service/main.py` Contract vs Front-End (1:1 Audit)

## Scope
This file condenses the operational contract implemented in `fastapi_service/main.py` and compares it against the current front-end request paths.

---

## 1) `main.py` condensed contract (what the backend actually does)

### 1.1 Public endpoints
- `GET /` → service metadata.
- `GET /health` → `{ "status": "ok" }`.
- `POST /crop` → single-file crop.
- `POST /crop/batch` → multi-file crop.
- `GET /downloads/{download_token}` → ZIP download for batch outputs.

All crop endpoints require `X-SmartCrop-Token` when configured and return canonical payloads:
- `status`: `succeeded | partial_failure | failed`
- `mediaUpdates`: per-file results
- `summary`: counts + optional `batchDownloadUrl`
- `errors`: normalized error objects

### 1.2 Accepted crop request fields
`/crop` and `/crop/batch` both accept the same crop option fields:
- `pipeline`: `auto | face | salience | heuristic`
- `method`:
  - face/auto pipeline: `auto | head_bust | frontal | profile | chin | nose | below_lips | center_content`
  - salience/heuristic pipeline: `auto | center_content`
- `target_aspect_ratio`: decimal (`1.0`) or ratio string (`4:5`)
- margins: `margin_top`, `margin_right`, `margin_bottom`, `margin_left` (non-negative)
- `anchor_hint`: `auto | top | center | bottom | left | right`
- `crop_coordinates`: normalized fractional JSON `{left, top, width, height}` (+ optional source dimensions)
- `filters`: CSV or JSON array, allowed: `sharpen | detail | grayscale`
- `use_head_rotation_heuristic`: optional boolean
- `use_center_bias_heuristic`: optional boolean
- `override_image_size_limit`: optional boolean (can be disabled server-side)

### 1.3 Pipeline behavior
- `auto/face` pipeline:
  - runs InsightFace face detection + landmarks
  - no face → center/content fallback
  - method-specific branching (`head_bust`, `frontal`, `profile`, etc.)
- `salience/heuristic` pipeline:
  - salience mask inference
  - candidate crop box computation
  - optional center-bias fallback controlled by `use_center_bias_heuristic`

### 1.4 Post-processing order (important)
1. Manual crop (`crop_coordinates`) **or**
2. Aspect ratio enforcement + anchor hint
3. Margins
4. Filters

### 1.5 I/O, formats, and limits
- Handles standard images, HEIC/HEIF (if available), and RAW (if `rawpy` available).
- Preserves ICC profile when present; otherwise assigns sRGB fallback.
- Output format is resolved from original extension/content-type; unsupported extensions fail with `400`.
- Batch requests:
  - enforce max file count
  - produce per-file success/failure entries
  - generate downloadable ZIP via tokenized `/downloads/{token}` URL

---

## 2) Front-end implementation map (current)

### 2.1 UI layer (`CropControlCenter.jsx`)
The UI can collect and submit:
- source: upload or Shopify image URL
- `pipeline`, `method`, `anchorHint`
- `targetAspectRatio`, margins
- `filters` (sharpen/detail/grayscale)
- toggles:
  - `headRotationHeuristicEnabled` (face pipelines)
  - `centerBiasHeuristicEnabled` (salience/heuristic pipelines)
  - `overrideImageSizeLimit`

### 2.2 Route action A (`app/routes/app.crop.jsx`)
This path is close to backend contract:
- accepts upload and URL source
- forwards:
  - `pipeline`, `method`, aspect ratio, margins
  - `anchorHint`, `filters`
  - head-rotation / center-bias / size-override booleans
- uses `cropImagesWithOutputs()` client to map to backend field names

### 2.3 Route action B (`app/routes/api.crop.jsx`)
This path now shares the same action factory as `/app/crop`:
- forwards `pipeline`, `method`, aspect ratio, margins
- forwards `anchorHint`, `filters`
- forwards all heuristic and size override toggles
- uses the same URL-fetch + file normalization logic

---

## 3) 1:1 comparison matrix (backend vs front-end)

| Capability | Backend (`main.py`) | `/app/crop` action | `/api/crop` action | Parity |
|---|---|---|---|---|
| Upload file crop | ✅ | ✅ | ✅ | ✅ |
| URL-based crop source | Backend accepts file upload only (URL fetch must happen in Node) | ✅ (fetches URL then uploads) | ✅ (fetches URL then uploads) | ✅ |
| `pipeline` selection | ✅ | ✅ | ✅ | ✅ |
| Full method matrix by pipeline | ✅ | ✅ | ✅ | ✅ |
| `target_aspect_ratio` | ✅ | ✅ | ✅ | ✅ |
| Margins (4 sides) | ✅ | ✅ | ✅ | ✅ |
| `anchor_hint` | ✅ | ✅ | ✅ | ✅ |
| `crop_coordinates` manual crop | ✅ | ❌ (not exposed) | ❌ | ❌ |
| `filters` | ✅ | ✅ | ✅ | ✅ |
| `use_head_rotation_heuristic` | ✅ | ✅ | ✅ | ✅ |
| `use_center_bias_heuristic` | ✅ | ✅ | ✅ | ✅ |
| `override_image_size_limit` | ✅ | ✅ | ✅ | ✅ |
| Canonical response usage | ✅ | ✅ (via client normalizer) | ✅ (via client normalizer) | ✅ |

---

## 4) Current parity status
The app still exposes **two server entry points** to cropping, but they now execute the same shared action factory in `app/lib/crop/route-action.server.js`.

This removes route-level drift for crop option parsing and forwarding.

---

## 5) Launch readiness check (April 22, 2026)

### 5.1 Checks executed
- `npm test` ✅
  - Contract test confirms `/app/crop` and `/api/crop` forward identical crop options.
- `npm run typecheck` ✅
  - Type generation + TypeScript compile pass.
- `npm run lint` ✅
  - ESLint passes after removing direct `process` usage from `app/routes/app.jsx`.

### 5.2 Product/readiness observations
- Core crop route parity is in good shape for currently exposed controls.
- `crop_coordinates` is still unsupported in the UI, so backend capability is not fully surfaced.
- Roadmap still marks the app as **preview mode** and lists launch-blocking items for preview exit:
  - fully hardened multi-file handling UX,
  - real-time crop preview behavior,
  - explicit end-user access to all crop capabilities,
  - stronger pipeline execution verification coverage.

### 5.3 Launch verdict
**Not ready for full launch yet.**

Reason: although core crop contract parity and core checks are now passing, roadmap-defined preview-exit requirements remain incomplete.

---

## 6) One-line status
Backend/front-end crop option parity is largely implemented, and lint is clean, but the app should remain in **preview/stabilization** until preview-exit roadmap criteria are complete.

## 7) Priority Fix List

All previously listed priority fixes are now resolved and removed from this checklist.
