const API_BASE = process.env.SMARTCROP_API_URL || "https://smart-crop-api-f97p.onrender.com";
const REQUEST_TIMEOUT_MS = 15000;

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

async function parseJsonSafe(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function testSmartCropApi({ signal } = {}) {
  const timeout = withTimeout(signal, 5000);

  try {
    const response = await fetch(`${API_BASE}/crop`, {
      method: "OPTIONS",
      signal: timeout.signal,
    });

    const payload = await parseJsonSafe(response);

    return {
      ok: response.ok,
      apiBase: API_BASE,
      status: response.status,
      statusText: response.statusText,
      details: response.ok
        ? "The API endpoint responded to a probe request."
        : "The API endpoint responded, but with a non-success status.",
      payload,
    };
  } catch (error) {
    const normalized = normalizeError(error);
    return {
      ok: false,
      apiBase: API_BASE,
      status: null,
      statusText: normalized.code,
      details: normalized.details,
      error: normalized.message,
    };
  } finally {
    timeout.cleanup();
  }
}

export async function cropImagesWithOutputs(files, options, { signal } = {}) {
  void options;
  const form = new FormData();
  files.forEach((file, index) =>
    form.append("file", file, file.name || `image-${index}.jpg`),
  );

  const timeout = withTimeout(signal);

  try {
    const response = await fetch(`${API_BASE}/crop`, {
      method: "POST",
      body: form,
      signal: timeout.signal,
    });

    const payload = await parseJsonSafe(response);

    if (!response.ok) {
      const apiMessage = payload?.error || payload?.message || payload?.detail;
      throw new Error(apiMessage || `Crop failed with status ${response.status}`);
    }

    return Array.isArray(payload) ? payload : payload?.mediaUpdates || [];
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
