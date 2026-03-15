import { useCallback, useMemo, useState } from "react";

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function useCropPreview() {
  const [previewCropRect, setPreviewCropRect] = useState(null);

  const normalizeRect = useCallback((rect) => {
    if (!rect) return null;
    return {
      x: clamp(rect.x ?? 0, 0, 1),
      y: clamp(rect.y ?? 0, 0, 1),
      width: clamp(rect.width ?? 1, 0.01, 1),
      height: clamp(rect.height ?? 1, 0.01, 1),
    };
  }, []);

  const updatePreviewCropRect = useCallback((rect) => {
    setPreviewCropRect(normalizeRect(rect));
  }, [normalizeRect]);

  const clearPreviewCropRect = useCallback(() => setPreviewCropRect(null), []);

  return {
    previewCropRect,
    updatePreviewCropRect,
    clearPreviewCropRect,
    hasCropPreview: useMemo(() => Boolean(previewCropRect), [previewCropRect]),
  };
}
