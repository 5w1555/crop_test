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

const CRC32_TABLE = new Uint32Array(256).map((_, index) => {
  let crc = index;
  for (let i = 0; i < 8; i += 1) {
    crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatUint8Arrays(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    output.set(chunk, offset);
    offset += chunk.length;
  });
  return output;
}

function dataUrlToBytes(dataUrl) {
  const [, base64 = ""] = dataUrl.split(",");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function buildZipArchive(files) {
  const encoder = new TextEncoder();
  const localFileHeaders = [];
  const centralDirectoryHeaders = [];
  let currentOffset = 0;

  files.forEach((file) => {
    const fileNameBytes = encoder.encode(file.name);
    const fileBytes = dataUrlToBytes(file.imageDataUrl);
    const checksum = crc32(fileBytes);

    const localHeader = new Uint8Array(30 + fileNameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, fileBytes.length, true);
    localView.setUint32(22, fileBytes.length, true);
    localView.setUint16(26, fileNameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(fileNameBytes, 30);
    localFileHeaders.push(localHeader, fileBytes);

    const centralHeader = new Uint8Array(46 + fileNameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, fileBytes.length, true);
    centralView.setUint32(24, fileBytes.length, true);
    centralView.setUint16(28, fileNameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, currentOffset, true);
    centralHeader.set(fileNameBytes, 46);
    centralDirectoryHeaders.push(centralHeader);

    currentOffset += localHeader.length + fileBytes.length;
  });

  const centralDirectory = concatUint8Arrays(centralDirectoryHeaders);

  const endHeader = new Uint8Array(22);
  const endView = new DataView(endHeader.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralDirectory.length, true);
  endView.setUint32(16, currentOffset, true);
  endView.setUint16(20, 0, true);

  return new Blob(
    [...localFileHeaders, centralDirectory, endHeader],
    { type: "application/zip" },
  );
}

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const apiHealthy = await health();
  return { apiHealthy };
};

export const action = async ({ request }) => {
  await authenticate.admin(request);

  const formData = await request.formData();
  const files = formData.getAll("file");
  if (!files.length) return { error: "Please upload at least one image." };

  for (const file of files) {
    const fileError = validateImageFile(file);
    if (fileError) {
      return { error: `${file instanceof File ? file.name : "File"}: ${fileError}` };
    }
  }

  const method = formData.get("method") || "auto";

  try {
    const results = await Promise.all(
      files.map(async (file) => {
        const response = await cropImage(file, { method });
        const mimeType = response.headers.get("content-type") || "image/png";
        const buffer = Buffer.from(await response.arrayBuffer());
        const extension = mimeType.includes("jpeg") ? "jpg" : mimeType.split("/")[1] || "png";
        const safeBaseName = (file.name || "output")
          .replace(/\.[^.]+$/, "")
          .replace(/[^a-zA-Z0-9_-]+/g, "-");

        return {
          name: `${safeBaseName || "output"}-cropped.${extension}`,
          mimeType,
          outputSizeBytes: buffer.byteLength,
          imageDataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
        };
      }),
    );

    return { results };
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
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [selectedMethod, setSelectedMethod] = useState("auto");
  const [croppedResults, setCroppedResults] = useState([]);
  const [batchOutputUrl, setBatchOutputUrl] = useState("");

  const isPosting =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.data?.results?.length) {
      shopify.toast.show(`Cropped ${fetcher.data.results.length} image(s) successfully`);
    }

    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  useEffect(() => {
    if (fetcher.data?.results) {
      setCroppedResults(fetcher.data.results);
    }
  }, [fetcher.data?.results]);

  useEffect(() => {
    return () => {
      if (batchOutputUrl) {
        URL.revokeObjectURL(batchOutputUrl);
      }
    };
  }, [batchOutputUrl]);

  useEffect(() => {
    if (!croppedResults.length) {
      setBatchOutputUrl((previousBatchOutputUrl) => {
        if (previousBatchOutputUrl) {
          URL.revokeObjectURL(previousBatchOutputUrl);
        }
        return "";
      });
      return;
    }

    const nextBatchUrl = URL.createObjectURL(buildZipArchive(croppedResults));
    setBatchOutputUrl((previousBatchOutputUrl) => {
      if (previousBatchOutputUrl) {
        URL.revokeObjectURL(previousBatchOutputUrl);
      }
      return nextBatchUrl;
    });
  }, [croppedResults]);

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

  const hasValidSelection = selectedFiles.length > 0 && !fileError;

  return (
    <s-page heading="Crop Images">
      <s-section heading="FastAPI connection">
        <s-banner tone={apiHealthy ? "success" : "critical"}>
          {apiHealthy
            ? "Connected to Smart Crop API"
            : "FastAPI service is unreachable. Set SMARTCROP_API_URL and verify /health."}
        </s-banner>
      </s-section>

      <s-section heading="1) Upload and configure">
        <s-paragraph>
          Upload one or more images, choose one of the crop methods implemented by
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
              multiple
              accept="image/*"
              required
              onChange={(event) => {
                const nextFiles = Array.from(event.currentTarget.files ?? []);
                const nextError = nextFiles
                  .map((file) => {
                    const error = validateImageFile(file);
                    return error ? `${file.name}: ${error}` : null;
                  })
                  .find(Boolean);

                setFileError(nextError || "");
                setCroppedResults([]);
                if (batchOutputUrl) {
                  URL.revokeObjectURL(batchOutputUrl);
                  setBatchOutputUrl("");
                }

                setSelectedFiles(
                  nextError
                    ? []
                    : nextFiles.map((file) => ({
                        name: file.name,
                        mimeType: file.type,
                        sizeBytes: file.size,
                      })),
                );
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
              disabled={!apiHealthy || !hasValidSelection || isPosting}
              {...(isPosting ? { loading: true } : {})}
            >
              Crop images
            </s-button>

            {loadingText && <s-text>{loadingText}</s-text>}
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section heading="2) Selected images">
        {!selectedFiles.length && <s-paragraph>Select one or more images to continue.</s-paragraph>}
        {selectedFiles.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">Name</th>
                <th align="left">MIME type</th>
                <th align="right">Size (KB)</th>
              </tr>
            </thead>
            <tbody>
              {selectedFiles.map((file) => (
                <tr key={`${file.name}-${file.sizeBytes}`}>
                  <td>{file.name}</td>
                  <td>{file.mimeType}</td>
                  <td align="right">{(file.sizeBytes / 1024).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </s-section>

      <s-section heading="3) Cropped output">
        <s-paragraph>Status: {apiStatusText}</s-paragraph>

        {fetcher.data?.error && (
          <s-banner tone="critical">{fetcher.data.error}</s-banner>
        )}

        {croppedResults.length > 0 && (
          <s-stack direction="block" gap="base">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th align="left">Output file</th>
                  <th align="left">Type</th>
                  <th align="right">Size (KB)</th>
                </tr>
              </thead>
              <tbody>
                {croppedResults.map((result) => (
                  <tr key={result.name}>
                    <td>{result.name}</td>
                    <td>{result.mimeType}</td>
                    <td align="right">{(result.outputSizeBytes / 1024).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <s-stack direction="inline" gap="base">
              <s-button
                variant="secondary"
                onClick={() => {
                  setSelectedFiles([]);
                  setCroppedResults([]);
                  setFileError("");
                  setSelectedMethod("auto");
                  if (batchOutputUrl) {
                    URL.revokeObjectURL(batchOutputUrl);
                  }
                  setBatchOutputUrl("");
                  inputRef.current?.form?.reset();
                  inputRef.current?.focus();
                }}
              >
                Re-crop
              </s-button>
              {batchOutputUrl && <a href={batchOutputUrl} download="cropped-images.zip">Download ZIP</a>}
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
