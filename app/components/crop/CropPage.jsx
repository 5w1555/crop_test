import { useCallback, useMemo, useState } from "react";
import { useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { parseCanonicalCropResponse } from "../../utils/cropRequestContract.js";
import { useCropWorkflow } from "./useCropWorkflow.js";
import MediaSelector from "./MediaSelector.jsx";
import PresetSelector from "./PresetSelector.jsx";
import CropSubmitPanel from "./CropSubmitPanel.jsx";
import CropResultPanel from "./CropResultPanel.jsx";

const PRESET_OPTIONS = [
  {
    value: "auto",
    label: "Auto (recommended)",
    method: "auto",
    description: "Best default for mixed catalog uploads.",
  },
  {
    value: "portrait",
    label: "Portrait",
    method: "head_bust",
    description: "Head-and-shoulders framing for profile imagery.",
  },
  {
    value: "product",
    label: "Product",
    method: "auto",
    description: "Balanced product framing.",
  },
  {
    value: "square",
    label: "Square",
    method: "chin",
    description: "Tighter composition for square presentation.",
  },
];

function buildEmbeddedRequestQueryString(search, sessionToken = "") {
  const allowed = new URLSearchParams();
  const params = new URLSearchParams(search || "");
  ["shop", "host", "embedded"].forEach((key) => {
    const value = params.get(key);
    if (value) allowed.set(key, value);
  });
  if (sessionToken) allowed.set("id_token", sessionToken);
  const query = allowed.toString();
  return query ? `?${query}` : "";
}

function extractCropJobId(payload) {
  return typeof payload?.jobId === "string" && payload.jobId.trim() ? payload.jobId.trim() : "";
}

export default function CropPage() {
  const { appOrigin } = useLoaderData();
  const shopify = useAppBridge();
  const { state: workflowState, isBusy, beginSubmit, acceptSubmit, finishSuccess, finishFailure } = useCropWorkflow();

  const [selectedPreset, setSelectedPreset] = useState("auto");
  const [selectedUploadFiles, setSelectedUploadFiles] = useState([]);
  const [selectedShopifyMedia, setSelectedShopifyMedia] = useState([]);
  const [fileError, setFileError] = useState("");
  const [result, setResult] = useState(null);

  const selectedMethod = useMemo(() => {
    return PRESET_OPTIONS.find((preset) => preset.value === selectedPreset)?.method || "auto";
  }, [selectedPreset]);

  const selectedFiles = useMemo(() => {
    if (selectedUploadFiles.length) {
      return selectedUploadFiles.map((file) => ({ name: file.name }));
    }
    return selectedShopifyMedia.map((media) => ({ name: media.sourceUrl || media.mediaId || "shopify-media" }));
  }, [selectedShopifyMedia, selectedUploadFiles]);

  const selectionCount = selectedUploadFiles.length || selectedShopifyMedia.length;

  const showToast = useCallback((message, options) => {
    if (shopify?.toast?.show) {
      shopify.toast.show(message, options);
    }
  }, [shopify]);

  const pollJobStatus = useCallback(async (jobId) => {
    const idToken = await shopify.idToken();
    const statusUrl = `${appOrigin}/app/additional/status/${jobId}${buildEmbeddedRequestQueryString(
      typeof window === "undefined" ? "" : window.location.search,
      idToken,
    )}`;

    let isComplete = false;
    let finalPayload = null;
    while (!isComplete) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const response = await fetch(statusUrl, { headers: { Authorization: `Bearer ${idToken}` } });
      const payload = await response.json();

      if (!response.ok) throw new Error(payload?.error || "Failed to fetch crop status.");
      if (payload?.status === "succeeded" || payload?.status === "failed" || payload?.status === "partial_failure") {
        finalPayload = payload;
        isComplete = true;
      }
    }

    return finalPayload;
  }, [appOrigin, shopify]);

  const submitCrop = useCallback(async () => {
    if (!selectionCount) {
      setFileError("Please select at least one image.");
      return;
    }

    beginSubmit();
    setResult(null);

    try {
      const formData = new FormData();
      selectedUploadFiles.forEach((file) => formData.append("file", file, file.name || "upload"));
      selectedShopifyMedia.forEach((media) => {
        formData.append("selected_media_id", media.mediaId || "");
        formData.append("selected_product_id", media.productId || "");
      });

      formData.set("method", selectedMethod);
      formData.set("pipeline", "auto");
      formData.set("pipeline_stages", "auto");
      formData.set("target_aspect_ratio", "");
      formData.set("margin_top", "");
      formData.set("margin_right", "");
      formData.set("margin_bottom", "");
      formData.set("margin_left", "");
      formData.set("anchor_hint", "");
      formData.set("filters", "");
      formData.set("crop_coordinates", "");

      const idToken = await shopify.idToken();
      const submitUrl = `${appOrigin}/app/additional${buildEmbeddedRequestQueryString(
        typeof window === "undefined" ? "" : window.location.search,
        idToken,
      )}`;

      const response = await fetch(submitUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
        body: formData,
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Crop request failed.");

      const jobId = extractCropJobId(payload);
      if (!jobId) throw new Error("Missing crop job ID.");
      acceptSubmit(jobId);

      const statusPayload = await pollJobStatus(jobId);
      const normalized = parseCanonicalCropResponse(statusPayload, { files: selectedFiles });
      if (!normalized) throw new Error("Unexpected crop status response.");

      setResult(normalized);
      finishSuccess(normalized);
      showToast("Crop job completed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to crop image.";
      finishFailure({ message });
      showToast(message, { isError: true });
    }
  }, [
    acceptSubmit,
    appOrigin,
    beginSubmit,
    finishFailure,
    finishSuccess,
    pollJobStatus,
    selectedFiles,
    selectedMethod,
    selectedShopifyMedia,
    selectedUploadFiles,
    selectionCount,
    shopify,
    showToast,
  ]);

  return (
    <s-page heading="Crop Images">
      <s-stack direction="block" gap="base">
        <MediaSelector
          appOrigin={appOrigin}
          shopify={shopify}
          selectedUploadFiles={selectedUploadFiles}
          selectedShopifyMedia={selectedShopifyMedia}
          fileError={fileError}
          onUploadFilesChange={setSelectedUploadFiles}
          onShopifyMediaChange={setSelectedShopifyMedia}
          onError={setFileError}
          showToast={showToast}
          buildEmbeddedRequestQueryString={buildEmbeddedRequestQueryString}
        />

        <PresetSelector presets={PRESET_OPTIONS} selectedPreset={selectedPreset} onChange={setSelectedPreset} />

        <CropSubmitPanel
          selectionCount={selectionCount}
          isSubmitting={isBusy}
          disabled={isBusy || !!fileError || !selectionCount}
          onSubmit={submitCrop}
        />

        <CropResultPanel workflowState={workflowState} result={result} />
      </s-stack>
    </s-page>
  );
}
