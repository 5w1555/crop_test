import { Buffer } from "node:buffer";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { cropImage, health } from "../utils/smartCropClient";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const CROP_METHODS = [
  {
    value: "auto",
    label: "Auto",
    description:
      "Automatically chooses frontal/profile logic and uses center/content fallback when no face is detected.",
  },
  {
    value: "head_bust",
    label: "Head bust",
    description:
      "Portrait-focused crop intended for head and shoulders framing.",
  },
  {
    value: "frontal",
    label: "Frontal",
    description:
      "Best when the face looks straight at the camera and both eyes are visible.",
  },
  {
    value: "profile",
    label: "Profile",
    description:
      "Optimized for side-profile shots where one side of the face is dominant.",
  },
  {
    value: "chin",
    label: "Chin",
    description: "Crops with an emphasis around the jaw/chin region.",
  },
  {
    value: "nose",
    label: "Nose",
    description: "Centers the crop relative to nose landmarks.",
  },
  {
    value: "below_lips",
    label: "Below lips",
    description: "Anchors composition just below the lips for tighter portrait crops.",
  },
];

function validateImageFile(file) {
  if (!(file instanceof File)) {
    return "Please upload an image.";
  }

  if (!file.type.startsWith("image/")) {
    return "Only image files are supported.";
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return "File must be 10MB or smaller.";
  }

  return null;
}

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const apiHealthy = await health();
  return { apiHealthy };
};

export const action = async ({ request }) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const file = formData.get("file");
  const fileError = validateImageFile(file);

  if (fileError) {
    return { error: fileError };
  }

  const method = formData.get("method") || "auto";

  try {
    const response = await cropImage(file, { method });

    const mimeType = response.headers.get("content-type") || "image/png";
    const buffer = Buffer.from(await response.arrayBuffer());
    const imageDataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;

    return {
      imageDataUrl,
      mimeType,
      outputSizeBytes: buffer.byteLength,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to crop image. Check the FastAPI service.",
    };
  }
};

export default function CropImagePage() {
  const { apiHealthy } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const inputRef = useRef(null);
  const [fileError, setFileError] = useState("");
  const [hasSelectedFile, setHasSelectedFile] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState("auto");
  const [outputDimensions, setOutputDimensions] = useState(null);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState("");
  const [sourceFileInfo, setSourceFileInfo] = useState(null);

  const isPosting =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.data?.imageDataUrl) {
      shopify.toast.show("Image cropped successfully");
    }

    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  useEffect(() => {
    if (!fetcher.data?.imageDataUrl) {
      setOutputDimensions(null);
      return;
    }

    const img = new Image();
    img.onload = () => {
      setOutputDimensions({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = fetcher.data.imageDataUrl;
  }, [fetcher.data?.imageDataUrl]);

  useEffect(() => {
    return () => {
      if (sourcePreviewUrl) {
        URL.revokeObjectURL(sourcePreviewUrl);
      }
    };
  }, [sourcePreviewUrl]);

  const apiStatusText = useMemo(() => {
    if (apiHealthy) return "Connected";
    return "FastAPI service is unreachable";
  }, [apiHealthy]);

  const loadingText = useMemo(() => {
    if (!isPosting) return "";

    if (fetcher.state === "submitting") {
      return "Uploading…";
    }

    return "Cropping…";
  }, [fetcher.state, isPosting]);

  const downloadName = useMemo(() => {
    const mime = fetcher.data?.mimeType || "image/png";
    const extension = mime.includes("jpeg") ? "jpg" : mime.split("/")[1] || "png";
    return `cropped-output.${extension}`;
  }, [fetcher.data?.mimeType]);

  return (
    <s-page heading="Crop Image">
      <s-section heading="FastAPI connection">
        <s-banner tone={apiHealthy ? "success" : "critical"}>
          {apiHealthy
            ? "Connected to Smart Crop API"
            : "FastAPI service is unreachable. Set SMARTCROP_API_URL and verify /health."}
        </s-banner>
      </s-section>

      <s-section heading="1) Upload and configure">
        <s-paragraph>
          Upload an image, choose one of the crop methods implemented by
          <code> fastapi_service/main.py </code>, and run Smart Crop.
        </s-paragraph>

        <fetcher.Form method="post" encType="multipart/form-data">
          <s-stack direction="block" gap="base">
            <label htmlFor="file">Image file</label>
            <input
              id="file"
              name="file"
              ref={inputRef}
              type="file"
              accept="image/*"
              required
              onChange={(event) => {
                const nextFile = event.currentTarget.files?.[0];
                const nextError = validateImageFile(nextFile);

                setHasSelectedFile(Boolean(nextFile));
                setFileError(nextError || "");

                if (sourcePreviewUrl) {
                  URL.revokeObjectURL(sourcePreviewUrl);
                }

                if (nextFile && !nextError) {
                  setSourcePreviewUrl(URL.createObjectURL(nextFile));
                  setSourceFileInfo({
                    name: nextFile.name,
                    mimeType: nextFile.type,
                    sizeBytes: nextFile.size,
                  });
                } else {
                  setSourcePreviewUrl("");
                  setSourceFileInfo(null);
                }
              }}
            />
            {fileError && <s-text tone="critical">{fileError}</s-text>}

            <label htmlFor="method">Crop method</label>
            <select
              id="method"
              name="method"
              value={selectedMethod}
              onChange={(event) => setSelectedMethod(event.currentTarget.value)}
            >
              {CROP_METHODS.map((method) => (
                <option key={method.value} value={method.value}>
                  {method.value}
                </option>
              ))}
            </select>

            <s-box padding="base" border="base" borderRadius="base">
              <s-text fontWeight="semibold">Method details</s-text>
              <s-stack direction="block" gap="small">
                {CROP_METHODS.map((method) => (
                  <s-text
                    key={method.value}
                    tone={selectedMethod === method.value ? "success" : "subdued"}
                  >
                    <strong>{method.label}:</strong> {method.description}
                  </s-text>
                ))}
              </s-stack>
            </s-box>

            <s-button
              type="submit"
              disabled={!apiHealthy || !hasSelectedFile || Boolean(fileError) || isPosting}
              {...(isPosting ? { loading: true } : {})}
            >
              Crop image
            </s-button>

            {loadingText && <s-text>{loadingText}</s-text>}
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section heading="2) Source preview">
        {!sourcePreviewUrl && <s-paragraph>Select an image to preview it here.</s-paragraph>}
        {sourcePreviewUrl && (
          <s-stack direction="block" gap="base">
            <img
              src={sourcePreviewUrl}
              alt="Uploaded source preview"
              style={{ maxWidth: "100%", borderRadius: 8 }}
            />
            {sourceFileInfo && (
              <s-stack direction="block" gap="tight">
                <s-paragraph>Name: {sourceFileInfo.name}</s-paragraph>
                <s-paragraph>MIME type: {sourceFileInfo.mimeType}</s-paragraph>
                <s-paragraph>
                  Size: {(sourceFileInfo.sizeBytes / 1024).toFixed(1)} KB
                </s-paragraph>
              </s-stack>
            )}
          </s-stack>
        )}
      </s-section>

      <s-section heading="3) Cropped output">
        <s-paragraph>Status: {apiStatusText}</s-paragraph>

        {fetcher.data?.error && (
          <s-banner tone="critical">{fetcher.data.error}</s-banner>
        )}

        {fetcher.data?.imageDataUrl && (
          <s-stack direction="block" gap="base">
            <img
              src={fetcher.data.imageDataUrl}
              alt="Cropped output"
              style={{ maxWidth: "100%", borderRadius: 8 }}
            />

            <s-stack direction="block" gap="tight">
              {outputDimensions && (
                <s-paragraph>
                  Dimensions: {outputDimensions.width} × {outputDimensions.height}
                </s-paragraph>
              )}
              <s-paragraph>File type: {fetcher.data.mimeType || "image/png"}</s-paragraph>
              {fetcher.data.outputSizeBytes && (
                <s-paragraph>
                  File size: {(fetcher.data.outputSizeBytes / 1024).toFixed(1)} KB
                </s-paragraph>
              )}
            </s-stack>

            <s-stack direction="inline" gap="base">
              <s-button
                variant="secondary"
                onClick={() => {
                  setOutputDimensions(null);
                  setHasSelectedFile(false);
                  setFileError("");
                  setSelectedMethod("auto");
                  if (sourcePreviewUrl) {
                    URL.revokeObjectURL(sourcePreviewUrl);
                  }
                  setSourcePreviewUrl("");
                  setSourceFileInfo(null);
                  inputRef.current?.form?.reset();
                  inputRef.current?.focus();
                }}
              >
                Re-crop
              </s-button>
              <a href={fetcher.data.imageDataUrl} download={downloadName}>
                Download
              </a>
            </s-stack>
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
