from types import SimpleNamespace

import pytest
from fastapi import HTTPException


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
        filters='["sharpen", "grayscale"]',
    )

    assert options.target_aspect_ratio == (4.0, 5.0)
    assert options.margins == (0.1, 0.2, 0.3, 0.4)
    assert options.anchor_hint == "top"
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


def test_run_crop_pipeline_raises_runtime_error_when_crop_method_returns_none(monkeypatch, fastapi_main_module):
    monkeypatch.setattr(
        fastapi_main_module,
        "get_face_and_landmarks",
        lambda *args, **kwargs: ([1, 2, 3, 4], [[1, 1]], "cv", _StubImage(), {}),
    )
    monkeypatch.setattr(fastapi_main_module, "crop_profile_image", lambda *args, **kwargs: None)

    with pytest.raises(RuntimeError, match="Cropping failed"):
        fastapi_main_module.run_crop_pipeline("tmp.jpg", "profile", fastapi_main_module.CropOptions())


def test_crop_batch_endpoint_sets_binary_transport_headers(monkeypatch, fastapi_main_module):
    import asyncio
    import io

    from starlette.datastructures import Headers, UploadFile

    monkeypatch.setattr(fastapi_main_module, "run_crop_pipeline", lambda *args, **kwargs: object())
    monkeypatch.setattr(
        fastapi_main_module,
        "resolve_output_format",
        lambda *args, **kwargs: {"extension": "png", "pil_format": "PNG"},
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

    assert response.media_type == "application/zip"
    assert response.headers["content-disposition"] == 'attachment; filename="cropped_batch.zip"'
    assert response.headers["cache-control"] == "no-store, no-transform"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert int(response.headers["content-length"]) > 0

    asyncio.run(response.background())
