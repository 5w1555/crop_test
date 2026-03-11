import process from "node:process";

const DEFAULT_RENDER_API_URL = "https://smart-crop-api-f97p.onrender.com";

const API_BASE =
  process.env.SMARTCROP_API_URL ||
  (process.env.RENDER ? DEFAULT_RENDER_API_URL : "http://localhost:8000");

const NORMALIZED_API_BASE = API_BASE.replace(/\/+$/, "");
const API_TOKEN = process.env.SMARTCROP_API_TOKEN;

function getAuthHeaders() {
  if (!API_TOKEN) {
    throw new Error("SMARTCROP_API_TOKEN is required for Smart Crop API requests");
  }

  return {
    "X-SmartCrop-Token": API_TOKEN,
  };
}

function appendCropOptions(form, options = {}) {
  if (options.method) form.append("method", String(options.method));
  if (options.pipeline) form.append("pipeline", String(options.pipeline));
  if (options.targetAspectRatio) {
    form.append("target_aspect_ratio", String(options.targetAspectRatio));
  }
  if (options.anchorHint) form.append("anchor_hint", String(options.anchorHint));
  if (
    options.cropCoordinates !== undefined &&
    options.cropCoordinates !== null &&
    options.cropCoordinates !== ""
  ) {
    const cropCoordinatesValue =
      typeof options.cropCoordinates === "string"
        ? options.cropCoordinates
        : JSON.stringify(options.cropCoordinates);
    form.append("crop_coordinates", cropCoordinatesValue);
  }
  if (options.filters) {
    const filterValue = Array.isArray(options.filters)
      ? JSON.stringify(options.filters)
      : String(options.filters);
    form.append("filters", filterValue);
  }

  const marginMap = {
    marginTop: "margin_top",
    marginRight: "margin_right",
    marginBottom: "margin_bottom",
    marginLeft: "margin_left",
  };

  Object.entries(marginMap).forEach(([optionKey, fieldName]) => {
    if (options[optionKey] !== undefined && options[optionKey] !== null) {
      form.append(fieldName, String(options[optionKey]));
    }
  });
}

export async function cropImage(file, options = {}) {
  const form = new FormData();
  form.append("file", file, file.name || "upload");
  appendCropOptions(form, options);

  const res = await fetch(`${NORMALIZED_API_BASE}/crop`, {
    method: "POST",
    body: form,
    headers: getAuthHeaders(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Crop failed: ${res.status}`);
  }

  return res;
}

export async function cropImages(files, options = {}) {
  const form = new FormData();

  files.forEach((file) => {
    form.append("files", file, file.name || "upload");
  });

  appendCropOptions(form, options);

  const res = await fetch(`${NORMALIZED_API_BASE}/crop/batch`, {
    method: "POST",
    body: form,
    headers: getAuthHeaders(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Crop failed: ${res.status}`);
  }

  return res;
}

export async function health() {
  try {
    const res = await fetch(`${NORMALIZED_API_BASE}/health`, {
      headers: getAuthHeaders(),
    });
    return res.ok;
  } catch {
    return false;
  }
}
