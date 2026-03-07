import importlib.util
import sys
import types
from pathlib import Path

import pytest


def _install_stubs():
    cv2_stub = types.ModuleType("cv2")
    cv2_stub.IMREAD_UNCHANGED = 1
    cv2_stub.IMREAD_COLOR = 1
    cv2_stub.COLOR_BGR2RGB = 1
    cv2_stub.COLOR_BGRA2RGBA = 1
    cv2_stub.cvtColor = lambda *args, **kwargs: None
    cv2_stub.imdecode = lambda *args, **kwargs: None

    sys.modules["cv2"] = cv2_stub

    insightface_module = types.ModuleType("insightface")
    insightface_app_module = types.ModuleType("insightface.app")

    class FaceAnalysis:
        def __init__(self, *args, **kwargs):
            return

        def prepare(self, *args, **kwargs):
            return

    insightface_app_module.FaceAnalysis = FaceAnalysis
    insightface_module.app = insightface_app_module

    sys.modules["insightface"] = insightface_module
    sys.modules["insightface.app"] = insightface_app_module


@pytest.fixture(scope="session")
def fastapi_main_module():
    _install_stubs()

    module_name = "fastapi_service_main_for_tests"
    module_path = Path(__file__).resolve().parents[1] / "main.py"
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module
