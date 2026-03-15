import io
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from PIL import Image


class _StubImage:
    def __init__(self):
        self.size = (100, 100)


def test_parse_crop_options_normalizes_supported_inputs(fastapi_main_module):
    options = fastapi_main_module.parse_crop_options(
        target_aspect_ratio="4:5",
        margin_top=0.1,
        margin_right=0.2,
        margin_bottom=0.3,
        margin_left=0.4,
        anchor_hint=" TOP ",
        crop_coordinates='{"left":0.1,"top":0.2,"width":0.6,"height":0.7}',
        filters='["sharpen", "grayscale"]',
    )

    assert options.target_aspect_ratio == (4.0, 5.0)
    assert options.margins == (0.1, 0.2, 0.3, 0.4)
    assert options.anchor_hint == "top"
    assert options.crop_coordinates == {
        "left": 0.1,
        "top": 0.2,
        "width": 0.6,
        "height": 0.7,
    }
    assert options.filters == ["sharpen", "grayscale"]


@pytest.mark.parametrize(
    "raw_ratio, expected",
    [
        (None, None),
        ("", None),
        (" 1.5 ", (1.5, 1.0)),
        ("16:9", (16.0, 9.0)),
    ],
)
def test_parse_aspect_ratio_valid_cases(fastapi_main_module, raw_ratio, expected):
    assert fastapi_main_module._parse_aspect_ratio(raw_ratio) == expected


@pytest.mark.parametrize("raw_ratio", ["abc", "0:2", "2:0", "-1:2"])
def test_parse_aspect_ratio_rejects_invalid_values(fastapi_main_module, raw_ratio):
    with pytest.raises(HTTPException) as exc_info:
        fastapi_main_module._parse_aspect_ratio(raw_ratio)

    assert exc_info.value.status_code == 400


@pytest.mark.parametrize(
    "margins, expected",
    [
        ((None, None, None, None), None),
        ((0.1, None, 0.2, None), (0.1, 0.0, 0.2, 0.0)),
    ],
)
def test_parse_margins_valid_cases(fastapi_main_module, margins, expected):
    assert fastapi_main_module._parse_margins(*margins) == expected


def test_parse_margins_rejects_negative_values(fastapi_main_module):
    with pytest.raises(HTTPException) as exc_info:
        fastapi_main_module._parse_margins(0.1, -0.1, 0.0, 0.0)

    assert exc_info.value.status_code == 400


@pytest.mark.parametrize(
    "raw_anchor, expected",
    [
        (None, None),
        ("", None),
        (" Center ", "center"),
    ],
)
def test_normalize_anchor_hint_valid_cases(fastapi_main_module, raw_anchor, expected):
    assert fastapi_main_module._normalize_anchor_hint(raw_anchor) == expected


def test_normalize_anchor_hint_rejects_invalid_value(fastapi_main_module):
    with pytest.raises(HTTPException) as exc_info:
        fastapi_main_module._normalize_anchor_hint("middle")

    assert exc_info.value.status_code == 400


@pytest.mark.parametrize(
    "raw_pipeline, expected",
    [
        (None, "auto"),
        ("", "auto"),
        (" Face ", "face"),
        ("heuristic", "heuristic"),
    ],
)
def test_normalize_pipeline_valid_cases(fastapi_main_module, raw_pipeline, expected):
    assert fastapi_main_module._normalize_pipeline(raw_pipeline) == expected


def test_normalize_pipeline_rejects_invalid_value(fastapi_main_module):
    with pytest.raises(HTTPException) as exc_info:
        fastapi_main_module._normalize_pipeline("bogus")

    assert exc_info.value.status_code == 400
    assert "pipeline must be one of" in exc_info.value.detail


@pytest.mark.parametrize(
    "raw_filters, expected",
    [
        (None, None),
        ("", None),
        ("sharpen, detail", ["sharpen", "detail"]),
        ('["grayscale", "sharpen"]', ["grayscale", "sharpen"]),
    ],
)
def test_parse_filters_valid_cases(fastapi_main_module, raw_filters, expected):
    assert fastapi_main_module._parse_filters(raw_filters) == expected


@pytest.mark.parametrize("raw_filters", ["[", "[1,2", '["unknown"]'])
def test_parse_filters_rejects_invalid_inputs(fastapi_main_module, raw_filters):
    with pytest.raises(HTTPException) as exc_info:
        fastapi_main_module._parse_filters(raw_filters)

    assert exc_info.value.status_code == 400


def test_parse_crop_coordinates_rejects_invalid_json(fastapi_main_module):
    with pytest.raises(HTTPException) as exc_info:
        fastapi_main_module._parse_crop_coordinates("{")

    assert exc_info.value.status_code == 400


def test_parse_crop_coordinates_accepts_fastapi_form_default_none(fastapi_main_module):
    assert fastapi_main_module._parse_crop_coordinates(fastapi_main_module.Form(default=None)) is None


def test_apply_crop_postprocessing_manual_crop_coordinates_take_precedence(fastapi_main_module):
    image = Image.new("RGB", (120, 80), "white")
    crop_options = fastapi_main_module.CropOptions(
        target_aspect_ratio=(1.0, 1.0),
        margins=(0.1, 0.1, 0.1, 0.1),
        crop_coordinates={
            "left": 0.25,
            "top": 0.25,
            "width": 0.5,
            "height": 0.5,
        },
    )

    cropped = fastapi_main_module.apply_crop_postprocessing(image, crop_options)
    assert cropped.size == (60, 40)


@pytest.mark.parametrize(
    "filename, content_type, expected",
    [
        ("photo.heic", "image/heic", {"resolved": "HEIC", "pil_format": "HEIF", "extension": "heic", "media_type": "image/heic"}),
        ("portrait.jpeg", None, {"resolved": "JPEG", "pil_format": "JPEG", "extension": "jpg", "media_type": "image/jpeg"}),
        (None, "image/png", {"resolved": "PNG", "pil_format": "PNG", "extension": "png", "media_type": "image/png"}),
    ],
)
def test_resolve_output_format_happy_paths(fastapi_main_module, filename, content_type, expected):
    assert fastapi_main_module.resolve_output_format(filename, content_type) == expected


def test_resolve_output_format_rejects_unsupported_files(fastapi_main_module):
    with pytest.raises(HTTPException) as exc_info:
        fastapi_main_module.resolve_output_format("archive.zip", "application/zip")

    assert exc_info.value.status_code == 400


def test_run_crop_pipeline_falls_back_to_center_content_when_face_missing(monkeypatch, fastapi_main_module):
    sentinel_output = SimpleNamespace(name="center")
    captured = {}

    monkeypatch.setattr(
        fastapi_main_module,
        "get_face_and_landmarks",
        lambda *args, **kwargs: (None, None, "cv", "pil", {"meta": True}),
    )
    monkeypatch.setattr(
        fastapi_main_module,
        "center_content_crop",
        lambda pil_img, metadata=None: sentinel_output,
    )

    def fake_apply_postprocessing(cropped, crop_options):
        captured["cropped"] = cropped
        captured["crop_options"] = crop_options
        return "final-image"

    monkeypatch.setattr(fastapi_main_module, "apply_crop_postprocessing", fake_apply_postprocessing)

    crop_options = fastapi_main_module.CropOptions(anchor_hint="center")
    result = fastapi_main_module.run_crop_pipeline("tmp.jpg", "auto", crop_options)

    assert result == "final-image"
    assert captured["cropped"] is sentinel_output
    assert captured["crop_options"] is crop_options


def test_run_crop_pipeline_rejects_unknown_method(monkeypatch, fastapi_main_module):
    monkeypatch.setattr(
        fastapi_main_module,
        "get_face_and_landmarks",
        lambda *args, **kwargs: ([1, 2, 3, 4], [[1, 1]], "cv", _StubImage(), {}),
    )

    with pytest.raises(HTTPException) as exc_info:
        fastapi_main_module.run_crop_pipeline("tmp.jpg", "unexpected", fastapi_main_module.CropOptions())

    assert exc_info.value.status_code == 400


def test_run_crop_pipeline_rejects_unknown_pipeline(monkeypatch, fastapi_main_module):
    monkeypatch.setattr(
        fastapi_main_module,
        "get_face_and_landmarks",
        lambda *args, **kwargs: ([1, 2, 3, 4], [[1, 1]], "cv", _StubImage(), {}),
    )

    with pytest.raises(HTTPException) as exc_info:
        fastapi_main_module.run_crop_pipeline(
            "tmp.jpg",
            "auto",
            fastapi_main_module.CropOptions(),
            pipeline="unexpected",
        )

    assert exc_info.value.status_code == 400
    assert "pipeline must be one of" in exc_info.value.detail


def test_run_crop_pipeline_uses_salience_candidate_box(monkeypatch, fastapi_main_module):
    image = Image.new("RGB", (120, 100), "white")

    monkeypatch.setattr(
        fastapi_main_module,
        "get_face_and_landmarks",
        lambda *args, **kwargs: ([1, 2, 3, 4], [[1, 1]], "cv", image, {}),
    )
    monkeypatch.setattr(
        fastapi_main_module,
        "infer_salience_mask",
        lambda *args, **kwargs: [[0.0]],
    )
    monkeypatch.setattr(
        fastapi_main_module,
        "compute_candidate_crop_box",
        lambda *args, **kwargs: (10, 10, 90, 80),
    )
    monkeypatch.setattr(
        fastapi_main_module,
        "apply_crop_postprocessing",
        lambda cropped, crop_options: cropped,
    )

    result = fastapi_main_module.run_crop_pipeline(
        "tmp.jpg",
        "auto",
        fastapi_main_module.CropOptions(),
        pipeline="salience",
    )

    assert result.size == (80, 70)


def test_run_crop_pipeline_salience_falls_back_when_inference_fails(monkeypatch, fastapi_main_module):
    image = Image.new("RGB", (120, 100), "white")

    monkeypatch.setattr(
        fastapi_main_module,
        "get_face_and_landmarks",
        lambda *args, **kwargs: ([1, 2, 3, 4], [[1, 1]], "cv", image, {"meta": True}),
    )

    def _raise(*args, **kwargs):
        raise RuntimeError("no model")

    monkeypatch.setattr(fastapi_main_module, "infer_salience_mask", _raise)
    monkeypatch.setattr(
        fastapi_main_module,
        "compute_candidate_crop_box",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        fastapi_main_module,
        "center_content_crop",
        lambda pil_img, metadata=None: "center-result",
    )
    monkeypatch.setattr(
        fastapi_main_module,
        "apply_crop_postprocessing",
        lambda cropped, crop_options: cropped,
    )

    result = fastapi_main_module.run_crop_pipeline(
        "tmp.jpg",
        "auto",
        fastapi_main_module.CropOptions(),
        pipeline="salience",
    )

    assert result == "center-result"


def test_run_crop_pipeline_rejects_unsupported_method_for_salience_pipeline(monkeypatch, fastapi_main_module):
    monkeypatch.setattr(
        fastapi_main_module,
        "get_face_and_landmarks",
        lambda *args, **kwargs: ([1, 2, 3, 4], [[1, 1]], "cv", _StubImage(), {}),
    )

    with pytest.raises(HTTPException) as exc_info:
        fastapi_main_module.run_crop_pipeline(
            "tmp.jpg",
            "frontal",
            fastapi_main_module.CropOptions(),
            pipeline="salience",
        )

    assert exc_info.value.status_code == 400
    assert "not supported for pipeline 'salience'" in exc_info.value.detail


def test_run_crop_pipeline_raises_runtime_error_when_crop_method_returns_none(monkeypatch, fastapi_main_module):
    monkeypatch.setattr(
        fastapi_main_module,
        "get_face_and_landmarks",
        lambda *args, **kwargs: ([1, 2, 3, 4], [[1, 1]], "cv", _StubImage(), {}),
    )
    monkeypatch.setattr(fastapi_main_module, "crop_profile_image", lambda *args, **kwargs: None)

    with pytest.raises(RuntimeError, match="Cropping failed"):
        fastapi_main_module.run_crop_pipeline("tmp.jpg", "profile", fastapi_main_module.CropOptions())


def test_crop_batch_endpoint_returns_canonical_payload(monkeypatch, fastapi_main_module):
    import asyncio
    import io

    from starlette.datastructures import Headers, UploadFile

    monkeypatch.setattr(fastapi_main_module, "run_crop_pipeline", lambda *args, **kwargs: object())
    monkeypatch.setattr(
        fastapi_main_module,
        "resolve_output_format",
        lambda *args, **kwargs: {"extension": "png", "pil_format": "PNG", "media_type": "image/png"},
    )
    monkeypatch.setattr(fastapi_main_module, "image_to_buffer", lambda *args, **kwargs: io.BytesIO(b"png-bytes"))

    upload = UploadFile(
        file=io.BytesIO(b"fake-image-bytes"),
        filename="sample.jpg",
        headers=Headers({"content-type": "image/jpeg"}),
    )

    response = asyncio.run(
        fastapi_main_module.crop_batch_endpoint(
            files=[upload],
            file=None,
            method="auto",
            target_aspect_ratio=None,
            margin_top=None,
            margin_right=None,
            margin_bottom=None,
            margin_left=None,
            anchor_hint=None,
            filters=None,
            _=None,
        )
    )

    assert response["status"] == "succeeded"
    assert response["summary"]["requestedCount"] == 1
    assert response["summary"]["failedCount"] == 0
    assert len(response["mediaUpdates"]) == 1


def test_salience_compute_candidate_crop_box_prefers_largest_component(fastapi_main_module):
    mask = fastapi_main_module.np.zeros((10, 10), dtype=fastapi_main_module.np.float32)
    mask[1:4, 1:4] = 0.9
    mask[5:10, 5:10] = 0.95

    box = fastapi_main_module.compute_candidate_crop_box(
        mask,
        image_size=(10, 10),
        threshold=0.5,
        padding_ratio=0.0,
        min_salient_area_ratio=0.01,
    )

    assert box == (5, 5, 10, 10)


def test_salience_compute_candidate_crop_box_uses_center_bias_fallback(fastapi_main_module):
    mask = fastapi_main_module.np.zeros((10, 10), dtype=fastapi_main_module.np.float32)

    box = fastapi_main_module.compute_candidate_crop_box(
        mask,
        image_size=(100, 80),
        threshold=0.9,
        min_salient_area_ratio=0.5,
        use_center_bias_fallback=True,
    )

    assert box == (16, 9, 84, 77)



def _make_png_bytes():
    image = Image.new("RGB", (4, 4), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def test_crop_batch_contract_success(monkeypatch, fastapi_main_module):
    import asyncio

    from starlette.datastructures import Headers, UploadFile

    monkeypatch.setattr(
        fastapi_main_module,
        "run_crop_pipeline",
        lambda *args, **kwargs: Image.new("RGB", (8, 8), "white"),
    )

    upload = UploadFile(
        file=io.BytesIO(_make_png_bytes()),
        filename="ok.png",
        headers=Headers({"content-type": "image/png"}),
    )

    payload = asyncio.run(
        fastapi_main_module.crop_batch_endpoint(
            files=[upload],
            file=None,
            pipeline="auto",
            method="auto",
            target_aspect_ratio=None,
            margin_top=None,
            margin_right=None,
            margin_bottom=None,
            margin_left=None,
            anchor_hint=None,
            crop_coordinates=None,
            filters=None,
            _=None,
        )
    )

    assert payload["status"] == "succeeded"
    assert payload["summary"]["failedCount"] == 0
    assert payload["mediaUpdates"][0]["status"] == "updated"


def test_crop_batch_contract_partial_failure(monkeypatch, fastapi_main_module):
    import asyncio

    from starlette.datastructures import Headers, UploadFile

    state = {"calls": 0}

    def _run_crop_pipeline(path, method, crop_options, pipeline="auto"):
        state["calls"] += 1
        if state["calls"] == 2:
            raise RuntimeError("boom")
        return Image.new("RGB", (8, 8), "white")

    monkeypatch.setattr(fastapi_main_module, "run_crop_pipeline", _run_crop_pipeline)

    uploads = [
        UploadFile(file=io.BytesIO(_make_png_bytes()), filename="ok.png", headers=Headers({"content-type": "image/png"})),
        UploadFile(file=io.BytesIO(_make_png_bytes()), filename="fail.png", headers=Headers({"content-type": "image/png"})),
    ]

    payload = asyncio.run(
        fastapi_main_module.crop_batch_endpoint(
            files=uploads,
            file=None,
            pipeline="auto",
            method="auto",
            target_aspect_ratio=None,
            margin_top=None,
            margin_right=None,
            margin_bottom=None,
            margin_left=None,
            anchor_hint=None,
            crop_coordinates=None,
            filters=None,
            _=None,
        )
    )

    assert payload["status"] == "partial_failure"
    assert payload["summary"]["failedCount"] == 1
    assert len(payload["errors"]) == 1


def test_crop_contract_auth_failure(monkeypatch, fastapi_main_module):
    import asyncio

    monkeypatch.setattr(fastapi_main_module, "SMARTCROP_API_TOKEN", "token")

    with pytest.raises(HTTPException) as exc_info:
        fastapi_main_module.require_smartcrop_token(None)

    response = asyncio.run(
        fastapi_main_module.canonical_http_exception_handler(
            fastapi_main_module.Request({"type": "http", "method": "POST", "path": "/crop/batch", "headers": []}),
            exc_info.value,
        )
    )

    assert response.status_code == 401
    payload = json.loads(response.body)
    assert payload["status"] == "failed"
    assert payload["errors"][0]["code"] == "auth_error"


def test_crop_contract_validation_failure(fastapi_main_module):
    import asyncio

    exc = HTTPException(status_code=400, detail="pipeline must be one of: auto, face, salience, heuristic")
    response = asyncio.run(
        fastapi_main_module.canonical_http_exception_handler(
            fastapi_main_module.Request({"type": "http", "method": "POST", "path": "/crop/batch", "headers": []}),
            exc,
        )
    )

    assert response.status_code == 400
    payload = json.loads(response.body)
    assert payload["status"] == "failed"
    assert payload["errors"][0]["message"]


def test_error_payload_schema_for_auth_and_validation_errors(fastapi_main_module):
    import asyncio

    request = fastapi_main_module.Request({"type": "http", "method": "POST", "path": "/crop/batch", "headers": []})

    auth_exc = HTTPException(status_code=401, detail="Missing X-SmartCrop-Token header")
    auth_response = asyncio.run(fastapi_main_module.canonical_http_exception_handler(request, auth_exc))
    auth_payload = json.loads(auth_response.body)

    assert auth_response.status_code == 401
    assert auth_payload["errors"][0] == {
        "code": "auth_error",
        "message": "Missing X-SmartCrop-Token header",
        "details": {"statusCode": 401},
    }

    validation_exc = HTTPException(status_code=413, detail="Too many files")
    validation_response = asyncio.run(fastapi_main_module.canonical_http_exception_handler(request, validation_exc))
    validation_payload = json.loads(validation_response.body)

    assert validation_response.status_code == 413
    assert validation_payload["errors"][0] == {
        "code": "validation_error",
        "message": "Too many files",
        "details": {"statusCode": 413},
    }


def test_error_payload_schema_for_resource_error(fastapi_main_module):
    import asyncio

    request = fastapi_main_module.Request({"type": "http", "method": "POST", "path": "/crop/batch", "headers": []})
    exc = HTTPException(status_code=503, detail="Smart Crop API is busy. Please retry shortly.")

    response = asyncio.run(fastapi_main_module.canonical_http_exception_handler(request, exc))
    payload = json.loads(response.body)

    assert response.status_code == 503
    assert payload["errors"][0] == {
        "code": "resource_error",
        "message": "Smart Crop API is busy. Please retry shortly.",
        "details": {"statusCode": 503},
    }


def test_crop_batch_preserves_http_exception_status_in_error_details(monkeypatch, fastapi_main_module):
    from starlette.datastructures import Headers, UploadFile
    import asyncio

    monkeypatch.setattr(
        fastapi_main_module,
        "run_crop_pipeline",
        lambda *args, **kwargs: (_ for _ in ()).throw(HTTPException(status_code=400, detail="Unknown method")),
    )

    upload = UploadFile(
        file=io.BytesIO(_make_png_bytes()),
        filename="bad.png",
        headers=Headers({"content-type": "image/png"}),
    )

    payload = asyncio.run(
        fastapi_main_module.crop_batch_endpoint(
            files=[upload],
            file=None,
            pipeline="auto",
            method="auto",
            target_aspect_ratio=None,
            margin_top=None,
            margin_right=None,
            margin_bottom=None,
            margin_left=None,
            anchor_hint=None,
            crop_coordinates=None,
            filters=None,
            _=None,
        )
    )

    assert payload["status"] == "failed"
    assert payload["errors"][0] == {
        "code": "validation_error",
        "message": "Unknown method",
        "details": {"statusCode": 400, "sourceFilename": "bad.png"},
    }


def test_crop_batch_maps_unexpected_exception_to_stable_internal_error(monkeypatch, fastapi_main_module):
    from starlette.datastructures import Headers, UploadFile
    import asyncio

    monkeypatch.setattr(
        fastapi_main_module,
        "run_crop_pipeline",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("kaboom")),
    )

    upload = UploadFile(
        file=io.BytesIO(_make_png_bytes()),
        filename="explode.png",
        headers=Headers({"content-type": "image/png"}),
    )

    payload = asyncio.run(
        fastapi_main_module.crop_batch_endpoint(
            files=[upload],
            file=None,
            pipeline="auto",
            method="auto",
            target_aspect_ratio=None,
            margin_top=None,
            margin_right=None,
            margin_bottom=None,
            margin_left=None,
            anchor_hint=None,
            crop_coordinates=None,
            filters=None,
            _=None,
        )
    )

    assert payload["status"] == "failed"
    assert payload["errors"][0] == {
        "code": "internal_error",
        "message": "Unexpected crop failure",
        "details": {"sourceFilename": "explode.png", "reason": "kaboom"},
    }


def test_crop_batch_endpoint_exact_http_status_codes_for_request_failures(fastapi_main_module):
    import asyncio

    request = fastapi_main_module.Request({"type": "http", "method": "POST", "path": "/crop/batch", "headers": []})

    with pytest.raises(HTTPException) as no_file_exc:
        asyncio.run(
            fastapi_main_module.crop_batch_endpoint(
                files=None,
                file=None,
                pipeline="auto",
                method="auto",
                target_aspect_ratio=None,
                margin_top=None,
                margin_right=None,
                margin_bottom=None,
                margin_left=None,
                anchor_hint=None,
                crop_coordinates=None,
                filters=None,
                _=None,
            )
        )

    no_file_response = asyncio.run(
        fastapi_main_module.canonical_http_exception_handler(request, no_file_exc.value)
    )
    assert no_file_response.status_code == 400
    assert json.loads(no_file_response.body)["errors"][0] == {
        "code": "validation_error",
        "message": "No files uploaded",
        "details": {"statusCode": 400},
    }

    from starlette.datastructures import Headers, UploadFile

    uploads = [
        UploadFile(file=io.BytesIO(_make_png_bytes()), filename="one.png", headers=Headers({"content-type": "image/png"})),
        UploadFile(file=io.BytesIO(_make_png_bytes()), filename="two.png", headers=Headers({"content-type": "image/png"})),
    ]

    original_max = fastapi_main_module.MAX_BATCH_FILES
    try:
        fastapi_main_module.MAX_BATCH_FILES = 1
        with pytest.raises(HTTPException) as too_many_exc:
            asyncio.run(
                fastapi_main_module.crop_batch_endpoint(
                    files=uploads,
                    file=None,
                    pipeline="auto",
                    method="auto",
                    target_aspect_ratio=None,
                    margin_top=None,
                    margin_right=None,
                    margin_bottom=None,
                    margin_left=None,
                    anchor_hint=None,
                    crop_coordinates=None,
                    filters=None,
                    _=None,
                )
            )
    finally:
        fastapi_main_module.MAX_BATCH_FILES = original_max

    too_many_response = asyncio.run(
        fastapi_main_module.canonical_http_exception_handler(request, too_many_exc.value)
    )
    assert too_many_response.status_code == 413
    too_many_payload = json.loads(too_many_response.body)
    assert too_many_payload["errors"][0]["code"] == "validation_error"
    assert too_many_payload["errors"][0]["details"] == {"statusCode": 413}
