import { CROP_PIPELINES, normalizePipeline } from "./cropRequestContract.js";

export const FRONTEND_PIPELINE_OPTIONS = [
  {
    value: "auto",
    label: "Auto",
    description:
      "Recommended for most batches. Smart Crop chooses the best pipeline per image.",
  },
  {
    value: "face",
    label: "Face",
    description:
      "Use for portrait-heavy sets where a visible face should drive composition.",
  },
  {
    value: "salience",
    label: "Salience",
    description:
      "Use for products and objects when visual attention (not faces) should lead framing.",
  },
  {
    value: "heuristic",
    label: "Heuristic",
    description:
      "Use for deterministic fallback behavior when you need consistent non-ML crop logic.",
  },
];

const FRONTEND_PIPELINE_SET = new Set(CROP_PIPELINES);

export const PRESET_PIPELINE_TEMPLATES = {
  auto: ["auto"],
  portrait: ["face", "auto", "heuristic"],
  product: ["salience", "auto", "heuristic"],
  square: ["face", "salience", "heuristic"],
};

export function normalizePipelineStage(rawValue) {
  return normalizePipeline(rawValue);
}

export function normalizePipelineStageList(rawValue) {
  const values = Array.isArray(rawValue)
    ? rawValue
    : String(rawValue || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);

  const normalized = [];

  for (const value of values) {
    const stage = normalizePipelineStage(value);
    if (FRONTEND_PIPELINE_SET.has(stage) && !normalized.includes(stage)) {
      normalized.push(stage);
    }
  }

  return normalized.length ? normalized : ["auto"];
}

export function getPipelineTemplateForPreset(preset) {
  const normalizedPreset = String(preset || "").trim().toLowerCase();
  return normalizePipelineStageList(
    PRESET_PIPELINE_TEMPLATES[normalizedPreset] || PRESET_PIPELINE_TEMPLATES.auto,
  );
}

export function derivePrimaryPipeline(stages) {
  return normalizePipelineStageList(stages)[0];
}

export function serializePipelineStages(stages) {
  return normalizePipelineStageList(stages).join(",");
}
