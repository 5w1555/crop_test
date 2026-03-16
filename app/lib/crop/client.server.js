const API_BASE = process.env.SMARTCROP_API_URL || "https://smart-crop-api-f97p.onrender.com";

export async function cropImagesWithOutputs(files, options) {
  void options;
  const form = new FormData();
  files.forEach((file, i) => form.append("file", file, file.name || `image-${i}.jpg`));

  const res = await fetch(`${API_BASE}/crop`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) throw new Error("Crop failed");
  return await res.json();
}
