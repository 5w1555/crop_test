const API_BASE = (process.env.SMARTCROP_API_URL || "https://smart-crop-api-f97p.onrender.com").replace(/\/$/, "");
const API_TOKEN = process.env.SMARTCROP_API_TOKEN || "";
const REQUEST_TIMEOUT_MS = 30_000; // 30 s — model inference can be slow on Render cold starts

// ── shared headers ────────────────────────────────────────────────────────────
function apiHeaders(extra = {}) {
  const headers = { ...extra };
  if (API_TOKEN) headers["X-SmartCrop-Token"] = API_TOKEN;
  return headers;
}

// ── timeout helper ────────────────────────────────────────────────────────────
function withTimeout(signal, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

// ── error normaliser ──────────────────────────────────────────────────────────
function normalizeError(error) {
  if (error?.name === "AbortError") {
    return {
      message: "Smart Crop API request timed out.",
      code: "TIMEOUT",
      details: "The API did not respond before the request timeout elapsed.",
    };
  }

  const causeCode = error?.cause?.code;

  if (causeCode === "ENETUNREACH") {
    return {
      message: "Smart Crop API network is unreachable.",
      code: causeCode,
      details:
        "The app server could not reach the configured API host. Verify outbound network access and SMARTCROP_API_URL.",
    };
  }

  if (causeCode === "ECONNREFUSED") {
    return {
      message: "Smart Crop API refused the connection.",
      code: causeCode,
      details:
        "The configured API host is reachable, but no service accepted the connection on that endpoint.",
    };
  }

  return {
    message: error?.message || "Crop failed",
    code: causeCode || error?.code || "UNKNOWN",
    details: error?.cause?.message || null,
  };
}

// ── safe JSON parser ──────────────────────────────────────────────────────────
async function parseJsonSafe(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// ── health probe — hits GET /health, not OPTIONS /crop ────────────────────────
export async function testSmartCropApi({ signal } = {}) {
  const timeout = withTimeout(signal, 8_000);

  try {
    const response = await fetch(`${API_BASE}/health`, {
      method: "GET",
      headers: apiHeaders({ Accept: "application/json" }),
      signal: timeout.signal,
    });

    const payload = await parseJsonSafe(response);

    return {
      ok: response.ok,
      apiBase: `${API_BASE}/health`,
      status: response.status,
      statusText: response.statusText,
      details: payload?.status ?? (response.ok ? "ok" : "non-success response"),
      payload,
    };
  } catch (error) {
    const normalized = normalizeError(error);
    return {
      ok: false,
      apiBase: `${API_BASE}/health`,
      status: null,
      statusText: normalized.code,
      details: normalized.details,
      error: normalized.message,
    };
  } finally {
    timeout.cleanup();
  }
}

// ── crop — single file → /crop, multiple files → /crop/batch ─────────────────
export async function cropImagesWithOutputs(files, options = {}, { signal } = {}) {
  const isBatch = files.length > 1;
  const endpoint = `${API_BASE}${isBatch ? "/crop/batch" : "/crop"}`;

  const form = new FormData();
  await Promise.all(
    files.map(async (file, index) => {
      const blob = new Blob([await file.arrayBuffer()], {
        type: file.type || "application/octet-stream",
      });
      form.append("file", blob, file.name || `image-${index}`);
    }),
  );

  // Forward any crop options the caller passes (all optional)
  const {
    method = "auto",
    pipeline = "auto",
    targetAspectRatio,
    marginTop,
    marginRight,
    marginBottom,
    marginLeft,
    anchorHint,
    cropCoordinates,
    filters,
    useHeadRotationHeuristic,
  } = options;

  form.append("method", method);
  form.append("pipeline", pipeline);
  if (targetAspectRatio != null) form.append("target_aspect_ratio", targetAspectRatio);
  if (marginTop      != null)    form.append("margin_top",           String(marginTop));
  if (marginRight    != null)    form.append("margin_right",         String(marginRight));
  if (marginBottom   != null)    form.append("margin_bottom",        String(marginBottom));
  if (marginLeft     != null)    form.append("margin_left",          String(marginLeft));
  if (anchorHint     != null)    form.append("anchor_hint",          anchorHint);
  if (cropCoordinates != null)   form.append("crop_coordinates",     JSON.stringify(cropCoordinates));
  if (filters        != null)    form.append("filters",              Array.isArray(filters) ? JSON.stringify(filters) : filters);
  if (useHeadRotationHeuristic != null) form.append("use_head_rotation_heuristic", String(useHeadRotationHeuristic));

  // Batch jobs can be slow on Render's free tier — give them more time
  const timeout = withTimeout(signal, isBatch ? 60_000 : REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: apiHeaders(), // X-SmartCrop-Token; DO NOT set Content-Type (fetch sets multipart boundary)
      body: form,
      signal: timeout.signal,
    });

    const payload = await parseJsonSafe(response);

    if (!response.ok) {
      const apiMessage =
        payload?.errors?.[0]?.message ||
        payload?.error ||
        payload?.message ||
        payload?.detail;
      throw new Error(apiMessage || `Crop failed with status ${response.status}`);
    }

    // FastAPI canonical shape: { status, mediaUpdates, summary, errors }
    if (Array.isArray(payload)) {
      return {
        status: "succeeded",
        mediaUpdates: payload,
        summary: {
          requestedCount: payload.length,
          succeededCount: payload.length,
          failedCount: 0,
        },
        errors: [],
      };
    }

    return {
      status: payload?.status || "succeeded",
      mediaUpdates: Array.isArray(payload?.mediaUpdates) ? payload.mediaUpdates : [],
      summary: payload?.summary || null,
      errors: Array.isArray(payload?.errors) ? payload.errors : [],
    };
  } catch (error) {
    const normalized = normalizeError(error);
    const enrichedError = new Error(normalized.message);
    enrichedError.code = normalized.code;
    enrichedError.details = normalized.details;
    throw enrichedError;
  } finally {
    timeout.cleanup();
  }
}
