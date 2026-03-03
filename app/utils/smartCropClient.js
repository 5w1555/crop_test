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

export async function cropImage(file, options = {}) {
  const form = new FormData();
  form.append("file", file, file.name || "upload");

  if (options.method) form.append("method", String(options.method));

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

  if (options.method) form.append("method", String(options.method));

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
