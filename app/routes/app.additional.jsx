import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { PLAN_CONFIG, buildPlanView } from "../utils/plan.js";
import {
  commitPlanUsage,
  getShopPlanUsage,
  reservePlanCapacity,
} from "../utils/plan.server.js";
import { cropImages, health } from "../utils/smartCropClient";
import { getBillingState } from "../utils/billing.server";
import { PRO_PLAN } from "../utils/billing";
import { prepareDownloadFromResponse } from "../utils/preparedDownloads.server";

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
    description:
      "Anchors composition just below the lips for tighter portrait crops.",
  },
];

const PRESET_OPTIONS = [
  {
    value: "auto",
    label: "Auto (recommended)",
    method: "auto",
    description:
      "Best default for mixed catalog uploads. The app decides the crop strategy.",
  },
  {
    value: "portrait",
    label: "Portrait",
    method: "head_bust",
    description: "Head-and-shoulders framing for model and profile imagery.",
  },
  {
    value: "product",
    label: "Product",
    method: "auto",
    description:
      "Balanced product framing with content fallback when no face is present.",
  },
  {
    value: "square",
    label: "Square",
    method: "chin",
    description:
      "Tighter composition preferred for social grids and square presentation.",
  },
];

function validateImageFile(file) {
  if (!(file instanceof File)) {
    return "Please upload an image.";
  }

  if (!file.type.startsWith("image/")) {
    return "Only image files are supported.";
  }

  return null;
}

export const loader = async ({ request }) => {
  const { session, admin, billing } = await authenticate.admin(request);
  const apiHealthy = await health();
  const billingState = await getBillingState({ billing });

  let products = [];
  let productContextWarning = null;

  try {
    const productsResponse = await admin.graphql(
      `#graphql
      query CropReadyProducts {
        products(first: 5, sortKey: UPDATED_AT, reverse: true) {
          nodes {
            id
            title
            handle
            totalInventory
            featuredMedia {
              preview {
                image {
                  url
                  altText
                }
              }
            }
          }
        }
      }`,
    );

    const productsJson = await productsResponse.json();

    if (Array.isArray(productsJson?.errors) && productsJson.errors.length > 0) {
      console.error(
        "Failed to load product context from Shopify Admin GraphQL",
        {
          shop: session.shop,
          requestId: productsResponse.headers.get("x-request-id") || null,
          graphqlErrors: productsJson.errors,
        },
      );

      productContextWarning = "Product context is temporarily unavailable.";
    } else {
      products = productsJson.data?.products?.nodes || [];
    }
  } catch (error) {
    console.error("Failed to load product context from Shopify Admin GraphQL", {
      shop: session.shop,
      requestId: null,
      graphqlErrors: null,
      error: error instanceof Error ? error.message : String(error),
    });

    productContextWarning = "Product context is temporarily unavailable.";
  }

  const planUsage = buildPlanView(
    await getShopPlanUsage(session.shop, {
      hasActiveProPlan: billingState.hasActivePayment,
    }),
  );

  return {
    apiHealthy,
    planUsage,
    hasActiveProPlan: billingState.hasActivePayment,
    products,
    productContextWarning,
  };
};

export const action = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);
  const startedAt = Date.now();

  const formData = await request.formData();
  const files = formData.getAll("file");

  if (!files.length) return { error: "Please upload at least one image." };

  for (const file of files) {
    const fileError = validateImageFile(file);
    if (fileError) {
      return {
        error: `${file instanceof File ? file.name : "File"}: ${fileError}`,
      };
    }
  }

  const method = String(formData.get("method") || "auto");
  const billingState = await getBillingState({ billing });
  const planReservation = await reservePlanCapacity({
    shop: session.shop,
    imageCount: files.length,
    method,
    hasActiveProPlan: billingState.hasActivePayment,
  });

  if (!planReservation.ok) {
    return { error: planReservation.error, plan: planReservation.plan };
  }

  try {
    const response = await cropImages(files, {
      method: planReservation.effectiveMethod,
    });
    const elapsedMs = Date.now() - startedAt;

    const metadataFromHeaders = (() => {
      const parseNumeric = (value) => {
        if (value === null || value === undefined || value === "") return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };

      const parseManifestHeader = () => {
        const possibleManifestHeaders = [
          "x-smartcrop-manifest",
          "x-manifest",
          "x-crop-manifest",
        ];

        for (const headerName of possibleManifestHeaders) {
          const rawValue = response.headers.get(headerName);
          if (!rawValue) continue;

          try {
            const parsed = JSON.parse(rawValue);
            if (parsed && typeof parsed === "object") {
              return parsed;
            }
          } catch {
            // ignore malformed manifest headers
          }
        }

        return null;
      };

      const manifest = parseManifestHeader();
      const processedCount =
        parseNumeric(response.headers.get("x-processed-count")) ??
        parseNumeric(manifest?.processed_count) ??
        parseNumeric(manifest?.processedCount) ??
        files.length;
      const failedCount =
        parseNumeric(response.headers.get("x-failed-count")) ??
        parseNumeric(manifest?.failed_count) ??
        parseNumeric(manifest?.failedCount) ??
        Math.max(files.length - processedCount, 0);
      const elapsedFromManifest =
        parseNumeric(response.headers.get("x-elapsed-ms")) ??
        parseNumeric(manifest?.elapsed_ms) ??
        parseNumeric(manifest?.elapsedMs) ??
        null;

      return {
        requestedCount: files.length,
        processedCount,
        failedCount,
        elapsedMs: elapsedFromManifest ?? elapsedMs,
        manifest,
      };
    })();

    const mimeType =
      response.headers.get("content-type") || "application/octet-stream";
    if (!mimeType.includes("application/zip")) {
      const bodyPreview = (await response.text()).slice(0, 500);
      console.error("Smart Crop API returned unexpected content type", {
        mimeType,
        bodyPreview,
      });
      return {
        error: `Expected application/zip response but received ${mimeType}.`,
      };
    }

    await commitPlanUsage({ shop: session.shop, imageCount: files.length });

    const prepared = await prepareDownloadFromResponse(response);
    return Response.json({
      ok: true,
      filename: prepared.filename,
      downloadUrl: `/download?token=${prepared.token}`,
      expiresInSeconds: prepared.expiresInSeconds,
      metadata: {
        ...metadataFromHeaders,
        elapsedSeconds: Number(
          (metadataFromHeaders.elapsedMs / 1000).toFixed(2),
        ),
      },
    });
  } catch (error) {
    console.error("Crop action failed", {
      error: error instanceof Error ? error.message : error,
      fileCount: files.length,
      method: planReservation.effectiveMethod,
    });
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to crop image. Check the FastAPI service.",
    };
  }
};

export default function CropImagePage() {
  const {
    apiHealthy,
    planUsage,
    hasActiveProPlan,
    products,
    productContextWarning,
  } = useLoaderData();
  const cropFetcher = useFetcher();
  const shopify = useAppBridge();

  const inputRef = useRef(null);
  const previewUrlRef = useRef("");
  const [fileError, setFileError] = useState("");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [selectedFileObjects, setSelectedFileObjects] = useState([]);
  const [previewFile, setPreviewFile] = useState(null);
  const [selectedPreset, setSelectedPreset] = useState("auto");
  const [advancedMethodOverrideEnabled, setAdvancedMethodOverrideEnabled] =
    useState(false);
  const [advancedMethod, setAdvancedMethod] = useState("auto");
  const [isDragActive, setIsDragActive] = useState(false);
  const [isSubmittingDownload, setIsSubmittingDownload] = useState(false);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [downloadLink, setDownloadLink] = useState("");
  const [downloadExpiryAt, setDownloadExpiryAt] = useState(null);
  const [downloadFailureMessage, setDownloadFailureMessage] = useState("");
  const [progressStep, setProgressStep] = useState("idle");

  const showToast = useCallback(
    (message, options) => {
      if (typeof window === "undefined") {
        return;
      }

      if (
        !shopify ||
        !shopify.toast ||
        typeof shopify.toast.show !== "function"
      ) {
        return;
      }

      shopify.toast.show(message, options);
    },
    [shopify],
  );

  useEffect(() => {
    if (cropFetcher.state !== "idle") {
      setProgressStep("uploading");
      const processingTimer = setTimeout(
        () => setProgressStep("processing"),
        500,
      );
      const preparingTimer = setTimeout(
        () => setProgressStep("preparing_zip"),
        1400,
      );

      return () => {
        clearTimeout(processingTimer);
        clearTimeout(preparingTimer);
      };
    }

    if (cropFetcher.data?.ok && cropFetcher.data.downloadUrl) {
      setProgressStep("ready");
      return;
    }

    setProgressStep("idle");
  }, [cropFetcher.data, cropFetcher.state]);

  useEffect(() => {
    if (cropFetcher.state !== "idle") {
      setIsSubmittingDownload(true);
      return;
    }

    setIsSubmittingDownload(false);

    if (!cropFetcher.data) {
      return;
    }

    if (!cropFetcher.data.ok || !cropFetcher.data.downloadUrl) {
      showToast(cropFetcher.data.error || "Unable to prepare download link.", {
        isError: true,
      });
      return;
    }

    setDownloadFailureMessage("");
    setDownloadLink(cropFetcher.data.downloadUrl);
    setDownloadExpiryAt(
      typeof cropFetcher.data.expiresInSeconds === "number"
        ? new Date(Date.now() + cropFetcher.data.expiresInSeconds * 1000)
        : null,
    );
    showToast(
      `Download is ready${cropFetcher.data.filename ? `: ${cropFetcher.data.filename}` : ""}`,
    );
  }, [cropFetcher.data, cropFetcher.state, showToast]);

  const apiStatusText = useMemo(() => {
    if (apiHealthy) return "Connected";
    return "FastAPI service is unreachable";
  }, [apiHealthy]);

  const loadingText = useMemo(() => {
    const progressTextByStep = {
      idle: "",
      uploading: "Uploading images…",
      processing: "Processing crops…",
      preparing_zip: "Preparing ZIP…",
      ready: "Ready to download.",
    };

    return progressTextByStep[progressStep] || "";
  }, [progressStep]);

  const resultSummary = useMemo(() => {
    if (!cropFetcher.data?.ok || !cropFetcher.data?.metadata) return null;

    const {
      requestedCount = 0,
      processedCount = 0,
      failedCount = 0,
      elapsedMs,
      elapsedSeconds,
    } = cropFetcher.data.metadata;

    return {
      requestedCount,
      processedCount,
      failedCount,
      elapsedLabel:
        elapsedSeconds ??
        (typeof elapsedMs === "number"
          ? Number((elapsedMs / 1000).toFixed(2))
          : null),
    };
  }, [cropFetcher.data]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  const syncPreviewFile = (nextFiles) => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = "";
    }

    const firstFile = nextFiles[0];
    if (!firstFile) {
      setPreviewFile(null);
      return;
    }

    const previewUrl = URL.createObjectURL(firstFile);
    previewUrlRef.current = previewUrl;
    setPreviewFile({
      name: firstFile.name,
      src: previewUrl,
    });
  };

  const syncSelectedFiles = (nextFiles) => {
    const nextError = nextFiles
      .map((file) => {
        const error = validateImageFile(file);
        return error ? `${file.name}: ${error}` : null;
      })
      .find(Boolean);

    setFileError(nextError || "");
    syncPreviewFile(nextError ? [] : nextFiles);
    setSelectedFileObjects(nextError ? [] : nextFiles);
    setSelectedFiles(
      nextError
        ? []
        : nextFiles.map((file) => ({
            name: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          })),
    );
  };

  const hasValidSelection = selectedFiles.length > 0 && !fileError;
  const selectedPresetConfig =
    PRESET_OPTIONS.find((preset) => preset.value === selectedPreset) ||
    PRESET_OPTIONS[0];
  const selectedMethod = advancedMethodOverrideEnabled
    ? advancedMethod
    : selectedPresetConfig.method;
  const selectedMethodDetails =
    CROP_METHODS.find((method) => method.value === selectedMethod) ||
    CROP_METHODS[0];

  const handleDownloadSubmit = async (event) => {
    event.preventDefault();

    if (!hasValidSelection) {
      if (fileError) {
        showToast(fileError, { isError: true });
      }
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);

    setDownloadLink("");
    setDownloadExpiryAt(null);
    setDownloadFailureMessage("");
    showToast("Cropping started. Preparing direct download link...");

    cropFetcher.submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
  };

  const submitGenerationRequest = useCallback(() => {
    if (!selectedFileObjects.length) {
      setDownloadFailureMessage(
        "Re-run requires the original files. Please upload again.",
      );
      return;
    }

    const formData = new FormData();
    selectedFileObjects.forEach((file) => formData.append("file", file));
    formData.append("method", selectedMethod);

    setDownloadLink("");
    setDownloadExpiryAt(null);
    setDownloadFailureMessage("");

    cropFetcher.submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
  }, [cropFetcher, selectedFileObjects, selectedMethod]);

  const handleDownloadClick = useCallback(async () => {
    if (!downloadLink || isDownloadingZip) {
      return;
    }

    setIsDownloadingZip(true);
    setDownloadFailureMessage("");

    try {
      const response = await fetch(downloadLink, {
        method: "GET",
        headers: {
          Accept: "application/json, application/octet-stream",
        },
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";
        let message = "Download link expired or is no longer valid.";

        if (contentType.includes("application/json")) {
          const payload = await response.json();
          if (payload?.error) {
            message = payload.error;
          }
        } else {
          const text = await response.text();
          if (text) {
            message = text;
          }
        }

        setDownloadFailureMessage(message);
        showToast(message, { isError: true });
        return;
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const contentDisposition =
        response.headers.get("content-disposition") || "";
      const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);

      anchor.href = blobUrl;
      anchor.download = filenameMatch?.[1] || "cropped-images.zip";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to download ZIP. Please regenerate and try again.";
      setDownloadFailureMessage(message);
      showToast(message, { isError: true });
    } finally {
      setIsDownloadingZip(false);
    }
  }, [downloadLink, isDownloadingZip, showToast]);

  const downloadExpiryLabel = useMemo(() => {
    if (!downloadExpiryAt) {
      return "";
    }

    return downloadExpiryAt.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }, [downloadExpiryAt]);

  const getInventoryStatus = useCallback((inventoryCount) => {
    return Number(inventoryCount) > 0 ? "In stock" : "Out of stock";
  }, []);

  return (
    <s-page heading="Crop Images">
      <style>{`
        .responsive-table {
          width: 100%;
          border-collapse: collapse;
        }

        .responsive-table th,
        .responsive-table td {
          padding: 8px;
          border-bottom: 1px solid rgba(0, 0, 0, 0.08);
          vertical-align: top;
        }

        .responsive-card-list {
          display: none;
        }

        .responsive-card {
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 8px;
          padding: 12px;
          background: var(--p-color-bg-surface, #fff);
        }

        .responsive-card-primary {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto auto;
          gap: 8px;
          align-items: start;
          margin-bottom: 8px;
        }

        .responsive-card-name {
          overflow-wrap: anywhere;
          font-weight: 600;
        }

        .responsive-card-metadata {
          display: grid;
          gap: 4px;
        }

        .responsive-card-row {
          display: flex;
          justify-content: space-between;
          gap: 8px;
        }

        @media (max-width: 900px) {
          .responsive-table {
            display: none;
          }

          .responsive-card-list {
            display: grid;
            gap: 12px;
          }
        }

        @media (max-width: 480px) {
          .responsive-card-primary {
            grid-template-columns: minmax(0, 1fr);
          }
        }
      `}</style>
      <s-section heading="FastAPI connection">
        <s-banner tone={apiHealthy ? "success" : "critical"}>
          {apiHealthy
            ? "Connected to Smart Crop API"
            : "FastAPI service is unreachable. Set SMARTCROP_API_URL and verify /health."}
        </s-banner>
      </s-section>

      <s-section heading="Plan and usage">
        <s-stack direction="block" gap="small">
          <s-text>
            Current plan: <strong>{planUsage.label}</strong>
          </s-text>
          <s-text>
            Usage this month: {planUsage.imagesProcessed}/
            {planUsage.monthlyImageLimit} images
          </s-text>
          <s-text>Remaining this month: {planUsage.remaining} images</s-text>
          {!planUsage.allowsFaceDetection && (
            <s-banner tone="info">
              Free plan uses content-aware crop only ({" "}
              <code>center_content</code>). Face detection methods are available
              on the {PLAN_CONFIG.pro.label} plan (€
              {PLAN_CONFIG.pro.monthlyPriceEur}/month).
            </s-banner>
          )}
          {!hasActiveProPlan && (
            <s-text>
              To activate {PRO_PLAN}, open{" "}
              <s-link href="/app/billing">Billing</s-link> and approve the
              Shopify app subscription.
            </s-text>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Shopify product context">
        <s-paragraph>
          Latest products from your catalog are shown below so you can quickly
          verify which assets should be exported and cropped.
        </s-paragraph>
        {productContextWarning && (
          <s-banner tone="warning">{productContextWarning}</s-banner>
        )}
        {!products.length && (
          <s-text tone="subdued">No products found yet.</s-text>
        )}
        {products.length > 0 && (
          <>
            <table className="responsive-table">
              <thead>
                <tr>
                  <th align="left">Title</th>
                  <th align="left">Status</th>
                  <th align="left">Handle</th>
                  <th align="right">Inventory</th>
                  <th align="left">Featured image</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td>{product.title}</td>
                    <td>{getInventoryStatus(product.totalInventory)}</td>
                    <td>{product.handle}</td>
                    <td align="right">{product.totalInventory ?? 0}</td>
                    <td>
                      {product.featuredMedia?.preview?.image ? (
                        <a
                          href={product.featuredMedia.preview.image.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View image
                        </a>
                      ) : (
                        <span>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="responsive-card-list">
              {products.map((product) => (
                <div key={`${product.id}-card`} className="responsive-card">
                  <div className="responsive-card-primary">
                    <span className="responsive-card-name">
                      {product.title}
                    </span>
                    <span>
                      {(product.totalInventory ?? 0).toString()} in stock
                    </span>
                    <span>{getInventoryStatus(product.totalInventory)}</span>
                  </div>
                  <div className="responsive-card-metadata">
                    <div className="responsive-card-row">
                      <span>Handle</span>
                      <span>{product.handle}</span>
                    </div>
                    <div className="responsive-card-row">
                      <span>Featured image</span>
                      {product.featuredMedia?.preview?.image ? (
                        <a
                          href={product.featuredMedia.preview.image.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View image
                        </a>
                      ) : (
                        <span>—</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </s-section>

      <s-section heading="Layer 1 — Zero friction">
        <s-paragraph>
          Drop images and run Smart Crop. For most stores, the default preset
          handles the batch without extra setup.
        </s-paragraph>

        <form
          method="post"
          encType="multipart/form-data"
          onSubmit={handleDownloadSubmit}
        >
          <s-stack direction="block" gap="base">
            <label htmlFor="file">Image files</label>
            <s-box
              padding="base"
              border="base"
              borderRadius="base"
              background={isDragActive ? "bg-fill-brand" : "bg-fill"}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setIsDragActive(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragActive(false);

                const nextFiles = Array.from(event.dataTransfer.files ?? []);
                if (!nextFiles.length) return;

                if (inputRef.current) {
                  const dataTransfer = new DataTransfer();
                  nextFiles.forEach((file) => dataTransfer.items.add(file));
                  inputRef.current.files = dataTransfer.files;
                }

                syncSelectedFiles(nextFiles);
              }}
            >
              <s-stack direction="block" gap="small">
                <s-text>Drag and drop one or more images here</s-text>
                <s-text tone="subdued">or use the picker below</s-text>
                <input
                  id="file"
                  name="file"
                  ref={inputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  required
                  onChange={(event) => {
                    const nextFiles = Array.from(
                      event.currentTarget.files ?? [],
                    );
                    syncSelectedFiles(nextFiles);
                  }}
                />
              </s-stack>
            </s-box>
            {fileError && <s-text tone="critical">{fileError}</s-text>}

            <s-box
              padding="base"
              border="base"
              borderRadius="base"
              background="bg-fill-secondary"
            >
              <s-stack direction="block" gap="small">
                <s-text fontWeight="semibold">Layer 2 — Light control</s-text>
                <s-text tone="subdued">
                  Choose a preset in plain language. You can run immediately
                  without touching advanced settings.
                </s-text>
                <label htmlFor="preset">Preset</label>
                <select
                  id="preset"
                  value={selectedPreset}
                  onChange={(event) =>
                    setSelectedPreset(event.currentTarget.value)
                  }
                >
                  {PRESET_OPTIONS.map((preset) => (
                    <option key={preset.value} value={preset.value}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                <s-text tone="subdued">
                  {selectedPresetConfig.description}
                </s-text>
              </s-stack>
            </s-box>

            <input type="hidden" name="method" value={selectedMethod} />

            <details>
              <summary>
                <strong>Layer 3 — Power user (advanced)</strong>
              </summary>
              <s-box
                padding="base"
                border="base"
                borderRadius="base"
                style={{ marginTop: "12px" }}
              >
                <s-stack direction="block" gap="small">
                  <s-text tone="subdued">
                    Fine-tune crop strategy for repeatable workflows. Collapsed
                    by default to keep first-run setup simple.
                  </s-text>
                  <label>
                    <input
                      type="checkbox"
                      checked={advancedMethodOverrideEnabled}
                      onChange={(event) =>
                        setAdvancedMethodOverrideEnabled(
                          event.currentTarget.checked,
                        )
                      }
                    />{" "}
                    Override preset method
                  </label>
                  <label htmlFor="method">Crop method</label>
                  <select
                    id="method"
                    value={advancedMethod}
                    disabled={!advancedMethodOverrideEnabled}
                    onChange={(event) =>
                      setAdvancedMethod(event.currentTarget.value)
                    }
                  >
                    {CROP_METHODS.filter((method) =>
                      planUsage.allowsFaceDetection
                        ? true
                        : method.value === "auto",
                    ).map((method) => (
                      <option key={method.value} value={method.value}>
                        {method.value}
                      </option>
                    ))}
                  </select>
                </s-stack>
              </s-box>
            </details>

            <s-box padding="base" border="base" borderRadius="base">
              <s-text fontWeight="semibold">Current crop strategy</s-text>
              {!planUsage.allowsFaceDetection && (
                <s-text tone="subdued">
                  Free plan requests are automatically processed with{" "}
                  <code>center_content</code>.
                </s-text>
              )}
              <s-text>
                <strong>{selectedMethodDetails.label}:</strong>{" "}
                {selectedMethodDetails.description}
              </s-text>
            </s-box>

            <s-button
              type="submit"
              disabled={
                !apiHealthy || !hasValidSelection || isSubmittingDownload
              }
              {...(isSubmittingDownload ? { loading: true } : {})}
            >
              Auto-crop images
            </s-button>

            {loadingText && <s-text>{loadingText}</s-text>}
          </s-stack>
        </form>

        {resultSummary && (
          <s-box
            padding="base"
            border="base"
            borderRadius="base"
            background="bg-fill-secondary"
          >
            <s-stack direction="block" gap="small">
              <s-text fontWeight="semibold">Batch result summary</s-text>
              <s-text>Requested: {resultSummary.requestedCount}</s-text>
              <s-text>Processed: {resultSummary.processedCount}</s-text>
              <s-text>Failed: {resultSummary.failedCount}</s-text>
              {resultSummary.elapsedLabel !== null && (
                <s-text>Elapsed: {resultSummary.elapsedLabel}s</s-text>
              )}
            </s-stack>
          </s-box>
        )}

        {downloadLink && (
          <s-banner tone="success">
            <s-stack direction="block" gap="small">
              <s-text>
                Your ZIP is ready. Click to download the complete processed
                batch.
              </s-text>
              {downloadExpiryLabel && (
                <s-text tone="subdued">
                  Expires at: {downloadExpiryLabel}
                </s-text>
              )}
              <s-stack direction="inline" gap="small">
                <s-button
                  variant="secondary"
                  onClick={handleDownloadClick}
                  {...(isDownloadingZip ? { loading: true } : {})}
                >
                  Download now
                </s-button>
                <s-button variant="plain" onClick={submitGenerationRequest}>
                  Regenerate download
                </s-button>
              </s-stack>
              {downloadFailureMessage && (
                <s-banner tone="warning">
                  {downloadFailureMessage}
                  {selectedFileObjects.length > 0 && (
                    <s-button variant="plain" onClick={submitGenerationRequest}>
                      Re-run generation without re-uploading
                    </s-button>
                  )}
                </s-banner>
              )}
            </s-stack>
          </s-banner>
        )}
      </s-section>

      <s-section heading="Selected images">
        {!selectedFiles.length && (
          <s-paragraph>Select one or more images to continue.</s-paragraph>
        )}
        {selectedFiles.length > 0 && (
          <>
            <table className="responsive-table">
              <thead>
                <tr>
                  <th align="left">Name</th>
                  <th align="left">Status</th>
                  <th align="left">MIME type</th>
                  <th align="right">Size (KB)</th>
                </tr>
              </thead>
              <tbody>
                {selectedFiles.map((file) => (
                  <tr key={`${file.name}-${file.sizeBytes}`}>
                    <td>{file.name}</td>
                    <td>Ready</td>
                    <td>{file.mimeType}</td>
                    <td align="right">{(file.sizeBytes / 1024).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="responsive-card-list">
              {selectedFiles.map((file) => (
                <div
                  key={`${file.name}-${file.sizeBytes}-card`}
                  className="responsive-card"
                >
                  <div className="responsive-card-primary">
                    <span className="responsive-card-name">{file.name}</span>
                    <span>{(file.sizeBytes / 1024).toFixed(1)} KB</span>
                    <span>Ready</span>
                  </div>
                  <div className="responsive-card-metadata">
                    <div className="responsive-card-row">
                      <span>MIME type</span>
                      <span>{file.mimeType}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {previewFile && (
          <s-stack direction="block" gap="small">
            <s-text fontWeight="semibold">Preview (first image only)</s-text>
            <s-text tone="subdued">{previewFile.name}</s-text>
            <img
              src={previewFile.src}
              alt={`Preview for ${previewFile.name}`}
              style={{ maxWidth: "320px", height: "auto", borderRadius: "8px" }}
            />
          </s-stack>
        )}
      </s-section>

      <s-section heading="Cropped output">
        <s-paragraph>Status: {apiStatusText}</s-paragraph>

        <s-stack direction="inline" gap="base">
          <s-button
            variant="secondary"
            onClick={() => {
              setSelectedFiles([]);
              setSelectedFileObjects([]);
              syncPreviewFile([]);
              setFileError("");
              setDownloadLink("");
              setDownloadExpiryAt(null);
              setDownloadFailureMessage("");
              setSelectedPreset("auto");
              setAdvancedMethodOverrideEnabled(false);
              setAdvancedMethod("auto");
              inputRef.current?.form?.reset();
              inputRef.current?.focus();
            }}
          >
            Reset selection
          </s-button>
          <s-text tone="subdued">
            Downloads use a generated link once the FastAPI batch ZIP has been
            fully prepared.
          </s-text>
        </s-stack>
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
