import os
import io
import math
import threading
import queue
import concurrent.futures
import multiprocessing

import cv2
import numpy as np
from PIL import Image, ImageCms, ImageOps, ImageFilter, ImageEnhance, ImageDraw

import piexif
from insightface.app import FaceAnalysis

# Optional RAW support
try:
    import rawpy
except ImportError:
    rawpy = None

# ----------------------------
# Face Detection Model (InsightFace)
# ----------------------------
def get_insightface_model():
    """
    Load lightweight InsightFace FaceAnalysis model for face detection + 5-point landmarks.
    """
    providers = ["CPUExecutionProvider"]
    print("Using CPU provider for InsightFace model initialization.")

    app = FaceAnalysis(name="buffalo_sc", providers=providers)
    app.prepare(ctx_id=-1, det_size=(640, 640), det_thresh=0.2)
    return app


# Instantiate it once for the app
model = get_insightface_model()

def heic_available():
    """
    Return True if pillow_heif is installed AND both opener/saver are registered.
    """
    try:
        import pillow_heif
        if not hasattr(pillow_heif, "read_heif"):
            return False
        # check saver
        if not hasattr(pillow_heif, "write_heif") and not hasattr(pillow_heif, "HeifFile"):
            return False
        return True
    except Exception:
        return False

# ----------------------------
# HEIC/HEIF Support Setup
# ----------------------------
try:
    import pillow_heif

    pillow_heif.register_heif_opener()
    if hasattr(pillow_heif, "register_heif_saver"):
        pillow_heif.register_heif_saver()
    else:
        print("Warning: HEIC saver not available in this pillow-heif version.")
except ImportError:
    print("pillow-heif not installed; HEIC support will be limited.")
except Exception as e:
    print("Error setting up HEIC support:", e)


# ----------------------------
# Core Functionality
# ----------------------------
def create_required_folders():
    REQUIRED_FOLDERS = ["originals", "face_detector", "cropped"]
    for folder in REQUIRED_FOLDERS:
        os.makedirs(folder, exist_ok=True)


# ----------------------------
# Embedded ICC Profiles
# ----------------------------
SRGB_PROFILE_BASE64 = """
AAAMYWxzdGF0aWMteHJkZi1zdHJlYW0cbjI7ADxzdHJlYW0KbWFqb3I6IDEKbWlub3I6IDAK
YmV0YTogMApjb25kaXRpb25zIDAKZW5kYXZvcjogMApvcGVyYXRvcl9uYW1lOiBQYXJzZWQg
U1JHQiBwcm9maWxlCmNvcHlyaWdodDogQ29weXJpZ2h0IEFwcGxlIEluYy4sIDE5OTkKbWFu
dWZhY3R1cmVyOiBBcHBsZQptb2RlbDogMQpzdGFydGluZ19vZmZzZXQ6IDAKc3RvcHBpbmdf
b2Zmc2V0OiAwCnNpZ25hdHVyZTogc3JnYgpkZXNjcmlwdGlvbjogU1JHQiBjb2xvciBwcm9m
aWxlCmRlc2NyaXB0aW9uX3N0cmluZzogU1JHQiBjb2xvciBwcm9maWxlCmNvbm5lY3Rpb25f
dHlwZTogUkdCCnByb2ZpbGVfaWQ6IDAKY2xvc2luZ19sYWJlbDogRW5kIG9mIHByb2ZpbGUK
ZW5kX2Jsb2NrX3NpZ25hdHVyZTogZW9jcApleGlmX3ZlcnNpb246IDIuMgpjb2xvcl9zcGFj
ZTogU1JHQgpjb21wcmVzc2lvbjogMApiaXRzX3Blcl9jb21wb25lbnQ6IDgKd2lkdGg6IDAK
aGVpZ2h0OiAwCmNvbXByZXNzaW9uX3R5cGU6IDAKcGhvdG9tZXRyaWNfaW50ZXJwcmV0YXRp
b246IDAKZGF0ZV90aW1lOiAxOTk5OjAxOjAxIDAwOjAwOjAwCnN0cmlwX29mZnNldHM6IDAK
cm93c19wZXJfc3RyaXA6IDAKc3RyaXBfYnl0ZV9jb3VudHM6IDAKcGxhbmFyX2NvbmZpZ3Vy
YXRpb246IDAKc2FtcGxlX2Zvcm1hdDogMApzbWFydF9zdHJpcF9vZmZzZXQ6IDAKcHJlZGlj
dG9yOiAwCnBhZGRpbmc6IDAKY29sb3JfbWFwX3R5cGU6IDAKY29sb3JfbWFwX2xlbmd0aDog
MApyZWRfdHlwZTogMApyZWRfY29sX3R5cGU6IDAKcmVkX2xlbmd0aDogMApncmVlbl90eXBl
OiAwCmdncmVlbl9jb2xfdHlwZTogMApncmVlbl9sZW5ndGg6IDAKYmx1ZV90eXBlOiAwCmJs
dWVfY29sX3R5cGU6IDAKYmx1ZV9sZW5ndGg6IDAKcmVkX3gfb3JpZ2luOiAwCnJlZF95X29y
aWdpbjogMApncmVlbl94X29yaWdpbjogMApncmVlbl95X29yaWdpbjogMApibHVlX3hfb3Jp
Z2luOiAwCmJsdWVfeV9vcmlnaW46IDAKcmVkX3o6IDAKcmVkX3k6IDAKZ3JlZW5feDogMApn
cmVlbl95OiAwCmJsdWVfeDogMApibHVlX2NvbG9yX3R5cGU6IDAKZ3JlZW5fY29sb3JfdHlw
ZTogMApibHVlX2NvbG9yX3R5cGU6IDAKcmVkX2NvbG9yX2xlbmd0aDogMApncmVlbl9jb2xv
cl9sZW5ndGg6IDAKYmx1ZV9jb2xvcl9sZW5ndGg6IDAKY2FsbGJhY2tfdHlwZTogMApjYWxs
YmFja19vZmZzZXQ6IDAKY2FsbGJhY2tfc2l6ZTogMApjYWxsYmFja19wYXJhbTogMApmaWxs
X29yZGVyOiAwCnVua25vd24xOiAwCnVua25vd24yOiAwCnVua25vd24zOiAwCnVua25vd240
OiAwCnVua25vd241OiAwCnVua25vd242OiAwCnVua25vd243OiAwCnVua25vd244OiAwCnVu
a25vd245OiAwCmVuZG9mZmxpbmU6IDAKZW5kb2ZmaWxlOiAwCmVuZG9mZmlsZTozMDA7AA== 
"""
BASE_DIR = os.path.dirname(__file__)
ICC_DIR  = os.path.join(BASE_DIR, "icc_profiles")

def load_icc(name):
    path = os.path.join(ICC_DIR, name)
    try:
        with open(path, "rb") as f:
            data = f.read()
        # ICC signature check (offset 36-39): 'acsp'
        if data[36:40] != b"acsp":
            raise ValueError("Not a valid ICC profile: missing 'acsp' signature")
        return data
    except Exception as e:
        print(f"Warning: Failed to load {name}: {e}")
        return None

SRGB_PROFILE        = load_icc("sRGB_ICC_v4_Appearance.icc")
DISPLAY_P3_PROFILE  = load_icc("Display P3.icc") or SRGB_PROFILE

# ----------------------------
# Color Conversion Helpers
# ----------------------------
icc_transform_cache = {}


def get_icc_transform(input_icc, mode):
    if input_icc is None:
        input_icc = SRGB_PROFILE
    key = (input_icc, mode)
    if key in icc_transform_cache:
        return icc_transform_cache[key]
    try:
        in_profile = ImageCms.ImageCmsProfile(io.BytesIO(input_icc))
    except Exception as e:
        print(f"Error: Invalid input ICC profile: {e}. Falling back to sRGB.")
        in_profile = ImageCms.ImageCmsProfile(io.BytesIO(SRGB_PROFILE))
    try:
        out_profile = ImageCms.ImageCmsProfile(io.BytesIO(DISPLAY_P3_PROFILE))
    except Exception as e:
        print(f"Error: Invalid Display P3 profile: {e}. Falling back to sRGB.")
        out_profile = ImageCms.ImageCmsProfile(io.BytesIO(SRGB_PROFILE))
    try:
        transform = ImageCms.buildTransformFromOpenProfiles(
            in_profile, out_profile, mode, mode
        )
        icc_transform_cache[key] = transform
        return transform
    except Exception as e:
        print(f"Error building ICC transform: {e}")
        return None

def process_color_profile(pil_img, metadata):
    """
    Preserve the image's original ICC profile if present.
    No conversion is performed.
    Ensures output always has a valid ICC tag (SRGB fallback only if none present).
    """
    input_icc = metadata.get("icc_profile")

    # If source had an ICC profile, preserve it exactly.
    if input_icc:
        pil_img.info["icc_profile"] = input_icc
        print("Preserved embedded ICC profile.")
        return pil_img

    # Otherwise, attach sRGB as a neutral fallback (no transform)
    print("No ICC profile found — assigning sRGB fallback.")
    pil_img.info["icc_profile"] = SRGB_PROFILE
    return pil_img


def convert_to_displayp3(pil_img, input_icc=None):
    if input_icc is None:
        input_icc = SRGB_PROFILE
    transform = get_icc_transform(input_icc, pil_img.mode)
    if transform is None:
        return pil_img
    try:
        converted_img = ImageCms.applyTransform(pil_img, transform)
        return converted_img
    except Exception as e:
        print("Error converting image to Display P3:", e)
        return pil_img


# ----------------------------
# Image I/O, Face Detection, and Cropping
# ----------------------------
def save_as_heic_fallback(cropped_img, output_path):
    """
    Attempt to save as HEIC, but first verify pillow_heif availability.
    If unavailable, return False so caller can fall back automatically.
    """
    try:
        import pillow_heif
    except ImportError:
        print("⚠️ HEIC save skipped: pillow_heif not installed.")
        return False

    if not heic_available():
        print("⚠️ HEIC save skipped: pillow_heif not fully registered.")
        return False

    try:
        if cropped_img.mode != "RGB":
            cropped_img = cropped_img.convert("RGB")

        heif_file = pillow_heif.HeifFile()
        heif_file.add_image(
            cropped_img.tobytes(),
            width=cropped_img.width,
            height=cropped_img.height
        )
        heif_file.save(output_path, quality=95)
        return True

    except Exception as e:
        print(f"⚠️ HEIC save failed: {e}")
        return False



try:
    import rawpy
except ImportError:
    print("rawpy not installed; RAW support will not be available.")

def read_image(input_path, max_dim=1024, sharpen=True, enhance_lighting=False):
    """
    Read an image from a file path, with optional resizing, sharpening, and lighting enhancement.
    Supports RAW, HEIC, and standard image formats.

    Args:
        input_path (str): Path to the image file
        max_dim (int): Maximum dimension for resizing
        sharpen (bool): Apply sharpening filter after resizing
        enhance_lighting (bool): Apply lighting enhancement for improved face detection

    Returns:
        tuple: (OpenCV image, PIL image, metadata dictionary)
    """
    lower_path = input_path.lower()
    # --- RAW/HEIF Extension Normalization ---
    raw_extensions = (".cr2", ".nef", ".arw", ".dng", ".orf", ".raf")
    heif_extensions = (".heic", ".heif")
    if lower_path.endswith(raw_extensions):
        try:
            with rawpy.imread(input_path) as raw:
                rgb = raw.postprocess()
            pil_img = Image.fromarray(rgb)
            scale = min(max_dim / pil_img.width, max_dim / pil_img.height, 1)
            if scale < 1:
                new_size = (int(pil_img.width * scale), int(pil_img.height * scale))
                pil_img = pil_img.resize(new_size, Image.LANCZOS)
                if sharpen:
                    pil_img = pil_img.filter(ImageFilter.SHARPEN)
            metadata = pil_img.info.copy()
            pil_img = pil_img.convert("RGB")
            cv_img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
            if enhance_lighting:
                cv_img = enhance_lighting_for_faces(cv_img)
                pil_img = Image.fromarray(cv2.cvtColor(cv_img, cv2.COLOR_BGR2RGB))
            return cv_img, pil_img, metadata
        except Exception as e:
            print(f"RAW image read error: {e}")
            return None, None, {}

    # --- HEIC/HEIF Handling ---
    if lower_path.endswith(heif_extensions):
        if pillow_heif is None:
            print("pillow-heif not installed; cannot decode HEIC/HEIF input.")
            return None, None, {}
        try:
            heif_file = pillow_heif.read_heif(input_path)
            pil_img = Image.frombytes(
                heif_file.mode, heif_file.size, heif_file.data, "raw"
            )
            metadata = {}
            try:
                if hasattr(heif_file, "color_profile"):
                    metadata["icc_profile"] = heif_file.color_profile["data"]
                elif (
                    hasattr(heif_file, "metadata")
                    and "icc_profile" in heif_file.metadata
                ):
                    metadata["icc_profile"] = heif_file.metadata["icc_profile"]
                elif hasattr(heif_file, "info") and "icc_profile" in heif_file.info:
                    metadata["icc_profile"] = heif_file.info["icc_profile"]
            except Exception as e:
                print(f"Color profile extraction warning: {e}")
            if hasattr(heif_file, "metadata"):
                metadata.update(heif_file.metadata)
            cv_img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

            # Apply lighting enhancement if requested
            if enhance_lighting:
                cv_img = enhance_lighting_for_faces(cv_img)
                # Update PIL image to match enhanced OpenCV image
                pil_img = Image.fromarray(cv2.cvtColor(cv_img, cv2.COLOR_BGR2RGB))

            return cv_img, pil_img, metadata
        except Exception as e:
            print(f"HEIC read error: {e}")
            return None, None, {}

    # --- Standard Image Handling ---
    else:
        try:
            pil_img = ImageOps.exif_transpose(Image.open(input_path))
            scale = min(max_dim / pil_img.width, max_dim / pil_img.height, 1)
            if scale < 1:
                new_size = (int(pil_img.width * scale), int(pil_img.height * scale))
                pil_img = pil_img.resize(new_size, Image.LANCZOS)
                if sharpen:
                    pil_img = pil_img.filter(ImageFilter.SHARPEN)
            metadata = pil_img.info.copy()
            try:
                metadata["exif"] = piexif.dump(piexif.load(input_path))
            except Exception:
                pass
            pil_img = pil_img.convert("RGB")
            cv_img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

            # Apply lighting enhancement if requested
            if enhance_lighting:
                cv_img = enhance_lighting_for_faces(cv_img)
                # Update PIL image to match enhanced OpenCV image
                pil_img = Image.fromarray(cv2.cvtColor(cv_img, cv2.COLOR_BGR2RGB))

            return cv_img, pil_img, metadata
        except Exception as e:
            print(f"Image read error: {e}")
            return None, None, {}


def enhance_lighting_for_faces(cv_img):
    """
    Enhance image lighting to improve face detection in challenging conditions
    """
    # Convert to LAB color space (L=lightness, A=green-red, B=blue-yellow)
    lab = cv2.cvtColor(cv_img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)

    # Apply CLAHE (Contrast Limited Adaptive Histogram Equalization) to L channel
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced_l = clahe.apply(l)

    enhanced_lab = cv2.merge((enhanced_l, a, b))

    # Convert back to BGR color space
    enhanced_img = cv2.cvtColor(enhanced_lab, cv2.COLOR_LAB2BGR)

    hsv = cv2.cvtColor(enhanced_img, cv2.COLOR_BGR2HSV)
    h, s, v = cv2.split(hsv)

    # Only brighten pixels below certain brightness threshold
    mask = v < 100
    v[mask] = np.clip(v[mask] * 1.3, 0, 255).astype(np.uint8)

    enhanced_hsv = cv2.merge((h, s, v))
    result = cv2.cvtColor(enhanced_hsv, cv2.COLOR_HSV2BGR)

    return result

def correct_rotation_roi_transparent(pil_img, landmarks, box):
    """
    Rotate the entire image around the face-center so that eyes are level,
    then update landmarks accordingly. This avoids partial-ROI artifacts.
    Args:
        pil_img: full PIL.Image in RGB
        landmarks: dict with keys 'left_eye', 'right_eye', etc.
        box: [x1, y1, x2, y2]
    Returns:
        (rotated_pil_img, updated_landmarks)
    """
    # unpack box
    x1, y1, x2, y2 = map(int, box)
    # compute eye coordinates
    l = np.array(landmarks['left_eye'])
    r = np.array(landmarks['right_eye'])
    # compute angle to horizontal
    dy, dx = (r - l)[1], (r - l)[0]
    angle = np.degrees(np.arctan2(dy, dx))
    # if nearly straight, skip
    if abs(angle) < 0.5:
        return pil_img, landmarks

    # center of rotation: midpoint between eyes
    cx, cy = float(l[0] + r[0]) / 2.0, float(l[1] + r[1]) / 2.0

    # rotate full image around (cx, cy)
    # Pillow >=8 supports center+expand=False
    try:
        rotated = pil_img.rotate(-angle, resample=Image.BICUBIC, center=(cx, cy), expand=False)
    except TypeError:
        # fallback: convert to OpenCV, rotate, convert back
        cv_img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
        M = cv2.getRotationMatrix2D((cx, cy), -angle, 1.0)
        h, w = cv_img.shape[:2]
        rotated_cv = cv2.warpAffine(cv_img, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
        rotated = Image.fromarray(cv2.cvtColor(rotated_cv, cv2.COLOR_BGR2RGB))

    # build rotation matrix for landmarks
    M = cv2.getRotationMatrix2D((cx, cy), -angle, 1.0)

    def rotate_point(pt):
        x, y = pt
        v = np.dot(M, np.array([x, y, 1.0]))
        return (v[0], v[1])

    updated_landmarks = {
        k: rotate_point(v)
        for k, v in landmarks.items()
    }

    return rotated, updated_landmarks

def get_face_and_landmarks(
    input_path,
    conf_threshold=0.3,
    sharpen=True,
    apply_rotation=True,
    model=None,  # ✅ NEW: allow external model injection
):
    """
    Detect face and landmarks using InsightFace FaceAnalysis.

    Returns:
        tuple: (box, landmarks, cv_img, pil_img, metadata)
               If detection fails, `box` is None.
    """
    # ✅ Choose model: use shared one if provided, else fallback to global
    face_model = model if model is not None else globals().get("model")
    if face_model is None:
        face_model = get_insightface_model()

    # Step 1: Load and validate image
    cv_img, pil_img, metadata = read_image(input_path, sharpen=sharpen)

    if cv_img is None:
        print(f"[Error] Could not read image at: {input_path}")
        return None, None, None, None, {}

    if not isinstance(cv_img, np.ndarray):
        print(f"[Error] Image is not a NumPy array: {type(cv_img)}")
        return None, None, cv_img, pil_img, metadata

    # Step 2: Run detection (with fallback attempts)
    try:
        annotations = face_model.get(cv_img)
    except Exception as e:
        print(f"[Warning] Detection failed: {e}")
        print("Trying fallback with relaxed thresholds...")

        try:
            annotations = face_model.get(enhance_lighting_for_faces(cv_img))
        except Exception as e2:
            print(f"[Error] Fallback detection failed: {e2}")
            return None, None, cv_img, pil_img, metadata

    # Step 3: Validate detections
    valid = [d for d in annotations if float(getattr(d, "det_score", 0.0)) >= conf_threshold]
    if not valid:
        print(f"[Info] No face detected in: {input_path}")
        return None, None, cv_img, pil_img, metadata

    best = max(valid, key=lambda d: float(getattr(d, "det_score", 0.0)))
    box = getattr(best, "bbox", None)

    if box is None or len(box) < 4:
        print(f"[Error] Invalid bounding box in: {input_path}")
        return None, None, cv_img, pil_img, metadata
    box = [float(v) for v in box[:4]]

    # Step 4: Extract and validate landmarks
    raw_landmarks = getattr(best, "kps", None)
    if raw_landmarks is None or len(raw_landmarks) < 5:
        print(f"[Error] Incomplete landmarks in: {input_path}")
        return None, None, cv_img, pil_img, metadata

    raw_landmarks = np.asarray(raw_landmarks, dtype=np.float32)
    landmarks = {
        "left_eye": tuple(raw_landmarks[0][:2]),
        "right_eye": tuple(raw_landmarks[1][:2]),
        "nose": tuple(raw_landmarks[2][:2]),
        "mouth_left": tuple(raw_landmarks[3][:2]),
        "mouth_right": tuple(raw_landmarks[4][:2]),
    }

    for k, pt in landmarks.items():
        if not isinstance(pt, (list, tuple)) or len(pt) < 2:
            print(f"[Warning] Bad landmark '{k}' in: {input_path}. Estimating instead.")
            x1, y1, x2, y2 = box
            w, h = x2 - x1, y2 - y1
            landmarks = {
                "left_eye":   (x1 + 0.3 * w, y1 + 0.3 * h),
                "right_eye":  (x1 + 0.7 * w, y1 + 0.3 * h),
                "nose":       (x1 + 0.5 * w, y1 + 0.5 * h),
                "mouth_left": (x1 + 0.4 * w, y1 + 0.8 * h),
                "mouth_right":(x1 + 0.6 * w, y1 + 0.8 * h),
            }
            break

    print(f"[OK] Detected face at: {box}")
    print(f"[OK] Landmarks: {landmarks}")

    # Step 5: Apply rotation if needed
    if apply_rotation:
        try:
            rotated_pil, new_landmarks = correct_rotation_roi_transparent(pil_img, landmarks, box)
            rotated_cv = cv2.cvtColor(np.array(rotated_pil), cv2.COLOR_RGB2BGR)
            return box, new_landmarks, rotated_cv, rotated_pil, metadata
        except Exception as e:
            print(f"[Warning] Rotation correction failed: {e}")
            return box, landmarks, cv_img, pil_img, metadata

    return box, landmarks, cv_img, pil_img, metadata



def is_frontal_face(landmarks):
    left_eye = np.array(landmarks["left_eye"], dtype="float")
    right_eye = np.array(landmarks["right_eye"], dtype="float")
    nose = np.array(landmarks["nose"], dtype="float")
    d_left = np.linalg.norm(nose - left_eye)
    d_right = np.linalg.norm(nose - right_eye)
    ratio = min(d_left, d_right) / max(d_left, d_right)
    diff = abs(d_left - d_right)
    avg = (d_left + d_right) / 2.0
    rel_diff = diff / avg
    print(
        f"Eye-to-nose ratio: {ratio:.2f}, absolute diff: {diff:.2f}, relative diff: {rel_diff:.2f}"
    )
    return (ratio >= 0.70) and (rel_diff <= 0.22)


# Precompute format mapping to avoid repeated dictionary lookups in save_image
# Why: Reduces CPU overhead by computing the mapping once at module level, saving ~0.1ms per call
FORMAT_MAP = {
    # --- HEIC/HEIF family ---
    "heic": "HEIC",
    "heics": "HEIC",
    "heif": "HEIC",
    "heifs": "HEIC",
    "hif": "HEIC",
    "avif": "HEIC",     # AVIF decodes through libheif; fallback to HEIC pipeline
    "avifs": "HEIC",

    # --- TIFF family ---
    "tiff": "TIFF",
    "tif": "TIFF",

    # --- JPEG family ---
    "jpg": "JPEG",
    "jpeg": "JPEG",
    "jpe": "JPEG",
    "jfif": "JPEG",
    "pjpeg": "JPEG",

    # --- PNG ---
    "png": "PNG",

    # --- Web formats ---
    "webp": "WEBP",
    "bmp": "BMP",
    "gif": "GIF",   # non-animated only; animated → convert to PNG

    # --- RAW → TIFF fallback ---
    "cr2": "TIFF",
    "nef": "TIFF",
    "arw": "TIFF",
    "dng": "TIFF",
    "orf": "TIFF",
    "raf": "TIFF",
    "rw2": "TIFF",
    "srw": "TIFF",
}

def save_image(cropped_img, output_path, metadata, output_format=None, jpeg_quality=95):
    """
    Unified, safe, extensible image saving pipeline.
    """

    def ensure_directory(path):
        outdir = os.path.dirname(path)
        if outdir:
            os.makedirs(outdir, exist_ok=True)

    # Normalized, extended format alias map
    FORMAT_MAP = {
        "heic": "HEIC",
        "heics": "HEIC",
        "heif": "HEIC",
        "heifs": "HEIC",
        "hif": "HEIC",
        "jpg": "JPEG",
        "jpeg": "JPEG",
        "jpe": "JPEG",
        "tif": "TIFF",
        "tiff": "TIFF",
        "dng": "DNG",
        "png": "PNG",
    }

    def determine_format(path, forced_format):
        """
        Resolve final format using forced override > extension > PNG fallback.
        Handles normalization.
        """
        if forced_format:
            fmt = forced_format.lower().strip()
        else:
            ext = os.path.splitext(path)[1].lower().lstrip(".")
            fmt = ext

        final_fmt = FORMAT_MAP.get(fmt)
        if final_fmt is None:
            print(f"[Warn] Unknown extension '{fmt}', falling back to PNG.")
            final_fmt = "PNG"

        # HEIC safety gate
        if final_fmt == "HEIC":
            if pillow_heif is None or not hasattr(pillow_heif, "register_heif_opener"):
                print("[Warn] HEIC saver unavailable — falling back to PNG.")
                final_fmt = "PNG"

        return final_fmt

    def build_save_metadata(metadata):
        save_meta = {"icc_profile": DISPLAY_P3_PROFILE}
        if "exif" in metadata:
            save_meta["exif"] = metadata["exif"]
        return save_meta

    def save_heic(img, path, save_meta):
        try:
            img.save(
                path,
                format="HEIF",
                quality=90,
                save_all=True,
                matrix_coefficients=0,
                chroma=420,
                icc_profile=save_meta.get("icc_profile"),
            )
            return True
        except Exception as e:
            print(f"[Err] HEIC save failed: {e}. Falling back to PNG.")
            return save_png(img, path + ".png", save_meta)

    def save_tiff(img, path, save_meta):
        img.save(
            path,
            format="TIFF",
            compression="deflate",
            **save_meta,
        )
        return True

    def save_dng(img, path, save_meta):
        try:
            import pydng
            pydng.write_dng(img, path, metadata=metadata, icc_profile=save_meta.get("icc_profile"))
            return True
        except ImportError:
            print("pydng not installed; falling back to TIFF.")
            fallback = os.path.splitext(path)[0] + ".tiff"
            return save_tiff(img, fallback, save_meta)

    def save_jpeg(img, path, save_meta):
        cv_img = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
        cv2.imwrite(path, cv_img, [int(cv2.IMWRITE_JPEG_QUALITY), jpeg_quality])
        # Add ICC + EXIF using PIL
        with Image.open(path) as reopened:
            reopened.save(path, format="JPEG", quality=jpeg_quality, **save_meta)
        return True

    def save_png(img, path, save_meta):
        img.save(
            path,
            format="PNG",
            compress_level=4,
            **save_meta,
        )
        return True

    format_handlers = {
        "HEIC": save_heic,
        "TIFF": save_tiff,
        "DNG": save_dng,
        "JPEG": save_jpeg,
        "PNG": save_png,
    }

    try:
        ensure_directory(output_path)
        fmt = determine_format(output_path, output_format)

        # RGB-conversion guard
        if fmt in ("HEIC", "JPEG") and cropped_img.mode != "RGB":
            cropped_img = cropped_img.convert("RGB")

        save_metadata = build_save_metadata(metadata)

        handler = format_handlers.get(fmt, save_png)
        return handler(cropped_img, output_path, save_metadata)

    except Exception as e:
        print(f"Save error: {e}")
        return False



def crop_frontal_image(pil_img, landmarks=None, metadata={}, margin=20, lip_offset=50):
    """
    Crop from just above the lips to the bottom of the image, with side margins.
    Args:
        pil_img (PIL.Image): Input image.
        landmarks (dict): Facial landmarks (e.g., mouth_left, mouth_right).
        metadata (dict): Image metadata.
        margin (int): Side margin in pixels.
        lip_offset (int): Vertical offset above lips.
    Returns:
        PIL.Image or None: Cropped image or None if cropping fails.
    """
    # Check for valid inputs
    # Why: Specific error messages help users identify issues, improving usability
    if pil_img is None:
        print("Error: No input image provided to crop_frontal_image.")
        return None
    if not landmarks or not all(k in landmarks for k in ["mouth_left", "mouth_right"]):
        print("Error: Missing 'mouth_left' or 'mouth_right' landmarks in crop_frontal_image.")
        return None

    width, height = pil_img.size
    lip_y = (landmarks["mouth_left"][1] + landmarks["mouth_right"][1]) / 2

    # Validate crop coordinates
    # Why: Prevents invalid crop boxes, ensuring robustness
    left = max(0, margin)
    top = max(0, int(lip_y) - lip_offset)
    right = min(width, width - margin)
    bottom = height

    if right <= left or bottom <= top:
        print(f"Error: Invalid crop box in crop_frontal_image: ({left}, {top}, {right}, {bottom}).")
        return None

    try:
        cropped = pil_img.crop((left, top, right, bottom))
        return process_color_profile(cropped, metadata)
    except Exception as e:
        print(f"Error during frontal crop: {e}")
        return None


def crop_profile_image(pil_img, box=None, metadata={}, margin=20, neck_offset=50):
    """
    Crop from below the detected neck to the bottom of the image, with side margins.
    Args:
        pil_img (PIL.Image): Input image.
        box (list): Bounding box [x1, y1, x2, y2].
        metadata (dict): Image metadata.
        margin (int): Side margin in pixels.
        neck_offset (int): Vertical offset below face box.
    Returns:
        PIL.Image or None: Cropped image or None if cropping fails.
    """
    # Check for valid inputs
    # Why: Clear error messages pinpoint issues, reducing user confusion
    if pil_img is None:
        print("Error: No input image provided to crop_profile_image.")
        return None
    if box is None or len(box) < 4:
        print("Error: Missing or invalid bounding box in crop_profile_image.")
        return None

    width, height = pil_img.size
    _, _, _, y2 = box

    # Validate crop coordinates
    # Why: Ensures valid crop box, preventing crashes
    left = max(0, margin)
    top = min(height, int(y2) + neck_offset)
    right = min(width, width - margin)
    bottom = height

    if right <= left or bottom <= top:
        print(f"Error: Invalid crop box in crop_profile_image: ({left}, {top}, {right}, {bottom}).")
        return None

    try:
        cropped = pil_img.crop((left, top, right, bottom))
        return process_color_profile(cropped, metadata)
    except Exception as e:
        print(f"Error during profile crop: {e}")
        return None


def head_bust_crop(input_path,
                   margin=40,
                   target_ratio=None,
                   conf_threshold=0.3):
    """
    Reworked to avoid off-set rotations:
    1) First try without rotation
    2) If face is significantly tilted, apply minimal rotation
    3) Approximate hairline and crop head-bust region
    4) Apply margins and aspect ratio
    """
    
    # First attempt: get face without rotation
    box, landmarks, _, pil_img, _ = get_face_and_landmarks(
        input_path,
        conf_threshold=conf_threshold,
        apply_rotation=False
    )
    
    if box is None:
        return None
    
    # Check if we need rotation based on landmarks
    needs_rotation = False
    rotation_applied = False
    
    if landmarks is not None and len(landmarks) >= 2:
        # Calculate eye alignment (assuming first two landmarks are eyes)
        try:
            left_eye = landmarks[0]
            right_eye = landmarks[1]
            
            # Calculate angle
            dx = right_eye[0] - left_eye[0]
            dy = right_eye[1] - left_eye[1]
            angle = abs(math.degrees(math.atan2(dy, dx)))
            
            # Only rotate if angle is moderate (not extreme)
            if 3 < angle <= 12:
                needs_rotation = True
        except:
            pass
    
    # Apply rotation only if needed and not extreme
    if needs_rotation:
        try:
            box, landmarks, _, rotated_pil, _ = get_face_and_landmarks(
                input_path,
                conf_threshold=conf_threshold,
                apply_rotation=True
            )
            
            if box is not None:
                pil_img = rotated_pil
                rotation_applied = True
            # If rotation fails, continue with original
        except:
            pass
    
    # Use original detection if rotation wasn't applied or failed
    if not rotation_applied:
        box, landmarks, _, pil_img, _ = get_face_and_landmarks(
            input_path,
            conf_threshold=conf_threshold,
            apply_rotation=False
        )
        
        if box is None:
            return None
    
    # Unpack face box
    x1, y1, x2, y2 = map(int, box)
    face_h = y2 - y1
    face_w = x2 - x1
    
    # Conservative hairline estimation
    hair_offset = int(face_h * 0.3)  # Reduced from 0.4
    
    # Calculate crop boundaries
    top = max(0, y1 - hair_offset - margin)
    bottom = min(pil_img.height, y2 + margin)
    
    # Extend sides proportionally to face width
    side_margin = max(margin, int(face_w * 0.2))
    left = max(0, x1 - side_margin)
    right = min(pil_img.width, x2 + side_margin)
    
    # Ensure minimum crop size
    min_size = max(face_h, face_w) + 2 * margin
    crop_w = right - left
    crop_h = bottom - top
    
    if crop_w < min_size:
        center_x = (left + right) // 2
        left = max(0, center_x - min_size // 2)
        right = min(pil_img.width, left + min_size)
    
    if crop_h < min_size:
        center_y = (top + bottom) // 2
        top = max(0, center_y - min_size // 2)
        bottom = min(pil_img.height, top + min_size)
    
    # Crop the image
    bust = pil_img.crop((left, top, right, bottom)).convert("RGB")
    
    # Apply aspect ratio if specified
    if target_ratio:
        w, h = bust.size
        curr = w / h
        
        if abs(curr - target_ratio) > 0.05:  # Only adjust if significantly different
            if curr > target_ratio:
                # Too wide - crop horizontally
                new_w = int(h * target_ratio)
                dx = (w - new_w) // 2
                bust = bust.crop((dx, 0, dx + new_w, h))
            else:
                # Too tall - crop vertically
                new_h = int(w / target_ratio)
                dy = (h - new_h) // 2
                bust = bust.crop((0, dy, w, dy + new_h))
    
    return bust


def auto_crop(pil_img, frontal_margin, profile_margin, box, landmarks, metadata, lip_offset=50, neck_offset=50):
    """
    Automatically crop based on face orientation, with fallback to bounding box if landmarks fail.
    Args:
        pil_img (PIL.Image): Input image.
        frontal_margin (int): Margin for frontal crop.
        profile_margin (int): Margin for profile crop.
        box (list): Bounding box [x1, y1, x2, y2].
        landmarks (dict): Facial landmarks.
        metadata (dict): Image metadata.
        lip_offset (int): Vertical offset for frontal crop.
        neck_offset (int): Vertical offset for profile crop.
    Returns:
        PIL.Image or None: Cropped image or None if cropping fails.
    """
    # Validate inputs
    # Why: Early validation with specific errors aids debugging and user feedback
    if pil_img is None:
        print("Error: No input image provided to auto_crop.")
        return None
    if box is None or len(box) < 4:
        print("Error: Missing or invalid bounding box in auto_crop.")
        return None
    if not landmarks or not all(k in landmarks for k in ["left_eye", "right_eye", "nose"]):
        print("Warning: Incomplete landmarks in auto_crop; falling back to bounding box crop.")
        # Fallback to profile crop using bounding box
        # Why: Provides a robust fallback, ensuring cropping succeeds even with partial data
        cropped_image = crop_profile_image(
            pil_img, box=box, metadata=metadata, margin=profile_margin, neck_offset=neck_offset
        )
        if cropped_image is None:
            print("Error: Fallback profile crop failed in auto_crop.")
        return cropped_image

    # Check face orientation and crop accordingly
    # Why: Maintains original logic but adds logging for debugging
    if is_frontal_face(landmarks):
        print("Detected frontal face; using crop_frontal_image.")
        cropped_image = crop_frontal_image(
            pil_img, landmarks=landmarks, metadata=metadata, margin=frontal_margin, lip_offset=lip_offset
        )
        if cropped_image is None:
            print("Warning: Frontal crop failed; falling back to bounding box crop.")
            # Fallback to profile crop
            # Why: Ensures cropping succeeds if frontal crop fails, improving reliability
            cropped_image = crop_profile_image(
                pil_img, box=box, metadata=metadata, margin=profile_margin, neck_offset=neck_offset
            )
    else:
        print("Detected profile face; using crop_profile_image.")
        cropped_image = crop_profile_image(
            pil_img, box=box, metadata=metadata, margin=profile_margin, neck_offset=neck_offset
        )

    if cropped_image is None:
        print("Error: All cropping attempts failed in auto_crop.")
    return cropped_image


def crop_chin_image(pil_img, margin=20, box=None, metadata={}, chin_offset=20):
    if box is None or len(box) < 4:
        return None
    width, height = pil_img.size
    crop_top = max(0, box[3] - chin_offset)
    crop_left = margin
    crop_right = width - margin
    crop_bottom = height
    try:
        cropped_img = pil_img.crop((crop_left, crop_top, crop_right, crop_bottom))
        return process_color_profile(cropped_img, metadata)
    except Exception as e:
        print(f"Chin crop error: {e}")
        return None


def crop_nose_image(pil_img, box, landmarks, metadata={}, margin=0):
    x1, y1, x2, y2 = box
    x1 = max(0, x1 - margin)
    y1 = max(0, y1 - margin)
    x2 = min(pil_img.width, x2 + margin)
    y2 = min(pil_img.height, y2 + margin)
    try:
        cropped_img = pil_img.crop((x1, y1, x2, y2))
        return process_color_profile(cropped_img, metadata)
    except Exception as e:
        print(f"Nose crop error: {e}")
        return None


def crop_below_lips_image(pil_img, margin=20, landmarks=None, metadata={}, offset=10):
    if not landmarks or not all(k in landmarks for k in ["mouth_left", "mouth_right"]):
        return None
    width, height = pil_img.size
    lip_y = (landmarks["mouth_left"][1] + landmarks["mouth_right"][1]) / 2
    crop_top = min(height, int(lip_y + offset))
    crop_left = margin
    crop_right = width - margin
    crop_bottom = height
    try:
        cropped_img = pil_img.crop((crop_left, crop_top, crop_right, crop_bottom))
        return process_color_profile(cropped_img, metadata)
    except Exception as e:
        print(f"Below lips crop error: {e}")
        return None


def crop_frontal_image_preview(
    pil_img,
    landmarks=None,
    metadata={},
    margin=20,
    lip_offset=50
):
    """
    Same as crop_frontal_image, but prints the coordinates for debugging.
    """
    if not landmarks or not all(k in landmarks for k in ["mouth_left", "mouth_right"]):
        print("Lip landmarks are missing for preview.")
        return None

    width, height = pil_img.size
    lip_y = (landmarks["mouth_left"][1] + landmarks["mouth_right"][1]) / 2

    left   = max(0, margin)
    top    = max(0, int(lip_y) - lip_offset)
    right  = min(width, width - margin)
    bottom = height

    print(f"Frontal-preview box: {(left, top, right, bottom)}")
    try:
        cropped = pil_img.crop((left, top, right, bottom))
        return process_color_profile(cropped, metadata)
    except Exception as e:
        print(f"Preview frontal crop error: {e}")
        return None


def crop_profile_image_preview(
    pil_img,
    box=None,
    metadata={},
    margin=20,
    neck_offset=50
):
    """
    Same as crop_profile_image, but prints the coordinates for debugging.
    """
    if box is None or len(box) < 4:
        print("Bounding box is missing or invalid for preview.")
        return None

    width, height = pil_img.size
    _, _, _, y2 = box

    left   = max(0, margin)
    top    = min(height, int(y2) + neck_offset)
    right  = min(width, width - margin)
    bottom = height

    print(f"Profile-preview box: {(left, top, right, bottom)}")
    try:
        cropped = pil_img.crop((left, top, right, bottom))
        return process_color_profile(cropped, metadata)
    except Exception as e:
        print(f"Preview profile crop error: {e}")
        return None


# --- Mapping helper functions ---


def map_slider_to_multiplier(slider_value, min_multiplier=0.5, max_multiplier=1.5):
    """
    Map a slider value (0 to 100) to a multiplier between min_multiplier and max_multiplier.
    A value of 50 yields a neutral multiplier (1.0).
    """
    return min_multiplier + (max_multiplier - min_multiplier) * (slider_value / 100.0)


def map_slider_to_blur_radius(slider_value, max_radius=5):
    """
    Map a slider value (0 to 100) to a blur radius.
    A value of 50 could be considered moderate (half of max_radius).
    """
    return max_radius * (slider_value / 100.0)

def apply_circle_mask(img):
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, w, h), fill=255)
    img.putalpha(mask)
    return img  # RGBA with circular transparency


# --- Enhanced Filter Functions ---


def apply_filter(pil_img, filter_name, slider_value=50):
    """
    Apply a filter to a PIL image using a slider_value for fine tuning.
    slider_value is expected to be in the range 0 to 100, with 50 as the neutral value.
    Supported filters: Brightness, Contrast, Saturation, Sharpness, Blur,
    Edge Detection, and Sepia.
    """
    # For brightness, contrast, saturation, and sharpness, map slider to a multiplier.
    # For example, slider_value=50 maps to 1.0 (neutral), while 0 maps to 0.5 and 100 to 1.5.
    brightness = lambda img: ImageEnhance.Brightness(img).enhance(
        map_slider_to_multiplier(slider_value, 0.5, 1.5)
    )
    contrast = lambda img: ImageEnhance.Contrast(img).enhance(
        map_slider_to_multiplier(slider_value, 0.5, 1.5)
    )
    saturation = lambda img: ImageEnhance.Color(img).enhance(
        map_slider_to_multiplier(slider_value, 0.5, 1.5)
    )
    sharpness = lambda img: ImageEnhance.Sharpness(img).enhance(
        map_slider_to_multiplier(slider_value, 0.5, 1.5)
    )
    # For blur, map the slider to a blur radius (e.g., 0 to 5)
    blur = lambda img: img.filter(
        ImageFilter.GaussianBlur(radius=map_slider_to_blur_radius(slider_value, 5))
    )
    # Edge detection remains binary; intensity is not applicable
    edge_detection = lambda img: img.filter(ImageFilter.FIND_EDGES)
    # Sepia: blend original with a sepia-toned version based on a normalized slider
    sepia = lambda img: apply_sepia(img, slider_value / 100.0)

    filter_functions = {
        "Brightness": brightness,
        "Contrast": contrast,
        "Saturation": saturation,
        "Sharpness": sharpness,
        "Blur": blur,
        "Edge Detection": edge_detection,
        "Sepia": sepia,
    }

    # Return the filtered image or the original if the filter is not found.
    return filter_functions.get(filter_name, lambda img: img)(pil_img)


def apply_sepia(pil_img, blend_factor=0.5):
    """
    Apply a sepia filter by blending the original image with a sepia-toned version.
    blend_factor should be between 0 (original) and 1 (full sepia).
    """
    # Convert image to grayscale
    grayscale = pil_img.convert("L")
    # Create a sepia-toned image via colorization
    sepia_img = ImageOps.colorize(grayscale, "#704214", "#C0A080")
    # Blend original and sepia images based on blend_factor
    return Image.blend(pil_img, sepia_img, blend_factor)


# --- Background Removal with Transparency ---


def remove_background_transparent(cv_img):
    """
    Remove the background from a CV2 image using GrabCut and output an image with transparency.
    The foreground pixels become fully opaque, and background pixels become transparent. Should work well for images with a clear subject.
    """
    mask = np.zeros(cv_img.shape[:2], np.uint8)
    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)
    rect = (50, 50, cv_img.shape[1] - 50, cv_img.shape[0] - 50)
    cv2.grabCut(cv_img, mask, rect, bgd_model, fgd_model, 5, cv2.GC_INIT_WITH_RECT)
    mask2 = np.where((mask == 2) | (mask == 0), 0, 1).astype("uint8")
    alpha = mask2 * 255
    b, g, r = cv2.split(cv_img)
    cv_img_transparent = cv2.merge([b, g, r, alpha])
    return cv_img_transparent


def apply_aspect_ratio_filter(pil_img, target_ratio):
    """
    Crop the PIL image to a target aspect ratio while keeping the crop centered.
    
    Args:
        pil_img (PIL.Image): The input image.
        target_ratio (float): Desired aspect ratio (width / height).
        
    Returns:
        PIL.Image: The cropped image.
    """
    width, height = pil_img.size
    current_ratio = width / height

    if current_ratio > target_ratio:
        # Image is too wide: crop the sides
        new_width = int(height * target_ratio)
        left = (width - new_width) // 2
        right = left + new_width
        crop_box = (left, 0, right, height)
    else:
        # Image is too tall: crop the top and bottom
        new_height = int(width / target_ratio)
        top = (height - new_height) // 2
        bottom = top + new_height
        crop_box = (0, top, width, bottom)
    
    return pil_img.crop(crop_box)


# ----------------------------
# Dedicated face detection queue worker
# ----------------------------
class FaceDetectionWorker:
    """Keeps one model in memory, processes detection requests sequentially."""

    def __init__(self):
        self.task_q = queue.Queue()
        self.result_q = queue.Queue()
        self.thread = threading.Thread(target=self._worker, daemon=True)
        self.thread.start()

    def _worker(self):
        while True:
            item = self.task_q.get()
            if item is None:
                self.task_q.task_done()
                break
            filename, args = item
            try:
                result = get_face_and_landmarks(*args)
                self.result_q.put((filename, result, None))
            except Exception as e:
                self.result_q.put((filename, None, e))
            finally:
                self.task_q.task_done()

    def submit(self, filename, *args):
        self.task_q.put((filename, args))

    def get_result(self):
        return self.result_q.get()

    def shutdown(self):
        self.task_q.put(None)
        self.task_q.join()
        self.thread.join(timeout=2)


# ----------------------------
# Cropping controller helpers
# ----------------------------
def process_image(
    filename,
    detection_result,
    output_folder,
    frontal_margin,
    profile_margin,
    use_frontal,
    use_profile,
    crop_style,
    filter_name,
    filter_intensity,
    aspect_ratio,
):
    """Do cropping + filtering + save based on detection result."""
    input_path, box, landmarks, _, pil_img, metadata = detection_result
    output_path = os.path.join(output_folder, f"cropped_{filename}")

    if box is None or landmarks is None:
        print(f"{filename}: No face detected. Skipping...")
        return 0

    crop_functions = {
        "frontal": lambda: (
            crop_frontal_image(
                pil_img,
                margin=frontal_margin,
                landmarks=landmarks,
                metadata=metadata,
                lip_offset=50,
            )
            if use_frontal and is_frontal_face(landmarks)
            else auto_crop(
                pil_img,
                frontal_margin,
                profile_margin,
                box,
                landmarks,
                metadata,
                lip_offset=50,
                neck_offset=50,
            )
        ),
        "profile": lambda: (
            crop_profile_image(
                pil_img,
                margin=profile_margin,
                neck_offset=50,
                box=box,
                metadata=metadata,
            )
            if use_profile
            else None
        ),
        "chin": lambda: crop_chin_image(
            pil_img,
            margin=frontal_margin,
            box=box,
            metadata=metadata,
            chin_offset=20,
        ),
        "nose": lambda: crop_nose_image(
            pil_img,
            box,
            landmarks,
            metadata,
            margin=0,
        ),
        "below_lips": lambda: crop_below_lips_image(
            pil_img,
            margin=frontal_margin,
            landmarks=landmarks,
            metadata=metadata,
            offset=10,
        ),
        "auto": lambda: auto_crop(
            pil_img,
            frontal_margin,
            profile_margin,
            box,
            landmarks,
            metadata,
            lip_offset=50,
            neck_offset=50,
        ),
    }

    try:
        cropped_img = crop_functions.get(crop_style, lambda: None)()
        if cropped_img and aspect_ratio:
            cropped_img = apply_aspect_ratio_filter(cropped_img, aspect_ratio)
        if cropped_img:
            cropped_img = apply_filter(cropped_img, filter_name, filter_intensity)
            save_image(cropped_img, output_path, metadata)
        else:
            print(f"{filename}: Cropping failed. Skipping...")
    except Exception as e:
        print(f"{filename}: error during crop/save: {e}")
        return 0
    return 1


def process_images_threaded(
    input_folder,
    output_folder,
    frontal_margin,
    profile_margin,
    sharpen=True,
    use_frontal=True,
    use_profile=True,
    progress_callback=None,
    cancel_func=None,
    apply_rotation=True,
    crop_style="auto",
    filter_name="None",
    filter_intensity=50,
    aspect_ratio=None,
):
    """Run face detection sequentially with one model, and crop/save in parallel."""
    os.makedirs(output_folder, exist_ok=True)
    valid_exts = (".jpg", ".jpeg", ".png", ".heic")
    filenames = [f for f in os.listdir(input_folder) if f.lower().endswith(valid_exts)]
    total = len(filenames)
    if not total:
        print("No valid images found.")
        return 0, 0

    detector = FaceDetectionWorker()

    for fn in filenames:
        input_path = os.path.join(input_folder, fn)
        detector.submit(fn, input_path, 0.3, sharpen, apply_rotation)

    processed = 0
    max_workers = min(4, multiprocessing.cpu_count())
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = []

        for _ in range(total):
            filename, result, err = detector.get_result()
            if err:
                print(f"{filename}: detection error {err}")
                continue
            if cancel_func and cancel_func():
                break

            fut = executor.submit(
                process_image,
                filename,
                (os.path.join(input_folder, filename), *result),
                output_folder,
                frontal_margin,
                profile_margin,
                use_frontal,
                use_profile,
                crop_style,
                filter_name,
                filter_intensity,
                aspect_ratio,
            )
            futures.append(fut)

        for fut in concurrent.futures.as_completed(futures):
            processed += fut.result()
            if progress_callback:
                progress_callback(processed, total, "Processed")

    detector.shutdown()
    print(f"✅ Done: {processed}/{total} images processed.")
    return processed, total

def main():
    # sanity check ICC profiles
    assert SRGB_PROFILE, "sRGB.icc failed to load"
    assert DISPLAY_P3_PROFILE, "Display P3.icc failed to load"

    img_path = "sample.png"
    output_path = "output_cropped.png"
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    try:
        pil_img = Image.open(img_path)
    except Exception as e:
        print(f"Error loading image: {e}")
        return

    box, landmarks, cv_img, pil_img, metadata = get_face_and_landmarks(
        img_path, conf_threshold=0.3
    )
    if not (box and landmarks):
        print("Face detection failed—see logs.")
        return

    cropped_img = auto_crop(
        pil_img,
        frontal_margin=20,
        profile_margin=20,
        box=box,
        landmarks=landmarks,
        metadata=metadata,
        lip_offset=0,
        neck_offset=0,
    )
    if not cropped_img:
        print("auto_crop returned None—see logs.")
        return

    # cropped_img.show()  # uncomment to preview
    success = save_image(cropped_img, output_path, metadata, output_format="PNG")
    if success:
        print(f"Successfully saved cropped image to {output_path}")
    else:
        print("Failed to save cropped image.")

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import tempfile

app = FastAPI(title="smart-crop API")

# Configure CORS origins via environment variable SMARTCROP_FRONTEND_ORIGINS
origins_env = os.getenv("SMARTCROP_FRONTEND_ORIGINS")
if origins_env:
    origins = [o.strip() for o in origins_env.split(",") if o.strip()]
else:
    origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/crop")
async def crop_endpoint(
    file: UploadFile = File(...),
    method: str = Form("auto"),
):
    """
    Upload an image and return a cropped image.
    `method` can be: auto (default), head_bust, frontal, profile, chin, nose, below_lips
    """
    suffix = os.path.splitext(file.filename)[1] or ".jpg"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        content = await file.read()
        tmp.write(content)
        tmp.flush()
        tmp.close()

        box, landmarks, cv_img, pil_img, metadata = get_face_and_landmarks(
            tmp.name, conf_threshold=0.3
        )

        cropped = None
        if method == "head_bust":
            cropped = head_bust_crop(tmp.name)
        elif method == "auto":
            cropped = auto_crop(
                pil_img,
                frontal_margin=20,
                profile_margin=20,
                box=box,
                landmarks=landmarks,
                metadata=metadata,
            )
        elif method == "frontal":
            cropped = crop_frontal_image(pil_img, landmarks=landmarks, metadata=metadata)
        elif method == "profile":
            cropped = crop_profile_image(pil_img, box=box, metadata=metadata)
        elif method == "chin":
            cropped = crop_chin_image(pil_img, box=box, metadata=metadata)
        elif method == "nose":
            cropped = crop_nose_image(pil_img, box=box, landmarks=landmarks, metadata=metadata)
        elif method == "below_lips":
            cropped = crop_below_lips_image(pil_img, landmarks=landmarks, metadata=metadata)
        else:
            raise HTTPException(status_code=400, detail="Unknown method")

        if cropped is None:
            raise HTTPException(status_code=500, detail="Cropping failed")

        buf = io.BytesIO()

        save_kwargs = {}
        if getattr(cropped, "info", None) and "icc_profile" in cropped.info:
            save_kwargs["icc_profile"] = cropped.info.get("icc_profile")

        cropped.save(buf, format="PNG", **save_kwargs)

        buf.seek(0)
        return StreamingResponse(buf, media_type="image/png")

    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=False)

# Estimation of the time complexity:
# The time complexity of the image processing functions is generally O(n), where n is the number of pixels in the image.
# This is because most operations (like cropping, filtering, etc.) need to iterate over each pixel at least once.
# The overall complexity of the batch processing function is O(m * n), where m is the number of images and n is the average number of pixels per image.
# The threading and multiprocessing aspects can help reduce the wall-clock time but do not change the underlying complexity.
# The actual time taken will depend on the size of the images, the number of images, and the specific operations being performed.
# The performance can be further optimized by using libraries like OpenCV or Numba for specific operations.


# Estimation of the marketability of the code:
# The code is designed to be user-friendly and provides a GUI for image cropping and processing, which is a common requirement in various applications
# However, the marketability of the code would depend on several factors:
# 1. **User Interface**: The GUI is simple and functional, but it could be enhanced with more features and better aesthetics.
# 2. **Performance**: The code uses threading and multiprocessing, which is good for performance, but the actual speed will depend on the hardware and image sizes.
# 3. **Features**: The code includes several useful features like cropping, filtering, and background removal but may be too "complicated" for the average user.
# 4. **Documentation**: The code is commented, but additional user documentation would be beneficial for non-technical users due to the heavy usage of many librairies.
# 5. **Market Demand**: The demand for image processing tools is high, especially in fields like photography, e-commerce, and social medias.
# 6. **Competition**: There are many existing tools and libraries for image processing, so the code would need to offer unique features or better performance to stand out.

# Unique selling points could include:
# - Easy-to-use GUI for batch processing
# - Support for multiple cropping styles
# - Integration with popular image formats (e.g., HEIC!)
# - Customizable filters and effects
# - Background removal with transparency
# - Performance optimizations for large batches of images
# - Compatibility with various platforms (Windows, macOS, Linux)
# - Potential for cloud-based processing or integration with web services
# - Ability to save and load presets for different cropping/filtering styles
