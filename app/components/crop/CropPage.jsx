import { useCallback, useMemo, useState } from "react";
import { useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  applyRouteCropRequestContract,
  DEFAULT_CROP_OPTION_VALUES,
  parseCanonicalCropResponse,
} from "../../lib/crop/contract.js";
import { useCropWorkflow } from "./useCropWorkflow.js";
import MediaSelector from "./MediaSelector.jsx";
import PresetSelector from "./PresetSelector.jsx";
import CropSubmitPanel from "./CropSubmitPanel.jsx";
import CropResultPanel from "./CropResultPanel.jsx";
import { buildResponseDiagnostics, mapDiagnosticsToErrorMessage, readJsonPayload } from "./apiClient.js";

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
    const statusUrl = `${appOrigin}/app/crop/status/${jobId}${buildEmbeddedRequestQueryString(
      typeof window === "undefined" ? "" : window.location.search,
      idToken,
    )}`;

    let isComplete = false;
    let finalPayload = null;
    while (!isComplete) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const response = await fetch(statusUrl, { headers: { Authorization: `Bearer ${idToken}` } });
      const payload = await readJsonPayload(response);
      if (!response.ok) {
        const diagnostics = await buildResponseDiagnostics(response);
        throw new Error(payload?.error || mapDiagnosticsToErrorMessage(diagnostics, "Failed to fetch crop status."));
      }
      if (!payload) {
        const diagnostics = await buildResponseDiagnostics(response);
        throw new Error(mapDiagnosticsToErrorMessage(diagnostics, "Unexpected crop status response."));
      }
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

      applyRouteCropRequestContract(formData, {
        method: selectedMethod,
        pipeline: "auto",
        pipelineStages: ["auto"],
        optionValues: DEFAULT_CROP_OPTION_VALUES,
      });

      const idToken = await shopify.idToken();
      const submitUrl = `${appOrigin}/app/crop${buildEmbeddedRequestQueryString(
        typeof window === "undefined" ? "" : window.location.search,
        idToken,
      )}`;

      const response = await fetch(submitUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
        body: formData,
      });

      const payload = await readJsonPayload(response);
      if (!response.ok) {
        const diagnostics = await buildResponseDiagnostics(response);
        throw new Error(payload?.error || mapDiagnosticsToErrorMessage(diagnostics, "Crop request failed."));
      }
      if (!payload) {
        const diagnostics = await buildResponseDiagnostics(response);
        throw new Error(mapDiagnosticsToErrorMessage(diagnostics, "Unexpected response from crop submit."));
      }

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
