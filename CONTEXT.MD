# CONTEXT.MD - Current Image Processing and Download Pipeline

## Purpose

This document replaces the older FastAPI-only context.

The current crop flow is not just `fastapi_service/main.py`. The real system is:

1. Shopify embedded UI in Remix
2. Remix action + in-memory job tracker
3. Node server-to-server request to FastAPI
4. FastAPI crop pipeline
5. FastAPI temporary ZIP download endpoint
6. Browser opening the returned download URL

If you change crop behavior or download behavior, you need to reason across all six layers.

## Primary files

Read these in this order:

1. `app/routes/app.additional.jsx`
   - Embedded UI
   - Remix `action`
   - Browser polling logic
   - Final "Download ZIP" button behavior
2. `app/routes/app.additional.status.$jobId.jsx`
   - Job status loader used by polling
3. `app/utils/cropJobs.server.js`
   - In-memory async job execution and stored job payload
4. `app/utils/smartCropClient.js`
   - Node -> FastAPI request contract
5. `app/utils/cropRequestContract.js`
   - Route-level normalization of `method`, `pipeline`, and optional crop fields
6. `fastapi_service/main.py`
   - Crop execution, ZIP packaging, download token registry
7. `fastapi_service/tests/test_crop_contract.py`
   - Best source of truth for request/response contract details

## High-confidence mental model

### What the browser actually does

The embedded page in `app/routes/app.additional.jsx` does not download images directly from Remix.

Instead it:

1. Lets the user select one or more image files.
2. Builds crop options from the current UI state:
   - `method`
   - `pipeline`
   - `target_aspect_ratio`
   - `margin_*`
   - `anchor_hint`
   - `filters`
   - optional `crop_coordinates`
3. Sends those files to the Remix `action` at `/app/additional`.
4. Receives a `jobId`.
5. Polls `/app/additional/status/:jobId`.
6. Reads `downloadUrl` from the finished job payload.
7. Opens that URL in a new tab with `window.top.open(...)`, falling back to `window.open(...)`.

Important: even a single uploaded image goes through the batch-style job flow in the current UI.

### What Remix actually does

The Remix `action` in `app/routes/app.additional.jsx`:

1. Authenticates the embedded Shopify admin request.
2. Reads uploaded files from form field `file`.
3. Validates that every item is an image.
4. Normalizes request options with `buildRouteCropRequestContract`.
5. Reserves plan capacity before the job starts.
6. Creates an async crop job through `createCropJob(...)`.
7. Returns `{ jobId }` with HTTP `202`.

The status route in `app/routes/app.additional.status.$jobId.jsx`:

1. Authenticates the admin request.
2. Loads the job from the in-memory job map.
3. Returns one of:
   - `{ status: "pending" }`
   - `{ status: "error", error }`
   - `{ status: "done", downloadUrl, filename, expiresIn, cropSummary }`

### What the job runner actually does

`app/utils/cropJobs.server.js` is the bridge between Remix and FastAPI.

`createCropJob(...)`:

1. Creates a UUID job ID.
2. Stores a `pending` job in a process-local `Map`.
3. Starts `runCropJob(...)` without awaiting it.
4. Schedules deletion after 15 minutes.

`runCropJob(...)`:

1. Calls `cropImages(files, options)` from `app/utils/smartCropClient.js`.
2. Awaits the FastAPI JSON payload.
3. Requires `payload.downloadUrl`.
4. Commits plan usage after FastAPI returns success.
5. Stores a `done` job with:
   - `downloadUrl`
   - `filename`
   - `expiresIn`
   - simplified `cropSummary`
6. On failure, stores `status: "error"`.

Important limitations in this layer:

- Jobs are in memory only. A Node process restart loses all pending and completed jobs.
- There is no persistent queue.
- `cropSummary` is optimistic and currently assumes all uploaded files succeeded if FastAPI returned a `downloadUrl`.
- The job layer does not inspect `manifest.json` inside the ZIP and does not surface per-file failures back to the UI.

## Server-to-server contract

`app/utils/smartCropClient.js` is the Node client for FastAPI.

### Base URL selection

The FastAPI base URL is resolved as:

- `process.env.SMARTCROP_API_URL`, otherwise
- Render default `https://smart-crop-api-f97p.onrender.com` when `RENDER` is set, otherwise
- local `http://localhost:8000`

### Auth

Requests to FastAPI require `X-SmartCrop-Token`, sourced from `SMARTCROP_API_TOKEN`.

### Endpoints used by the app

- Single image helper exists: `POST /crop`
- Current embedded UI job flow uses batch: `POST /crop/batch`

### Batch request payload

`cropImages(files, options)` sends:

- repeated `files` form entries
- `method`
- `pipeline`
- `target_aspect_ratio`
- `anchor_hint`
- `crop_coordinates`
- `filters`
- `margin_top`
- `margin_right`
- `margin_bottom`
- `margin_left`

Important: Remix receives uploaded files under `file`, but the Node -> FastAPI client sends them under `files`.
FastAPI currently accepts both `files` and `file` for compatibility.

## FastAPI execution path

The FastAPI service lives in `fastapi_service/main.py`.

### Auth and request guardrails

`require_smartcrop_token` enforces the shared secret:

- missing token -> `401`
- invalid token -> `403`

The upload/crop path also uses:

- max upload size protection while streaming temp files
- max batch file count
- semaphore-based concurrency limiting with timeout

### Single-image endpoint

`POST /crop`:

1. Streams one upload to a temp file.
2. Parses crop options.
3. Acquires a crop slot.
4. Runs `run_crop_pipeline(...)`.
5. Resolves output format from filename/content type.
6. Streams the cropped bytes back directly with attachment headers.

### Batch endpoint

`POST /crop/batch`:

1. Accepts `files` or `file`.
2. Parses `pipeline`, `method`, and optional crop controls.
3. Creates an in-memory ZIP buffer.
4. For each uploaded file:
   - stream to temp file
   - run `run_crop_pipeline(...)`
   - resolve output format
   - serialize image bytes
   - write `<stem>_cropped.<ext>` into the ZIP
   - on failure, append an entry to `manifest["failed"]`
5. Writes `manifest.json` into the ZIP.
6. Stores the ZIP under a random token in `/tmp/smartcrop-downloads`.
7. Returns JSON:
   - `downloadUrl`
   - `filename`
   - `expiresIn`

### Download endpoint

`GET /downloads/{download_token}`:

1. Cleans expired registry entries.
2. Looks up the token in `_download_registry`.
3. Verifies the ZIP file still exists.
4. Returns `FileResponse(..., media_type="application/zip")`.

The browser downloads from FastAPI directly, not from Remix.

## Download URL behavior

This is a key production detail.

FastAPI returns the download URL through `_build_download_url(...)`.

Behavior:

- If the URL is already absolute, it is returned unchanged.
- If `DOWNLOAD_BASE_URL` is set, FastAPI prefixes the relative path with that base URL.
- If `DOWNLOAD_BASE_URL` is not set, FastAPI returns a relative path like `/downloads/<token>`.

Why this matters:

- The UI opens `downloadUrl` in the browser.
- In an embedded Shopify app, a relative URL can point at the app origin instead of the FastAPI origin.
- If that happens, the browser opens the wrong host and the download fails even though cropping succeeded.

For deployed Render config, `render.yaml` sets `DOWNLOAD_BASE_URL` for the FastAPI service. That setting is part of the live contract, not optional documentation noise.

## Crop pipeline behavior

`run_crop_pipeline(temp_path, method, crop_options, pipeline="auto")` is the core dispatcher.

### Pipelines

Supported `pipeline` values:

- `auto`
- `face`
- `salience`
- `heuristic`

`auto` and `face` use the face-detection-driven path.

`salience` and `heuristic` use the salience/center-biased path and only support:

- `auto`
- `center_content`

Any other method for those pipelines returns `400`.

### Methods

Supported methods in the face path:

- `auto`
- `head_bust`
- `frontal`
- `profile`
- `chin`
- `nose`
- `below_lips`
- `center_content`

### Fallback behavior

- If `crop_coordinates` are provided, manual crop takes precedence after the image is loaded.
- If no face is detected in the face path, the pipeline falls back to `center_content_crop`.
- If salience inference fails, the service falls back to center-biased content cropping.
- If a crop method returns `None`, the pipeline raises `RuntimeError("Cropping failed")`.

### Output format behavior

`resolve_output_format(...)` preserves the input format when supported.

Examples covered by tests:

- HEIC input -> HEIC output
- JPEG input -> JPEG output
- PNG input -> PNG output

`image_to_buffer(...)` handles PIL serialization and preserves ICC profile data when available.

## What is stale in the old context

The previous version of this file was misleading in a few important ways:

1. It treated `fastapi_service/main.py` as the whole system.
2. It ignored the Remix job/polling layer that users actually interact with.
3. It did not document the direct FastAPI ZIP download handoff clearly enough.
4. It omitted `pipeline` as a first-class request control.
5. It did not explain that absolute download URL generation depends on `DOWNLOAD_BASE_URL`.

## Known fragile spots and likely breakpoints

These are the places most likely to cause "crop succeeded but user cannot download" or confusing error behavior.

### 1. Relative download URLs

If `DOWNLOAD_BASE_URL` is missing, FastAPI can return `/downloads/<token>` instead of an absolute API URL.
That is dangerous in the embedded app because the browser may open the wrong origin.

### 2. In-memory job registry in Remix

The crop job map in `app/utils/cropJobs.server.js` is process-local and volatile.

Effects:

- app restart loses jobs
- scale-out across multiple Node instances would break polling unless requests remain sticky
- jobs disappear after the 15-minute TTL

### 3. Batch endpoint error masking

`crop_batch_endpoint(...)` ends with a blanket `except Exception` that rethrows `HTTPException(status_code=500, ...)`.

That means intended client-facing errors like:

- `400` no files
- `400` invalid crop options
- `413` too many files

can be turned into `500` responses.

This is a real behavior hazard when debugging uploads or option validation.

### 4. UI success summary is not authoritative

FastAPI records partial failures inside ZIP `manifest.json`.
The Remix job layer does not parse that manifest and currently stores:

- `successCount = files.length`
- `failedCount = 0`

as long as FastAPI returned a `downloadUrl`.

So the UI can report total success even when some files failed and were only recorded in the ZIP manifest.

### 5. Plan usage commits requested count, not confirmed processed count

After a successful FastAPI batch response, `commitPlanUsage(...)` is called with the original number of uploaded files.

Because the job layer does not inspect `manifest["processed"]`, plan usage may count files that failed inside a partially successful ZIP.

## Best debugging order

When this flow breaks, debug in this order:

1. `app/routes/app.additional.jsx`
   - Did the browser receive a `jobId`?
   - Did polling finish?
   - What exact `downloadUrl` is being opened?
2. `app/routes/app.additional.status.$jobId.jsx`
   - Is the job still present?
   - Is it `pending`, `error`, or `done`?
3. `app/utils/cropJobs.server.js`
   - Did FastAPI return JSON with `downloadUrl`?
   - Was the error swallowed into a generic job error?
4. `app/utils/smartCropClient.js`
   - Is the API base correct?
   - Is `SMARTCROP_API_TOKEN` present?
5. `fastapi_service/main.py`
   - Did upload streaming fail?
   - Did the request hit the semaphore timeout?
   - Did `run_crop_pipeline(...)` fail?
   - Did ZIP registration succeed?
   - Is `DOWNLOAD_BASE_URL` producing the correct host?

## If you need to change this pipeline safely

Change order should be:

1. Lock the contract with tests.
2. Fix URL and status-code correctness first.
3. Only then refactor modules or job storage.

Most risky areas:

- anything around `downloadUrl`
- error handling in `crop_batch_endpoint(...)`
- job persistence assumptions
- response summaries that pretend partial failures did not happen

## Bottom line

The current user-facing crop system is a distributed flow across Remix and FastAPI.

If users cannot download processed images, do not debug `main.py` in isolation.
Start from the browser's `downloadUrl`, then trace:

UI -> Remix action -> job map -> FastAPI batch response -> FastAPI download token -> FastAPI file response
