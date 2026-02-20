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
docker run -p 8000:8000 -e SMARTCROP_FRONTEND_ORIGINS="http://localhost:3000,https://your-frontend.example.com" smart-crop-fastapi
```

The service exposes `/` (service info), `/health`, and a POST `/crop` endpoint that accepts a file upload.

Note: if you intentionally set `SMARTCROP_FRONTEND_ORIGINS="*"`, the service automatically disables credentialed CORS (`allow_credentials=False`) for browser compatibility and security.


## API

### `POST /crop`
- Multipart form fields:
  - `file`: single image upload
  - `method`: one of `auto` (default), `head_bust`, `frontal`, `profile`, `chin`, `nose`, `below_lips`
- Response: cropped image stream in the **same format as the input file** (for example JPEG→JPEG, HEIC→HEIC).

### `POST /crop/batch`
- Multipart form fields:
  - `files`: multiple image uploads (`files` can be repeated in form-data)
  - `method`: one of `auto` (default), `head_bust`, `frontal`, `profile`, `chin`, `nose`, `below_lips`
- Behavior:
  - Reuses the same crop pipeline as `/crop` for each image (face detect + selected method + fallback crop when no face is detected).
  - Skips invalid/failed files and records failures in `manifest.json` inside the ZIP payload.
  - If every file fails, returns HTTP 400 with failure details.
- Response:
  - ZIP stream (`application/zip`) with files named `<original-stem>_cropped.<original-ext>` (deduplicated with numeric suffixes when needed), preserving each file's original image format.
  - `Content-Disposition: attachment; filename="cropped_batch.zip"`.
