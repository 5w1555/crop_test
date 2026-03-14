FastAPI service for smart-crop

Run locally:

1. Create a virtualenv and install dependencies:

```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

2. Set CORS origins (recommended in all environments):

```
# Comma-separated list of allowed browser origins
# Example for local UI + deployed app
export SMARTCROP_FRONTEND_ORIGINS="http://localhost:3000,https://your-frontend.example.com"
```

If this variable is not set, the API defaults to localhost development origins only (`http://localhost:3000` and `http://127.0.0.1:3000`).

Set required shared-secret auth token:

```
export SMARTCROP_API_TOKEN="replace-with-a-long-random-secret"
```

`/crop` and `/crop/batch` require header `X-SmartCrop-Token` that exactly matches `SMARTCROP_API_TOKEN`.
Missing header returns `401`; invalid token returns `403`.

Image safety/performance limits (recommended):

```
# Maximum decoded image megapixels before resize/downscale logic kicks in.
# Default: 20
export SMARTCROP_MAX_MP=20
```

Notes:
- Images larger than `SMARTCROP_MAX_MP` are aggressively downscaled before OpenCV/Numpy conversion.
- Extremely large inputs (more than 4× `SMARTCROP_MAX_MP`) are rejected early to avoid excessive memory use.
- For small containers (1-2 GB RAM), keep `SMARTCROP_MAX_MP` around `12-20`; raise only if you truly need higher-resolution face crops.

3. Start the server:

```
uvicorn main:app --host 0.0.0.0 --port 8000
```

Docker build:

```
docker build -t smart-crop-fastapi .
docker run -p 8000:8000 -e SMARTCROP_FRONTEND_ORIGINS="http://localhost:3000,https://your-frontend.example.com" -e SMARTCROP_API_TOKEN="replace-with-a-long-random-secret" smart-crop-fastapi
```

The service exposes `/` (service info), `/health`, and a POST `/crop` endpoint that accepts a file upload.

Note: if you intentionally set `SMARTCROP_FRONTEND_ORIGINS="*"`, the service automatically disables credentialed CORS (`allow_credentials=False`) for browser compatibility and security.

## Dependency compatibility notes

- `insightface==0.7.3` + `onnxruntime==1.19.2` are pinned for CPU-only inference in this service.
- Runtime provider expectation: InsightFace should resolve to `CPUExecutionProvider` only (no CUDA/TensorRT requirement in staging/production defaults).
- `opencv-python==4.10.0.84`, `pillow==10.4.0`, `pillow-heif==0.18.0`, and `rawpy==0.26.1` are pinned as a tested image I/O stack for JPEG/PNG/HEIC/RAW input handling.
- Memory impact guidance:
  - face detection + decode paths can use significant temporary memory for high-megapixel images.
  - HEIC/RAW decode can be substantially heavier than JPEG/PNG due to larger intermediate buffers.
  - Keep `SMARTCROP_MAX_MP` conservative (for example `12-20`) on 1-2 GB containers to reduce OOM risk.

## Dependency update workflow

When updating any pinned package (especially `insightface`, `onnxruntime`, `opencv-python`, `pillow`, `rawpy`, `pillow-heif`), use this process:

1. **Update in a branch**
   - Create a dedicated branch (for example `chore/dependency-refresh`).
   - Change versions in `requirements.txt` and include compatibility notes if behavior changed.
2. **Run smoke tests**
   - Install fresh deps in a clean virtual environment.
   - Start the API and run minimal health/crop checks (`/health`, one standard JPEG, one HEIC/RAW sample if available).
   - Verify InsightFace loads with CPU provider and that crop endpoints still return expected formats.
3. **Deploy to staging**
   - Roll out the branch artifact to staging only.
   - Run representative batch requests and monitor memory/latency/error rates.
4. **Promote after verification**
   - Promote to production only after staging verification passes.
   - Keep rollback instructions ready (previous image/tag with previous `requirements.txt` lock).



## Salience pipeline model loading

- The `salience` pipeline runs U²-Net inference through ONNX Runtime on CPU.
- Default model lookup path is `fastapi_service/models/u2net.onnx`.
- You can override the path with `SMARTCROP_SALIENCE_MODEL_PATH` (absolute or relative path).
- Loading is lazy and singleton-based: the model is initialized on the first `pipeline=salience` request and reused afterward.
- If the model file is missing or inference fails, the service falls back to center-biased content crop behavior.

## API

### `POST /crop`
- Required header: `X-SmartCrop-Token: <SMARTCROP_API_TOKEN>`
- Multipart form fields:
  - `file`: single image upload
  - `method`: one of `auto` (default), `head_bust`, `frontal`, `profile`, `chin`, `nose`, `below_lips`
- Response: cropped image stream in the **same format as the input file** (for example JPEG→JPEG, HEIC→HEIC).

### `POST /crop/batch`
- Required header: `X-SmartCrop-Token: <SMARTCROP_API_TOKEN>`
- Multipart form fields:
  - `files`: multiple image uploads (`files` can be repeated in form-data)
  - `method`: one of `auto` (default), `head_bust`, `frontal`, `profile`, `chin`, `nose`, `below_lips`
- Behavior:
  - Reuses the same crop pipeline as `/crop` for each image (face detect + selected method + fallback crop when no face is detected).
  - Skips invalid/failed files and records failures in `manifest.json` inside the generated ZIP.
  - If every file fails, returns HTTP 400 with failure details.
  - Writes the ZIP to temporary local storage (`/tmp/smartcrop-downloads`) and returns a FastAPI download URL.
- Response (`application/json`):
  - `downloadUrl`: FastAPI endpoint for direct browser download (`/downloads/{token}`).
  - `filename`: suggested download filename (`cropped_batch.zip`).
  - `expiresIn`: URL TTL in seconds (controlled by `SMARTCROP_DOWNLOAD_TTL_SECONDS`, default `600`).

### `GET /downloads/{download_token}`
- Returns the generated ZIP (`application/zip`) for a valid, non-expired token.
- Tokens and files are temporary and expire automatically based on `SMARTCROP_DOWNLOAD_TTL_SECONDS`.
