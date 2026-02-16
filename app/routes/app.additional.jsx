import { Buffer } from "node:buffer";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { cropImage, health } from "../utils/smartCropClient";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

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
  const [outputDimensions, setOutputDimensions] = useState(null);

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
      <s-section heading="Upload and crop">
        <s-paragraph>
          Upload a source image, choose a crop method, and run Smart Crop.
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
              }}
            />
            {fileError && <s-text tone="critical">{fileError}</s-text>}

            <label htmlFor="method">Crop method</label>
            <select id="method" name="method" defaultValue="auto">
              <option value="auto">auto</option>
              <option value="head_bust">head_bust</option>
              <option value="frontal">frontal</option>
              <option value="profile">profile</option>
              <option value="chin">chin</option>
              <option value="nose">nose</option>
              <option value="below_lips">below_lips</option>
            </select>

            <s-button
              type="submit"
              disabled={!hasSelectedFile || Boolean(fileError) || isPosting}
              {...(isPosting ? { loading: true } : {})}
            >
              Crop image
            </s-button>

            {loadingText && <s-text>{loadingText}</s-text>}
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section heading="Result">
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
