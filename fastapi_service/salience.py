import os
import threading
from pathlib import Path

import numpy as np
from PIL import Image

_SALIENCE_MODEL = None
_SALIENCE_MODEL_LOCK = threading.Lock()


class SalienceModel:
    def __init__(self, session, input_name, output_name, input_size=320):
        self.session = session
        self.input_name = input_name
        self.output_name = output_name
        self.input_size = input_size


def _default_model_path() -> str:
    return str(Path(__file__).resolve().parent / "models" / "u2net.onnx")


def load_salience_model(model_path: str | None = None) -> SalienceModel:
    """Load U²-Net ONNX model from disk."""
    import onnxruntime as ort

    resolved_path = model_path or os.getenv("SMARTCROP_SALIENCE_MODEL_PATH") or _default_model_path()
    if not os.path.exists(resolved_path):
        raise FileNotFoundError(
            f"Salience model file not found at '{resolved_path}'. "
            "Set SMARTCROP_SALIENCE_MODEL_PATH or place model at fastapi_service/models/u2net.onnx"
        )

    providers = ["CPUExecutionProvider"]
    session = ort.InferenceSession(resolved_path, providers=providers)
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name
    return SalienceModel(session=session, input_name=input_name, output_name=output_name)


def get_salience_model() -> SalienceModel:
    global _SALIENCE_MODEL
    if _SALIENCE_MODEL is None:
        with _SALIENCE_MODEL_LOCK:
            if _SALIENCE_MODEL is None:
                _SALIENCE_MODEL = load_salience_model()
    return _SALIENCE_MODEL


def preprocess_for_u2net(pil_img: Image.Image, input_size: int = 320):
    rgb = pil_img.convert("RGB")
    resized = rgb.resize((input_size, input_size), Image.Resampling.BILINEAR)
    arr = np.asarray(resized).astype(np.float32) / 255.0

    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    arr = (arr - mean) / std
    chw = np.transpose(arr, (2, 0, 1))
    return np.expand_dims(chw, axis=0)


def infer_salience_mask(pil_img: Image.Image, model: SalienceModel | None = None) -> np.ndarray:
    model = model or get_salience_model()
    model_input = preprocess_for_u2net(pil_img, input_size=model.input_size)
    raw = model.session.run([model.output_name], {model.input_name: model_input})[0]

    mask = np.asarray(raw)
    while mask.ndim > 2:
        mask = mask[0]

    mask = mask.astype(np.float32)
    min_v = float(mask.min())
    max_v = float(mask.max())
    if max_v > min_v:
        mask = (mask - min_v) / (max_v - min_v)
    else:
        mask = np.zeros_like(mask, dtype=np.float32)

    resized = Image.fromarray((mask * 255.0).astype(np.uint8)).resize(pil_img.size, Image.Resampling.BILINEAR)
    return np.asarray(resized).astype(np.float32) / 255.0


def _largest_component_bbox(binary_mask: np.ndarray):
    h, w = binary_mask.shape
    visited = np.zeros((h, w), dtype=bool)
    best_area = 0
    best_bbox = None

    points = np.argwhere(binary_mask)
    for y, x in points:
        if visited[y, x]:
            continue

        stack = [(int(y), int(x))]
        visited[y, x] = True
        area = 0
        min_x = max_x = int(x)
        min_y = max_y = int(y)

        while stack:
            cy, cx = stack.pop()
            area += 1
            min_x = min(min_x, cx)
            max_x = max(max_x, cx)
            min_y = min(min_y, cy)
            max_y = max(max_y, cy)

            for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                if 0 <= ny < h and 0 <= nx < w and binary_mask[ny, nx] and not visited[ny, nx]:
                    visited[ny, nx] = True
                    stack.append((ny, nx))

        if area > best_area:
            best_area = area
            best_bbox = (min_x, min_y, max_x + 1, max_y + 1)

    return best_bbox, best_area


def center_bias_crop_box(width: int, height: int):
    side_margin = max(16, int(width * 0.08))
    top = max(0, int(height * 0.12))
    bottom = min(height, int(height * 0.97))
    left = max(0, side_margin)
    right = min(width, width - side_margin)
    return (left, top, right, bottom)


def compute_candidate_crop_box(
    salience_mask: np.ndarray,
    image_size: tuple[int, int],
    threshold: float = 0.4,
    padding_ratio: float = 0.08,
    min_salient_area_ratio: float = 0.002,
    use_center_bias_fallback: bool = True,
):
    width, height = image_size
    if salience_mask is None or salience_mask.size == 0:
        return center_bias_crop_box(width, height) if use_center_bias_fallback else None

    mask = np.asarray(salience_mask, dtype=np.float32)
    if mask.shape != (height, width):
        resized = Image.fromarray(np.clip(mask * 255.0, 0, 255).astype(np.uint8)).resize((width, height), Image.Resampling.BILINEAR)
        mask = np.asarray(resized, dtype=np.float32) / 255.0

    binary = mask >= threshold
    bbox, area = _largest_component_bbox(binary)
    min_area = max(1, int(width * height * min_salient_area_ratio))

    if bbox is None or area < min_area:
        return center_bias_crop_box(width, height) if use_center_bias_fallback else None

    left, top, right, bottom = bbox
    pad_x = int((right - left) * padding_ratio)
    pad_y = int((bottom - top) * padding_ratio)

    left = max(0, left - pad_x)
    top = max(0, top - pad_y)
    right = min(width, right + pad_x)
    bottom = min(height, bottom + pad_y)

    if right <= left or bottom <= top:
        return center_bias_crop_box(width, height) if use_center_bias_fallback else None

    return (left, top, right, bottom)
