# CONTEXT.md — `fastapi_service/main.py` IA Execution Context

## Purpose

This context is intentionally centered on **`fastapi_service/main.py`**, because that file contains the actual crop engine behavior exposed by the API.
If another IA needs to change this system safely, treat `main.py` as the single source of truth.

---

## 1) What `main.py` actually is

`main.py` is not just routing glue; it combines:
- app bootstrap + environment validation,
- auth enforcement,
- request-size + concurrency protection,
- image decode/normalize/metadata handling,
- face detection model lifecycle,
- crop strategy implementations,
- output format resolution and batch ZIP packaging.

In other words, endpoint behavior and core image-processing logic are coupled in one file.

---

## 2) High-confidence mental model (read in this order)

For fastest understanding, read `main.py` in this sequence:

1. **Env/config + startup guards**
   - `_validate_fastapi_startup_env`, parsed constants (`MAX_*`, concurrency/timeouts), `startup_event`.
2. **Security + backpressure**
   - `require_smartcrop_token`, `crop_request_slot`, upload streaming/size checks.
3. **I/O and format decisions**
   - image read/resize limits, ICC/profile handling, output-format resolver, buffer serialization.
4. **Crop orchestration**
   - `run_crop_pipeline` and method dispatch.
5. **Endpoints**
   - `/crop` then `/crop/batch` and manifest/zip behavior.
6. **Individual crop implementations**
   - frontal/profile/auto/head_bust/chin/nose/below_lips/center_content.

---

## 3) Runtime path: request → result

### `POST /crop`
1. Auth dependency validates `X-SmartCrop-Token` (unless token is unset in non-prod).
2. Upload is streamed in chunks to temp file with rolling max-size enforcement.
3. Concurrency slot is acquired (semaphore + timeout).
4. `run_crop_pipeline(temp_path, method)` executes:
   - read + normalize image,
   - detect face/landmarks,
   - select crop strategy,
   - fallback if needed,
   - optional post-processing contract (`target_aspect_ratio`, margins, anchor, filters) when provided.
5. Output format is resolved from input filename/content type.
6. Response streams cropped image with attachment filename.

### `POST /crop/batch`
- Same core pipeline per file.
- Supports the same optional crop contract fields as `/crop` and applies them per output image.
- Per-file failures are captured in `manifest.json` (not immediate total failure).
- Entire request fails only if **all** files fail.
- Output is a temporary ZIP with deduplicated output filenames.

---

## 4) Crop logic decision system (actual behavior)

Primary dispatcher: `run_crop_pipeline`.

- No face detected → `center_content_crop` fallback.
- `method=head_bust` → dedicated head-bust flow.
- `method=auto` → orientation-aware path:
  - frontal candidate → `crop_frontal_image`
  - otherwise profile/bbox fallback via `crop_profile_image`
- Explicit methods:
  - `frontal`, `profile`, `chin`, `nose`, `below_lips`, `center_content`
- Unknown method → HTTP 400.
- If method returns `None` unexpectedly, pipeline raises failure instead of returning broken output.
- After the method result, post-processing may be applied via `CropOptions`:
  - aspect-ratio enforcement,
  - margin cropping,
  - optional lightweight filters.

This keeps API behavior predictable even when landmarks are incomplete.

---

## 5) Hard guardrails that protect production stability

1. **Env validation before app starts**
   - Numeric bounds are validated early; invalid config aborts startup.
2. **Token security model**
   - Missing header -> 401; invalid header -> 403.
3. **Upload size controls**
   - Streaming validation yields 413 for over-limit files.
4. **Megapixel risk controls**
   - Oversized decoded images are downscaled; extremely large sources can be hard-rejected.
5. **Concurrency backpressure**
   - Semaphore limit + acquisition timeout gives explicit 503 busy response.
6. **Batch containment**
   - max file count cap + per-file isolation in manifest.

---

## 6) Known structural issues in `main.py` (important for future IA work)

- The file is very large and mixes domains (API, model lifecycle, image math, serialization, ops controls).
- Several defaults are operationally sensitive and easy to regress if changed without load testing.
- There is legacy/noisy commentary at the bottom that does not influence runtime and can distract maintainers.
- Some helper areas (format/metadata conversions) are subtle and should be changed with regression fixtures.

---

## 7) Best course of action (recommended plan)

### Phase 1 — Safety-first stabilization (do first)
1. Build regression tests around `run_crop_pipeline` and `resolve_output_format` using small fixture images.
2. Add focused parser tests for `parse_crop_options` helpers (`_parse_aspect_ratio`, `_parse_margins`, `_normalize_anchor_hint`, `_parse_filters`) to lock request-contract behavior.
3. Add endpoint tests for:
   - token auth matrix (unset/missing/invalid/valid),
   - 413 behavior for size limits,
   - 503 behavior when concurrency slots are saturated,
   - batch manifest semantics (partial success vs all-fail).
4. Remove or relocate non-actionable trailing comments in `main.py` to reduce maintenance noise.

### Phase 2 — Modularization without behavior change
1. Extract modules while keeping API contract fixed:
   - `config.py` (env parsing/validation),
   - `auth.py` (token dependency),
   - `limits.py` (upload + semaphore slot),
   - `image_io.py` (decode/icc/format write),
   - `crop_methods.py` (method implementations),
   - `pipeline.py` (`run_crop_pipeline`).
2. Keep `main.py` as thin composition layer (FastAPI wiring only).
3. Run fixture parity tests before/after extraction to prove no output regressions.

### Phase 3 — Operational hardening
1. Add structured logging around each request stage (decode/detect/crop/serialize timings).
2. Emit counters for method usage, fallback frequency, and failure reasons.
3. Validate high-memory formats (HEIC/RAW) separately in staging with conservative limits.

---

## 8) IA guardrails for editing `main.py`

- Never weaken token checks in production paths.
- Preserve current HTTP semantics (400/401/403/413/503/500) unless a migration plan is documented.
- Any change to default limits must include perf rationale and staging evidence.
- Preserve filename + format expectations for both single and batch endpoints.
- Do not merge refactors and behavior changes in one PR unless tests clearly isolate each risk.

---

## 9) Practical debugging checklist

1. Confirm effective env values at startup (especially `SMARTCROP_*` limits and token).
2. Reproduce on `/crop` with one known JPEG before touching batch.
3. Validate whether failure is decode, face detect, crop method, or output serialization.
4. For batch issues, inspect `manifest.json` first to classify per-file failures.
5. For latency spikes, check image megapixels and concurrency slot contention before tuning model code.

---

## 10) Bottom line for another IA

If you need to improve this system quickly and safely:
- **test behavior first**,
- **extract modules second**,
- **tune limits/observability third**.

That order gives the best chance of reducing risk while making `main.py` maintainable.
