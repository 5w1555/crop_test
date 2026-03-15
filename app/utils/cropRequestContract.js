export const CROP_PIPELINES = ["auto", "face", "salience", "heuristic"];

export function normalizePipeline(rawValue) {
  const value = String(rawValue || "")
    .trim()
    .toLowerCase();

  if (!value) {
    return "auto";
  }

  if (CROP_PIPELINES.includes(value)) {
    return value;
  }

  if (value === "face_detection") {
    return "face";
  }

  return "auto";
}

export function normalizePipelineStages(rawValue) {
  const values = Array.isArray(rawValue)
    ? rawValue
    : String(rawValue || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);

  const normalized = [];

  for (const value of values) {
    const stage = normalizePipeline(value);
    if (!normalized.includes(stage)) {
      normalized.push(stage);
    }
  }

  return normalized.length ? normalized : ["auto"];
}

export function buildRouteCropRequestContract(formData) {
  const pipeline = normalizePipeline(formData.get("pipeline"));
  const pipelineStages = normalizePipelineStages(
    formData.get("pipeline_stages") || pipeline,
  );

  return {
    method: String(formData.get("method") || "auto"),
    pipeline: pipelineStages[0] || pipeline,
    pipelineStages,
    optionValues: {
      targetAspectRatio: String(formData.get("target_aspect_ratio") || ""),
      marginTop: String(formData.get("margin_top") || ""),
      marginRight: String(formData.get("margin_right") || ""),
      marginBottom: String(formData.get("margin_bottom") || ""),
      marginLeft: String(formData.get("margin_left") || ""),
      anchorHint: String(formData.get("anchor_hint") || ""),
      filters: String(formData.get("filters") || ""),
      cropCoordinates: String(formData.get("crop_coordinates") || ""),
    },
  };
}
