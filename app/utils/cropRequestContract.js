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

export function buildRouteCropRequestContract(formData) {
  return {
    method: String(formData.get("method") || "auto"),
    pipeline: normalizePipeline(formData.get("pipeline")),
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
